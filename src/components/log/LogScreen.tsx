"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { IconChevronDown } from "@tabler/icons-react";
import { CategoryIcon, SourceIcon } from "@/components/CategoryIcon";
import { Money } from "@/components/Money";
import { NumberPad } from "@/components/NumberPad";
import { TABBAR } from "@/components/Shell";
import { Toast, type ToastState } from "@/components/Toast";
import { Chip, ChipRow, Empty, Input, Label, SectionTitle, cx } from "@/components/ui";
import { buildBoxes, currentPeriod } from "@/lib/ledger/boxes";
import { pkr, useSnapshot } from "@/lib/ledger/snapshot";
import { deleteTransaction, postTransaction, restoreTransaction } from "@/lib/db/mutations";
import {
  KIND_LABEL,
  accountsByUsage,
  composeEntries,
  decompose,
  kindsFor,
  type LogDraft,
  type MoneyKind,
} from "@/lib/ledger/compose";
import { recentLogRows, type LogRow } from "@/lib/ledger/log";
import { mostUsedAccountId } from "@/lib/ledger/accounts";
import { today } from "@/lib/dates";
import { formatTyped } from "@/lib/format";
import { padInput, type PadKey } from "@/lib/pad";
import { parseAmount, type Currency, type Minor } from "@/lib/money";
import { RecentList } from "./RecentList";
import { Reconcile } from "./Reconcile";

/**
 * /log is the screen that decides whether this app gets used: opened ten times
 * a day, one hand, no keyboard. The target is three seconds from opening it to
 * a saved transaction, so:
 *
 *  - the amount comes from an on-screen number pad, never the system keyboard
 *  - category and account are one-tap tiles and pills, nothing is a dropdown
 *  - the defaults (today, most-used account, last direction) are usually right
 *  - the save is a local IndexedDB write, so it returns immediately and the
 *    network is somebody else's problem
 *  - after saving, everything except the amount is kept, because the next
 *    transaction is usually a lot like the last one
 *  - there is no confirmation dialog; saving and deleting both offer an undo
 *
 * The logic (what a draft means, how it becomes entries, what an edit
 * decomposes to) is unchanged from the form this replaces.
 */

const MAX_TILES = 8;
/** The pinned save button's height, so the toast can sit above it. */
const SAVE_H = 76;

interface FormState {
  amount: string;
  direction: "in" | "out";
  kind: MoneyKind;
  accountId: string;
  categoryId: string | null;
  incomeAccountId: string | null;
  counterpartyId: string | null;
  payee: string;
  note: string;
  bookedOn: string;
  editingId: string | null;
}

function initialForm(): FormState {
  return {
    amount: "",
    direction: "out",
    kind: "expense",
    accountId: "",
    categoryId: null,
    incomeAccountId: null,
    counterpartyId: null,
    payee: "",
    note: "",
    bookedOn: today(),
    editingId: null,
  };
}

/** The amount shrinks as it grows so twelve digits still fit one line. */
function amountSize(text: string): string {
  const n = text.length;
  if (n <= 9) return "text-[56px] short:text-[44px]";
  if (n <= 12) return "text-[44px] short:text-[36px]";
  if (n <= 15) return "text-[36px] short:text-[30px]";
  return "text-[28px]";
}

function buzz() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
}

