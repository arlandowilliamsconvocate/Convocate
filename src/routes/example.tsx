import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { SiteHeader } from "~/components/site-chrome";
import { Card } from "~/components/ui";
import { HIDDEN_MONEY, formatDateRange, formatMoney, sumMoney } from "~/lib/money";
import {
  CONTRACT_STAGES,
  contractStatusLabel,
  contractTotalCents,
  kindLabel,
  type Money,
} from "~/lib/types";
import { getPublicExampleFn, getSessionUser } from "~/server/api";

/**
 * `/example` — the worked example conference, for anyone, signed in or not.
 *
 * What this page is: a real look at a planning workspace for a 260-person
 * conference — a budget with planned and committed amounts against a target and
 * an over-budget flag, a contracts board with signed and unsigned paperwork, and
 * a registration summary. What it is not: a way in. Every figure here is
 * invented, and there is nothing to click except the link back to the product.
 *
 * The gate is entirely on the server (`getPublicExampleFn`, which takes no
 * input and finds the conference by its example flag). This file holds no
 * conference id and cannot be talked into showing one: it renders what the
 * server sent, and if the server says "not found" this page is the site's
 * ordinary 404 — the same one a mistyped address gets.
 */
export const Route = createFileRoute("/example")({
  head: () => ({
    meta: [{ title: "A worked example — Convocate" }],
  }),
  loader: async () => {
    try {
      const [example, user] = await Promise.all([getPublicExampleFn(), getSessionUser()]);
      return { example, signedIn: Boolean(user) };
    } catch {
      // No example in this database: the visitor sees the not-found page, with
      // the same 404 status and wording as an address that never existed.
      throw notFound();
    }
  },
  component: ExamplePage,
});

/** A figure as the page shows it. `null` only if the server ever withheld one. */
const dollars = (cents: Money): string => (cents === null ? HIDDEN_MONEY : formatMoney(cents));

