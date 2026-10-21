-- Dump who owes what, in the exact format the /setup "Money already owed"
-- paste box expects:  name <tab> direction <tab> amount <tab> due
--
-- Run this BEFORE supabase/reset.sql — the reset deletes it permanently.
--
-- A row named *** NO PERSON ATTACHED *** means those opening balances were
-- entered as a lump with no counterparty, so the app never knew who they
-- belonged to. That total has to be rebuilt from your own records; there is
-- nothing in the database to recover it from.

select
  coalesce(c.name, '*** NO PERSON ATTACHED ***')                              as name,
  case when sum(e.amount_minor) > 0 then 'owes_me' else 'i_owe' end           as direction,
  to_char(abs(sum(e.amount_minor)) / 100.0, 'FM9999999990.00')                as amount,
  coalesce(min(e.due_on) filter (where e.due_on is not null)::text, '')       as due,
  coalesce(c.kind::text, '-')                                                 as kind,
  min(t.booked_on)                                                            as since
from entries e
join accounts a      on a.id = e.account_id
join transactions t  on t.id = e.transaction_id
left join counterparties c on c.id = e.counterparty_id
where t.deleted_at is null
  -- Only receivable/payable style accounts; ordinary spending is not a debt.
  and a.type in ('asset', 'liability')
  and a.name ~* '^(receivables|payables|client float|float receivable)'
group by c.id, c.name, c.kind
-- A fully settled person nets to zero and should not be carried forward.
having sum(e.amount_minor) <> 0
order by direction, name;
