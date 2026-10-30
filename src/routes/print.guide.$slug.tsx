import { Link, createFileRoute } from "@tanstack/react-router";
import { PrintableForm } from "~/components/lead-magnet";
import { SiteHeader } from "~/components/site-chrome";
import { renderMarkdown } from "~/lib/markdown";
import { leadMagnet, leadMagnetPath, type LeadMagnetSlug } from "~/lib/lead-magnets";
import { printableSheetFn } from "~/server/api";

/**
 * `/print/guide/:slug` — the printable one-page sheet of a free guide.
 *
 * **The gate is the loader, and the loader runs on the server.** A direct
 * request for this URL asks `printableSheetFn`, which reads the signed cookie
 * (`server/printable.server.ts`) and returns the sheet's Markdown only when that
 * cookie names this guide. With no cookie — or a tampered one, or one for a
 * different guide — the server returns no guide text at all, and what comes back
 * in the HTML is the form asking for an address. There is no client-side flag to
 * flip and nothing hidden in the page source to find: the sheet is simply not in
 * the response.
 *
 * The unlock itself happens on the guide page (`PrintableForm` →
 * `unlockPrintableFn`), which stores the address, sets the cookie and sends the
 * browser here. Someone who lands on this URL first gets the same form, and it
 * works here too — it reloads this page, which the server then renders unlocked.
 *
 * Print: the sheet is one section of the guide, set on its own with a page rule
 * of US Letter and no site chrome, so it prints as a single page to write on.
 * `@page` lives here rather than in the global stylesheet on purpose: the
 * contract printouts keep their own A4 rule.
 */
export const Route = createFileRoute("/print/guide/$slug")({
  loader: async ({ params }) => {
    const slug = params.slug as LeadMagnetSlug;
    const magnet = leadMagnet(slug);
    if (!magnet) return { known: false as const, unlocked: false as const, title: "", markdown: "" };
    const sheet = await printableSheetFn({ data: { slug } });
    return {
      known: true as const,
      unlocked: sheet.unlocked,
      title: magnet.title,
      markdown: sheet.markdown,
    };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.known
          ? `${loaderData.title} — printable sheet`
          : "Printable sheet — Convocate",
      },
      // The printable is not a page for a search engine: the guide page is. A
      // teaser is indexed; a one-page sheet behind a form is not.
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintableGuidePage,
});

function PrintableGuidePage() {
  const data = Route.useLoaderData();
  const slug = Route.useParams().slug;
  const magnet = data.known ? leadMagnet(slug) : undefined;

  if (!magnet) {
    return (
      <div className="min-h-screen bg-paper">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 pb-20 pt-14">
          <h1 className="text-3xl text-ink">There is no printable sheet at this address</h1>
          <p className="mt-4 text-base leading-relaxed text-ink-soft">
            The guides are listed at{" "}
            <Link to="/resources" className="font-medium text-brand underline">
              the resources page
            </Link>
            . Two of them have a printable one-page sheet.
          </p>
        </main>
      </div>
    );
  }

  if (!data.unlocked) {
    return (
      <div className="min-h-screen bg-paper">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 pb-20 pt-14">
          <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">
            <Link to={leadMagnetPath(magnet.slug)} className="hover:text-ink">
              {magnet.title}
            </Link>
          </p>
          <h1 className="mt-3 text-3xl leading-tight text-ink sm:text-4xl">
            The printable sheet is one email address away
          </h1>
          <p className="mt-4 text-base leading-relaxed text-ink-soft">
            The guide itself is free to read on its own page, in full, with nothing asked for. This
            address is the printable version: the same sheet on one page, with no site around it,
            ready to print and write on.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            Leave an address and it opens here immediately.
          </p>
          <PrintableForm magnet={magnet} />
          <p className="mt-8 text-sm leading-relaxed text-ink-soft">
            <Link to={leadMagnetPath(magnet.slug)} className="font-medium text-brand underline">
              Read the whole guide instead
            </Link>{" "}
            — no address needed for that.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      {/* The page rule for this sheet only. A browser printing to Letter uses it
          as written; nothing else on the site is affected. */}
      <style>{`
        @media print {
          @page { size: Letter portrait; margin: 12mm 12mm; }
          .guide-sheet-body { font-size: 10.5pt; line-height: 1.35; }
          .guide-sheet-body h2 { font-size: 14pt; margin-top: 0; }
          .guide-sheet-body p { margin-top: 6pt; }
          .guide-sheet-body table { font-size: 9.5pt; }
          .guide-sheet-body th, .guide-sheet-body td { padding: 2.5pt 4pt; }
          .guide-sheet-body ul, .guide-sheet-body ol { margin-top: 5pt; }
        }
      `}</style>
      <div className="print-hide border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <p className="text-sm text-ink-soft">Printable sheet — one page</p>
          <div className="flex items-center gap-3">
            <Link
              to={leadMagnetPath(magnet.slug)}
              className="text-sm font-medium text-brand underline underline-offset-2"
            >
              Back to the guide
            </Link>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand/90"
            >
              Print this sheet
            </button>
          </div>
        </div>
      </div>
      <main className="mx-auto max-w-3xl px-6 py-10 print:p-0">
        <article className="print-sheet rounded-xl border border-line bg-white p-6 shadow-sm sm:p-10 print:border-0 print:shadow-none">
          <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">
            {magnet.title} · getconvocate.com
          </p>
          <div className="guide-sheet-body">{renderMarkdown(data.markdown)}</div>
        </article>
        <p className="print-hide mt-6 text-xs leading-relaxed text-ink-soft">
          This sheet is part of a free guide at{" "}
          <Link to={leadMagnetPath(magnet.slug)} className="font-medium text-brand underline">
            {`getconvocate.com${leadMagnetPath(magnet.slug)}`}
          </Link>
          . The address you left is stored by Convocate and never sold; the{" "}
          <Link to="/privacy" className="font-medium text-brand underline">
            privacy page
          </Link>{" "}
          says how to have it deleted.
        </p>
      </main>
    </div>
  );
}
