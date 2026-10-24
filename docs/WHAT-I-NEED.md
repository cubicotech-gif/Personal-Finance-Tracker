# What I need from this app

A brief for whoever works on this next — human or AI. Written in my own
situation, with my real numbers, because the generic version of this app is not
the one I need.

---

## 1. Who this is for

One person, in Pakistan. PKR is the main currency, some USD arrives from
freelance work. I use the app on an Android phone and on a laptop browser. I am
the only user and there will never be another.

I am not budgeting a comfortable salary. I am **insolvent and illiquid at the
same time**, and the app has to be honest about that or it is useless to me.

---

## 2. What already exists

Working, deployed, and not to be thrown away:

- **Next.js 15** (App Router, TypeScript strict), **Tailwind 4**, deployed on Vercel
- **Supabase** Postgres + email auth, RLS forced on every table
- **Dexie (IndexedDB)** holds everything the UI reads; an outbox syncs to
  Supabase. Works fully offline. Installable PWA (Serwist).
- **Double-entry ledger.** Every transaction is 2+ entries summing to zero per
  currency, enforced by a deferred Postgres trigger, not app code.
- **118 unit tests + 18 SQL assertions** against a real Postgres.

### Non-negotiables — do not change these

1. **Money is `bigint` minor units (paisa/cents). Never a JS number, never a
   float.** It crosses the wire as a decimal *string*, because PostgREST renders
   `bigint` as a JSON number and truncates past 2^53. ESLint bans `parseInt`
   and `parseFloat`.
2. **Dates are Asia/Karachi calendar dates** (`booked_on`, a `YYYY-MM-DD`
   string). Timestamps exist but nothing reasons about them.
3. **Double entry stays enforced in Postgres**, not in the app.
4. **Budget envelopes are never accounts.** A category is a dimension on an
   entry; spending goes to one `Expenses` account per currency. If an envelope
   became an account the same rupee would be counted twice and the balance
   sheet would break.
5. **The UI reads only from IndexedDB** so it behaves the same offline.

---

## 3. My actual situation

Figures as of late October 2026.

### Cash — about Rs 61,000 across ten accounts

Meezan 9857, Meezan 1032, Meezan Baba, BankIslami, JazzCash, Bank AL Habib,
MCB, Samba, NayaPay, Cash in hand. Most hold under Rs 1,000. One or two hold
almost all of it.

### Owed to me — Rs 12,88,970

| Who | Amount |
|---|---|
| Rafay | 6,00,600 |
| Saud | 5,84,570 |
| Arshad | 1,00,000 |
| Uncles | 3,800 |

(I also owe Rafay 3,00,000, so net he owes me 3,00,600.)

### What I owe — Rs 22,87,200, and **these are not the same kind of debt**

This is the thing the app gets wrong. It adds them all up into one number.

| Who | Amount | What it actually is |
|---|---|---|
| Unclaimed freelancers ($3,000) | 8,28,000 | **Not my money.** Client money I was holding and have already spent. |
| Danish — accidental payment ($1,300) | 3,54,900 | **Not my money.** Landed in my account by mistake, must go back. |
| Danish — personal loan | 7,23,000 | **A real loan I chose to take.** Gold pledged. Due 30 Dec 2026. |
| Committee (Nov–Dec) | 60,000 | A recurring commitment that ends in December. |
| Shopkeepers (10 shops, Pepsico days) | 21,300 | Old trade debt. |
| Rafay | 3,00,000 | A loan, offsettable against what he owes me. |

**Net worth: −Rs 9,37,157.** Even if every person paid me in full, I would still
owe Rs 9.37 lakh — and nearly all of it to Danish.

**Float shortfall: about Rs 11,21,827.** That is how much of other people's
money I have already spent. It is callable any day, with no due date, and it is
the number I most need in front of me.

### Monthly

