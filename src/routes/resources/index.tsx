import { Link, createFileRoute } from "@tanstack/react-router";
import { PublicPage, PageHead, SectionHead, FRAME, actionPrimary, actionSecondary, linkInline } from "~/components/public-page";
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
 *
 * Presentation: a guide is a hairline-separated row, not a boxed card — a rule
 * above it, the access label in small caps, the title in Fraunces, the promise
 * in body type, and one thin outlined action. The paid half sits on the
 * deep-cream band so the two halves read as two sections rather than one long
 * list.
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

function GuideRow({ magnet }: { magnet: LeadMagnet }) {
  const free = magnet.access === "free";
  return (
    <li className="flex flex-col border-t border-taupe/80 pb-10 pt-7">
      <h3 className="font-display text-balance text-[1.3rem] font-normal leading-snug text-charcoal">
        {magnet.title}
      </h3>
      <p className="mt-3 flex-1 text-[15.5px] leading-[1.75] text-charcoal-soft">{magnet.promise}</p>
      <p className="mt-6">
        <Link
          to={leadMagnetPath(magnet.slug)}
          className={free ? actionPrimary : actionSecondary}
        >
          {free ? magnet.buttonLabel : "Read the opening section"}
        </Link>
      </p>
    </li>
  );
}

/** Two columns of hairline rows from `sm` up; one column on a phone. */
const guideGrid = "mt-12 grid gap-x-12 sm:grid-cols-2";

function Resources() {
  const free = LEAD_MAGNETS.filter((magnet) => magnet.access === "free");
  const paid = LEAD_MAGNETS.filter((magnet) => magnet.access === "paid");
  return (
    <PublicPage>
      <PageHead
        eyebrow="Resources"
        title="Guides for the person who runs the conference"
        lede={
          <>
            Ten working documents for whoever owns the money and the contracts for an event. Two
            are free to read by anyone — the conference budget template and the conference day
            timeline — each on its own page in full; printing either one asks for an email address.
            The other eight are part of the $199 plan on an event.
          </>
        }
      />

      <div className={`${FRAME} pb-20 md:pb-24`}>
        <section aria-labelledby="free-guides">
          <SectionHead
            id="free-guides"
            title="Free to read in full"
            lede="Both guides are on their own page in full, nothing is held back, and there is no email address needed to read either one. Both also have a printable one-page sheet; that sheet asks for an address, the reading never does."
          />
          <ul className={guideGrid}>
            {free.map((magnet) => (
              <GuideRow key={magnet.slug} magnet={magnet} />
            ))}
          </ul>
        </section>
      </div>

      <div className="border-y border-taupe/70 bg-cream-deep py-20 md:py-24">
        <div className={FRAME}>
          <section aria-labelledby="paid-guides">
            <SectionHead
              id="paid-guides"
              title="Part of the $199 plan"
              lede="These eight come with the $199 event plan. Each page opens with a real section of the guide so you can see what you are getting, and the whole thing opens once an event on your account is unlocked. There is a free plan as well — one event, the account owner alone, and one budget line."
            />
            <ul className={guideGrid}>
              {paid.map((magnet) => (
                <GuideRow key={magnet.slug} magnet={magnet} />
              ))}
            </ul>
          </section>
        </div>
      </div>

      <div className={`${FRAME} pb-24`}>
        <p className="mx-auto mt-16 max-w-[62ch] border-t border-taupe/80 pt-8 text-center text-[15.5px] leading-[1.8] text-charcoal-soft">
          If you would like to see these numbers and dates in a plan, there is a filled-in example
          event at{" "}
          <Link to="/example" className={linkInline}>
            the worked example
          </Link>
          .
        </p>
      </div>
    </PublicPage>
  );
}
