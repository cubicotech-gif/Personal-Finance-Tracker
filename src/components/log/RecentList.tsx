"use client";

import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "framer-motion";
import { IconArrowsLeftRight, IconArrowDownLeft, IconTrash, IconCategory2 } from "@tabler/icons-react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Money } from "@/components/Money";
import { useMemo, useState } from "react";
import { Chip, ChipRow } from "@/components/ui";
import { describe, groupLogRowsByDay, type LogRow } from "@/lib/ledger/log";

/** Drag this far left, in px, and the row is deleted on release. */
const DELETE_AT = -88;

function Glyph({ row }: { row: LogRow }) {
  if (row.direction === "transfer") return <IconArrowsLeftRight size={20} stroke={1.75} aria-hidden />;
  if (row.direction === "split") return <IconCategory2 size={20} stroke={1.75} aria-hidden />;
  if (row.category) return <CategoryIcon name={row.category.name} hint={row.category.icon} size={20} />;
  if (row.direction === "in") return <IconArrowDownLeft size={20} stroke={1.75} aria-hidden />;
  return <CategoryIcon name={describe(row)} size={20} />;
}

/**
 * Swipe left to delete, tap to edit. Delete is not confirmed — the toast that
 * follows carries the undo. A row that is dragged only part of the way springs
 * back. Backspace/Delete on a focused row deletes too, for keyboard users.
 */
function LogListRow({
  row,
  onEdit,
  onDelete,
}: {
  row: LogRow;
  onEdit: (row: LogRow) => void;
  onDelete: (row: LogRow) => void;
}) {
  const reduce = useReducedMotion();

  // Only a plain in/out gets a sign. A transfer nets to zero across my own
  // accounts and a split has no single direction, so signing either would be
  // asserting something untrue.
  const signed = row.direction === "in" || row.direction === "out";
  const inbound = row.direction === "in";

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x < DELETE_AT) onDelete(row);
  }

  return (
    <motion.li
      layout={reduce ? false : "position"}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -32, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: -48, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="relative overflow-hidden rounded-2xl bg-danger-soft"
    >
      <div className="absolute inset-y-0 right-0 flex w-24 items-center justify-center text-danger" aria-hidden>
        <IconTrash size={22} stroke={1.75} />
      </div>

      <motion.div
        drag={reduce ? false : "x"}
        dragDirectionLock
        dragConstraints={{ left: -120, right: 0 }}
        dragElastic={{ left: 0.15, right: 0 }}
        dragSnapToOrigin
        onDragEnd={onDragEnd}
        onTap={() => onEdit(row)}
        role="button"
        tabIndex={0}
        aria-label={`Edit ${describe(row)}`}
        onKeyDown={(event) => {
          if (event.key === "Enter") onEdit(row);
          if (event.key === "Delete" || event.key === "Backspace") onDelete(row);
        }}
        className="relative flex min-h-16 cursor-pointer items-center gap-3 bg-surface px-4 py-3 focus-visible:outline-2 focus-visible:outline-accent"
        style={{ touchAction: "pan-y" }}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-raised text-muted">
          <Glyph row={row} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{describe(row)}</span>
          <span className="block truncate text-muted">
            {[
              row.direction === "split" ? `${row.lineCount} lines` : null,
              row.account?.name,
              row.counterparty?.name,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <Money
          amount={signed && !inbound ? -row.amount : row.amount}
          currency={row.currency}
          signed={signed}
          tone={inbound ? "positive" : "plain"}
          className="shrink-0 font-medium"
        />
      </motion.div>
    </motion.li>
  );
}

/** "All", in or out, then whichever categories actually appear below. */
type Filter = { id: string; label: string; icon?: string };

function filtersFor(rows: LogRow[]): Filter[] {
  const categories = new Map<string, Filter>();
  for (const row of rows) {
    if (row.category && !categories.has(row.category.id)) {
      categories.set(row.category.id, {
        id: `cat:${row.category.id}`,
        label: row.category.name,
        icon: row.category.icon,
      });
    }
  }

  // Offering every category when only two were used is noise, so the list is
  // built from what is actually on screen rather than from the category table.
  return [
    { id: "all", label: "All" },
    ...(rows.some((r) => r.direction === "out") ? [{ id: "out", label: "Out" }] : []),
    ...(rows.some((r) => r.direction === "in") ? [{ id: "in", label: "In" }] : []),
    ...[...categories.values()].sort((a, b) => a.label.localeCompare(b.label)),
  ];
}

function matches(row: LogRow, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "in" || filter === "out") return row.direction === filter;
  return row.category?.id === filter.slice(4);
}

export function RecentList({
  rows,
  onEdit,
  onDelete,
}: {
  rows: LogRow[];
  onEdit: (row: LogRow) => void;
  onDelete: (row: LogRow) => void;
}) {
  const [filter, setFilter] = useState("all");

  const filters = useMemo(() => filtersFor(rows), [rows]);
  // A filter stops applying once nothing it matched is left in range.
  const active = filters.some((f) => f.id === filter) ? filter : "all";
  const days = useMemo(
    () => groupLogRowsByDay(rows.filter((row) => matches(row, active))),
    [rows, active],
  );

  return (
    <div className="space-y-3">
      {filters.length > 2 && (
        <ChipRow label="Filter activity">
          {filters.map((option) => (
            <Chip
              key={option.id}
              selected={active === option.id}
              onClick={() => setFilter(option.id)}
            >
              {option.icon ? `${option.icon} ${option.label}` : option.label}
            </Chip>
          ))}
        </ChipRow>
      )}

      {days.length === 0 ? (
        <p className="py-6 text-center text-muted">Nothing matches that filter.</p>
      ) : (
        days.map((day) => (
          <section key={day.on}>
            <div className="flex items-baseline justify-between px-1 pb-1.5">
              <h3 className="t-label text-muted">{day.label}</h3>
              {day.net !== 0n && (
                <Money
                  amount={day.net}
                  signed
                  compact
                  tone={day.net > 0n ? "positive" : "plain"}
                  className="t-label text-muted"
                />
              )}
            </div>
            <ul className="space-y-1">
              <AnimatePresence initial={false}>
                {day.rows.map((row) => (
                  <LogListRow key={row.transaction.id} row={row} onEdit={onEdit} onDelete={onDelete} />
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
