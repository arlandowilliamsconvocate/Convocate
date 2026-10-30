import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from "react";
import { Button, Card, EmptyState, Field, Input, Select, Textarea } from "~/components/ui";
import { PeopleSection } from "~/components/people";
import { RegistrationSection } from "~/components/registration";
import { ChecklistSection } from "~/components/checklist";
import {
  ADMIN_PLAN_BADGE,
  BUDGET_LINE_LIMIT_HINT,
  FREE_PLAN_INCLUDES,
  LOCKED_CONTROL_HINT,
  PRINT_LOCKED_HINT,
  PAYMENT_CONFIRM_NOTE,
  PAYMENT_IN_PROGRESS_LABEL,
  PAYMENT_OWNER_ONLY_NOTE,
  PAYMENT_PENDING_RETRY_NOTE,
  PAYMENT_RETRY_BUTTON_LABEL,
  PAYMENT_RETRY_HEADLINE,
  PAYMENT_RETRY_NOTE,
  PAYMENT_STARTED_NOTE,
  REFUND_PROMISE,
  REFUND_SHORT,
  SAMPLE_BADGE,
  SAMPLE_NOTICE_BODY,
  SAMPLE_NOTICE_TITLE,
  UNLOCK_BUTTON_LABEL,
  UPGRADE_INCLUDES,
  paymentRetryWaitLabel,
  UPGRADE_PANEL_BODY,
  UPGRADE_PRICE,
} from "~/lib/plan";
import {
  HIDDEN_MONEY_NOTE,
  formatDate,
  formatDateRange,
  formatMoneyOrHidden,
  sumMoney,
  toCents,
  toUnitsInput,
} from "~/lib/money";
import {
  BUDGET_CATEGORIES,
  CONTRACT_KINDS,
  CONTRACT_STAGES,
  CONTRACT_STATUSES,
  contractStatusLabel,
  contractTotalCents,
  kindLabel,
  type BudgetItem,
  type Contract,
  type Money,
  type ContractKind,
  type ContractStage,
  type ContractStatus,
} from "~/lib/types";
import {
  addBudgetItemFn,
  addContractFn,
  deleteBudgetItemFn,
  deleteContractFn,
  deleteContractDocumentFn,
  downloadContractDocumentFn,
  getChecklistFn,
  getConferenceFn,
  getRegistrationFn,
  moveContractFn,
  setContractStatusFn,
  startUnlockFn,
  updateBudgetItemFn,
  updateBudgetTargetFn,
  updateContractFn,
  uploadContractDocumentFn,
} from "~/server/api";
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_HELP,
  MAX_DOCUMENT_MB,
  formatBytes,
  mimeForFilename,
} from "~/lib/documents";
import { canHaveInvitationLetter } from "~/lib/letter";
import { AgreementTermsEditor } from "~/components/agreement-terms";
import { SignatureLinkPanel } from "~/components/signature-link";
import { DRAFT_NOTICE } from "~/lib/agreement";
import { describeRefusal } from "~/lib/refusal";
// The facts behind "Where you stand", built here from the loader's own rows so
// the numbers line is on screen before any model is asked, and the panel itself.
import { buildStandFacts } from "~/lib/stand";
import { EventStandPanel } from "~/components/event-stand";
import type { ContractDocument } from "~/server/db.server";

export const Route = createFileRoute("/app/conference/$conferenceId")({
  loader: async ({ params }) => {
    const conferenceId = Number(params.conferenceId);
    const detail = await getConferenceFn({ data: { conferenceId } });
    /**
     * Registration is a read of its own, and on a locked conference the server
     * refuses it with `upgrade_required` — an answer this page renders as the
     * locked panel, not an error that should take the whole page down. So the
     * refusal is caught here and travels as `null`. Every registration write
     * invalidates the router, which re-runs this loader and refreshes the whole
     * section in one go.
     */
    let registration: Awaited<ReturnType<typeof getRegistrationFn>> | null = null;
    if (detail) {
      try {
        registration = await getRegistrationFn({ data: { conferenceId } });
      } catch {
        registration = null;
      }
    }
    /**
     * The checklist is a read of its own. On a locked conference the server
     * refuses it with `upgrade_required`, so the refusal is caught here and
     * travels as `null`, which the section renders as the locked panel rather
     * than an error that takes the whole page down. Every checklist write
     * invalidates the router, which re-runs this loader.
     */
    let checklist: Awaited<ReturnType<typeof getChecklistFn>> | null = null;
    if (detail) {
      try {
        checklist = await getChecklistFn({ data: { conferenceId } });
      } catch {
        checklist = null;
      }
    }
    return { detail, registration, checklist };
  },
  component: ConferencePage,
});

