import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  Button,
  Chip,
  EmptyState,
  Field,
  Input,
  Panel,
  SectionHead,
  errorClass,
  fieldHintClass,
} from "~/components/app-ui";
import { AppPageHead } from "~/components/app-page";
import { formatDateRange, formatMoneyOrHidden, parseMoneyInput } from "~/lib/money";

/** The conference form's fields that can be refused, named as the server names them. */
type FieldName = "name" | "startDate" | "endDate" | "expectedAttendance" | "budgetTargetCents";
import { ADMIN_PLAN_BADGE, SAMPLE_BADGE, UPGRADE_PRICE } from "~/lib/plan";
import { createConferenceFn, listConferencesFn } from "~/server/api";

export const Route = createFileRoute("/app/")({
  loader: async () => ({ conferences: await listConferencesFn() }),
  component: ConferenceList,
});

/**
 * The conference list — the first screen after signing in.
 *
 * One hairline row per conference rather than a grid of cards: an organizer with
 * a dozen events a year reads a list down its money column, and the row keeps the
 * target, the planned total and what is left of it on one line at 1440px. On a
 * phone the row stacks — the name and its chips, then the three figures — and
 * nothing is hidden.
 */
function ConferenceList() {
  const router = useRouter();
  const { conferences } = Route.useLoaderData();
  // The shared example is always in the list, so "is the list empty?" is the
  // wrong question for whether to show the new-conference form: a brand new
  // account owns nothing yet and must be offered one straight away.
  const [showForm, setShowForm] = useState(conferences.every((c) => c.isSample));
  const own = conferences.filter((conference) => !conference.isSample);
  const hasSample = conferences.length !== own.length;

  return (
    <div className="space-y-10">
      <AppPageHead
        eyebrow="Workspace"
        title="Conferences"
        lede={
          <>
            {own.length === 0
              ? "Nothing on the calendar yet."
              : `${String(own.length)} conference${own.length === 1 ? "" : "s"} you can open — your own and any shared with you.`}
            {hasSample
              ? ` The example conference${own.length === 0 ? " below" : " is listed last"}, to show you what a worked conference looks like.`
              : ""}
          </>
        }
        actions={
          !showForm ? <Button onClick={() => setShowForm(true)}>New conference</Button> : null
        }
      />

      {showForm ? (
        <NewConferenceForm
          onDone={() => setShowForm(false)}
          onCreated={async (conferenceId) => {
            await router.invalidate();
            await router.navigate({
              to: "/app/conference/$conferenceId",
              params: { conferenceId: String(conferenceId) },
            });
          }}
        />
      ) : null}

      {conferences.length === 0 ? (
        <EmptyState
          title="Start with your next conference"
          body={`Create a conference with its dates, venue and budget target. The free plan then includes one budget line, so you can see the totals work on your own numbers; the ${UPGRADE_PRICE} unlock opens unlimited budget lines, the contracts board for guests, suppliers and the venue, committee invites and printing.`}
        />
      ) : (
        <ul className="border-b border-taupe/70">
          {conferences.map((conference) => {
            // Withheld amounts are `null`, and a remainder built from them is
            // `null` too — never a number assembled from parts.
            const remaining =
              conference.budgetTargetCents === null || conference.plannedCents === null
                ? null
                : conference.budgetTargetCents - conference.plannedCents;
            const over = remaining !== null && remaining < 0;
            return (
              <li key={conference.id} className="border-t border-taupe/70">
                <Link
                  to="/app/conference/$conferenceId"
                  params={{ conferenceId: String(conference.id) }}
                  className="block transition-colors hover:bg-cream-deep/50"
                >
                  <div className="flex flex-col gap-4 px-1 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <h2 className="font-display text-[1.2rem] font-normal leading-tight text-charcoal">
                          {conference.name}
                        </h2>
                        <Chip>{conference.budgetLineCount} line{conference.budgetLineCount === 1 ? "" : "s"}</Chip>
                        {conference.isSample ? <Chip tone="attention">{SAMPLE_BADGE}</Chip> : null}
                        {conference.plan === "free" &&
                        !conference.isSample &&
                        !conference.adminUnlocked ? (
                          <Chip tone="flight">Free plan · not unlocked</Chip>
                        ) : null}
                        {conference.adminUnlocked && conference.role === "owner" ? (
                          <Chip>{ADMIN_PLAN_BADGE}</Chip>
                        ) : null}
                        {conference.role !== "owner" && !conference.isSample ? (
                          <Chip>Shared · {conference.role === "editor" ? "Editor" : "Viewer"}</Chip>
                        ) : null}
                      </div>
                      <p className="mt-2 text-[12px] uppercase tracking-[0.14em] text-charcoal-soft">
                        {formatDateRange(conference.startDate, conference.endDate)}
                        {conference.venue ? ` · ${conference.venue}` : ""}
                      </p>
                      <p className="mt-1.5 text-[12.5px] text-charcoal-soft">
                        {conference.contractCount} guest
                        {conference.contractCount === 1 ? "" : "s"} &amp; suppliers ·{" "}
                        {conference.contractedCount} contracted or booked ·{" "}
                        {conference.signedCount} signed ·{" "}
                        {formatMoneyOrHidden(conference.contractedCostCents)} contracted cost
                      </p>
                    </div>
                    {/* The money, right-aligned in tabular numerals so a column of
                        conferences can be read down its last digit. */}
                    <dl className="grid shrink-0 grid-cols-3 gap-x-6 gap-y-1 sm:w-[21rem]">
                      <div>
                        <dt className="text-[10px] uppercase tracking-[0.16em] text-charcoal-soft">
                          Target
                        </dt>
                        <dd className="mt-1 text-[13.5px] tabular-nums text-charcoal">
                          {formatMoneyOrHidden(conference.budgetTargetCents)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-[0.16em] text-charcoal-soft">
                          Planned
                        </dt>
                        <dd className="mt-1 text-[13.5px] tabular-nums text-charcoal">
                          {formatMoneyOrHidden(conference.plannedCents)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-[0.16em] text-charcoal-soft">
                          {over ? "Over by" : "Unallocated"}
                        </dt>
                        <dd
                          className={`mt-1 text-[13.5px] tabular-nums ${
                            over ? "text-terracotta-ink" : "text-charcoal"
                          }`}
                        >
                          {formatMoneyOrHidden(remaining === null ? null : Math.abs(remaining))}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** One field's refusal, printed directly under that field. */
function FieldError({ message }: { message?: string }) {
  return message ? (
    <span role="alert" className={`mt-2 block ${errorClass}`}>
      {message}
    </span>
  ) : null;
}

function NewConferenceForm({
  onCreated,
  onDone,
}: {
  onCreated: (conferenceId: number) => Promise<void>;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [venue, setVenue] = useState("");
  const [attendance, setAttendance] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * One message per field, shown under the box that is wrong — a single banner
   * at the bottom makes the reader hunt for which field was refused, and nothing
   * typed is cleared when a check fails.
   */
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    // The same checks the server function makes; it repeats them because this
    // form is a convenience, never the guard.
    const problems: Partial<Record<FieldName, string>> = {};
    if (!name.trim()) problems.name = "Give the conference a name.";
    if (!startDate) problems.startDate = "Choose the start date.";
    if (!endDate) problems.endDate = "Choose the end date.";
    else if (startDate && endDate < startDate) {
      problems.endDate = "The end date cannot be before the start date.";
    }
    const trimmedAttendance = attendance.trim();
    if (trimmedAttendance && !/^\d+$/.test(trimmedAttendance)) {
      problems.expectedAttendance = "Expected attendance must be a whole number, for example 240.";
    }
    const parsedTarget = parseMoneyInput(target);
    if ("error" in parsedTarget) problems.budgetTargetCents = parsedTarget.error;
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setBusy(true);
    try {
      const result = await createConferenceFn({
        data: {
          name,
          startDate,
          endDate,
          venue,
          expectedAttendance: trimmedAttendance,
          // Send what was typed, exactly as the budget-line forms do. The
          // server parses dollars → cents once; sending parsedTarget.cents
          // made it convert a second time and store 100× the amount.
          budgetTargetCents: target,
        },
      });
      if (!result.ok) {
        // The server names the field it refused, so the message lands on that
        // box; anything that is not about one field is the banner below.
        const refused = result as { field?: FieldName; error?: string };
        if (refused.field) {
          setFieldErrors({ [refused.field]: refused.error ?? "That value was refused." });
        } else {
          setError(refused.error ?? "The conference could not be created.");
        }
        return;
      }
      setFieldErrors({});
      await onCreated(result.conferenceId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel as="section" className="p-5 sm:p-7">
      <SectionHead
        eyebrow="New"
        title="Set the frame first"
        lede="You can refine everything else later."
        actions={
          <Button variant="ghost" size="sm" type="button" onClick={onDone}>
            Cancel
          </Button>
        }
      />
      <form onSubmit={submit} className="mt-6 space-y-5">
        <Field label="Conference name">
          <Input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Annual Ministers' Retreat 2027"
          />
          <FieldError message={fieldErrors.name} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Start date">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <FieldError message={fieldErrors.startDate} />
          </Field>
          <Field label="End date">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <FieldError message={fieldErrors.endDate} />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Venue">
            <Input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="Lakeside Retreat Center"
            />
          </Field>
          <Field label="Expected attendance">
            <Input
              inputMode="numeric"
              value={attendance}
              onChange={(e) => setAttendance(e.target.value)}
              placeholder="240"
            />
            <FieldError message={fieldErrors.expectedAttendance} />
          </Field>
        </div>
        <Field label="Budget target">
          <Input
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="45000"
          />
          <span className={fieldHintClass}>Whole currency units, e.g. 45000.</span>
          <FieldError message={fieldErrors.budgetTargetCents} />
        </Field>
        {error ? (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3 border-t border-taupe/70 pt-5">
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create conference"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
