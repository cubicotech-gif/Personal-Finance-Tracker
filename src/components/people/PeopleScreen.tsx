"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { Money } from "@/components/Money";
import { Sheet } from "@/components/Sheet";
import { TABBAR } from "@/components/Shell";
import { Empty, SectionTitle, cx } from "@/components/ui";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { debtPositions, splitByKind, totalOf, type DebtPosition } from "@/lib/ledger/people";
import { PersonRow } from "./PersonRow";
import { PersonSheetBody } from "./PersonSheet";

/** Height reserved for the pinned action, so content never hides behind it. */
const ACTION_H = 76;

type Tab = "owesMe" | "iOwe";

export function PeopleScreen() {
  const snapshot = useSnapshot();
  const positions = useMemo(() => debtPositions(snapshot), [snapshot]);
  const { people, floatClients } = useMemo(() => splitByKind(positions), [positions]);
  const [tab, setTab] = useState<Tab>("owesMe");

  // `session` changes on every open, which remounts the sheet body so nothing
  // typed last time survives. Closing only flips `open`, so the content stays
  // while the sheet slides away.
  const [sheet, setSheet] = useState<{ position: DebtPosition | null; session: number; open: boolean }>({
    position: null,
    session: 0,
    open: false,
  });
  const open = useCallback((position: DebtPosition) => {
    setSheet((current) => ({ position, session: current.session + 1, open: true }));
  }, []);
  const close = useCallback(() => setSheet((current) => ({ ...current, open: false })), []);

  const nobody =
    positions.length === 0 ||
    (people.owesMe.length === 0 &&
      people.iOwe.length === 0 &&
      floatClients.owesMe.length === 0 &&
      floatClients.iOwe.length === 0);

  if (nobody) {
    return (
      <div className="py-6 text-center">
        <Empty>Nobody owes anybody.</Empty>
        <Link href="/log" className="font-medium text-accent underline">
          Log a loan
        </Link>
      </div>
    );
  }

  const mine = tab === "owesMe" ? people.owesMe : people.iOwe;
  const clients = tab === "owesMe" ? floatClients.owesMe : floatClients.iOwe;

  return (
    <div className="flex flex-col" style={{ minHeight: `calc(100dvh - 48px - ${TABBAR})` }}>
      <div className="flex-1 space-y-6 pb-6">
        {/* Tabs, each carrying its own total ----------------------------- */}
        <div role="tablist" aria-label="Direction" className="grid grid-cols-2 gap-1 rounded-2xl bg-surface p-1">
          {(
            [
              ["owesMe", "Owes me", people.owesMe],
              ["iOwe", "I owe", people.iOwe],
            ] as const
          ).map(([id, label, list]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cx(
                "flex min-h-14 flex-col items-center justify-center rounded-xl transition-colors",
                tab === id ? "bg-raised text-ink" : "text-muted",
              )}
            >
              <span className="font-medium">{label}</span>
              <Money amount={totalOf(list)} tone="plain" className="text-xs" />
            </button>
          ))}
        </div>

        <section>
          <p className="t-label text-muted">{tab === "owesMe" ? "Owed to you" : "You owe"}</p>
          <Money amount={totalOf(mine)} tone="plain" countOnMount className="t-hero mt-1 block" />
        </section>

        {mine.length === 0 ? (
          <Empty>{tab === "owesMe" ? "Nobody owes you." : "You owe nobody."}</Empty>
        ) : (
          <ul className="space-y-1" aria-label={tab === "owesMe" ? "People who owe you" : "People you owe"}>
            {mine.map((position) => (
              <PersonRow key={position.counterparty.id} position={position} onOpen={open} />
            ))}
          </ul>
        )}

        {/* Float clients are a different kind of money, kept apart ----------- */}
        {clients.length > 0 && (
          <section className="mt-10">
            <SectionTitle
              action={<Money amount={totalOf(clients)} tone="plain" className="text-xs text-muted" />}
            >
              {tab === "owesMe" ? "Float clients owe me" : "Holding for float clients"}
            </SectionTitle>
            <ul className="space-y-1">
              {clients.map((position) => (
                <PersonRow key={position.counterparty.id} position={position} onOpen={open} />
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Primary action, under the thumb -------------------------------- */}
      <div
        className="sticky z-10 -mx-4 bg-canvas px-4 pt-2 pb-3"
        style={{ bottom: TABBAR, minHeight: ACTION_H }}
      >
        <Link
          href="/log"
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent font-medium text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <IconPlus size={20} stroke={2} aria-hidden />
          Lend or borrow
        </Link>
      </div>

      <Sheet open={sheet.open} onClose={close} label="Person">
        {sheet.position && <PersonSheetBody key={sheet.session} position={sheet.position} onDone={close} />}
      </Sheet>
    </div>
  );
}
