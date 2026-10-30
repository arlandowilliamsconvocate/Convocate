import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { SiteHeader } from "~/components/site-chrome";
import { Card } from "~/components/ui";
import { getAdminOverviewFn } from "~/server/api";

/**
 * `/admin` — the owner's read-only view of who has signed up and what conferences
 * exist.
 *
 * Two things make this page safe, and only one of them is here:
 *
 *  1. **The server**, which is the real gate. `getAdminOverviewFn` refuses a
 *     signed-out caller with 403 `not_signed_in` and a signed-in non-admin with
 *     404 `not_found` (see api.ts). No row is read before that check.
 *  2. **This file**, which decides what a refused caller sees: `notFound()` — so
 *     the router renders the site's own not-found page, with the same 404 status
 *     an address that never existed gives. There is no "you need permission"
 *     screen, because that would tell every organizer account that an admin view
 *     exists and that it is worth trying.
 *
 * The loader never lets a refusal reach the error boundary: a refused call becomes
 * `notFound()`, drawn by `__root.tsx`'s `notFoundComponent`. Nothing on this page
 * writes, and nothing it receives is a budget amount, a contract fee, a document
 * or an attendee's name — only counts (see `adminOverview`).
 */
export const Route = createFileRoute("/admin")({
  loader: async () => {
    try {
      return await getAdminOverviewFn();
    } catch {
      // Signed out, or signed in and not an admin. Both look exactly like a URL
      // that was never a page: 404, the site's not-found page, no clue that an
      // admin view exists.
      throw notFound();
    }
  },
  component: AdminPage,
});

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * `21 Oct 2026`, built by hand rather than through `toLocaleDateString`: the page
 * is rendered on the server first and then in the browser, and a locale-dependent
 * formatter can print two different strings and fail hydration. This cannot.
 */
function formatDay(ms: number): string {
  if (!ms) return "—";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "—";
  return `${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${String(date.getUTCFullYear())}`;
}

const number = (value: number): string => value.toLocaleString("en-US");

