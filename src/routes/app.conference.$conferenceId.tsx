import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from "react";
import {
  Button,
  Chip,
  EmptyState,
  EYEBROW,
  Field,
  Figure,
  Input,
  LEDE,
  META,
  Panel,
  SectionHead,
  Select,
  Textarea,
  actionLink,
  errorClass,
  fieldHintClass,
  moneyCell,
  tdClass,
  thClass,
} from "~/components/app-ui";
import { SectionNav } from "~/components/app-page";
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
      <div className="mx-auto max-w-[46ch] py-16 text-center">
        <p className={EYEBROW}>Not found</p>
        <h1 className="font-display mt-2.5 text-[1.8rem] font-normal leading-tight text-charcoal">
          Conference not found
        </h1>
        <span aria-hidden="true" className="mx-auto mt-4 block h-[2px] w-12 bg-terracotta" />
        <p className={`mt-4 ${LEDE}`}>
          It may have been deleted, or it belongs to another account.
        </p>
        <Link
          to="/app"
          className="mt-6 inline-flex min-h-12 items-center border border-charcoal px-5 text-[11px] uppercase tracking-[0.16em] text-charcoal transition-colors hover:bg-charcoal hover:text-cream"
        >
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
        <Link
          to="/app"
          className="inline-flex min-h-11 items-center text-[10.5px] uppercase tracking-[0.18em] text-charcoal-soft transition-colors hover:text-charcoal"
        >
          ← All conferences
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0 max-w-[62ch]">
            <p className={EYEBROW}>Conference</p>
            <h1 className="font-display mt-2.5 text-balance text-[clamp(1.7rem,3.2vw,2.4rem)] font-normal leading-[1.1] tracking-[-0.015em] text-charcoal">
              {conference.name}
            </h1>
            <span aria-hidden="true" className="mt-4 block h-[2px] w-12 bg-terracotta" />
            <p className={`mt-4 ${META}`}>
              {formatDateRange(conference.startDate, conference.endDate)}
              {conference.venue ? ` · ${conference.venue}` : ""}
              {conference.expectedAttendance > 0
                ? ` · ${String(conference.expectedAttendance)} expected`
                : ""}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {sample ? <Chip tone="attention">{SAMPLE_BADGE}</Chip> : null}
              {!sample && role !== "owner" ? (
                <Chip>Shared with you · {role === "editor" ? "Editor" : "Viewer"}</Chip>
              ) : null}
              {locked ? <Chip tone="flight">Free plan · not unlocked</Chip> : null}
              {entitlement.adminUnlocked && role === "owner" ? (
                <Chip>{ADMIN_PLAN_BADGE}</Chip>
              ) : null}
            </div>
          </div>
          <BudgetTargetEditor
            conferenceId={conference.id}
            currentCents={conference.budgetTargetCents}
            canEdit={canEdit}
          />
        </div>
      </header>

      {/* The sections of this conference, as anchors on the one page. Nothing is
          hidden behind a tab: the budget calculator's "open the budget" link
          still lands on the lines it just wrote. */}
      <SectionNav
        items={[
          { id: "overview", label: "Overview" },
          { id: "budget", label: "Budget" },
          { id: "contracts", label: "Contracts" },
          { id: "checklist", label: "Checklist" },
          { id: "registration", label: "Registration" },
          { id: "people", label: "People" },
        ]}
      />

      <div id="overview" className="scroll-mt-32 space-y-8">
        {locked ? (
          <UpgradePanel
            conferenceId={conference.id}
            conferenceName={conference.name}
            canPay={role === "owner"}
            payment={entitlement.payment}
          />
        ) : null}
        {sample ? (
          <div className="border border-charcoal/25 bg-cream-deep px-4 py-3 text-[14px] leading-relaxed text-charcoal">
            <span className="text-[10.5px] uppercase tracking-[0.18em] text-terracotta-ink">
              {SAMPLE_NOTICE_TITLE}
            </span>{" "}
            {SAMPLE_NOTICE_BODY}
          </div>
        ) : null}

        {/* The four figures the whole page is about, on one line: what you set
            aside, what you plan to spend, what is already agreed, and what is
            left. Over budget is terracotta ink — a state to notice, not an alarm. */}
        <section
          aria-label="Budget summary"
          className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4"
        >
          <Figure
            label="Budget target"
            value={formatMoneyOrHidden(targetCents)}
            hint={targetCents === null ? HIDDEN_MONEY_NOTE : undefined}
            tone="muted"
          />
          <Figure
            label="Total planned"
            value={formatMoneyOrHidden(totalPlanned)}
            hint={totalPlanned === null ? HIDDEN_MONEY_NOTE : "Every line's planned amount"}
          />
          <Figure
            label="Total committed"
            value={formatMoneyOrHidden(totalCommitted)}
            hint={totalCommitted === null ? HIDDEN_MONEY_NOTE : "What is already agreed"}
          />
          <Figure
            label={overBudget ? "Over budget by" : "Unallocated"}
            value={formatMoneyOrHidden(unallocated === null ? null : Math.abs(unallocated))}
            tone={overBudget ? "over" : "default"}
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
          <div className="border-l-2 border-taupe py-1 pl-4 text-[14px] leading-relaxed text-charcoal-soft">
            <span className="text-charcoal">View only.</span> You can read this conference but not
            change it. {HIDDEN_MONEY_NOTE} — every fee, honorarium, travel and equipment cost, every
            budget figure and every total. Ask the owner for Editor access if you need them.
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
      </div>
      <BudgetSection
        conferenceId={conference.id}
        items={budgetItems}
        canEdit={canEditBudget}
        locked={locked}
        freePlanBudgetLines={entitlement.freePlanBudgetLines}
        targetCents={conference.budgetTargetCents}
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
    <Panel as="section" className="border-terracotta/45 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="max-w-[54ch]">
          <p className={EYEBROW}>Free plan</p>
          <h2 className="font-display mt-2 text-[1.35rem] font-normal leading-tight text-charcoal">
            &ldquo;{conferenceName}&rdquo; is on the free plan
          </h2>
          <span aria-hidden="true" className="mt-3 block h-[2px] w-10 bg-terracotta" />
          <p className="mt-3 text-[14.5px] leading-[1.7] text-charcoal-soft">{UPGRADE_PANEL_BODY}</p>
        </div>
        <div className="flex max-w-[22rem] flex-col items-end gap-2.5">
          {pendingFresh && payment ? (
            <>
              <Button disabled title={PAYMENT_STARTED_NOTE}>
                {PAYMENT_IN_PROGRESS_LABEL}
              </Button>
              <p className="text-right text-[12px] leading-relaxed text-charcoal-soft">
                {PAYMENT_STARTED_NOTE} {PAYMENT_CONFIRM_NOTE}{" "}
                {PAYMENT_PENDING_RETRY_NOTE(
                  paymentRetryWaitLabel(payment.startedAt, Date.now()),
                )}
              </p>
            </>
          ) : canPay ? (
            <>
              {retryReady ? (
                <p className="text-right text-[12px] text-charcoal">{PAYMENT_RETRY_HEADLINE}</p>
              ) : null}
              <Button onClick={startPayment} disabled={busy}>
                {busy
                  ? "Opening the payment page…"
                  : retryReady
                    ? PAYMENT_RETRY_BUTTON_LABEL
                    : UNLOCK_BUTTON_LABEL}
              </Button>
              <p className="text-right text-[12px] leading-relaxed text-charcoal-soft">
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
            <p className="text-right text-[12px] text-charcoal-soft">{PAYMENT_OWNER_ONLY_NOTE}</p>
          )}
          {error ? (
            <p role="alert" className={`text-right ${errorClass}`}>
              {error}
            </p>
          ) : null}
          <p className="text-right text-[12px] text-charcoal">{REFUND_SHORT}</p>
        </div>
      </div>
      {/* The promise an organizer reads before paying, and still sees while a payment
          is open: the 48 hours runs from the charge, so it is theirs either way. */}
      <div className="mt-5 border-l-2 border-taupe bg-cream-deep/60 px-4 py-3">
        <p className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-soft">
          The refund promise
        </p>
        <p className="mt-1.5 text-[14px] leading-relaxed text-charcoal">{REFUND_PROMISE}</p>
      </div>

      <div className="mt-6 grid gap-6 border-t border-taupe/70 pt-5 sm:grid-cols-2">
        <div>
          <h3 className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-soft">
            On the free plan
          </h3>
          <ul className="mt-3 space-y-1.5 text-[13.5px] leading-snug text-charcoal">
            {FREE_PLAN_INCLUDES.map((line) => (
              <li key={line} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-[0.65em] h-px w-3 shrink-0 bg-terracotta" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-soft">
            {UPGRADE_PRICE} unlocks on this conference
          </h3>
          <ul className="mt-3 space-y-1.5 text-[13.5px] leading-snug text-charcoal">
            {UPGRADE_INCLUDES.map((line) => (
              <li key={line} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-[0.65em] h-px w-3 shrink-0 bg-terracotta" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
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
    <form onSubmit={save} className="flex flex-wrap items-end gap-2">
      <Field label="Budget target" className="w-36">
        <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
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
  targetCents,
}: {
  conferenceId: number;
  items: BudgetItem[];
  canEdit: boolean;
  locked: boolean;
  /** How many budget lines the free plan allows — the server's own number. */
  freePlanBudgetLines: number;
  /** The conference's budget target, shown under the line totals. */
  targetCents: Money;
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

  // The two column totals, and what is left of the target. Built with
  // `sumMoney` so a Viewer never sees a partial sum that could read as whole.
  const plannedTotal = sumMoney(items.map((item) => item.plannedCents));
  const committedTotal = sumMoney(items.map((item) => item.committedCents));
  const target = targetCents;
  const remaining = target === null || plannedTotal === null ? null : target - plannedTotal;
  const over = remaining !== null && remaining < 0;

  return (
    // `id="budget"` is the target of the budget calculator's "Open the budget"
    // link after a save, so an organizer lands on the lines that were just
    // written instead of at the top of the page. `scroll-mt-32` keeps the
    // heading clear of the sticky header and the section nav.
    <section id="budget" className="scroll-mt-32 space-y-5">
      <SectionHead
        eyebrow="Budget"
        title="Every line, planned and committed"
        lede="Planned is what you expect to spend; committed is what is already agreed."
        actions={
          atFreeLimit ? (
            <div className="max-w-[18rem] text-right">
              <Button disabled title={BUDGET_LINE_LIMIT_HINT}>
                Add budget line
              </Button>
              <p className="mt-2 text-[11.5px] leading-snug text-charcoal-soft">
                {BUDGET_LINE_LIMIT_HINT}
              </p>
            </div>
          ) : canEdit && !showForm ? (
            <Button onClick={() => setShowForm(true)}>Add budget line</Button>
          ) : null
        }
      />

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
              <span className="text-[13px] text-charcoal-soft">Viewing only — no budget lines yet.</span>
            )
          }
        />
      ) : (
        <>
          {/*
            One table, no cards. The money columns are right-aligned in tabular
            numerals so forty lines can be read down their last digit, and rows
            are separated by a hairline rather than boxed.

            At 390px the Category column is dropped and the category is printed
            under the line's label instead; the row actions move into that same
            cell. Nothing scrolls sideways and no figure is hidden.
          */}
          <div className="border-t border-charcoal">
            <table className="w-full border-collapse">
              <caption className="sr-only">
                Budget lines with their planned and committed amounts
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>
                    Line
                  </th>
                  <th scope="col" className={`${thClass} hidden sm:table-cell`}>
                    Category
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Planned
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Committed
                  </th>
                  <th scope="col" className={`${thClass} hidden text-right sm:table-cell`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <BudgetRow key={item.id} item={item} canEdit={canEdit} />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-charcoal">
                  <th scope="row" className="px-3 py-3 text-left">
                    <span className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal">
                      Total
                    </span>
                    <span className="mt-0.5 block text-[11.5px] font-normal text-charcoal-soft">
                      {items.length} line{items.length === 1 ? "" : "s"}
                    </span>
                  </th>
                  <td className={`${tdClass} hidden sm:table-cell`} />
                  <td className={`${moneyCell} text-[14px] font-medium text-charcoal`}>
                    {formatMoneyOrHidden(plannedTotal)}
                  </td>
                  <td className={`${moneyCell} text-[14px] font-medium text-charcoal`}>
                    {formatMoneyOrHidden(committedTotal)}
                  </td>
                  <td className={`${tdClass} hidden sm:table-cell`} />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* The target, and what is left of it — deliberately outside the table:
              the line totals above are what the lines add up to, this is what the
              organizer set aside. Two different things, never the same figure. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-t border-taupe/70 pt-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-charcoal-soft">
              Target {formatMoneyOrHidden(target)} · {over ? "over budget" : "unallocated"}{" "}
              <span
                className={`text-[13.5px] normal-case tracking-normal tabular-nums ${
                  over ? "text-terracotta-ink" : "text-charcoal"
                }`}
              >
                {formatMoneyOrHidden(remaining === null ? null : Math.abs(remaining))}
              </span>
            </p>
            {remaining === null ? (
              <p className="text-[11.5px] text-charcoal-soft">{HIDDEN_MONEY_NOTE}</p>
            ) : null}
          </div>

          {rollups.length > 0 ? (
            <div className="border-t border-taupe/70 pt-4">
              <h3 className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-soft">
                By category
              </h3>
              <ul className="mt-2">
                {rollups.map((row) => (
                  <li
                    key={row.category}
                    className="flex items-baseline justify-between gap-4 border-t border-taupe/50 py-2 text-[13.5px] first:border-t-0"
                  >
                    <span className="min-w-0 text-charcoal">
                      {row.category}{" "}
                      <span className="text-[11.5px] text-charcoal-soft">
                        ({row.count} line{row.count === 1 ? "" : "s"})
                      </span>
                    </span>
                    <span className="flex shrink-0 items-baseline gap-6 tabular-nums">
                      <span className="w-24 text-right text-charcoal-soft">
                        {formatMoneyOrHidden(row.planned)}
                      </span>
                      <span className="w-24 text-right text-charcoal">
                        {formatMoneyOrHidden(row.committed)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 flex justify-end gap-6 text-[10px] uppercase tracking-[0.16em] text-charcoal-soft">
                <span className="w-24 text-right">Planned</span>
                <span className="w-24 text-right">Committed</span>
              </p>
            </div>
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
      <tr className="bg-cream-deep/60">
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
    <tr className="border-t border-taupe/60 align-top transition-colors hover:bg-cream-deep/30">
      <td className={tdClass}>
        <p className="text-[14px] leading-snug text-charcoal">{item.label}</p>
        {item.notes ? (
          <p className="mt-0.5 max-w-[46ch] text-[12px] leading-snug text-charcoal-soft">
            {item.notes}
          </p>
        ) : null}
        {/* The category and the row's actions, on a phone only: the Category and
            Actions columns are dropped below 640px so nothing scrolls sideways. */}
        <p className="mt-1.5 text-[10px] uppercase tracking-[0.16em] text-charcoal-soft sm:hidden">
          {item.category}
        </p>
        {canEdit ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 sm:hidden">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant="danger" onClick={remove} disabled={busy}>
              Delete
            </Button>
          </div>
        ) : null}
      </td>
      <td className={`${tdClass} hidden sm:table-cell`}>
        <span className="text-[10px] uppercase tracking-[0.16em] text-charcoal-soft">
          {item.category}
        </span>
      </td>
      <td className={`${moneyCell} text-charcoal`}>{formatMoneyOrHidden(item.plannedCents)}</td>
      <td className={`${moneyCell} text-charcoal-soft`}>
        {formatMoneyOrHidden(item.committedCents)}
      </td>
      <td className={`${tdClass} hidden whitespace-nowrap text-right sm:table-cell`}>
        {canEdit ? (
          <span className="inline-flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant="danger" onClick={remove} disabled={busy}>
              Delete
            </Button>
          </span>
        ) : (
          <span aria-hidden="true" className="text-charcoal-soft">
            —
          </span>
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
      className={
        item
          ? "border-l-2 border-terracotta/60 bg-cream-deep/50 px-4 py-4"
          : "border border-taupe/70 bg-cream p-5"
      }
    >
      {item ? null : (
        <p className="text-[10.5px] uppercase tracking-[0.18em] text-terracotta-ink">
          New budget line
        </p>
      )}
      <div
        className={
          item
            ? "grid gap-4 sm:grid-cols-5 sm:items-end"
            : "mt-4 grid gap-4 sm:grid-cols-2"
        }
      >
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
        <Field label="Notes" className={item ? "" : "sm:col-span-2"}>
          <Textarea rows={item ? 1 : 2} value={values.notes} onChange={update("notes")} placeholder="Deposit due 1 Mar" />
        </Field>
      </div>
      {error ? (
        <p role="alert" className={`mt-3 ${errorClass}`}>
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" size={item ? "sm" : "md"} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size={item ? "sm" : "md"} disabled={busy}>
          {busy ? "Saving…" : item ? "Save line" : "Add line"}
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------- contracts */

/**
 * The two badges on a board card, in the editorial palette.
 *
 * The stage column already says where the conversation is, so the contract
 * status is the one thing the chip has to carry: sage for signed, terracotta
 * ink for sent and waiting, taupe for not sent yet. The word is always there —
 * colour is never the only signal.
 */
const statusChipTone: Record<ContractStatus, "settled" | "flight" | "quiet"> = {
  signed: "settled",
  sent: "flight",
  not_sent: "quiet",
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
    <section id="contracts" className="scroll-mt-32 space-y-5">
      <SectionHead
        eyebrow="Contracts"
        title="Guests, suppliers & the venue"
        lede="Speakers, musicians, singers, bands, backline rental companies and the venue itself on one board. Move each one along as the conversation and the contract progress — the badge shows whether the contract itself is signed."
        actions={
          locked ? (
            <div className="max-w-[19rem] text-right">
              <Button disabled title={LOCKED_CONTROL_HINT}>
                Add guest, supplier or venue
              </Button>
              <p className="mt-2 text-[11.5px] leading-snug text-charcoal-soft">
                Contracts of any kind are part of the {UPGRADE_PRICE} upgrade — not available on the
                free plan.
              </p>
            </div>
          ) : canEdit && !showForm ? (
            <Button onClick={() => setShowForm(true)}>Add guest, supplier or venue</Button>
          ) : null
        }
      />

      {canPrint && contracts.length > 0 ? (
        <p className="text-[12.5px] text-charcoal-soft">
          {/* Printing is an export, and exports are part of the unlock: on a
              locked conference the server refuses the board
              (`upgrade_required`), so the control is shown disabled with the
              reason rather than offered and then refused. */}
          {locked ? (
            <>
              <span
                aria-disabled="true"
                title={PRINT_LOCKED_HINT}
                className="cursor-not-allowed text-[10.5px] uppercase tracking-[0.14em] text-charcoal-soft/70"
              >
                Print all contracts
              </span>
              <span className="ml-2">{PRINT_LOCKED_HINT}</span>
            </>
          ) : (
            <>
              <a
                href={`/print/conference/${String(conferenceId)}`}
                target="_blank"
                rel="noreferrer"
                className="text-[10.5px] uppercase tracking-[0.14em] text-terracotta-ink underline decoration-terracotta/40 underline-offset-4 hover:decoration-terracotta-ink"
              >
                Print all contracts
              </a>
              <span className="ml-2">— one page per guest, supplier and venue</span>
            </>
          )}
        </p>
      ) : null}

      {/* Where the board stands, in six figures: how many are at each stage, what
          every entry on the board is worth, and — separately, never the same
          number — what is actually signed. */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 border-b border-taupe/70 pb-6 sm:grid-cols-3 lg:grid-cols-6">
        {stageCounts.map((stage) => (
          <div key={stage.key} className="border-t border-taupe pt-3">
            <p className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-soft">
              {stage.label}
            </p>
            <p className="mt-1.5 font-display text-[1.35rem] leading-none tabular-nums text-charcoal">
              {stage.count}
            </p>
          </div>
        ))}
        {/* Two separate figures on purpose: the first is every entry on the
            board (quotes, invites, unsigned), the second is only what has
            actually been signed. They must never be read as the same number. */}
        <div className="border-t border-taupe pt-3">
          <p className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-soft">
            All entries · total
          </p>
          <p className="mt-1.5 font-display text-[1.35rem] leading-none tabular-nums text-charcoal">
            {formatMoneyOrHidden(totalCents)}
          </p>
          <p className="mt-1.5 text-[11px] leading-snug text-charcoal-soft">
            {contracts.length} entr{contracts.length === 1 ? "y" : "ies"} — includes invited and
            unsigned
          </p>
        </div>
        <div className="border-t border-taupe pt-3">
          <p className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-soft">
            Signed only · committed
          </p>
          <p
            className={`mt-1.5 font-display text-[1.35rem] leading-none tabular-nums ${
              signedCount > 0 ? "text-sage-ink" : "text-charcoal"
            }`}
          >
            {formatMoneyOrHidden(signedCents)}
          </p>
          <p className="mt-1.5 text-[11px] leading-snug text-charcoal-soft">
            {signedCount} of {contracts.length} signed · {formatMoneyOrHidden(unsignedCents)} not
            yet signed
          </p>
        </div>
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
                <span className="text-[13px] text-charcoal-soft">
                  Viewing only — nothing on the board yet.
                </span>
              )
            }
          />
        )
      ) : (
        /* Four columns on a wide screen, two on a tablet, one on a phone. Each
           column is a stage; the rule above it is the stage's edge, not a card. */
        <div className="grid gap-x-6 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
          {CONTRACT_STAGES.map((stage) => {
            const inStage = contracts.filter((contract) => contract.stage === stage.key);
            return (
              <div key={stage.key}>
                <div className="flex items-baseline justify-between gap-2 border-b border-charcoal pb-2">
                  <h3 className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal">
                    {stage.label}
                  </h3>
                  <span className="text-[12px] tabular-nums text-charcoal-soft">
                    {inStage.length}
                  </span>
                </div>
                <ul className="mt-3 space-y-3">
                  {inStage.length === 0 ? (
                    <li className="border border-dashed border-taupe/70 px-3 py-5 text-center text-[12px] text-charcoal-soft">
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
    <li className="border border-taupe/70 bg-cream px-3 py-3">
      {error ? (
        <p role="alert" className={`mb-2 ${errorClass}`}>
          {error}
        </p>
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[14px] leading-snug text-charcoal">{contract.name}</p>
        <Chip
          tone={statusChipTone[contract.contractStatus]}
          title={`Contract ${contractStatusLabel(contract.contractStatus).toLowerCase()}${
            contract.contractDate ? ` · ${formatDate(contract.contractDate)}` : ""
          }`}
        >
          {signed ? "✓ " : ""}
          {contractStatusLabel(contract.contractStatus)}
        </Chip>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Chip>{kindLabel(contract.kind)}</Chip>
        {contract.contractDate ? (
          <span className="text-[10px] uppercase tracking-[0.14em] text-charcoal-soft">
            Contract {formatDate(contract.contractDate)}
          </span>
        ) : null}
      </div>
      {contract.topic ? (
        <p className="mt-1.5 text-[12.5px] leading-snug text-charcoal-soft">{contract.topic}</p>
      ) : null}
      <dl className="mt-2.5 space-y-1 text-[12px]">
        <div className="flex justify-between gap-2">
          <dt className="text-charcoal-soft">{contract.kind === "venue" ? "Rental fee" : "Fee"}</dt>
          <dd className="tabular-nums text-charcoal">{formatMoneyOrHidden(contract.feeCents)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-charcoal-soft">Honorarium</dt>
          <dd className="tabular-nums text-charcoal">
            {formatMoneyOrHidden(contract.honorariumCents)}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-charcoal-soft">Travel</dt>
          <dd className="tabular-nums text-charcoal">{formatMoneyOrHidden(contract.travelCents)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-charcoal-soft">Equipment / rental</dt>
          <dd className="tabular-nums text-charcoal">
            {formatMoneyOrHidden(contract.equipmentCents)}
          </dd>
        </div>
        {contract.kind === "venue" &&
        (contract.depositCents === null || contract.depositCents > 0) ? (
          <div className="flex justify-between gap-2">
            <dt className="text-charcoal-soft">
              Deposit <span className="text-[10px]">(part of rental fee)</span>
            </dt>
            <dd className="tabular-nums text-charcoal">
              {formatMoneyOrHidden(contract.depositCents)}
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-2 border-t border-charcoal/30 pt-1">
          <dt className="text-charcoal">Total</dt>
          <dd className="tabular-nums text-charcoal">{formatMoneyOrHidden(contractTotalCents(contract))}</dd>
        </div>
      </dl>
      {/* Attached contract documents — the signed PDF or a scan of it. Names,
          sizes and who attached them only; the bytes are fetched through a
          server function that re-checks access on every request. */}
      <div className="mt-3 border-t border-taupe/60 pt-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-charcoal-soft">
          Contract document
        </p>
        {documents.length === 0 ? (
          <p className="mt-1 text-[11.5px] leading-snug text-charcoal-soft">
            No signed contract or scan attached yet.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {documents.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center justify-between gap-1">
                <span className="min-w-0 break-all text-[11.5px] leading-snug text-charcoal">
                  {document.filename}
                  <span className="ml-1 text-charcoal-soft">
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
                      className="cursor-not-allowed px-1.5 py-1 text-[10.5px] uppercase tracking-[0.14em] text-charcoal-soft/70"
                    >
                      Download
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-2"
                      disabled={fileBusy}
                      onClick={() => download(document.id)}
                    >
                      Download
                    </Button>
                  )}
                  {canEdit ? (
                    <Button
                      variant="danger"
                      size="sm"
                      className="px-2"
                      disabled={fileBusy}
                      onClick={() => removeFile(document.id)}
                      title="Remove this file"
                      aria-label="Remove this file"
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
            className={`mt-2 inline-flex min-h-11 cursor-pointer items-center gap-1.5 border border-taupe px-2.5 text-[10.5px] uppercase tracking-[0.14em] text-charcoal-soft transition-colors hover:border-charcoal hover:text-charcoal ${
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
          <p role="alert" className={`mt-1.5 ${errorClass}`}>
            {fileError}
          </p>
        ) : null}
      </div>
      {contract.contractNote ? (
        <p className="mt-2 border-l-2 border-taupe pl-2 text-[12px] leading-snug text-charcoal-soft">
          {contract.contractNote}
        </p>
      ) : null}
      {contract.contactEmail ? (
        <p className="mt-1.5 truncate text-[11.5px] text-charcoal-soft">{contract.contactEmail}</p>
      ) : null}
      {/* Printing, the invitation letter and the agreement are reads: offered to
          the owner and the editors, and on the shared example to anyone who can
          open it. All three are part of the unlock, so a locked conference shows
          each one disabled with the reason — the server refuses all three with
          `upgrade_required` (see `requireSheetReader` in `src/server/api.ts`) and
          the page must not offer a control that cannot work. */}
      {canPrint ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-taupe/60 pt-2">
          {locked ? (
            <>
              <span
                aria-disabled="true"
                title={PRINT_LOCKED_HINT}
                className="cursor-not-allowed text-[10.5px] uppercase tracking-[0.14em] text-charcoal-soft/70"
              >
                Print
              </span>
              <span className="text-[11px] text-charcoal-soft">{PRINT_LOCKED_HINT}</span>
            </>
          ) : (
            <a
              href={`/print/contract/${String(contract.id)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center text-[10.5px] uppercase tracking-[0.14em] text-terracotta-ink underline decoration-terracotta/40 underline-offset-4 hover:decoration-terracotta-ink"
            >
              Print
            </a>
          )}
          {canHaveInvitationLetter(contract.kind) ? (
            locked ? (
              <span
                aria-disabled="true"
                title={PRINT_LOCKED_HINT}
                className="cursor-not-allowed text-[10.5px] uppercase tracking-[0.14em] text-charcoal-soft/70"
              >
                Create invitation letter
              </span>
            ) : (
              <a
                href={`/print/letter/${String(contract.id)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center text-[10.5px] uppercase tracking-[0.14em] text-terracotta-ink underline decoration-terracotta/40 underline-offset-4 hover:decoration-terracotta-ink"
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
              className="cursor-not-allowed text-[10.5px] uppercase tracking-[0.14em] text-charcoal-soft/70"
            >
              Generate agreement
            </span>
          ) : (
            <a
              href={`/print/agreement/${String(contract.id)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center text-[10.5px] uppercase tracking-[0.14em] text-terracotta-ink underline decoration-terracotta/40 underline-offset-4 hover:decoration-terracotta-ink"
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
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-taupe/60 pt-2">
          {previous ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => move(previous.key)}
              title={`Move back to ${previous.label}`}
            >
              ← {previous.label}
            </Button>
          ) : null}
          {next ? (
            <Button
              size="sm"
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
              size="sm"
              disabled={busy}
              onClick={markSigned}
              title="Mark this contract signed"
            >
              Mark signed
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={remove}
            aria-label="Delete this entry"
            title="Delete this entry"
          >
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
      className={`space-y-4 ${
        contract ? "border border-taupe/70 bg-cream-deep/40 p-4" : "border border-taupe/70 bg-cream p-5"
      }`}
    >
      {!contract ? (
        <p className="text-[10.5px] uppercase tracking-[0.18em] text-terracotta-ink">
          Add a guest, supplier or venue
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
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
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 border-t border-taupe/70 pt-4">
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
