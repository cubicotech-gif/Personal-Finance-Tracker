-- Personal Finance Tracker — initial schema
-- Single user, double-entry ledger, RLS on every table.
--
-- Money: every amount is a bigint in MINOR units (paisa for PKR, cents for USD).
-- PostgREST renders bigint as a JSON number, which is lossy past 2^53, so every
-- read in the client selects `amount_minor::text` and parses to a JS bigint.
-- Writes send strings; Postgres coerces them into bigint losslessly.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type account_type     as enum ('asset', 'liability', 'income', 'expense', 'equity');
create type currency_code    as enum ('PKR', 'USD');
create type counterparty_kind as enum ('person', 'float_client');
create type category_kind    as enum ('fixed', 'variable', 'goal');
create type period_type      as enum ('weekly', 'monthly');
create type box_transfer_kind as enum ('reallocate', 'borrow');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Today in Asia/Karachi. Every period boundary in this app is a booked_on date,
-- and booked_on is always a Karachi calendar date, never a UTC one.
create or replace function karachi_today() returns date
language sql stable as $$
  select (now() at time zone 'Asia/Karachi')::date;
$$;

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ledger tables
-- ---------------------------------------------------------------------------

create table accounts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  type       account_type not null,
  currency   currency_code not null default 'PKR',
  -- is_float marks money that is not mine: float cash held on behalf of clients
  -- (asset side) and the matching held-for-others obligation (liability side).
  is_float   boolean not null default false,
  archived   boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, name)
);

create table counterparties (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  kind       counterparty_kind not null default 'person',
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, name)
);

create table categories (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null,
  kind         category_kind not null default 'variable',
  target_minor bigint not null default 0,
  icon         text not null default '•',
  sort_order   int not null default 0,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (user_id, name),
  constraint categories_target_nonneg check (target_minor >= 0)
);

create table transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  booked_on  date not null default karachi_today(),
  payee      text,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table entries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  transaction_id  uuid not null references transactions(id) on delete cascade,
  account_id      uuid not null references accounts(id) on delete restrict,
  counterparty_id uuid references counterparties(id) on delete set null,
  category_id     uuid references categories(id) on delete set null,
  amount_minor    bigint not null,
  -- Optional settlement date for a receivable/payable line. Drives the due date
  -- column on /people; not part of the ledger arithmetic.
  due_on          date,
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table rates (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  currency     currency_code not null,
  as_of        date not null,
  -- Manually entered. numeric, never float; the client parses it into a
  -- fixed-scale bigint so conversion stays integer arithmetic end to end.
  pkr_per_unit numeric(20, 8) not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (user_id, currency, as_of),
  constraint rates_positive check (pkr_per_unit > 0)
);

-- ---------------------------------------------------------------------------
-- Budget allocation layer
--
-- These tables sit ON TOP of the ledger. They are deliberately NOT accounts:
-- an envelope is a label on money that already exists in an asset account, so
-- modelling it as an account would double-count it and break the balance sheet.
-- Nothing here ever appears in a balance, in net worth, or in an entry.
-- ---------------------------------------------------------------------------

create table periods (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  start_date date not null,
  type       period_type not null default 'monthly',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, start_date, type)
);

create table allocations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_id    uuid not null references periods(id) on delete cascade,
  category_id  uuid not null references categories(id) on delete cascade,
  amount_minor bigint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (user_id, period_id, category_id)
);

create table box_transfers (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_category_id uuid not null references categories(id) on delete cascade,
  to_category_id   uuid not null references categories(id) on delete cascade,
  amount_minor     bigint not null,
  kind             box_transfer_kind not null,
  created_on       date not null default karachi_today(),
  repaid_at        date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  constraint box_transfers_positive check (amount_minor > 0),
  constraint box_transfers_distinct check (from_category_id <> to_category_id),
  -- Only a borrow can be repaid; a reallocate moves money permanently.
  constraint box_transfers_repaid_only_borrow check (repaid_at is null or kind = 'borrow')
);