function ConferencePage() {
  const { detail, registration, checklist } = Route.useLoaderData();
  if (!detail) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-2xl text-ink">Conference not found</h1>
        <p className="mt-2 text-sm text-ink-soft">
          It may have been deleted, or it belongs to another account.
        </p>
        <Link to="/app" className="mt-4 inline-block text-sm font-medium text-brand underline">
          Back to your conferences
        </Link>
      </div>
    );
  }
  const {
    conference,
    budgetItems,
    contracts,
    documents,
    role,
    members,
    invites,
    currentUserId,
    entitlement,
  } = detail;
  /**
   * Free tier: a locked conference shows its own frame and nothing that would
   * write. The server refuses those writes anyway (403 `upgrade_required`) —
   * this only stops the page offering a button that cannot work.
   */
  const locked = !entitlement.unlocked;
  /**
   * The shared example: readable by every account, writable by none. The server
   * refuses every write on it (403 `sample_read_only`) — `canEdit` false is only
   * what stops the page offering a control that could never work.
   */
  const sample = conference.isSample;
  /** Viewers get the whole page but no control that changes anything. */
  const canEdit = role !== "viewer" && !locked && !sample;
  /**
   * The budget is the one part of a free conference that still accepts a write:
   * one budget line, enforced on the server (`upgrade_required` for a second).
   * So the budget section is offered to an owner or editor even when locked —
   * and still never to a Viewer, nor on the read-only example.
   */
  const canEditBudget = role !== "viewer" && !sample;
  /**
   * Printing a contract sheet is a *read* — it writes nothing — so it is open to
   * the owner and the editors, and to anyone reading the shared example (its
   * figures are invented and it is readable by every account). A Viewer of a real
   * conference is refused it on the server: the sheet carries the fees, and a
   * Viewer is never shown an amount.
   */
  const canPrint = sample || role !== "viewer";

  // Every total is built with `sumMoney`, which is `null` the moment any
  // component was withheld — so a Viewer never sees a partial sum that could be
  // read as the whole, nor a total reconstructed from parts.
  const totalPlanned = sumMoney(budgetItems.map((item) => item.plannedCents));
  const totalCommitted = sumMoney(budgetItems.map((item) => item.committedCents));
  const targetCents = conference.budgetTargetCents;
  const unallocated =
    targetCents === null || totalPlanned === null ? null : targetCents - totalPlanned;
  const overBudget = unallocated !== null && unallocated < 0;

  return (
    <div className="space-y-10">
      <header>
        <Link to="/app" className="text-sm text-ink-soft hover:text-ink">
          ← All conferences
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl text-ink">{conference.name}</h1>
              {sample ? (
                <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand ring-1 ring-brand/20">
                  {SAMPLE_BADGE}
                </span>
              ) : null}
              {!sample && role !== "owner" ? (
                <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand ring-1 ring-brand/20">
                  Shared with you · {role === "editor" ? "Editor" : "Viewer"}
                </span>
              ) : null}
              {locked ? (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-300">
                  Free plan · not unlocked
                </span>
              ) : null}
              {entitlement.adminUnlocked && role === "owner" ? (
                <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand ring-1 ring-brand/20">
                  {ADMIN_PLAN_BADGE}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              {formatDateRange(conference.startDate, conference.endDate)}
              {conference.venue ? ` · ${conference.venue}` : ""}
              {conference.expectedAttendance > 0
                ? ` · ${String(conference.expectedAttendance)} expected`
                : ""}
            </p>
          </div>
          <BudgetTargetEditor
            conferenceId={conference.id}
            currentCents={conference.budgetTargetCents}
            canEdit={canEdit}
          />
        </div>
      </header>

      {locked ? (
        <UpgradePanel
          conferenceId={conference.id}
          conferenceName={conference.name}
          canPay={role === "owner"}
          payment={entitlement.payment}
        />
      ) : null}
      {sample ? (
        <div className="rounded-xl border border-brand/30 bg-brand-soft/50 px-4 py-3 text-sm text-ink">
          <span className="font-medium text-brand">{SAMPLE_NOTICE_TITLE}</span> {SAMPLE_NOTICE_BODY}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Budget target"
          value={formatMoneyOrHidden(targetCents)}
          hint={targetCents === null ? HIDDEN_MONEY_NOTE : undefined}
        />
        <Stat
          label="Total planned"
          value={formatMoneyOrHidden(totalPlanned)}
          hint={totalPlanned === null ? HIDDEN_MONEY_NOTE : undefined}
        />
        <Stat
          label="Total committed"
          value={formatMoneyOrHidden(totalCommitted)}
          hint={totalCommitted === null ? HIDDEN_MONEY_NOTE : undefined}
        />
        <Stat
          label={overBudget ? "Over budget by" : "Unallocated"}
          value={formatMoneyOrHidden(unallocated === null ? null : Math.abs(unallocated))}
          tone={overBudget ? "danger" : "default"}
          hint={
            unallocated === null
              ? HIDDEN_MONEY_NOTE
              : overBudget
                ? "Planned lines exceed the target"
                : "Target minus planned lines"
          }
        />
      </section>

      {/* Only a committee Viewer gets the view-only notice. A free-plan owner is
          not a viewer: it is the plan that is limited, not their role, and their
          own figures are still theirs. The example is not a viewer either: its
          figures are invented and shown to everyone, so the "money is hidden"
          note would be a lie there. */}
      {sample || role !== "viewer" ? null : (
        <div className="rounded-xl border border-line bg-paper-deep/60 px-4 py-3 text-sm text-ink-soft">
          <span className="font-medium text-ink">View only.</span> You can read this conference but
          not change it. {HIDDEN_MONEY_NOTE} — every fee, honorarium, travel and equipment cost,
          every budget figure and every total. Ask the owner for Editor access if you need them.
        </div>
      )}

      {/* Where you stand: the event's own figures, in one compact line, with a
          short summary above them when the assistant can write one. The figures
          are built from exactly the rows this page renders below — the same
          function the server uses — so the line and the summary cannot disagree
          about what is on this conference. */}
      <EventStandPanel
        conferenceId={conference.id}
        facts={buildStandFacts({
          budgetItems,
          contracts,
          checklistItems: checklist?.items ?? [],
          attendeePlaces: registration?.totals.headcount ?? 0,
          budgetTargetCents: conference.budgetTargetCents,
          checklistIsTemplate: sample,
        })}
      />
      <BudgetSection
        conferenceId={conference.id}
        items={budgetItems}
        canEdit={canEditBudget}
        locked={locked}
        freePlanBudgetLines={entitlement.freePlanBudgetLines}
      />
      <ContractsSection
        contracts={contracts}
        documents={documents}
        conferenceId={conference.id}
        canEdit={canEdit}
        canPrint={canPrint}
        locked={locked}
      />
      <ChecklistSection
        conferenceId={conference.id}
        checklist={checklist}
        locked={locked}
      />
      <RegistrationSection
        conferenceId={conference.id}
        registration={registration}
        locked={locked}
        sample={sample}
      />
      <PeopleSection
        conferenceId={conference.id}
        role={role}
        members={members}
        invites={invites}
        currentUserId={currentUserId}
        locked={locked}
        sample={sample}
      />
    </div>
  );
}

/**
 * The free-tier wall: what is free, what the one payment opens on this
 * conference, and the real way to pay it.
 *
 * The unlock button does not unlock anything. It records a `pending` payment on
 * the server — which is what stops an organizer paying twice — and then sends the
 * owner to the Stripe payment link with this conference attached. The conference
 * opens only when a payment has been confirmed with the admin token, which no
 * page and no signed-in account can do.
 */
function UpgradePanel({
  conferenceId,
  conferenceName,
  canPay,
  payment,
}: {
  conferenceId: number;
  conferenceName: string;
  /** Paying is the account owner's act. A committee member gets no button at all. */
  canPay: boolean;
  /**
   * Where this conference is in the payment flow, if anywhere: the latest
   * attempt's status and when it started, plus the server's own answer on
   * whether a fresh attempt may replace it (`retryable`).
   */
  payment: { status: string; startedAt: number; retryable: boolean } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A payment attempt that is still fresh is genuinely in flight — a card being
  // typed, a bank challenge — so the button stays shut. Once it is old enough and
  // was never confirmed, the organizer can start another one themselves; before
  // this change that was a dead end only the team could clear.
  const pendingFresh = payment?.status === "pending" && !payment.retryable;
  const retryReady = payment?.status === "pending" && payment.retryable;

  const startPayment = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    // The tab is opened before the request: a window opened after an await is
    // blocked by the browser. It is filled in once the server answers, and
    // closed again if the server refuses (a second payment is refused there).
    const tab = window.open("", "_blank");
    try {
      const result = await startUnlockFn({ data: { conferenceId } });
      if (result.alreadyUnlocked) {
        tab?.close();
        await router.invalidate();
        return;
      }
      if (!result.url) {
        tab?.close();
        setError("The payment link could not be opened. Nothing has been charged.");
        return;
      }
      if (tab) {
        tab.location.href = result.url;
        await router.invalidate();
      } else {
        window.location.href = result.url;
      }
    } catch (cause) {
      tab?.close();
      console.error("startUnlockFn", cause);
      setError(
        "The payment could not be started, so nothing has been charged. Reload this page and check whether a payment is already in progress.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-amber-300 bg-amber-50/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 className="font-serif text-xl text-ink">
            &ldquo;{conferenceName}&rdquo; is on the free plan
          </h2>
          <p className="mt-1 text-sm text-ink-soft">{UPGRADE_PANEL_BODY}</p>
        </div>
        <div className="flex max-w-[20rem] flex-col items-end gap-2">
          {pendingFresh && payment ? (
            <>
              <Button disabled title={PAYMENT_STARTED_NOTE}>
                {PAYMENT_IN_PROGRESS_LABEL}
              </Button>
              <p className="text-right text-xs text-ink-soft">
                {PAYMENT_STARTED_NOTE} {PAYMENT_CONFIRM_NOTE}{" "}
                {PAYMENT_PENDING_RETRY_NOTE(
                  paymentRetryWaitLabel(payment.startedAt, Date.now()),
                )}
              </p>
            </>
          ) : canPay ? (
            <>
              {retryReady ? (
                <p className="text-right text-xs font-medium text-ink">{PAYMENT_RETRY_HEADLINE}</p>
              ) : null}
              <Button onClick={startPayment} disabled={busy}>
                {busy
                  ? "Opening the payment page…"
                  : retryReady
                    ? PAYMENT_RETRY_BUTTON_LABEL
                    : UNLOCK_BUTTON_LABEL}
              </Button>
              <p className="text-right text-xs text-ink-soft">
                {retryReady ? (
                  PAYMENT_RETRY_NOTE
                ) : (
                  <>
                    One payment of {UPGRADE_PRICE} for this conference, taken on Stripe&rsquo;s
                    secure payment page. {PAYMENT_CONFIRM_NOTE}
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="text-right text-xs text-ink-soft">{PAYMENT_OWNER_ONLY_NOTE}</p>
          )}
          {error ? <p className="text-right text-xs text-red-700">{error}</p> : null}
          <p className="text-right text-xs font-medium text-ink">{REFUND_SHORT}</p>
        </div>
      </div>
      {/* The promise an organizer reads before paying, and still sees while a payment
          is open: the 48 hours runs from the charge, so it is theirs either way. */}
      <div className="mt-4 rounded-lg border border-amber-300/60 bg-white/60 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          The refund promise
        </p>
        <p className="mt-1 text-sm leading-relaxed text-ink">{REFUND_PROMISE}</p>
      </div>

      <div className="mt-5 grid gap-5 border-t border-amber-300/60 pt-4 sm:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            On the free plan
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm text-ink">
            {FREE_PLAN_INCLUDES.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="text-ink-soft">
                  ·
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            {UPGRADE_PRICE} unlocks on this conference
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm text-ink">
            {UPGRADE_INCLUDES.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="text-brand">
                  ✓
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "danger";
}) {
  return (
    <Card className={`p-4 ${tone === "danger" ? "border-red-300 bg-red-50/60" : ""}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
      <p
        className={`mt-1 font-serif text-2xl ${tone === "danger" ? "text-red-700" : "text-ink"}`}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-ink-soft">{hint}</p> : null}
    </Card>
  );
}

function BudgetTargetEditor({
  conferenceId,
  currentCents,
  canEdit,
}: {
  conferenceId: number;
  currentCents: Money;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(toUnitsInput(currentCents));
  const [busy, setBusy] = useState(false);

  if (!canEdit) return null;

  if (!editing) {
    return (
      <Button variant="secondary" onClick={() => setEditing(true)}>
        Edit budget target
      </Button>
    );
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    await updateBudgetTargetFn({
      data: { conferenceId, budgetTargetCents: toCents(value) },
    });
    await router.invalidate();
    setBusy(false);
    setEditing(false);
  };

  return (
    <form onSubmit={save} className="flex items-end gap-2">
      <Field label="Budget target">
        <Input
          className="w-32"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={busy}>
        Save
      </Button>
      <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  );
}

/* ----------------------------------------------------------------- budget */

const emptyBudget = {
  category: BUDGET_CATEGORIES[0] as string,
  label: "",
  planned: "",
  committed: "",
  notes: "",
};

function BudgetSection({
  conferenceId,
  items,
  canEdit,
  locked,
  freePlanBudgetLines,
}: {
  conferenceId: number;
  items: BudgetItem[];
  canEdit: boolean;
  locked: boolean;
  /** How many budget lines the free plan allows — the server's own number. */
  freePlanBudgetLines: number;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  /**
   * The free plan's one line is real, not a placeholder: until it is used,
   * adding works exactly as it does on an unlocked conference. Once it is
   * used, the control says why a second one is not on offer — the server
   * refuses it with the same message (`upgrade_required`).
   */
  const atFreeLimit = locked && items.length >= freePlanBudgetLines;

  // Category names and counts always show; the rollups are `null` when the
  // reader is not shown money, because their parts were withheld.
  const rollups = BUDGET_CATEGORIES.map((category) => {
    const rows = items.filter((item) => item.category === category);
    return {
      category,
      planned: sumMoney(rows.map((row) => row.plannedCents)),
      committed: sumMoney(rows.map((row) => row.committedCents)),
      count: rows.length,
    };
  }).filter((row) => row.count > 0);

  return (
    // `id="budget"` is the target of the budget calculator's "Open the budget"
    // link after a save, so an organizer lands on the lines that were just
    // written instead of at the top of the page. `scroll-mt-24` keeps the
    // heading clear of the sticky header.
    <section id="budget" className="scroll-mt-24 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl text-ink">Budget</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            Planned is what you expect to spend; committed is what is already agreed.
          </p>
        </div>
        {atFreeLimit ? (
          <div className="text-right">
            <Button disabled title={BUDGET_LINE_LIMIT_HINT}>
              Add budget line
            </Button>
            <p className="mt-1 max-w-xs text-xs text-ink-soft">{BUDGET_LINE_LIMIT_HINT}</p>
          </div>
        ) : canEdit && !showForm ? (
          <Button onClick={() => setShowForm(true)}>Add budget line</Button>
        ) : null}
      </div>

      {showForm ? (
        <BudgetItemForm
          conferenceId={conferenceId}
          onCancel={() => setShowForm(false)}
          onSaved={async () => {
            setShowForm(false);
            await router.invalidate();
          }}
        />
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title="No budget lines yet"
          body={
            locked
              ? `Add your first line — the venue deposit is usually the one to start with. The free plan includes ${freePlanBudgetLines === 1 ? "one budget line" : `${String(freePlanBudgetLines)} budget lines`}: a planned and a committed amount against a category, rolled into the totals above, so you can see the arithmetic work on your own numbers.`
              : "Add your first line — the venue deposit is usually the one to start with. Every line rolls up into the totals above."
          }
          action={
            canEdit && !showForm ? (
              <Button onClick={() => setShowForm(true)}>Add first line</Button>
            ) : canEdit ? undefined : (
              <span className="text-sm text-ink-soft">Viewing only — no budget lines yet.</span>
            )
          }
        />
      ) : (
        <>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-paper-deep/70 text-left text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Line</th>
                  <th className="px-4 py-2.5 font-semibold">Category</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Planned</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Committed</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {items.map((item) => (
                  <BudgetRow key={item.id} item={item} canEdit={canEdit} />
                ))}
              </tbody>
            </table>
          </Card>

          {rollups.length > 0 ? (
            <Card className="p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
                By category
              </h3>
              <ul className="mt-3 divide-y divide-line/70">
                {rollups.map((row) => (
                  <li
                    key={row.category}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span className="text-ink">
                      {row.category}{" "}
                      <span className="text-xs text-ink-soft">
                        ({row.count} line{row.count === 1 ? "" : "s"})
                      </span>
                    </span>
                    <span className="flex gap-8 tabular-nums">
                      <span className="text-ink-soft">
                        planned {formatMoneyOrHidden(row.planned)}
                      </span>
                      <span className="w-28 text-right font-medium text-ink">
                        {formatMoneyOrHidden(row.committed)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </section>
  );
}

function BudgetRow({ item, canEdit }: { item: BudgetItem; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    await deleteBudgetItemFn({ data: { itemId: item.id } });
    await router.invalidate();
    setBusy(false);
  };

  if (editing && canEdit) {
    return (
      <tr className="bg-paper-deep/30">
        <td colSpan={5} className="p-0">
          <BudgetItemForm
            conferenceId={item.conferenceId}
            item={item}
            onCancel={() => setEditing(false)}
            onSaved={async () => {
              setEditing(false);
              await router.invalidate();
            }}
          />
        </td>
      </tr>
    );
  }

  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <p className="font-medium text-ink">{item.label}</p>
        {item.notes ? <p className="mt-0.5 text-xs text-ink-soft">{item.notes}</p> : null}
      </td>
      <td className="px-4 py-3">
        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
          {item.category}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-ink">
        {formatMoneyOrHidden(item.plannedCents)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-ink">
        {formatMoneyOrHidden(item.committedCents)}
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {canEdit ? (
          <>
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="danger" onClick={remove} disabled={busy}>
              Delete
            </Button>
          </>
        ) : (
          <span className="text-xs text-ink-soft">—</span>
        )}
      </td>
    </tr>
  );
}

function BudgetItemForm({
  conferenceId,
  item,
  onSaved,
  onCancel,
}: {
  conferenceId: number;
  item?: BudgetItem;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState({
    category: item?.category ?? emptyBudget.category,
    label: item?.label ?? emptyBudget.label,
    planned: item ? toUnitsInput(item.plannedCents) : emptyBudget.planned,
    committed: item ? toUnitsInput(item.committedCents) : emptyBudget.committed,
    notes: item?.notes ?? emptyBudget.notes,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      category: values.category,
      label: values.label,
      plannedCents: toCents(values.planned),
      committedCents: toCents(values.committed),
      notes: values.notes,
    };
    try {
      if (item) {
        await updateBudgetItemFn({ data: { itemId: item.id, ...payload } });
        await onSaved();
      } else {
        const result = await addBudgetItemFn({ data: { conferenceId, ...payload } });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        await onSaved();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className={item ? "grid gap-3 p-4 sm:grid-cols-5 sm:items-end" : "rounded-xl border border-line bg-white p-5 shadow-sm"}
    >
      <div className={item ? "contents" : "grid gap-4 sm:grid-cols-2"}>
        <Field label="Label" className={item ? "sm:col-span-2" : ""}>
          <Input required value={values.label} onChange={update("label")} placeholder="Lakeside hall rental" />
        </Field>
        <Field label="Category">
          <Select value={values.category} onChange={update("category")}>
            {BUDGET_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Planned">
          <Input inputMode="decimal" value={values.planned} onChange={update("planned")} placeholder="12000" />
        </Field>
        <Field label="Committed">
          <Input
            inputMode="decimal"
            value={values.committed}
            onChange={update("committed")}
            placeholder="6000"
          />
        </Field>
        <Field label="Notes">
          <Textarea rows={item ? 1 : 2} value={values.notes} onChange={update("notes")} placeholder="Deposit due 1 Mar" />
        </Field>
      </div>
      <div className={`flex gap-2 ${item ? "sm:col-span-5 sm:justify-end" : "mt-4 justify-end"}`}>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : item ? "Save line" : "Add line"}
        </Button>
      </div>
      {error ? <p className="text-sm text-red-700 sm:col-span-5">{error}</p> : null}
    </form>
  );
}

/* -------------------------------------------------------------- contracts */

const kindBadgeTone: Record<ContractKind, string> = {
  speaker: "bg-brand-soft text-brand",
  musician: "bg-sky-100 text-sky-800",
  singer: "bg-indigo-100 text-indigo-800",
  band: "bg-violet-100 text-violet-800",
  backline: "bg-stone-200 text-stone-800",
  venue: "bg-teal-100 text-teal-900",
  other: "bg-slate-100 text-slate-700",
};

const statusBadgeTone: Record<ContractStatus, string> = {
  signed: "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300",
  sent: "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
  not_sent: "bg-white text-ink-soft ring-1 ring-line",
};

const todayIso = () => new Date().toISOString().slice(0, 10);

function ContractsSection({
  contracts,
  documents,
  conferenceId,
  canEdit,
  canPrint,
  locked,
}: {
  contracts: Contract[];
  /** Every attached document on the conference; the server sends none to a Viewer. */
  documents: ContractDocument[];
  conferenceId: number;
  canEdit: boolean;
  canPrint: boolean;
  locked: boolean;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  const stageCounts = CONTRACT_STAGES.map((stage) => ({
    ...stage,
    count: contracts.filter((contract) => contract.stage === stage.key).length,
  }));
  const totalCents = sumMoney(contracts.map((c) => contractTotalCents(c)));
  const signedCents = sumMoney(
    contracts.filter((c) => c.contractStatus === "signed").map((c) => contractTotalCents(c)),
  );
  const unsignedCents =
    totalCents === null || signedCents === null ? null : totalCents - signedCents;
  const signedCount = contracts.filter((c) => c.contractStatus === "signed").length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl text-ink">Guests, suppliers &amp; venue — contracts</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            Speakers, musicians, singers, bands, backline rental companies and the venue itself on
            one board. Move each one along as the conversation and the contract progress — the
            badge shows whether the contract itself is signed.
          </p>
          {canPrint && contracts.length > 0 ? (
            <p className="mt-1.5">
              {/* Printing is an export, and exports are part of the unlock: on a
                  locked conference the server refuses the board
                  (`upgrade_required`), so the control is shown disabled with the
                  reason rather than offered and then refused. */}
              {locked ? (
                <>
                  <span
                    aria-disabled="true"
                    title={PRINT_LOCKED_HINT}
                    className="cursor-not-allowed text-sm font-medium text-ink-soft/70"
                  >
                    Print all contracts
                  </span>
                  <span className="ml-1.5 text-xs text-ink-soft">{PRINT_LOCKED_HINT}</span>
                </>
              ) : (
                <>
                  <a
                    href={`/print/conference/${String(conferenceId)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-brand underline"
                  >
                    Print all contracts
                  </a>
                  <span className="ml-1.5 text-xs text-ink-soft">
                    — one page per guest, supplier and venue
                  </span>
                </>
              )}
            </p>
          ) : null}
        </div>
        {locked ? (
          <div className="text-right">
            <Button disabled title={LOCKED_CONTROL_HINT}>
              Add guest, supplier or venue
            </Button>
            <p className="mt-1 max-w-xs text-xs text-ink-soft">
              Contracts of any kind are part of the {UPGRADE_PRICE} upgrade — not available on the
              free plan.
            </p>
          </div>
        ) : canEdit && !showForm ? (
          <Button onClick={() => setShowForm(true)}>Add guest, supplier or venue</Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stageCounts.map((stage) => (
          <Card key={stage.key} className="px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              {stage.label}
            </p>
            <p className="font-serif text-2xl text-ink">{stage.count}</p>
          </Card>
        ))}
        {/* Two separate figures on purpose: the first is every entry on the
            board (quotes, invites, unsigned), the second is only what has
            actually been signed. They must never be read as the same number. */}
        <Card className="px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            All entries · total
          </p>
          <p className="font-serif text-2xl tabular-nums text-ink">
            {formatMoneyOrHidden(totalCents)}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {contracts.length} entr{contracts.length === 1 ? "y" : "ies"} — includes invited and
            unsigned
          </p>
        </Card>
        <Card
          className={`px-4 py-3 ${signedCount > 0 ? "border-emerald-300 bg-emerald-50/40" : ""}`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Signed only · committed
          </p>
          <p className="font-serif text-2xl tabular-nums text-ink">
            {formatMoneyOrHidden(signedCents)}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {signedCount} of {contracts.length} signed ·{" "}
            {formatMoneyOrHidden(unsignedCents)} not yet signed
          </p>
        </Card>
      </div>

      {showForm ? (
        <ContractForm
          conferenceId={conferenceId}
          onCancel={() => setShowForm(false)}
          onSaved={async () => {
            setShowForm(false);
            await router.invalidate();
          }}
        />
      ) : null}

      {contracts.length === 0 ? (
        locked ? (
          <EmptyState
            title="No guests or suppliers yet"
            body={`This is the board every guest, supplier and the venue sits on — speaker, musicians, singers, band, backline and equipment — with fee, honorarium, travel and rental, and whether the contract is signed. Contracts of any kind are part of the ${UPGRADE_PRICE} upgrade, so none can be added on the free plan.`}
            action={
              <Button disabled title={LOCKED_CONTROL_HINT}>
                Add the first one
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No guests or suppliers yet"
            body="Add everyone the conference negotiates with — a speaker, a vocalist, a band, a backline rental company, the venue itself. Each one carries their fee, honorarium, travel and equipment cost, plus the state of their contract."
            action={
              canEdit && !showForm ? (
                <Button onClick={() => setShowForm(true)}>Add the first one</Button>
              ) : canEdit ? undefined : (
                <span className="text-sm text-ink-soft">Viewing only — nothing on the board yet.</span>
              )
            }
          />
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-4">
          {CONTRACT_STAGES.map((stage) => {
            const inStage = contracts.filter((contract) => contract.stage === stage.key);
            return (
              <div key={stage.key} className="rounded-xl border border-line bg-paper-deep/40 p-3">
                <div className="flex items-center justify-between px-1 pb-2">
                  <h3 className="text-sm font-semibold text-ink">{stage.label}</h3>
                  <span className="text-xs text-ink-soft">{inStage.length}</span>
                </div>
                <ul className="space-y-2">
                  {inStage.length === 0 ? (
                    <li className="rounded-lg border border-dashed border-line/90 px-3 py-4 text-center text-xs text-ink-soft">
                      Nothing here
                    </li>
                  ) : (
                    inStage.map((contract) => (
                      <ContractCard
                        key={contract.id}
                        contract={contract}
                        canEdit={canEdit}
                        canPrint={canPrint}
                        locked={locked}
                        documents={documents.filter(
                          (document) => document.contractId === contract.id,
                        )}
                      />
                    ))
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

type ContractFormValues = {
  kind: ContractKind;
  name: string;
  topic: string;
  fee: string;
  honorarium: string;
  travel: string;
  equipment: string;
  deposit: string;
  note: string;
  email: string;
  stage: ContractStage;
  contractStatus: ContractStatus;
  contractDate: string;
};

const valuesToInput = (values: ContractFormValues) => ({
  kind: values.kind,
  name: values.name,
  topic: values.topic,
  feeCents: toCents(values.fee),
  honorariumCents: toCents(values.honorarium),
  travelCents: toCents(values.travel),
  equipmentCents: toCents(values.equipment),
  depositCents: values.kind === "venue" ? toCents(values.deposit) : 0,
  contractNote: values.note,
  contactEmail: values.email,
  stage: values.stage,
  contractStatus: values.contractStatus,
  contractDate: values.contractDate,
});

function ContractCard({
  contract,
  canEdit,
  canPrint,
  locked,
  documents,
}: {
  contract: Contract;
  canEdit: boolean;
  /** Owner/editor, or anyone reading the shared example — the sheet is a read. */
  canPrint: boolean;
  /**
   * Free plan: the server refuses the printed sheet, the invitation letter, the
   * agreement and the attached file (`upgrade_required`).
   */
  locked: boolean;
  /** Attached files on this entry. Empty for a Viewer: the server sends none. */
  documents: ContractDocument[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Attached-file work has its own messages: a refused upload is never silent. */
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  /** Every board action reports its own failure - a quiet board is a defect. */
  const runAction = async (
    label: string,
    action: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error || `${label} was refused.`);
        return;
      }
      await router.invalidate();
    } catch (cause) {
      setError(`${label} did not reach Convocate - check your connection and try again.`);
      console.error(label, cause);
    } finally {
      setBusy(false);
    }
  };

  const index = CONTRACT_STAGES.findIndex((stage) => stage.key === contract.stage);
  const previous = index > 0 ? CONTRACT_STAGES[index - 1] : null;
  const next = index < CONTRACT_STAGES.length - 1 ? CONTRACT_STAGES[index + 1] : null;

  const move = (stage: ContractStage) =>
    runAction("Moving on the board", () =>
      moveContractFn({ data: { contractId: contract.id, stage } }),
    );

  const markSigned = () =>
    runAction("Marking the contract signed", () =>
      setContractStatusFn({
        data: {
          contractId: contract.id,
          contractStatus: "signed",
          contractDate: contract.contractDate || todayIso(),
        },
      }),
    );

  const remove = () =>
    runAction("Deleting the entry", () => deleteContractFn({ data: { contractId: contract.id } }));

  /**
   * Attach a signed contract or a scan. The browser only reads the file; every
   * limit — size, type, the 100 MB per conference, the plan, the example — is
   * enforced by the server, so a tampered page gets the same refusals.
   */
  const attach = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileError(null);
    const mime = file.type || mimeForFilename(file.name);
    if (file.size > MAX_DOCUMENT_MB * 1024 * 1024) {
      setFileError(
        `That file is ${formatBytes(file.size)} — one attachment may be up to ${String(MAX_DOCUMENT_MB)} MB. Nothing was saved.`,
      );
      return;
    }
    setFileBusy(true);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("The file could not be read."));
        reader.onload = () => {
          const result = String(reader.result ?? "");
          resolve(result.slice(result.indexOf(",") + 1));
        };
        reader.readAsDataURL(file);
      });
      const result = await uploadContractDocumentFn({
        data: { contractId: contract.id, filename: file.name, mime, dataBase64 },
      });
      if (!result.ok) {
        setFileError(result.error || "That file was refused. Nothing was saved.");
        return;
      }
      await router.invalidate();
    } catch (cause) {
      const refusal = await describeRefusal(cause);
      setFileError(refusal.message);
    } finally {
      setFileBusy(false);
    }
  };

  const download = async (documentId: number) => {
    setFileError(null);
    setFileBusy(true);
    try {
      const result = await downloadContractDocumentFn({ data: { documentId } });
      if (!result.ok) {
        setFileError(result.error || "That file could not be opened.");
        return;
      }
      const binary = atob(result.dataBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mime }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename || "contract";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (cause) {
      const refusal = await describeRefusal(cause);
      setFileError(refusal.message);
    } finally {
      setFileBusy(false);
    }
  };

  const removeFile = (documentId: number) =>
    runAction("Removing the attached file", () =>
      deleteContractDocumentFn({ data: { documentId } }),
    );

  if (editing && canEdit) {
    return (
      <li>
        <ContractForm
          conferenceId={contract.conferenceId}
          contract={contract}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            // An edited entry must show its new values at once: without this the
            // card re-renders from stale loader data and the save reads as lost.
            await router.invalidate();
          }}
        />
      </li>
    );
  }

  const signed = contract.contractStatus === "signed";

  return (
    <li
      className={`rounded-lg border bg-white p-3 shadow-sm ${
        signed ? "border-emerald-300" : "border-line"
      }`}
    >
      {error ? (
        <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700 ring-1 ring-red-200">
          {error}
        </p>
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{contract.name}</p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            statusBadgeTone[contract.contractStatus]
          }`}
          title={`Contract ${contractStatusLabel(contract.contractStatus).toLowerCase()}${
            contract.contractDate ? ` · ${formatDate(contract.contractDate)}` : ""
          }`}
        >
          {signed ? "✓ " : ""}
          {contractStatusLabel(contract.contractStatus)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${kindBadgeTone[contract.kind]}`}
        >
          {kindLabel(contract.kind)}
        </span>
        {contract.contractDate ? (
          <span className="text-[10px] text-ink-soft">
            Contract {formatDate(contract.contractDate)}
          </span>
        ) : null}
      </div>
      {contract.topic ? <p className="mt-1 text-xs text-ink-soft">{contract.topic}</p> : null}
      <dl className="mt-2 space-y-0.5 text-xs text-ink-soft">
        <div className="flex justify-between">
          <dt>{contract.kind === "venue" ? "Rental fee" : "Fee"}</dt>
          <dd className="tabular-nums">{formatMoneyOrHidden(contract.feeCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Honorarium</dt>
          <dd className="tabular-nums">{formatMoneyOrHidden(contract.honorariumCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Travel</dt>
          <dd className="tabular-nums">{formatMoneyOrHidden(contract.travelCents)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Equipment / rental</dt>
          <dd className="tabular-nums">{formatMoneyOrHidden(contract.equipmentCents)}</dd>
        </div>
        {contract.kind === "venue" &&
        (contract.depositCents === null || contract.depositCents > 0) ? (
          <div className="flex justify-between">
            <dt>
              Deposit <span className="text-[10px]">(part of rental fee)</span>
            </dt>
            <dd className="tabular-nums">{formatMoneyOrHidden(contract.depositCents)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-line/70 pt-1 font-medium text-ink">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoneyOrHidden(contractTotalCents(contract))}</dd>
        </div>
      </dl>
      {/* Attached contract documents — the signed PDF or a scan of it. Names,
          sizes and who attached them only; the bytes are fetched through a
          server function that re-checks access on every request. */}
      <div className="mt-2.5 rounded border border-line/80 bg-paper-deep/40 px-2 py-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
          Contract document
        </p>
        {documents.length === 0 ? (
          <p className="mt-0.5 text-[11px] text-ink-soft">
            No signed contract or scan attached yet.
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {documents.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center justify-between gap-1">
                <span className="min-w-0 break-all text-[11px] text-ink">
                  {document.filename}
                  <span className="ml-1 text-ink-soft">
                    {formatBytes(document.sizeBytes)} ·{" "}
                    {formatDate(new Date(document.createdAt).toISOString().slice(0, 10))}
                    {document.uploadedByName ? ` · ${document.uploadedByName}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  {/* The file itself is part of the unlock: on a locked
                      conference the server refuses the download
                      (`upgrade_required`), so the name stays visible but the
                      control is shown disabled with the reason. */}
                  {locked ? (
                    <span
                      aria-disabled="true"
                      title={PRINT_LOCKED_HINT}
                      className="cursor-not-allowed rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-soft/70"
                    >
                      Download
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      className="px-1.5 py-0.5 text-[11px]"
                      disabled={fileBusy}
                      onClick={() => download(document.id)}
                    >
                      Download
                    </Button>
                  )}
                  {canEdit ? (
                    <Button
                      variant="danger"
                      className="px-1.5 py-0.5 text-[11px]"
                      disabled={fileBusy}
                      onClick={() => removeFile(document.id)}
                      title="Remove this file"
                    >
                      ✕
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <label
            className={`mt-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-white px-2 py-1 text-[11px] font-medium text-ink shadow-sm hover:bg-paper-deep ${
              fileBusy ? "opacity-50" : ""
            }`}
            title={DOCUMENT_HELP}
          >
            {fileBusy ? "Working…" : "Attach PDF or scan"}
            <input
              type="file"
              accept={DOCUMENT_ACCEPT}
              className="hidden"
              disabled={fileBusy}
              onChange={attach}
            />
          </label>
        ) : null}
        {fileError ? (
          <p className="mt-1 rounded bg-red-50 px-1.5 py-1 text-[11px] text-red-700 ring-1 ring-red-200">
            {fileError}
          </p>
        ) : null}
      </div>
      {contract.contractNote ? (
        <p className="mt-2 rounded bg-paper-deep/70 px-2 py-1.5 text-xs text-ink-soft">
          {contract.contractNote}
        </p>
      ) : null}
      {contract.contactEmail ? (
        <p className="mt-1.5 truncate text-xs text-brand">{contract.contactEmail}</p>
      ) : null}
      {/* Printing, the invitation letter and the agreement are reads: offered to
          the owner and the editors, and on the shared example to anyone who can
          open it. All three are part of the unlock, so a locked conference shows
          each one disabled with the reason — the server refuses all three with
          `upgrade_required` (see `requireSheetReader` in `src/server/api.ts`) and
          the page must not offer a control that cannot work. */}
      {canPrint ? (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {locked ? (
            <>
              <span
                aria-disabled="true"
                title={PRINT_LOCKED_HINT}
                className="cursor-not-allowed rounded-md px-1.5 py-1 text-xs font-medium text-ink-soft/70"
              >
                Print
              </span>
              <span className="px-1 py-1 text-[11px] text-ink-soft">{PRINT_LOCKED_HINT}</span>
            </>
          ) : (
            <a
              href={`/print/contract/${String(contract.id)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md px-1.5 py-1 text-xs font-medium text-brand underline decoration-brand/40 hover:bg-brand-soft"
            >
              Print
            </a>
          )}
          {canHaveInvitationLetter(contract.kind) ? (
            locked ? (
              <span
                aria-disabled="true"
                title={PRINT_LOCKED_HINT}
                className="cursor-not-allowed rounded-md px-1.5 py-1 text-xs font-medium text-ink-soft/70"
              >
                Create invitation letter
              </span>
            ) : (
              <a
                href={`/print/letter/${String(contract.id)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md px-1.5 py-1 text-xs font-medium text-brand underline decoration-brand/40 hover:bg-brand-soft"
                title="A draft letter merged from this entry — edit it, then print it. Nothing is emailed."
              >
                Create invitation letter
              </a>
            )
          ) : null}
          {/* The agreement is for every kind — a speaker, a band, a backline
              supplier or the venue itself. A draft: built from this entry and
              the conference, printable, and neither signed nor sent from here. */}
          {locked ? (
            <span
              aria-disabled="true"
              title={PRINT_LOCKED_HINT}
              className="cursor-not-allowed rounded-md px-1.5 py-1 text-xs font-medium text-ink-soft/70"
            >
              Generate agreement
            </span>
          ) : (
            <a
              href={`/print/agreement/${String(contract.id)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md px-1.5 py-1 text-xs font-medium text-brand underline decoration-brand/40 hover:bg-brand-soft"
              title={`A draft agreement merged from this entry — edit it, then print or save as a PDF. ${DRAFT_NOTICE}`}
            >
              Generate agreement
            </a>
          )}
        </div>
      ) : null}
      {canEdit ? (
        <AgreementTermsEditor contractId={contract.id} kind={contract.kind} name={contract.name} />
      ) : null}
      {/* Electronic acceptance by the other party. Offered only where editing is
          allowed and the conference is unlocked: the server refuses a Viewer, the
          example and a free plan on all three of its actions. Nothing is emailed
          — the organizer copies the link and sends it. */}
      {canEdit && !locked ? (
        <SignatureLinkPanel contractId={contract.id} guestName={contract.name} />
      ) : null}
      {canEdit ? (
      <div className="mt-2.5 flex flex-wrap gap-1">
        {previous ? (
          <Button
            variant="secondary"
            className="px-2 py-1 text-xs"
            disabled={busy}
            onClick={() => move(previous.key)}
            title={`Move back to ${previous.label}`}
          >
            ← {previous.label}
          </Button>
        ) : null}
        {next ? (
          <Button
            className="px-2 py-1 text-xs"
            disabled={busy}
            onClick={() => move(next.key)}
            title={`Move forward to ${next.label}`}
          >
            {next.label} →
          </Button>
        ) : null}
        {!signed ? (
          <Button
            variant="secondary"
            className="px-2 py-1 text-xs"
            disabled={busy}
            onClick={markSigned}
            title="Mark this contract signed"
          >
            Mark signed
          </Button>
        ) : null}
        <Button variant="ghost" className="px-1.5 py-1 text-xs" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button variant="danger" className="px-1.5 py-1 text-xs" disabled={busy} onClick={remove}>
          ✕
        </Button>
      </div>
      ) : null}
    </li>
  );
}

function ContractForm({
  conferenceId,
  contract,
  onSaved,
  onCancel,
}: {
  conferenceId: number;
  contract?: Contract;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<ContractFormValues>({
    kind: contract?.kind ?? "speaker",
    name: contract?.name ?? "",
    topic: contract?.topic ?? "",
    fee: contract ? toUnitsInput(contract.feeCents) : "",
    honorarium: contract ? toUnitsInput(contract.honorariumCents) : "",
    travel: contract ? toUnitsInput(contract.travelCents) : "",
    equipment: contract ? toUnitsInput(contract.equipmentCents) : "",
    deposit: contract ? toUnitsInput(contract.depositCents) : "",
    note: contract?.contractNote ?? "",
    email: contract?.contactEmail ?? "",
    stage: (contract?.stage ?? "invited") as ContractStage,
    contractStatus: (contract?.contractStatus ?? "not_sent") as ContractStatus,
    contractDate: contract?.contractDate ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (key: keyof ContractFormValues) => (event: { target: { value: string } }) =>
    setValues((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const payload = valuesToInput(values);
    if (values.contractStatus === "signed" && !payload.contractDate) {
      payload.contractDate = todayIso();
    }
    try {
      if (contract) {
        await updateContractFn({ data: { contractId: contract.id, ...payload } });
        await onSaved();
      } else {
        const result = await addContractFn({ data: { conferenceId, ...payload } });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        await onSaved();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className={`space-y-3 ${
        contract
          ? "rounded-lg border border-line bg-white p-3"
          : "rounded-xl border border-line bg-white p-5 shadow-sm"
      }`}
    >
      {!contract ? (
        <h3 className="text-base font-semibold text-ink">Add a guest, supplier or venue</h3>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input
            required
            value={values.name}
            onChange={update("name")}
            placeholder="Rev. Daniel Mensah / Northside Brass"
          />
        </Field>
        <Field label="Kind">
          <Select value={values.kind} onChange={update("kind")}>
            {CONTRACT_KINDS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Role / session" className="sm:col-span-2">
          <Input
            value={values.topic}
            onChange={update("topic")}
            placeholder="Opening plenary / three sets across the weekend"
          />
        </Field>
        <Field label={values.kind === "venue" ? "Rental fee" : "Fee"}>
          <Input
            inputMode="decimal"
            value={values.fee}
            onChange={update("fee")}
            placeholder={values.kind === "venue" ? "4500" : "2500"}
          />
        </Field>
        <Field label="Honorarium" hint="Optional — leave blank if you don't pay one">
          <Input
            inputMode="decimal"
            value={values.honorarium}
            onChange={update("honorarium")}
            placeholder="500"
          />
        </Field>
        <Field label="Travel">
          <Input
            inputMode="decimal"
            value={values.travel}
            onChange={update("travel")}
            placeholder="320"
          />
        </Field>
        <Field label="Equipment / rental">
          <Input
            inputMode="decimal"
            value={values.equipment}
            onChange={update("equipment")}
            placeholder="1800"
          />
        </Field>
        {/* The deposit is optional on every kind. For a venue it is part of the
            rental fee (the card says so); for anyone else it is an advance on the
            fee, used by the agreement to state the deposit and the balance. It
            is never added to the total a second time. */}
        <Field
          label="Deposit"
          hint={
            values.kind === "venue"
              ? "Part of the rental fee above — shown on the card, not added again"
              : values.kind === "backline"
                ? "Optional — a booking advance to the supplier (part of the total, not extra)"
                : "Optional — an advance on the fee (part of the total, not extra)"
          }
        >
          <Input
            inputMode="decimal"
            value={values.deposit}
            onChange={update("deposit")}
            placeholder="1500"
          />
        </Field>
        <Field label="Stage">
          <Select value={values.stage} onChange={update("stage")}>
            {CONTRACT_STAGES.map((stage) => (
              <option key={stage.key} value={stage.key}>
                {stage.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Contract status">
          <Select value={values.contractStatus} onChange={update("contractStatus")}>
            {CONTRACT_STATUSES.map((status) => (
              <option key={status.key} value={status.key}>
                {status.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Contract date" hint="Optional — e.g. the day it was signed">
          <Input type="date" value={values.contractDate} onChange={update("contractDate")} />
        </Field>
        <Field label="Contact email">
          <Input
            type="email"
            value={values.email}
            onChange={update("email")}
            placeholder="guest@example.org"
          />
        </Field>
        <Field label="Contract note" className="sm:col-span-2">
          <Textarea
            rows={2}
            value={values.note}
            onChange={update("note")}
            placeholder="Contract sent 12 Feb, awaiting signature"
          />
        </Field>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {contract ? "Save" : "Add to board"}
        </Button>
      </div>
    </form>
  );
}
