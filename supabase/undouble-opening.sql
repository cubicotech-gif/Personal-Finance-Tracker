-- Remove a duplicated opening-balances entry.
--
-- Saving /setup writes an opening transaction; it never replaces an earlier
-- one. Entering the same balances twice therefore doubles every figure, and
-- the result looks plausible rather than broken.
--
-- This keeps the FIRST opening transaction and deletes any later ones. Entries
-- cascade with their transaction, so the balances halve back. Accounts, people
-- and categories are untouched — those are matched by name and were never
-- duplicated.
--
-- Run it, then sign out and back in so the device reloads a clean copy.

begin;

-- Ordering by (created_at, id) keeps exactly one even if two were written in
-- the same instant.
delete from transactions
where payee = 'Opening balances'
  and id <> (
    select id
    from transactions
    where payee = 'Opening balances'
    order by created_at, id
    limit 1
  );

commit;

-- What is left: should be exactly one row.
select count(*) as opening_transactions_remaining
from transactions
where payee = 'Opening balances';