-- ---------------------------------------------------------------------------
-- The balance trigger
--
-- Double entry is enforced here, not in the app: entries can only ever be
-- written through code paths that end in a committed, balanced transaction.
--
-- Deferred, so a transaction's entries may be inserted one row at a time
-- inside one SQL transaction and are only judged as a set at COMMIT.
--
-- Balance is checked PER CURRENCY rather than across all entries. For every
-- single-currency transaction (all of them, except an actual PKR<->USD
-- exchange) this is exactly "entries sum to zero". Summing raw minor units
-- across currencies would be adding paisa to cents, which is meaningless, and
-- would make a currency exchange impossible to record at all.
-- ---------------------------------------------------------------------------
create or replace function assert_transaction_balanced() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_txn   uuid := coalesce(new.transaction_id, old.transaction_id);
  v_count int;
  v_off   text;
begin
  -- The parent transaction was deleted in this same SQL transaction; its
  -- entries went with it by cascade and there is nothing left to balance.
  if not exists (select 1 from transactions t where t.id = v_txn) then
    return null;
  end if;

  select count(*) into v_count from entries e where e.transaction_id = v_txn;
  if v_count < 2 then
    raise exception 'transaction % has % entr%, needs at least 2',
      v_txn, v_count, case when v_count = 1 then 'y' else 'ies' end
      using errcode = 'check_violation';
  end if;

  select string_agg(format('%s %s', q.currency, q.total), ', ')
    into v_off
  from (
    select a.currency, sum(e.amount_minor) as total
    from entries e
    join accounts a on a.id = e.account_id
    where e.transaction_id = v_txn
    group by a.currency
    having sum(e.amount_minor) <> 0
  ) q;

  if v_off is not null then
    raise exception 'transaction % does not balance: off by %', v_txn, v_off
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger entries_balanced
  after insert or update or delete on entries
  deferrable initially deferred
  for each row execute function assert_transaction_balanced();

-- An entry must belong to the same user as its transaction and account.
create or replace function assert_entry_ownership() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from transactions t
    where t.id = new.transaction_id and t.user_id = new.user_id
  ) then
    raise exception 'entry % references a transaction owned by another user', new.id
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from accounts a
    where a.id = new.account_id and a.user_id = new.user_id
  ) then
    raise exception 'entry % references an account owned by another user', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger entries_ownership
  before insert or update on entries
  for each row execute function assert_entry_ownership();

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'accounts', 'counterparties', 'categories', 'transactions', 'entries',
    'rates', 'periods', 'allocations', 'box_transfers'
  ] loop
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function touch_updated_at()', t || '_updated', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index accounts_user_idx        on accounts (user_id) where deleted_at is null;
create index counterparties_user_idx  on counterparties (user_id) where deleted_at is null;
create index categories_user_idx      on categories (user_id) where deleted_at is null;
create index transactions_booked_idx  on transactions (user_id, booked_on desc, created_at desc);
create index entries_txn_idx          on entries (transaction_id);
create index entries_account_idx      on entries (user_id, account_id);
create index entries_counterparty_idx on entries (user_id, counterparty_id) where counterparty_id is not null;
create index entries_category_idx     on entries (user_id, category_id) where category_id is not null;
create index rates_lookup_idx         on rates (user_id, currency, as_of desc);
create index allocations_period_idx   on allocations (user_id, period_id);
create index box_transfers_open_idx   on box_transfers (user_id) where repaid_at is null and deleted_at is null;

-- Sync cursors: the client pulls deltas by updated_at per table.
create index accounts_sync_idx       on accounts (user_id, updated_at);
create index counterparties_sync_idx on counterparties (user_id, updated_at);
create index categories_sync_idx     on categories (user_id, updated_at);
create index transactions_sync_idx   on transactions (user_id, updated_at);
create index entries_sync_idx        on entries (user_id, updated_at);
create index rates_sync_idx          on rates (user_id, updated_at);
create index periods_sync_idx        on periods (user_id, updated_at);
create index allocations_sync_idx    on allocations (user_id, updated_at);
create index box_transfers_sync_idx  on box_transfers (user_id, updated_at);

-- ---------------------------------------------------------------------------
-- RLS — enabled on every table, owner-only, no exceptions.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'accounts', 'counterparties', 'categories', 'transactions', 'entries',
    'rates', 'periods', 'allocations', 'box_transfers'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t || '_owner', t);
  end loop;
end;
$$;
