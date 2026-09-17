-- Exercises the guarantees the app relies on and cannot check for itself:
-- the balance trigger, cross-currency balancing, RLS isolation, and that a
-- bigint amount survives a round trip without losing a paisa.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

create or replace function test_rejects(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
    -- Force the deferred balance trigger to fire now rather than at COMMIT.
    set constraints all immediate;
  exception
    when check_violation or foreign_key_violation or insufficient_privilege then
      raise notice 'ok   %  (rejected: %)', rpad(p_label, 46), left(sqlerrm, 60);
      return;
  end;
  raise exception 'FAIL %  was accepted but should have been rejected', p_label;
end;
$$;

create or replace function test_ok(p_label text, p_condition boolean) returns void
language plpgsql as $$
begin
  if p_condition then
    raise notice 'ok   %', p_label;
  else
    raise exception 'FAIL %', p_label;
  end if;
end;
$$;

-- Two users, so isolation can actually be tested.
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

grant execute on function test_rejects(text, text) to authenticated;
grant execute on function test_ok(text, boolean) to authenticated;

-- ===========================================================================
begin;
set local role authenticated;
set local test.user_id = '11111111-1111-1111-1111-111111111111';

insert into accounts (id, name, type, currency) values
  ('a0000000-0000-0000-0000-000000000001', 'Cash',     'asset',   'PKR'),
  ('a0000000-0000-0000-0000-000000000002', 'Expenses', 'expense', 'PKR'),
  ('a0000000-0000-0000-0000-000000000003', 'USD Cash', 'asset',   'USD'),
  ('a0000000-0000-0000-0000-000000000004', 'USD Exp',  'expense', 'USD');

-- 1. A balanced two-entry transaction is accepted -----------------------------
select post_transaction(
  '70000000-0000-0000-0000-000000000001', '2026-09-17', 'Bakery', null,
  '[{"account_id":"a0000000-0000-0000-0000-000000000001","amount_minor":"-45000"},
    {"account_id":"a0000000-0000-0000-0000-000000000002","amount_minor":"45000"}]'::jsonb);
set constraints all immediate;
select test_ok('balanced transaction accepted',
  (select sum(amount_minor) = 0 from entries where transaction_id = '70000000-0000-0000-0000-000000000001'));
set constraints all deferred;

-- 2. Entries that do not sum to zero are rejected -----------------------------
select test_rejects('unbalanced entries', $q$
  select post_transaction('70000000-0000-0000-0000-000000000002', '2026-09-17', 'Off by one', null,
    '[{"account_id":"a0000000-0000-0000-0000-000000000001","amount_minor":"-45000"},
      {"account_id":"a0000000-0000-0000-0000-000000000002","amount_minor":"44999"}]'::jsonb) $q$);

-- 3. A single entry is rejected -----------------------------------------------
select test_rejects('single-entry transaction', $q$
  insert into transactions (id, booked_on) values ('70000000-0000-0000-0000-000000000003', '2026-09-17');
  insert into entries (transaction_id, account_id, amount_minor)
    values ('70000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '0') $q$);

-- 4. Cross-currency: each currency balances on its own ------------------------
select post_transaction(
  '70000000-0000-0000-0000-000000000004', '2026-09-17', 'Mixed', null,
  '[{"account_id":"a0000000-0000-0000-0000-000000000001","amount_minor":"-10000"},
    {"account_id":"a0000000-0000-0000-0000-000000000002","amount_minor":"10000"},
    {"account_id":"a0000000-0000-0000-0000-000000000003","amount_minor":"-500"},
    {"account_id":"a0000000-0000-0000-0000-000000000004","amount_minor":"500"}]'::jsonb);
set constraints all immediate;
select test_ok('per-currency balance accepted', true);
set constraints all deferred;

-- 5. Currencies that only balance when added together are rejected ------------
select test_rejects('paisa netted against cents', $q$
  select post_transaction('70000000-0000-0000-0000-000000000005', '2026-09-17', 'Bad FX', null,
    '[{"account_id":"a0000000-0000-0000-0000-000000000001","amount_minor":"-10000"},
      {"account_id":"a0000000-0000-0000-0000-000000000003","amount_minor":"10000"}]'::jsonb) $q$);

-- 6. Re-posting the same id replaces the entry set ----------------------------
select post_transaction(
  '70000000-0000-0000-0000-000000000001', '2026-09-18', 'Bakery', 'corrected',
  '[{"account_id":"a0000000-0000-0000-0000-000000000001","amount_minor":"-52000"},
    {"account_id":"a0000000-0000-0000-0000-000000000002","amount_minor":"52000"}]'::jsonb);
set constraints all immediate;
select test_ok('edit replaces entries, still balanced', (
  select count(*) = 2 and sum(amount_minor) = 0 and max(abs(amount_minor)) = 52000
  from entries where transaction_id = '70000000-0000-0000-0000-000000000001'));
select test_ok('edit updates the transaction row',
  (select booked_on = '2026-09-18' and note = 'corrected'
   from transactions where id = '70000000-0000-0000-0000-000000000001'));
set constraints all deferred;

-- 7. bigint precision beyond 2^53 ---------------------------------------------
select post_transaction(
  '70000000-0000-0000-0000-000000000006', '2026-09-17', 'Huge', null,
  '[{"account_id":"a0000000-0000-0000-0000-000000000001","amount_minor":"-9007199254740993"},
    {"account_id":"a0000000-0000-0000-0000-000000000002","amount_minor":"9007199254740993"}]'::jsonb);
set constraints all immediate;
select test_ok('amount above 2^53 survives exactly', (
  select amount_minor::text = '9007199254740993'
  from entries
  where transaction_id = '70000000-0000-0000-0000-000000000006' and amount_minor > 0));
set constraints all deferred;

-- 8. Soft delete keeps the entries balanced -----------------------------------
select delete_transaction('70000000-0000-0000-0000-000000000006');
set constraints all immediate;
select test_ok('soft delete marks deleted_at',
  (select deleted_at is not null from transactions where id = '70000000-0000-0000-0000-000000000006'));
select test_ok('soft delete keeps entries',
  (select count(*) = 2 from entries where transaction_id = '70000000-0000-0000-0000-000000000006'));
set constraints all deferred;

-- 9. Hard delete cascades without tripping the trigger ------------------------
delete from transactions where id = '70000000-0000-0000-0000-000000000006';
set constraints all immediate;
select test_ok('cascade delete leaves no orphan entries',
  (select count(*) = 0 from entries where transaction_id = '70000000-0000-0000-0000-000000000006'));
set constraints all deferred;

-- 10. booked_on defaults to the Karachi date ----------------------------------
select test_ok('karachi_today matches Asia/Karachi',
  karachi_today() = (now() at time zone 'Asia/Karachi')::date);

commit;

-- ===========================================================================
-- RLS
-- ===========================================================================
begin;
set local role authenticated;
set local test.user_id = '22222222-2222-2222-2222-222222222222';

select test_ok('other user sees no accounts', (select count(*) = 0 from accounts));
select test_ok('other user sees no transactions', (select count(*) = 0 from transactions));
select test_ok('other user sees no entries', (select count(*) = 0 from entries));

-- An entry may not be attached to somebody else's transaction, even with a
-- guessed id: the ownership trigger checks, and RLS hides the row anyway.
select test_rejects('entry on another user''s transaction', $q$
  insert into accounts (id, name, type) values ('b0000000-0000-0000-0000-000000000001', 'Their cash', 'asset');
  insert into entries (transaction_id, account_id, amount_minor)
  values ('70000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '1') $q$);

select test_rejects('cannot write a row owned by someone else', $q$
  insert into accounts (user_id, name, type)
  values ('11111111-1111-1111-1111-111111111111', 'Sneaky', 'asset') $q$);

rollback;

-- ===========================================================================
begin;
set local role authenticated;
set local test.user_id = '11111111-1111-1111-1111-111111111111';
select test_ok('owner still sees their own accounts', (select count(*) = 4 from accounts));
rollback;

\echo 'ALL TESTS PASSED'