| | |
|---|---|
| Billoo salary, 1st, into Bank AL Habib | 56,000 |
| 2% commission (3-month average) | 60,000–72,000 |
| Visa / small work, irregular | 1,000–1,500 |
| Cubico | 0 for now; ~4,00,000 expected around 10 Nov |
| **Fixed expenses** | **1,56,500** |
| Groceries (to mother) | 50,000 |
| Committee (ends December) | 30,000 |
| Electricity | 20,000 |
| Room rent | 15,000 |
| Bike petrol + maintenance | 12,000 |
| Wife's pocket money | 10,000 |
| Misc | 10,000 |
| Food outside | 5,000–8,000 |
| Mobile (whole family) | 3,000 |
| Sadaqa | varies |

Irregular, on top: VU fee 12,000/semester, family extra ~25,000, weddings
~15,000, medical ~7,000.

**I lose Rs 27,000–39,500 every month.** That gap is what dug the float hole,
and it is still running. From January, when the committee ends, it narrows to
roughly −9,500 to +3,000.

---

## 4. What is broken or missing

### 4.1 I cannot record moving money between my own accounts ← biggest problem

This is how I actually live. Two real examples:

> **22 Oct** — moved money from Samba to Meezan, bought chocolate for 3,000,
> 2,000 of it is still sitting in Meezan.
>
> **23 Oct** — moved 10,000 from Meezan to BankIslami, then bought medical
> tests for my mother for 3,700.

The app has no transfer. `/log` only does money **in** or **out** with a
category or a person. The ledger and the list view already understand a
transfer — `MoneyKind` just has no `transfer` option, so nothing can create
one. I have to fake it as an expense and an income, which is wrong and
pollutes my spending figures.

I also want to **see the trail**: where this money came from, where it went
next. Not just a flat list of in and out.

### 4.2 All my debt is lumped into one number

"You owe Rs 22,87,200" is useless to me. Three completely different things are
being added together:

- **Money that was never mine** (freelancers, Danish's accidental payment) —
  callable any day, no due date, this is the emergency.
- **A real loan** (Danish 7,23,000) — deliberate, gold pledged, has a date.
- **Commitments and old trade debt** (committee, shopkeepers).

I need these grouped and shown separately, each with its own total, and
ideally treated differently — a loan with a due date and collateral is not the
same risk as money I am holding for someone who might ask tomorrow.

### 4.3 Money I must spend is mixed in with money I owe

Rent, groceries and electricity are **coming**, every month, and I have to plan
for them. They are not the same as a debt. Right now there is no sense of
"committed spending" distinct from "borrowed money".

### 4.4 Boxes (budget envelopes) do not work for me yet

The envelope screen exists and the arithmetic is correct — assign, reallocate,
borrow between boxes, carry-forward, overspend carries forward negative. But it
was built before the rest and I have never been able to use it, partly because
I could not record my real transactions in the first place.

---

## 5. What I want built

In priority order.

1. **Account-to-account transfers.** Add `transfer` as a kind in `/log`: pick
   from-account, to-account, amount. One transaction, two entries, no category,
   no counterparty, no effect on income or expense. Same currency first;
   PKR↔USD can come later (the trigger already balances per currency, so
   cross-currency works if the UI posts both legs).

2. **Debt grouped by what it actually is.** Add a kind to each obligation —
   something like `float` (not my money), `loan`, `commitment`, `trade` — and
   show them as separate groups with separate totals on `/people` and on Home.
   Never a single "you owe" figure again.

3. **A money trail.** For any account or any person, show the movements in and
   out in sequence, so I can see where money came from and where it went.

4. **Committed spending as its own thing** — what is due this month that I have
   not paid yet, separate from what I owe people.

5. **Make boxes usable**, once the above exists.

---

## 6. Deliberately out of scope

From the original brief and still true:

No charts. No reports. No export. No bank import. No recurring-transaction
automation. No notifications. No AI features. No more than 8 default
categories. No settings page beyond what setup needs.

If you think something is missing, list it rather than building it.

---

## 7. How to work on this

- Read `README.md` first — it explains the architecture and why each decision
  was made.
- `npm test` (118 unit tests), `npm run typecheck`, `npm run lint`,
  `npm run build` all pass. Keep them passing.
- `npm run test:db` runs the SQL assertions against a throwaway Postgres.
- Migrations are in `supabase/migrations/`. `supabase/reset.sql` wipes the
  ledger for a clean re-baseline.
- The read model lives in `src/lib/ledger/` and is pure and tested — add there
  first, then the screen.