export function LogScreen() {
  const snapshot = useSnapshot();
  const reduce = useReducedMotion();
  const [form, setForm] = useState<FormState>(initialForm);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  // When editing, the old amount is already counted in the box's balance, so
  // the live "left" figure has to add it back before subtracting the new one.
  const [editOrigin, setEditOrigin] = useState<{ categoryId: string; amountPkr: Minor } | null>(null);
  const toastId = useRef(0);

  const accounts = useMemo(() => accountsByUsage(snapshot), [snapshot]);
  const incomeAccounts = useMemo(
    () => snapshot.accounts.filter((account) => account.type === "income" && !account.archived),
    [snapshot],
  );
  const rows = useMemo(() => recentLogRows(snapshot, 50), [snapshot]);
  const boxes = useMemo(() => buildBoxes(snapshot, currentPeriod()), [snapshot]);
  const categories = useMemo(
    () => snapshot.categories.filter((category) => !category.archived).slice(0, MAX_TILES),
    [snapshot],
  );

  // The account and the kind are DERIVED, not stored-then-corrected. The form
  // only remembers an explicit choice; the default account and the fallback
  // when a kind stops being applicable (because the counterparty was cleared)
  // are computed on render, so they can never be briefly out of step.
  const accountId = form.accountId || mostUsedAccountId(snapshot) || "";
  const account = snapshot.accountsById.get(accountId);
  const currency: Currency = account?.currency ?? "PKR";
  const kinds = kindsFor(form.direction, Boolean(form.counterpartyId));
  const kind = kinds.includes(form.kind) ? form.kind : (kinds[0] ?? "expense");

  const patch = useCallback((change: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...change }));
  }, []);

  const say = useCallback((next: Omit<ToastState, "id">) => {
    toastId.current += 1;
    setToast({ ...next, id: toastId.current });
  }, []);
  const dismiss = useCallback((id: number) => setToast((t) => (t?.id === id ? null : t)), []);

  const press = useCallback((key: PadKey) => {
    setForm((current) => ({ ...current, amount: padInput(current.amount, key) }));
    // Typing the next amount means the last one is settled; an undo offered
    // now would just be in the way.
    setToast(null);
  }, []);

  // A hardware keyboard works too, which keeps the screen usable on a desktop.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [role=button]")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^[0-9.]$/.test(event.key)) press(event.key as PadKey);
      else if (event.key === "Backspace") press("back");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [press]);

  // Live balance of the chosen box, moving as the amount is typed.
  const box = form.categoryId ? boxes.boxes.find((b) => b.category.id === form.categoryId) : undefined;
  const typed = parseAmount(form.amount, currency) ?? 0n;
  const typedPkr = pkr(snapshot, typed, currency);
  const spending = form.direction === "out" && kind === "expense";
  const addBack = editOrigin && editOrigin.categoryId === form.categoryId ? editOrigin.amountPkr : 0n;
  const left = box ? box.available + addBack - (spending ? typedPkr : 0n) : 0n;

  function reset(keepContext = true) {
    // The next transaction is usually like the last one, so the account and
    // direction stay; the kind falls back through the derivation above.
    setForm((current) =>
      keepContext
        ? { ...initialForm(), accountId: current.accountId, direction: current.direction }
        : initialForm(),
    );
    setEditOrigin(null);
    setShowMore(false);
  }

  async function onSave() {
    // A double tap on Save would otherwise post two transactions with different
    // ids, and the ledger has no way to tell them apart afterwards.
    if (saving) return;

    const amount = parseAmount(form.amount, currency);
    if (amount === null || amount <= 0n) {
      say({ message: "Enter an amount", tone: "error" });
      return;
    }

    const draft: LogDraft = {
      bookedOn: form.bookedOn,
      direction: form.direction,
      kind,
      amount,
      accountId,
      categoryId: kind === "expense" ? form.categoryId : null,
      counterpartyId: form.counterpartyId,
      incomeAccountId: form.incomeAccountId,
      payee: form.payee,
      note: form.note,
    };

    setSaving(true);
    try {
      const entries = await composeEntries(snapshot, draft);
      const wasEdit = form.editingId !== null;
      const id = await postTransaction({
        id: form.editingId ?? undefined,
        booked_on: form.bookedOn,
        payee: form.payee,
        note: form.note,
        entries,
      });
      buzz();
      reset();
      // An edit rewrites a transaction in place, so there is no earlier state
      // to undo back to; a new entry can simply be removed again.
      say(
        wasEdit
          ? { message: "Saved" }
          : {
              message: "Logged",
              action: { label: "Undo", run: () => void deleteTransaction(id) },
            },
      );
    } catch (cause) {
      say({ message: cause instanceof Error ? cause.message : "Could not save", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  function editRow(row: LogRow) {
    const draft = decompose(snapshot, row.transaction.id);
    if (!draft) {
      say({
        message: "This has more than two lines. Delete it and re-enter to change it.",
        tone: "error",
      });
      return;
    }
    const editCurrency = snapshot.accountsById.get(draft.accountId)?.currency ?? "PKR";
    // Round-trip the amount as text, never through a JS number: the whole and
    // fractional digits of the minor-unit value are laid out directly.
    const digits = (draft.amount < 0n ? -draft.amount : draft.amount).toString().padStart(3, "0");
    const whole = digits.slice(0, -2);
    const frac = digits.slice(-2);
    setForm({
      amount: frac === "00" ? whole : `${whole}.${frac.replace(/0$/, "")}`,
      direction: draft.direction,
      kind: draft.kind,
      accountId: draft.accountId,
      categoryId: draft.categoryId ?? null,
      incomeAccountId: draft.incomeAccountId ?? null,
      counterpartyId: draft.counterpartyId ?? null,
      payee: draft.payee ?? "",
      note: draft.note ?? "",
      bookedOn: draft.bookedOn,
      editingId: row.transaction.id,
    });
    setEditOrigin(
      draft.categoryId ? { categoryId: draft.categoryId, amountPkr: pkr(snapshot, draft.amount, editCurrency) } : null,
    );
    setShowMore(Boolean(draft.counterpartyId || draft.note || draft.payee));
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }

  async function removeRow(row: LogRow) {
    const id = row.transaction.id;
    await deleteTransaction(id);
    if (form.editingId === id) reset(false);
    say({ message: "Deleted", action: { label: "Undo", run: () => void restoreTransaction(id) } });
  }

  const amountText = formatTyped(form.amount, currency);
  const symbol = currency === "PKR" ? "₨" : "$";
  const empty = form.amount === "";

  return (
    <div className="space-y-6 pb-6">
      {/* The whole entry surface fits one screen: the pad takes whatever
          height the controls above it leave, so no key is ever below the fold. */}
      <div
        className="flex flex-col gap-3 short:gap-2"
        style={{ minHeight: `calc(100dvh - 48px - ${TABBAR} - ${SAVE_H + 8}px)` }}
      >
        {/* Amount -------------------------------------------------------- */}
        <div className="relative">
          {form.editingId && (
            <div className="absolute inset-x-0 top-0 flex items-center justify-between">
              <span className="t-label text-muted">Editing</span>
              <button type="button" onClick={() => reset(false)} className="-my-3 min-h-11 px-1 text-muted">
                Cancel
              </button>
            </div>
          )}
          <div
            role="status"
            aria-label="Amount"
            className={cx(
              "tabular flex items-baseline justify-end gap-2 overflow-hidden font-medium leading-tight tracking-tight",
              amountSize(amountText),
              empty ? "text-muted" : "text-ink",
            )}
          >
            <span className="text-muted">{symbol}</span>
            <span>{amountText}</span>
          </div>
        </div>

        {/* Category (out) or source (in) as tiles ----------------------- */}
        {kind === "expense" && (
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="Category">
            {categories.map((category) => {
              const selected = form.categoryId === category.id;
              return (
                <Tile
                  key={category.id}
                  selected={selected}
                  label={category.name}
                  onClick={() => patch({ categoryId: selected ? null : category.id })}
                >
                  <CategoryIcon name={category.name} hint={category.icon} />
                </Tile>
              );
            })}
          </div>
        )}
        {kind === "income" && (
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="Source">
            {incomeAccounts.slice(0, MAX_TILES).map((source) => {
              const selected = form.incomeAccountId === source.id;
              return (
                <Tile
                  key={source.id}
                  selected={selected}
                  label={source.name}
                  onClick={() => patch({ incomeAccountId: selected ? null : source.id })}
                >
                  <SourceIcon name={source.name} />
                </Tile>
              );
            })}
          </div>
        )}

        {/* Live remaining balance of the chosen box ---------------------- */}
        {kind === "expense" && (
          <div className="flex h-8 shrink-0 items-center justify-between" aria-live="polite">
            <span className="t-label truncate text-muted">
              {box ? `Left in ${box.category.name}` : "Pick a category"}
            </span>
            {box && (
              <Money
                amount={left}
                tone={left < 0n ? "danger" : "plain"}
                className="t-section"
              />
            )}
          </div>
        )}

        {/* Account pills ------------------------------------------------- */}
        <ChipRow label="Account">
          {accounts.map((option) => (
            <Chip key={option.id} selected={accountId === option.id} onClick={() => patch({ accountId: option.id })}>
              {option.name}
            </Chip>
          ))}
        </ChipRow>

        {/* Kind, only when a counterparty makes it ambiguous -------------- */}
        {kinds.length > 1 && (
          <ChipRow label="Kind">
            {kinds.map((option) => (
              <Chip key={option} selected={kind === option} onClick={() => patch({ kind: option })}>
                {KIND_LABEL[option]}
              </Chip>
            ))}
          </ChipRow>
        )}

        {/* Direction, with the one optional control beside it -------------- */}
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Direction" className="grid flex-1 grid-cols-2 rounded-2xl bg-surface p-1">
            {(["out", "in"] as const).map((direction) => {
              const on = form.direction === direction;
              return (
                <button
                  key={direction}
                  type="button"
                  aria-pressed={on}
                  onClick={() => patch({ direction })}
                  className={cx(
                    "min-h-11 rounded-xl font-medium transition-colors",
                    on ? "bg-raised text-ink" : "text-muted",
                    on && direction === "in" && "text-accent",
                  )}
                >
                  {direction === "out" ? "Out" : "In"}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-label={showMore ? "Hide who, note and date" : "Add who, note or date"}
            aria-expanded={showMore}
            onClick={() => setShowMore((open) => !open)}
            className="flex size-13 items-center justify-center rounded-2xl bg-surface text-muted"
          >
            <IconChevronDown
              size={22}
              stroke={1.75}
              className={cx("transition-transform", showMore && "rotate-180")}
            />
          </button>
        </div>

        {/* Everything optional lives behind the chevron ------------------- */}
        <AnimatePresence initial={false}>
          {showMore && (
            <motion.div
              key="more"
              initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
              animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="overflow-hidden"
            >
              <div className="space-y-3 rounded-2xl bg-surface p-4">
                <div>
                  <Label>Who</Label>
                  <ChipRow label="Counterparty">
                    {snapshot.counterparties.map((counterparty) => (
                      <Chip
                        key={counterparty.id}
                        className="bg-raised"
                        selected={form.counterpartyId === counterparty.id}
                        onClick={() =>
                          patch({
                            counterpartyId: form.counterpartyId === counterparty.id ? null : counterparty.id,
                          })
                        }
                      >
                        {counterparty.name}
                      </Chip>
                    ))}
                    {snapshot.counterparties.length === 0 && (
                      <span className="py-2 text-muted">Add people in setup</span>
                    )}
                  </ChipRow>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    aria-label="Payee"
                    placeholder="Payee"
                    className="bg-raised"
                    value={form.payee}
                    onChange={(e) => patch({ payee: e.target.value })}
                  />
                  <Input
                    aria-label="Date"
                    type="date"
                    className="bg-raised"
                    value={form.bookedOn}
                    onChange={(e) => patch({ bookedOn: e.target.value })}
                  />
                </div>
                <Input
                  aria-label="Note"
                  placeholder="Note"
                  className="bg-raised"
                  value={form.note}
                  onChange={(e) => patch({ note: e.target.value })}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <NumberPad onKey={press} className="min-h-[188px] flex-1 short:min-h-[176px]" />
      </div>

      {/* Save, pinned under the thumb ------------------------------------ */}
      <div
        className="sticky z-10 -mx-4 bg-canvas px-4 pt-2 pb-3"
        style={{ bottom: TABBAR, minHeight: SAVE_H }}
      >
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={saving}
          className={cx(
            "flex h-14 w-full items-center justify-center rounded-2xl font-medium transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            empty ? "bg-raised text-muted" : "bg-accent text-on-accent",
          )}
        >
          {form.editingId ? "Save changes" : "Save"}
        </button>
      </div>

      {/* Reconcile ------------------------------------------------------- */}
      <Reconcile open={reconciling} onOpenChange={setReconciling} />

      {/* Recent ---------------------------------------------------------- */}
      <section>
        <SectionTitle>Recent</SectionTitle>
        {rows.length === 0 ? (
          <Empty>Nothing logged yet.</Empty>
        ) : (
          <RecentList rows={rows} onEdit={editRow} onDelete={(row) => void removeRow(row)} />
        )}
      </section>

      <Toast toast={toast} onDone={dismiss} lift={SAVE_H} />
    </div>
  );
}

function Tile({
  selected,
  label,
  onClick,
  children,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "flex h-16 short:h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-accent",
        selected ? "bg-accent text-on-accent" : "bg-surface text-ink active:bg-raised",
      )}
    >
      {children}
      <span className="w-full truncate text-center text-xs leading-none">{label}</span>
    </button>
  );
}
