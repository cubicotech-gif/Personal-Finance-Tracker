-- Minimal stand-in for the parts of a Supabase database the migrations touch,
-- so the schema, the balance trigger and RLS can be exercised locally.
create schema if not exists auth;

create table auth.users (id uuid primary key);

-- Supabase derives auth.uid() from the request JWT; here it comes from a GUC
-- the test sets, which lets one session act as two different users.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.user_id', true), '')::uuid;
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;

-- Supabase grants these itself; the migrations assume they are in place.
grant usage on schema public to authenticated, anon;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
alter default privileges in schema public grant all on tables to authenticated;
