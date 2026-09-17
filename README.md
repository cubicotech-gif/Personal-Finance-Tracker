# Personal Finance Tracker

A single-user, offline-first double-entry ledger and budget-envelope app for
PKR/USD. Next.js 15 (App Router) + Supabase + Dexie, deployed on Vercel.

## Setting it up

1. Create a Supabase project.
2. Run the migrations in order, in the SQL editor or with the Supabase CLI:

   ```
   supabase/migrations/0001_init.sql   # schema, balance trigger, RLS
   supabase/migrations/0002_rpc.sql    # atomic ledger writes
   ```

3. Copy the env template and fill in the project URL and anon key:

   ```sh
   cp .env.example .env.local
   npm install
   npm run dev
   ```

4. Open the app, create the account (email + password), and complete the
   opening-balances screen. It accepts pasted spreadsheet cells.

On Vercel, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
and deploy — there is no server-side runtime to configure.

## Commands

| | |
|---|---|
| `npm run dev` | Dev server (service worker disabled) |
| `npm run build` | Production build, including the service worker |
| `npm run typecheck` | App and service-worker type checks |
| `npm test` | Unit tests for money, dates, paste and the read model |
| `npm run test:db` | Schema tests against a scratch Postgres (see below) |
| `npm run lint` | ESLint |

`npm run test:db` needs a throwaway Postgres; it creates the schema from
scratch and asserts on the balance trigger, cross-currency balancing, RLS
isolation and bigint precision:

```sh
PGURL=postgres://postgres@localhost:5432/pft_test npm run test:db
```

## How it is put together

**Money is never a JS number.** Every amount is a `bigint` count of minor units
(paisa, cents). The only representation changes are text ↔ bigint, at the input
box and at the wire. Amounts cross the wire as decimal *strings*, because
PostgREST renders `bigint` columns as JSON numbers and that silently truncates
past 2^53 — every read casts `amount_minor::text`. ESLint bans `parseInt` and
`parseFloat` outright.

**Dates are Karachi calendar dates.** Timestamps are stored as `timestamptz`,
but nothing reasons about them. Every date that matters is a `booked_on`
(`YYYY-MM-DD`, Asia/Karachi), handled as a string so it cannot drift across
midnight via a device timezone or a UTC round trip.

**Double entry is enforced in Postgres.** A deferred constraint trigger checks,
at COMMIT, that every transaction has at least two entries and that they sum to
zero *per currency*. Because the check is deferred, a transaction and its
entries must be written in one SQL transaction — hence the `post_transaction`
RPC, which is also idempotent on the primary key so the offline outbox is safe
to replay.

**Envelopes are an allocation layer, not accounts.** A budget category is a
dimension on an entry (`entries.category_id`), and spending goes to a single
`Expenses` account per currency. Giving each envelope its own account would make
it a ledger object and double-count the money. Nothing in `categories`,
`periods`, `allocations` or `box_transfers` ever reaches a balance or net worth.

**The local database is the source of truth the UI reads.** Every screen renders
from IndexedDB via Dexie, never from a network response, so the app behaves
identically online and offline. Supabase is a replica: an ordered outbox of
idempotent operations pushes to it, and a cursor-based delta pull brings changes
back. Last-write-wins, which for one person on two devices is both sufficient
and the only thing that can happen. There is no sync engine.

**Security is RLS, not routing.** Every table has `user_id`, `ENABLE` +
`FORCE ROW LEVEL SECURITY` and an owner-only policy. There is no server-side
Supabase client and no auth middleware, because an offline-capable PWA cannot
depend on the network to render.

### Layout

```
supabase/migrations/   schema, balance trigger, RLS, RPCs
supabase/tests/        SQL assertions for the guarantees above
src/lib/money.ts       bigint minor units; the only money arithmetic
src/lib/dates.ts       Asia/Karachi booked_on handling
src/lib/db/            Dexie schema, wire types, local-first mutations
src/lib/sync/          outbox push, delta pull, the app provider
src/lib/ledger/        the read model: balances, people, log rows, composition
src/lib/setup.ts       opening balances and spreadsheet paste
src/app/               login, setup, log, accounts, people
```

## Notes

`/boxes` is not built yet — it is the last step and is deliberately left until
the ledger is confirmed working.

The service worker does its own precaching rather than using Serwist's
`precacheEntries`. See the comment at the top of `src/app/sw.ts`: an upstream
bug in `@serwist/utils@9.5` hangs `install` forever if any single asset fails.