function AdminPage() {
  const overview = Route.useLoaderData();
  const { counts, accounts, conferences, recentSignups } = overview;

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader signedIn />
      <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
            Owner only · read-only
          </p>
          <h1 className="mt-1 text-3xl text-ink">Admin</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Who has signed up and what conferences exist in Convocate. Everything here is read from
            the product&rsquo;s own database; nothing on this page changes anything.
          </p>
        </header>

        <section aria-label="Headline counts" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Accounts" value={counts.accounts} note="everyone who has signed up" />
          <Stat
            label="Conferences"
            value={counts.conferences}
            note={`${number(counts.unlocked)} unlocked · ${number(counts.freePlan)} on the free plan`}
          />
          <Stat
            label="Attendee registrations"
            value={counts.attendeeRegistrations}
            note={`${number(counts.attendeePlaces)} place${counts.attendeePlaces === 1 ? "" : "s"} in total`}
          />
          <Stat
            label="Pending payments"
            value={counts.pendingPayments}
            note={`${number(counts.confirmedPayments)} confirmed by hand`}
          />
          <Stat
            label="Unlocked"
            value={counts.unlocked}
            note={counts.sample > 0 ? `includes ${number(counts.sample)} example conference` : "paid conferences"}
          />
          <Stat
            label="Free plan"
            value={counts.freePlan}
            note="not paid for yet"
          />
        </section>

        <Card className="p-5">
          <h2 className="text-lg text-ink">Traffic</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-ink-soft">
            Who opened the public pages, and where they came from — counted by our own server, with
            no cookie and no IP address stored.
          </p>
          <p className="mt-3 text-sm">
            <Link to="/admin/traffic" className="font-medium text-brand underline">
              Open the traffic readout
            </Link>
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="text-lg text-ink">Messenger</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-ink-soft">
            The direct messages the Convocate Page has received, and the place to answer one by
            hand — read the thread, draft a reply, edit it, send it.
          </p>
          <p className="mt-3 text-sm">
            <Link to="/admin/messenger" className="font-medium text-brand underline">
              Open the Messenger inbox
            </Link>
          </p>
        </Card>

        <Card className="overflow-hidden">
          <SectionHeading
            title="Accounts"
            note={`${number(accounts.length)} account${accounts.length === 1 ? "" : "s"}, oldest first.`}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper-deep/70 text-left text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Name</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Email</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-semibold sm:table-cell">Joined</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold">Owns</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {accounts.map((account) => (
                  <tr key={account.id} className="align-top">
                    <td className="px-4 py-3 font-medium text-ink">{account.name || "—"}</td>
                    <td className="px-4 py-3 break-all text-ink-soft">{account.email}</td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-ink-soft sm:table-cell">
                      {formatDay(account.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right text-ink">{number(account.conferenceCount)}</td>
                    <td className="px-4 py-3">
                      {account.isAdmin ? (
                        <span className="rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-white">
                          Admin
                        </span>
                      ) : (
                        <span className="text-ink-soft">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <SectionHeading
            title="Conferences"
            note={`${number(conferences.length)} conference${conferences.length === 1 ? "" : "s"}, newest first, with how much each one holds.`}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper-deep/70 text-left text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Conference</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Owner</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Plan</th>
                  <th scope="col" className="hidden whitespace-nowrap px-4 py-2.5 font-semibold sm:table-cell">
                    Created
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold" title="Budget lines">
                    Lines
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold" title="Contracts">
                    Contracts
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-semibold" title="Attendees">
                    Attendees
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {conferences.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-5 text-sm text-ink-soft">
                      No conferences yet.
                    </td>
                  </tr>
                ) : (
                  conferences.map((conference) => (
                    <tr key={conference.id} className="align-top">
                      <td className="px-4 py-3 font-medium text-ink">
                        {conference.name}
                        {conference.isSample ? (
                          <span className="ml-2 whitespace-nowrap rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">
                            example
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 break-all text-ink-soft">{conference.ownerEmail}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {conference.plan === "unlocked" ? (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                            Unlocked
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-300">
                            Free plan
                          </span>
                        )}
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-ink-soft sm:table-cell">
                        {formatDay(conference.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink">
                        {number(conference.budgetLineCount)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink">
                        {number(conference.contractCount)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink">
                        {number(conference.attendeeCount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <SectionHeading
            title="Recent sign-ups"
            note="The twenty most recent accounts, newest first."
          />
          {recentSignups.length === 0 ? (
            <p className="px-5 py-5 text-sm text-ink-soft">Nobody has signed up yet.</p>
          ) : (
            <ol className="divide-y divide-line/70">
              {recentSignups.map((signup) => (
                <li key={signup.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3">
                  <span className="text-sm font-medium text-ink">{signup.name || "—"}</span>
                  <span className="min-w-0 flex-1 break-all text-sm text-ink-soft">{signup.email}</span>
                  <span className="whitespace-nowrap text-xs text-ink-soft">{formatDay(signup.createdAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <p className="rounded-xl border border-dashed border-line bg-paper-deep/40 px-5 py-4 text-sm text-ink-soft">
          Every number on this page comes from Convocate&rsquo;s own database. The view is read-only,
          and it deliberately shows no budget amounts, contract fees, document contents or attendee
          names: only counts — accounts, conferences and registrations. Page views have their own
          page, <a href="/admin/traffic" className="font-medium text-brand underline">traffic</a>.
        </p>
      </main>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-1 font-serif text-3xl tabular-nums text-ink">{number(value)}</p>
      <p className="mt-1 text-xs text-ink-soft">{note}</p>
    </Card>
  );
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="border-b border-line/70 px-5 py-4">
      <h2 className="text-lg text-ink">{title}</h2>
      <p className="mt-0.5 text-sm text-ink-soft">{note}</p>
    </div>
  );
}
