-- Atomic write paths.
--
-- entries_balanced is a DEFERRABLE constraint trigger, so a transaction and its
-- entries must be written inside one SQL transaction. A PostgREST insert into
-- `transactions` followed by an insert into `entries` is two HTTP calls and
-- therefore two SQL transactions, and the first one would fail at COMMIT with
-- zero entries. So every ledger write goes through one of these functions.
--
-- They are also idempotent on the primary key, which is what makes the offline
-- outbox safe to retry: replaying an op converges instead of duplicating.
--
-- security invoker: RLS still applies, and auth.uid() is the caller.

create or replace function post_transaction(
  p_id        uuid,
  p_booked_on date,
  p_payee     text,
  p_note      text,
  p_entries   jsonb
) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) < 2 then
    raise exception 'a transaction needs at least 2 entries'
      using errcode = 'check_violation';
  end if;

  insert into transactions (id, user_id, booked_on, payee, note)
  values (p_id, v_user, p_booked_on, nullif(p_payee, ''), nullif(p_note, ''))
  on conflict (id) do update
    set booked_on  = excluded.booked_on,
        payee      = excluded.payee,
        note       = excluded.note,
        deleted_at = null
    where transactions.user_id = v_user;

  -- Replace the entry set wholesale. Editing a posted transaction is rewriting
  -- its lines, and the deferred trigger judges only the final set at COMMIT.
  delete from entries where transaction_id = p_id;

  insert into entries (
    id, user_id, transaction_id, account_id,
    counterparty_id, category_id, amount_minor, due_on, position
  )
  select
    coalesce((e->>'id')::uuid, gen_random_uuid()),
    v_user,
    p_id,
    (e->>'account_id')::uuid,
    nullif(e->>'counterparty_id', '')::uuid,
    nullif(e->>'category_id', '')::uuid,
    -- text -> bigint, never through a JSON number: jsonb numbers are arbitrary
    -- precision in Postgres but the client sends minor units as strings and we
    -- keep that contract unbroken all the way into the column.
    (e->>'amount_minor')::bigint,
    nullif(e->>'due_on', '')::date,
    coalesce((e->>'position')::int, ord::int)
  from jsonb_array_elements(p_entries) with ordinality as t(e, ord);

  return p_id;
end;
$$;

create or replace function delete_transaction(p_id uuid) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  -- Soft delete. The ledger is append-only in spirit: a deleted transaction
  -- keeps its balanced entries so the trigger stays satisfied, and every read
  -- filters on deleted_at is null.
  update transactions set deleted_at = now()
  where id = p_id and user_id = auth.uid();
  return p_id;
end;
$$;

create or replace function restore_transaction(p_id uuid) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  update transactions set deleted_at = null
  where id = p_id and user_id = auth.uid();
  return p_id;
end;
$$;

revoke all on function post_transaction(uuid, date, text, text, jsonb) from public;
revoke all on function delete_transaction(uuid)  from public;
revoke all on function restore_transaction(uuid) from public;

grant execute on function post_transaction(uuid, date, text, text, jsonb) to authenticated;
grant execute on function delete_transaction(uuid)  to authenticated;
grant execute on function restore_transaction(uuid) to authenticated;