function ExamplePage() {
  const { example, signedIn } = Route.useLoaderData();

  const totalPlanned = sumMoney(example.budget.map((item) => item.plannedCents));
  const totalCommitted = sumMoney(example.budget.map((item) => item.committedCents));
  const unallocated =
    example.budgetTargetCents === null || totalPlanned === null
      ? null
      : example.budgetTargetCents - totalPlanned;
  const overBudget = unallocated !== null && unallocated < 0;

  // One row per category, in the order the budget was built, so the arithmetic
  // reads the way the organizer sees it in their own workspace.
  const categories = Array.from(new Set(example.budget.map((item) => item.category)));
  const stages = CONTRACT_STAGES.map((stage) => ({
    ...stage,
    items: example.contracts.filter((contract) => contract.stage === stage.key),
  })).filter((stage) => stage.items.length > 0);

  const { registration } = example;
  const placesLeft =
    registration.capacity > 0 ? Math.max(0, registration.capacity - registration.placesTaken) : null;

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader signedIn={signedIn} />

      <main className="mx-auto max-w-5xl px-6 py-10">
        <Link to="/" className="text-sm text-ink-soft hover:text-ink">
          ← Convocate
        </Link>

        {/* The banner. A visitor must never mistake invented figures for a real
            organizer's, so it sits above the name, not below the fold. */}
        <div className="mt-4 rounded-xl border border-brand/30 bg-brand-soft/50 px-4 py-3 text-sm leading-relaxed text-ink">
          <span className="font-semibold text-brand">This is a worked example.</span>{" "}
          Everything on it — the budget, the guests, the ticket sales — is invented for this
          demonstration, and it is read-only. Nothing here is for sale, and nothing can be changed.
        </div>

        <header className="mt-8">
          <h1 className="text-3xl text-ink">{example.name}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {formatDateRange(example.startDate, example.endDate)}
            {example.venue ? ` · ${example.venue}` : ""}
            {example.expectedAttendance > 0
              ? ` · ${String(example.expectedAttendance)} expected`
              : ""}
          </p>
        </header>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Budget target" value={dollars(example.budgetTargetCents)} />
          <Stat label="Total planned" value={dollars(totalPlanned)} />
          <Stat label="Total committed" value={dollars(totalCommitted)} />
          <Stat
            label={overBudget ? "Over budget by" : "Still to allocate"}
            value={dollars(unallocated === null ? null : Math.abs(unallocated))}
            tone={overBudget ? "danger" : "default"}
            hint={overBudget ? "Planned lines exceed the target" : "Target minus planned lines"}
          />
        </section>

        {/* ------------------------------------------------------------ budget */}
        <section className="mt-12">
          <h2 className="text-2xl text-ink">The budget</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-soft">
            What is planned for the conference, and what has actually been committed so far —
            the difference is what is still open, not what is left over.
          </p>

          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-paper-deep/60 text-left text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Line</th>
                  <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Category</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Planned</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Committed</th>
                </tr>
              </thead>
              <tbody>
                {example.budget.map((item) => (
                  <tr key={`${item.category}:${item.label}`} className="border-t border-line/60">
                    <td className="px-4 py-2.5 text-ink">{item.label}</td>
                    <td className="hidden px-4 py-2.5 text-ink-soft sm:table-cell">{item.category}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                      {dollars(item.plannedCents)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">
                      {dollars(item.committedCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-line bg-paper-deep/30">
                <tr>
                  <td className="px-4 py-3 font-semibold text-ink" colSpan={2}>
                    {String(categories.length)} categories · {String(example.budget.length)} lines
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">
                    {dollars(totalPlanned)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">
                    {dollars(totalCommitted)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* --------------------------------------------------------- contracts */}
        <section className="mt-12">
          <h2 className="text-2xl text-ink">Contracts</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-soft">
            Everyone the conference is negotiating with — the venue, speakers, musicians and the
            equipment supplier — and how far each one has got: the pipeline stage on the left, the
            paperwork on the right.
          </p>

          <div className="mt-4 space-y-5">
            {stages.map((stage) => (
              <div key={stage.key}>
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-brass">
                  {stage.label} · {String(stage.items.length)}
                </h3>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {stage.items.map((contract) => {
                    const total = contractTotalCents(contract);
                    const parts = [
                      ["Fee", contract.feeCents],
                      ["Honorarium", contract.honorariumCents],
                      ["Travel", contract.travelCents],
                      ["Equipment", contract.equipmentCents],
                    ].filter((part): part is [string, number] => typeof part[1] === "number" && part[1] > 0);
                    return (
                      <Card key={`${contract.kind}:${contract.name}`} className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                              {kindLabel(contract.kind)}
                            </p>
                            <p className="mt-0.5 font-medium text-ink">{contract.name}</p>
                            {contract.topic ? (
                              <p className="text-sm text-ink-soft">{contract.topic}</p>
                            ) : null}
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                              contract.contractStatus === "signed"
                                ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                                : contract.contractStatus === "sent"
                                  ? "bg-amber-50 text-amber-900 ring-amber-200"
                                  : "bg-paper-deep text-ink-soft ring-line"
                            }`}
                          >
                            Contract {contractStatusLabel(contract.contractStatus).toLowerCase()}
                          </span>
                        </div>
                        <p className="mt-3 text-sm text-ink">
                          <span className="font-semibold tabular-nums">{dollars(total)}</span>
                          {parts.length > 1 ? (
                            <span className="text-ink-soft">
                              {" "}
                              — {parts.map(([label, cents]) => `${label} ${formatMoney(cents)}`).join(" · ")}
                            </span>
                          ) : null}
                        </p>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------ registration */}
        <section className="mt-12">
          <h2 className="text-2xl text-ink">Registration</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-soft">
            The registration options on offer and how many places each has taken. A conference like
            this one fills up in groups — a school booking twelve places, a team booking five — so
            the places sold matter more than the number of registrations.
          </p>

          {registration.ticketTypes.length === 0 ? (
            <Card className="mt-4 p-5 text-sm text-ink-soft">
              Registration has not been set up on this conference yet.
            </Card>
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border border-line bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-paper-deep/60 text-left text-xs uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Registration option</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Fee</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Places taken</th>
                  </tr>
                </thead>
                <tbody>
                  {registration.ticketTypes.map((ticket) => (
                    <tr key={ticket.name} className="border-t border-line/60">
                      <td className="px-4 py-2.5 text-ink">{ticket.name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                        {dollars(ticket.priceCents)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">
                        {String(ticket.placesTaken)}
                        {ticket.quantityLimit > 0 ? ` of ${String(ticket.quantityLimit)}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-line bg-paper-deep/30">
                  <tr>
                    <td className="px-4 py-3 font-semibold text-ink">
                      {String(registration.placesTaken)} places registered
                    </td>
                    <td className="px-4 py-3 text-right text-ink-soft">
                      {registration.capacity > 0 ? `cap ${String(registration.capacity)}` : "no cap"}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">
                      {placesLeft === null ? "—" : `${String(placesLeft)} left`}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Said plainly, because it is true and because it is the sort of thing
              a careful organizer will ask about: no attendee is ever listed here. */}
          <p className="mt-3 text-xs leading-relaxed text-ink-soft">
            The people behind these numbers are invented too, and the attendee list is never shown
            on this page.
          </p>
        </section>

        {/* ------------------------------------------------------------- close */}
        <section className="mt-14 rounded-xl border border-line bg-white px-6 py-8 text-center shadow-sm">
          <p className="font-serif text-xl text-ink">Run your own conference like this</p>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
            Build the budget, work the venue and every guest through to a signed contract, and open
            registration — in one workspace, instead of six spreadsheets and a group chat.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link
              to={signedIn ? "/app" : "/signup"}
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand/90"
            >
              {signedIn ? "Open your workspace" : "Create your workspace"}
            </Link>
            <Link
              to="/about"
              className="rounded-lg border border-line bg-white px-5 py-2.5 text-sm font-medium text-ink shadow-sm hover:bg-paper-deep"
            >
              What Convocate does
            </Link>
          </div>
        </section>
      </main>
    </div>
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
    <Card className="p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
      <p
        className={`mt-1 font-serif text-2xl tabular-nums ${
          tone === "danger" ? "text-red-700" : "text-ink"
        }`}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-ink-soft">{hint}</p> : null}
    </Card>
  );
}
