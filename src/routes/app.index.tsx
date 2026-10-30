import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, EmptyState, Field, Input } from "~/components/ui";
import { formatDateRange, formatMoneyOrHidden, parseMoneyInput } from "~/lib/money";

/** The conference form's fields that can be refused, named as the server names them. */
type FieldName = "name" | "startDate" | "endDate" | "expectedAttendance" | "budgetTargetCents";
import { ADMIN_PLAN_BADGE, SAMPLE_BADGE, UPGRADE_PRICE } from "~/lib/plan";
import { createConferenceFn, listConferencesFn } from "~/server/api";

export const Route = createFileRoute("/app/")({
  loader: async () => ({ conferences: await listConferencesFn() }),
  component: ConferenceList,
});

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
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl text-ink">Conferences</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {own.length === 0
              ? "Nothing on the calendar yet."
              : `${String(own.length)} conference${own.length === 1 ? "" : "s"} you can open — your own and any shared with you.`}
            {hasSample
              ? ` The example conference${own.length === 0 ? " below" : " is listed last"}, to show you what a worked conference looks like.`
              : ""}
          </p>
        </div>
        {!showForm ? (
          <Button onClick={() => setShowForm(true)}>New conference</Button>
        ) : null}
      </div>

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
        <ul className="grid gap-4 sm:grid-cols-2">
          {conferences.map((conference) => {
            // Withheld amounts are `null`, and a remainder built from them is
            // `null` too — never a number assembled from parts.
            const remaining =
              conference.budgetTargetCents === null || conference.plannedCents === null
                ? null
                : conference.budgetTargetCents - conference.plannedCents;
            const over = remaining !== null && remaining < 0;
            return (
              <li key={conference.id}>
                <Link
                  to="/app/conference/$conferenceId"
                  params={{ conferenceId: String(conference.id) }}
                  className="block h-full"
                >
                  <Card className="h-full p-5 transition hover:border-brand/40 hover:shadow-md">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg text-ink">{conference.name}</h2>
                        <p className="mt-0.5 text-sm text-ink-soft">
                          {formatDateRange(conference.startDate, conference.endDate)}
                          {conference.venue ? ` · ${conference.venue}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">
                          {conference.budgetLineCount} line
                          {conference.budgetLineCount === 1 ? "" : "s"}
                        </span>
                        {conference.isSample ? (
                          <span className="rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-white">
                            {SAMPLE_BADGE}
                          </span>
                        ) : null}
                        {conference.plan === "free" &&
                        !conference.isSample &&
                        !conference.adminUnlocked ? (
                          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-300">
                            Free plan · not unlocked
                          </span>
                        ) : null}
                        {conference.adminUnlocked && conference.role === "owner" ? (
                          <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand ring-1 ring-brand/20">
                            {ADMIN_PLAN_BADGE}
                          </span>
                        ) : null}
                        {conference.role !== "owner" && !conference.isSample ? (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                            Shared · {conference.role === "editor" ? "Editor" : "Viewer"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line/70 pt-4 text-sm">
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-ink-soft">Target</dt>
                        <dd className="font-medium text-ink">
                          {formatMoneyOrHidden(conference.budgetTargetCents)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-ink-soft">Planned</dt>
                        <dd className="font-medium text-ink">
                          {formatMoneyOrHidden(conference.plannedCents)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-ink-soft">
                          {over ? "Over by" : "Unallocated"}
                        </dt>
                        <dd
                          className={`font-medium ${over ? "text-red-700" : "text-ink"}`}
                        >
                          {formatMoneyOrHidden(remaining === null ? null : Math.abs(remaining))}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-xs text-ink-soft">
                      {conference.contractCount} guest
                      {conference.contractCount === 1 ? "" : "s"} &amp; suppliers ·{" "}
                      {conference.contractedCount} contracted or booked ·{" "}
                      {conference.signedCount} signed ·{" "}
                      {formatMoneyOrHidden(conference.contractedCostCents)} contracted cost
                    </p>
                  </Card>
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
    <span className="mt-1 block text-xs font-medium text-red-700">{message}</span>
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
    <Card className="p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg text-ink">New conference</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Set the frame first — you can refine everything else later.
          </p>
        </div>
        <Button variant="ghost" type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <Field label="Conference name">
          <Input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Annual Ministers' Retreat 2027"
          />
          <FieldError message={fieldErrors.name} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <FieldError message={fieldErrors.startDate} />
          </Field>
          <Field label="End date">
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <FieldError message={fieldErrors.endDate} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
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
        <Field label="Budget target" hint="Whole currency units, e.g. 45000.">
          <Input
            inputMode="decimal"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="45000"
          />
          <FieldError message={fieldErrors.budgetTargetCents} />
        </Field>
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create conference"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
