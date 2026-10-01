"use client";

import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "framer-motion";
import { IconArrowsLeftRight, IconArrowDownLeft, IconTrash, IconCategory2 } from "@tabler/icons-react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Money } from "@/components/Money";
import { describe, type LogRow } from "@/lib/ledger/log";
import { formatRelativeDay } from "@/lib/dates";

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
            {formatRelativeDay(row.transaction.booked_on)}
            {row.direction === "split" ? ` · ${row.lineCount} lines` : ""}
            {row.account ? ` · ${row.account.name}` : ""}
            {row.counterparty ? ` · ${row.counterparty.name}` : ""}
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

export function RecentList({
  rows,
  onEdit,
  onDelete,
}: {
  rows: LogRow[];
  onEdit: (row: LogRow) => void;
  onDelete: (row: LogRow) => void;
}) {
  return (
    <ul className="space-y-1">
      <AnimatePresence initial={false}>
        {rows.map((row) => (
          <LogListRow key={row.transaction.id} row={row} onEdit={onEdit} onDelete={onDelete} />
        ))}
      </AnimatePresence>
    </ul>
  );
}
