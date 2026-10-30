import { Link, createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/site-chrome";
import { LEAD_MAGNETS, SITE_ORIGIN, leadMagnetPath, type LeadMagnet } from "~/lib/lead-magnets";

/**
 * /resources — the guides, in one place, cut honestly in two.
 *
 * **Free** guides — exactly two, the conference budget template and the
 * conference day timeline — are on their own page in full: a crawler reads every
 * word and so does a person with JavaScript off. Both have a printable one-page
 * sheet, which asks for an email address first; the reading never does.
 *
 * **Paid** guides — the other eight — show their opening section on their own page
 * for anyone, then say plainly that the rest comes with the $199 plan. The list
 * is built from `LEAD_MAGNETS`, so a card can never describe a guide as free when
 * its record says otherwise — the label and the page are driven by the same
 * field.
 *
 * The copy below does state the count ("Ten working documents", "These eight"),
 * because a reader wants to know how much there is before they start. That means
 * the numbers have to be updated when a guide is added or one moves between the
 * two halves — the cards themselves never need it.
 */
export const Route = createFileRoute("/resources/")({
  head: () => ({
    meta: [
      { title: "Guides for conference and event organizers — Convocate" },
      {
        name: "description",
        content:
          "Ten working documents for conference and event organizers. Two are free to read by anyone: a line-by-line conference budget template and a conference day timeline. The other eight — a venue and speaker contract checklist, three ready-to-send speaker invitation letters, a speaker contract template with eighteen clauses, a printable venue site visit checklist, a guide to deciding what you pay a guest speaker, a twelve-month planning checklist, a guide to conference committee roles and responsibilities, and a guide to writing an event cancellation policy — are part of the $199 plan on an event.",
      },
    ],
    links: [{ rel: "canonical", href: `${SITE_ORIGIN}/resources` }],
  }),
  component: Resources,
});

function GuideCard({ magnet }: { magnet: LeadMagnet }) {
  const free = magnet.access === "free";
  return (
    <li className="flex flex-col rounded-xl border border-line bg-white p-6 shadow-sm">
      <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">
        {free ? "Free to read in full" : "Part of the $199 plan"}
      </p>
      <h3 className="mt-2 font-serif text-xl leading-snug text-ink">{magnet.title}</h3>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-ink-soft">{magnet.promise}</p>
      <p className="mt-5">
        <Link
          to={leadMagnetPath(magnet.slug)}
          className={
            free
              ? "inline-flex items-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand/90"
              : "inline-flex items-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink shadow-sm hover:bg-paper-deep"
          }
        >
          {free ? magnet.buttonLabel : "Read the opening section"}
        </Link>
      </p>
    </li>
  );
}

function Resources() {
  const free = LEAD_MAGNETS.filter((magnet) => magnet.access === "free");
  const paid = LEAD_MAGNETS.filter((magnet) => magnet.access === "paid");
  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 pb-20 pt-14 sm:pt-20">
        <div className="max-w-3xl">
          <h1 className="text-4xl leading-[1.1] text-ink sm:text-5xl">
            Guides for the person who runs the conference
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-ink-soft">
            Ten working documents for whoever owns the money and the contracts for an event. Two
            are free to read by anyone — the conference budget template and the conference day
            timeline — each on its own page in full; printing either one asks for an email
            address. The other eight are part of the $199 plan on an event.
          </p>
        </div>

        <section className="mt-12">
          <h2 className="font-serif text-2xl text-ink">Free to read in full</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-soft">
            Both guides are on their own page in full, nothing is held back, and there is no email
            address needed to read either one. Both also have a printable one-page sheet; that
            sheet asks for an address, the reading never does.
          </p>
          <ul className="mt-6 grid gap-5 sm:grid-cols-2">
            {free.map((magnet) => (
              <GuideCard key={magnet.slug} magnet={magnet} />
            ))}
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="font-serif text-2xl text-ink">Part of the $199 plan</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-soft">
            These eight come with the $199 event plan. Each page opens with a real section of the
            guide so you can see what you are getting, and the whole thing opens once an event on
            your account is unlocked. There is a free plan as well — one event, the account owner
            alone, and one budget line.
          </p>
          <ul className="mt-6 grid gap-5 sm:grid-cols-2">
            {paid.map((magnet) => (
              <GuideCard key={magnet.slug} magnet={magnet} />
            ))}
          </ul>
        </section>

        <p className="mt-12 max-w-3xl text-sm leading-relaxed text-ink-soft">
          If you would like to see these numbers and dates in a plan, there is a filled-in example
          event at{" "}
          <Link to="/example" className="font-medium text-brand underline">
            the worked example
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
