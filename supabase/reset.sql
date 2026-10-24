-- Re-baseline: wipe the ledger and start again from today's real balances.
--
-- WHEN TO USE THIS
-- You set the app up, life happened, and now every balance is stale. There is
-- no honest way to reconcile a gap you cannot account for, and no history worth
-- keeping if nothing was logged. Clear it and re-enter what is true today.
--
-- Two things that do NOT work instead, and why:
--
--   * Re-running /setup with new figures. Setup ADDS an opening transaction,
--     it does not replace the old one, so every balance would end up as
--     old + new.
--   * Editing balances by hand. There is nowhere to do it, on purpose: a
--     balance is the sum of its entries, and a figure typed over the top of
--     that would be a number the ledger cannot explain.
--
-- HOW TO USE IT
--   1. Run this whole file in the Supabase SQL editor.
--   2. In the app, open Wallets and sign out at the bottom. That clears the
--      local copy, which is what the screens actually read from.
--   3. Sign back in. With no accounts left, the app sends you to setup.
--   4. Type today's balance for each account. Everything else is pre-filled.
--
-- This deletes every ledger row for every user. The app is single-user by
-- design, so that is the whole database. It cannot be undone.

begin;

-- Budget layer first: it only ever references categories and periods.
delete from box_transfers;
delete from allocations;
delete from periods;

-- Entries cascade away with their transaction, which also releases the
-- on-delete-restrict reference that would otherwise block deleting accounts.
delete from transactions;

delete from rates;
delete from categories;
delete from counterparties;
delete from accounts;

commit;
