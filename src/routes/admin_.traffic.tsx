import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { SiteHeader } from "~/components/site-chrome";
import { Card } from "~/components/ui";
import { getTrafficFn } from "~/server/api";

/**
 * `/admin/traffic` — the visit counter's readout, for the owner's account only.
 *
 * Two things make this page safe, and only one of them is here:
 *
 *  1. **The server**, which is the real gate. `getTrafficFn` refuses a signed-out
 *     caller with 403 `not_signed_in` and a signed-in non-admin with 404
 *     `not_found` (see api.ts), before a single row is read. The rule is the same
 *     one the rest of the admin view uses: the `users.is_admin` flag AND the
 *     owner's own address, read from the database on every request.
 *  2. **This file**, which decides what a refused caller sees: `notFound()` — the
 *     site's own not-found page, with the same 404 status an address that never
 *     existed gives. There is no "you need permission" screen, because that would
 *     tell every organizer account that an admin view exists.
 *
 * Everything shown is a count. The table behind it holds no IP address, no
 * cookie, no user-agent string and no identifier of any kind, so there is nothing
 * per-person here to show.
 *
 * **Why this file is called `admin_.traffic.tsx` and not `admin.traffic.tsx`.**
 * In TanStack's file routing, `admin.traffic.tsx` is a CHILD of `admin.tsx`, so
 * `/admin/traffic` rendered `admin.tsx`'s own component and this page never drew —
 * the owner saw the admin index at this URL. The trailing underscore makes this a
 * sibling of `/admin` with the same URL: the route id is `/admin_/traffic`, the
 * path is still `/admin/traffic`, and the links in `admin.tsx` keep working.
 * Renaming it back to `admin.traffic.tsx` brings the bug back.
 */
export const Route = createFileRoute("/admin_/traffic")({
  loader: async () => {
    try {
      return await getTrafficFn();
    } catch {
      // Signed out, or signed in and not the owner. Both look exactly like a URL
      // that was never a page.
      throw notFound();
    }
  },
  component: TrafficPage,
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
 * is rendered on the server and then in the browser, and a locale-dependent
 * formatter can print two different strings and fail hydration. This cannot.
 */
function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return `${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${String(date.getUTCFullYear())}`;
}

const number = (value: number): string => value.toLocaleString("en-US");

/** A referrer as a person would name it. */
function referrerLabel(host: string): string {
  if (host === "") return "Direct — no referrer";
  if (host === "#self") return "Our own pages";
  return host;
}

function TrafficPage() {
  const traffic = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader signedIn />
      <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
            Owner only · read-only
          </p>
          <h1 className="mt-1 text-3xl text-ink">Traffic</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Pages the public site served, counted by our own server in our own database. This
            answers one question: did anyone arrive, and where did they land.
          </p>
          <p className="mt-3 text-sm">
            <Link to="/admin" className="font-medium text-brand underline">
              Back to the admin view
            </Link>
          </p>
        </header>

        <Card className="overflow-hidden">
          <div className="border-b border-line/70 px-5 py-4">
            <h2 className="text-lg text-ink">Views</h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              Counting since {formatDay(traffic.since)}.{" "}
              {traffic.firstRecordedDay === null
                ? "No view has been recorded yet — the first one will appear here the moment someone opens a page."
                : `The first view kept is from ${formatDay(traffic.firstRecordedDay)}.`}{" "}
              Nothing before that date was recorded and nothing can be recovered.
            </p>
          </div>
          <div className="grid gap-4 px-5 py-5 sm:grid-cols-3">
            <Figure label="Today" value={traffic.views.today} note="human views" />
            <Figure label="Last 7 days" value={traffic.views.d7} note="human views" />
            <Figure
              label="Last 30 days"
              value={traffic.views.d30}
              note={`${number(traffic.views.all)} all time`}
            />
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-line/70 px-5 py-4">
            <h2 className="text-lg text-ink">Pages</h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              Every public page counted, busiest over the last 30 days first. Only the marketing
              pages are counted — never the app, a print view or an asset.
            </p>
          </div>
          {traffic.pages.length === 0 ? (
            <p className="px-5 py-5 text-sm text-ink-soft">No page has been viewed yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-paper-deep/70 text-left text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th scope="col" className="px-5 py-2 font-semibold">Page</th>
                  <th scope="col" className="px-5 py-2 text-right font-semibold">Last 7 days</th>
                  <th scope="col" className="px-5 py-2 text-right font-semibold">Last 30 days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {traffic.pages.map((page) => (
                  <tr key={page.path}>
                    <td className="break-all px-5 py-2 font-mono text-xs text-ink">{page.path}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-ink">{number(page.d7)}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-ink">{number(page.d30)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-line/70 px-5 py-4">
            <h2 className="text-lg text-ink">Where they came from</h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              The host of the page that linked here — <code>google.com</code>, never the full
              address, never a search phrase. &ldquo;Direct&rdquo; means the browser sent no
              referrer: a typed address, a bookmark, a link in an email client or a messaging app.
            </p>
          </div>
          {traffic.referrers.length === 0 ? (
            <p className="px-5 py-5 text-sm text-ink-soft">Nothing yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-paper-deep/70 text-left text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th scope="col" className="px-5 py-2 font-semibold">Referring host</th>
                  <th scope="col" className="px-5 py-2 text-right font-semibold">Last 7 days</th>
                  <th scope="col" className="px-5 py-2 text-right font-semibold">Last 30 days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {traffic.referrers.map((referrer) => (
                  <tr key={referrer.host || "direct"}>
                    <td className="break-all px-5 py-2 text-ink">{referrerLabel(referrer.host)}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-ink">
                      {number(referrer.d7)}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums text-ink">
                      {number(referrer.d30)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-line/70 px-5 py-4">
            <h2 className="text-lg text-ink">Bots excluded</h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              Crawlers, link previews and command-line clients are recorded, then left out of every
              number above. They are kept rather than dropped so this line can prove the human
              count is not inflated by them.
            </p>
          </div>
          <div className="grid gap-4 px-5 py-5 sm:grid-cols-3">
            <Figure label="Bots · 7 days" value={traffic.bots.d7} note="excluded" />
            <Figure label="Bots · 30 days" value={traffic.bots.d30} note="excluded" />
            <Figure label="Bots · all time" value={traffic.bots.all} note="excluded" />
          </div>
        </Card>

        <p className="rounded-xl border border-dashed border-line bg-paper-deep/40 px-5 py-4 text-sm text-ink-soft">
          <span className="font-semibold text-ink">What this counts.</span> Every visit to a public
          page of this site, counted on the server that served it — including readers with
          JavaScript switched off. <span className="font-semibold text-ink">What it never
          stores.</span> No IP address, no cookie, no browser or device string, no query string and
          no account id; the referring site is cut down to its host. Raw rows are deleted after{" "}
          {number(traffic.retentionDays)} days, so these are totals, not a history of people.
        </p>
      </main>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-paper px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-1 font-serif text-2xl tabular-nums text-ink">{number(value)}</p>
      <p className="mt-0.5 text-xs text-ink-soft">{note}</p>
    </div>
  );
}
