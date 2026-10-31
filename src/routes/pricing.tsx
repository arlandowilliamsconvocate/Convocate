import { Link, createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  ACTION,
  BODY,
  Band,
  HERO,
  LEDE,
  LINK,
  PageOpening,
  SECTION,
} from "~/components/editorial-page";
import { PublicPage } from "~/components/public-page";

/**
 * /pricing — the one price, what the free plan holds, and what the $199 opens.
 *
 * Public and static: no loader, no session, no database. The copy is the
 * approved text from the lead; do not add claims, prices or names to it.
 *
 * Composition, in the landing page's language (src/routes/index.tsx):
 *
 *  1. The two plans stay side by side from `md` up, and the $199 plan is the
 *     one being offered: it is painted on the deeper cream, its figure is set
 *     at the hero size against the free plan's section size, and it carries the
 *     page's only filled action. Nothing is divided by a hairline — the tone
 *     step, the space and the type weight do the separating, exactly as they do
 *     between the landing page's bands.
 *  2. On a 390px phone the grid is one column, and the two plans stay two
 *     labelled blocks: "Free" on the cream, then "$199" on a full-width deeper
 *     cream panel.
 *  3. The refund rule, then the $0-of-attendee-money statement as the page's
 *     single charcoal band, then the screenshots on the deeper cream, then the
 *     closing links. One filled surface on the page, in the paid column.
 *
 * The screenshots are real captures of the read-only example conference
 * ("Bridgeway Conference 2027", invented figures, labeled "Example · view
 * only" in the product). They are WebP files in `public/screenshots`, captured
 * from the live site at 1000–1100px and encoded at about 1x so the text stays
 * legible at the ~540px they are shown at here.
 */

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Convocate" },
      {
        name: "description",
        content:
          "Convocate costs $199 per conference, paid once — no subscription, no per-seat charge, nothing renews. The free plan lets you run one conference on your own with one budget line.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Convocate" },
      { property: "og:title", content: "Pricing — Convocate" },
      {
        property: "og:description",
        content:
          "$199 per conference, paid once, with a free plan to try the arithmetic on your own numbers. No subscription, no per-seat charge, nothing renews.",
      },
      { property: "og:url", content: "https://www.getconvocate.com/pricing" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Pricing — Convocate" },
      {
        name: "twitter:description",
        content:
          "$199 per conference, paid once, with a free plan for one event and one budget line.",
      },
    ],
    links: [{ rel: "canonical", href: "https://www.getconvocate.com/pricing" }],
  }),
  component: Pricing,
});

/* -------------------------------------------------------------------------- */
/* Copy — every line is a fact that ships today.                              */
/* -------------------------------------------------------------------------- */

const FREE_ITEMS = [
  "The event itself: name, dates, venue, expected attendance and budget target.",
  "One budget line against that target, with planned and committed amounts, so you can see the arithmetic work on your own numbers.",
  "The read-only example conference, to look around before you start.",
];

const NOT_INCLUDED =
  "Not included on the free plan: more than one budget line, contracts, committee invitations, printing a contract or the whole board, attached documents, invitation letters, generated agreements, checklists, event registration and the eight paid planning guides.";

/** The $199 plan, in the order the offer reads: money, people, paper, extras. */
const PAID_ITEMS: { title: string; detail: ReactNode }[] = [
  {
    title: "Unlimited budget lines",
    detail: "by category, with planned against committed, rollups and the over-budget flag.",
  },
  {
    title: "Unlimited contracts",
    detail:
      "across speakers, musicians, singers, bands, backline and equipment suppliers, and the venue, each with its pipeline stage and contract state.",
  },
  { title: "Committee invites", detail: "as an Editor or a Viewer, revocable at any time." },
  {
    title: "Exports",
    detail: "the attendee list as a CSV file.",
  },
  {
    title: "Attached documents",
    detail:
      "signed contracts and scans: PDF, PNG or JPG, up to 10 MB a file and 100 MB a conference.",
  },
  {
    title: "Printed contracts",
    detail: "a single contract, or the whole board, on a clean sheet for the committee.",
  },
  {
    title: "Invitation letters",
    detail: "generated from what you have entered and editable before you print.",
  },
  {
    title: "Agreements with electronic signing",
    detail:
      "a draft per guest, supplier or venue, with optional clauses and your own free text, signed by typed name or a drawn signature.",
  },
  {
    title: "Checklists",
    detail: "the planning checklist, phase by phase, with what is done and what is left.",
  },
  {
    title: "Event registration",
    detail: "the switch, ticket types, the attendee list and the CSV export.",
  },
  {
    title: "The eight paid planning guides",
    detail: (
      <>
        on{" "}
        <Link to="/resources" className={LINK}>
          the resources page
        </Link>
        , alongside the two you can read without an account.
      </>
    ),
  },
];

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A product screenshot: no box, no hairline, a factual caption at body size.
 * Width and height are the file's own pixel size, so the browser reserves the
 * space before the image loads and the page does not jump.
 */
function Shot({
  src,
  alt,
  caption,
  width,
  height,
}: {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
}) {
  return (
    <figure className="m-0 break-inside-avoid">
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        className="block h-auto w-full"
      />
      <figcaption className={`mt-4 ${BODY} text-charcoal-soft`}>{caption}</figcaption>
    </figure>
  );
}

function Pricing() {
  return (
    <PublicPage>
      <PageOpening
        title="One conference, one payment."
        lede={
          <>
            Convocate costs $199 per conference, paid once. No subscription, no per-seat charge,
            nothing renews. Every option opens on that conference when you pay.
          </>
        }
      />

      {/* ---------------------------------------------------------------- */}
      {/* 1. Free and $199, side by side, separated by tone and space        */}
      {/* ---------------------------------------------------------------- */}
      <Band
        id="plans"
        title="What each plan holds."
        lede="The free plan is a real plan, not a trial that expires."
        measure="48ch"
      >
        <div className="mt-14 grid gap-14 md:grid-cols-2 md:gap-10 lg:gap-14">
          {/* Free. Source order first, because that is the order the eye reads. */}
          <section aria-labelledby="plan-free">
            <h3 id="plan-free" className={`font-display font-medium text-charcoal-soft ${SECTION}`}>
              Free
            </h3>
            <p className={`mt-4 ${LEDE} text-charcoal-soft`}>One event, and you work on it alone.</p>
            <ul className={`mt-8 grid gap-4 ${BODY} text-charcoal-soft`}>
              {FREE_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className={`mt-10 ${BODY} text-charcoal-soft`}>{NOT_INCLUDED}</p>
            <p className={`mt-8 ${BODY} text-charcoal`}>
              <Link to="/signup" search={{ redirect: undefined }} className={LINK}>
                Create a free account
              </Link>
            </p>
          </section>

          {/* The $199 plan: the deeper cream, the hero figure, the filled action. */}
          <section
            aria-labelledby="plan-paid"
            className="-mx-6 bg-cream-deep px-6 py-12 md:mx-0 md:px-8 md:py-12 lg:px-12 lg:py-14"
          >
            <h3 id="plan-paid" className={`font-display font-medium text-charcoal ${HERO}`}>
              $199
            </h3>
            <p className={`mt-4 ${LEDE} text-charcoal-soft`}>
              One payment for that conference. Nothing renews.
            </p>
            <p className={`mt-8 ${BODY} text-charcoal`}>
              Everything on that conference, with nothing held back:
            </p>
            <ul className={`mt-6 grid gap-4 ${BODY} text-charcoal-soft`}>
              {PAID_ITEMS.map((item) => (
                <li key={item.title}>
                  <strong className="font-semibold text-charcoal">{item.title}.</strong>{" "}
                  {item.detail}
                </li>
              ))}
            </ul>
            <p className="mt-10">
              <Link
                to="/signup"
                search={{ redirect: undefined }}
                className={`${ACTION} w-full sm:w-auto`}
              >
                Create an account to unlock
              </Link>
            </p>
          </section>
        </div>

        {/* The refund rule, exactly as the landing page and the Terms state it. */}
        <p className={`mt-16 max-w-[64ch] ${LEDE} text-charcoal-soft`}>
          If it is not right for you, say so within 48 hours of paying and the whole amount comes
          back — no questions, and the conference stays, back on the free plan with its data in
          place.
        </p>
      </Band>

      {/* ---------------------------------------------------------------- */}
      {/* 2. The one statement the business needs said out loud            */}
      {/* ---------------------------------------------------------------- */}
      <Band id="attendee-money" tone="charcoal" title="Attendee money never touches us." measure="46ch">
        <p className={`mt-6 max-w-[52ch] ${LEDE} text-cream/85`}>
          Registration fees and donations are paid into your own Stripe account, and Convocate takes
          nothing from them. That is{" "}
          <strong className="font-semibold text-cream">$0</strong>: not a percentage, not a fee.
        </p>
      </Band>

      {/* ---------------------------------------------------------------- */}
      {/* 3. What it looks like inside                                     */}
      {/* ---------------------------------------------------------------- */}
      <Band
        id="inside-the-plan"
        tone="deep"
        title="What it looks like inside."
        lede="Captured from the read-only example conference — invented figures, marked “Example · view only” in the product."
        measure="56ch"
      >
        {/* CSS columns rather than a grid: the screenshots are different
            heights, and a row grid would stretch every short one to the height
            of its neighbour. A column flows them and balances the two sides. */}
        <div className="mt-14 md:columns-2 md:gap-x-12 [&>figure]:mb-12">
          <Shot
            src="/screenshots/free-plan-conference.webp"
            width={1077}
            height={397}
            alt="A conference card from the Convocate app: Bridgeway Conference 2027, Mar 12, 2027 – Mar 14, 2027 at Riverside Conference Center, with a target of $75,000, $80,300 planned, over by $5,300, a count of guests and suppliers, and a badge reading Example · view only."
            caption="What the free plan gives you: the conference itself — its name, dates, venue and budget target. The card shown is the read-only example conference; its figures are invented, which is why it is marked “Example · view only”."
          />
          <Shot
            src="/screenshots/budget.webp"
            width={1085}
            height={984}
            alt="The Budget section of the example conference: four summary figures — budget target $75,000, total planned $80,300, total committed $37,100, and over budget by $5,300 with the note “Planned lines exceed the target” — then a table of eight budget lines with category, planned and committed amounts, and a roll-up by category."
            caption="Unlimited budget lines by category, planned against committed, the roll-up by category and the over-budget flag — here $5,300 over a $75,000 target."
          />
          <Shot
            src="/screenshots/contracts.webp"
            width={1085}
            height={1052}
            alt="The contracts board of the example conference: counts of invites, negotiating, contracted and booked entries, a total for all entries and a separate total for signed contracts only, then pipeline columns listing each guest, supplier and venue with its fee and its contract state, such as signed or not sent."
            caption="One board for every guest, supplier and venue, with the pipeline stage and whether the contract itself is signed."
          />
          <Shot
            src="/screenshots/invitation-letter.webp"
            width={820}
            height={470}
            alt="An invitation letter for a guest speaker: headed with the conference name, dates and venue, addressed to Rev. Dr. Anne Mbeki, naming the part they are invited to take and stating a fee of $4,000, an honorarium of $1,500 and $900 set aside for travel, with a total for the part of $6,400."
            caption="An invitation letter built from what is on the contract — dates, venue, the part they take, and the fee, honorarium and travel amounts exactly as entered — editable before printing."
          />
          <Shot
            src="/screenshots/agreement.webp"
            width={820}
            height={1159}
            alt="The first page of a generated draft agreement: the parties, with Rev. Dr. Anne Mbeki as the speaker and the organizer left blank to complete by hand; the scope of services; the schedule with blank times; and the fee itemized as fee $4,000, honorarium $1,500, travel $900, equipment $0 and total $6,400."
            caption="The first page of a draft agreement per guest, supplier or venue: the parties, the scope, the schedule and the fee itemized exactly as the contract states it, with blanks to complete by hand."
          />
        </div>
      </Band>

      {/* ---------------------------------------------------------------- */}
      {/* 4. Close, in text links — the page's one filled action is above   */}
      {/* ---------------------------------------------------------------- */}
      <Band
        id="start-free"
        title="Start on the free plan."
        lede="One event and one budget line, no card needed. Unlock that conference for $199 whenever you want the rest of it."
        measure="52ch"
      >
        <div className={`mt-8 grid gap-3 ${BODY} text-charcoal-soft`}>
          <p>
            <Link to="/signup" search={{ redirect: undefined }} className={LINK}>
              Create an account
            </Link>{" "}
            and start naming the event. It takes a minute.
          </p>
          <p>
            <Link to="/budget-calculator" className={LINK}>
              Get your budget number first
            </Link>
            : the estimator is free and asks for no account.
          </p>
          <p>
            Already have an account?{" "}
            <Link to="/signin" className={LINK}>
              Sign in
            </Link>
            .
          </p>
        </div>
      </Band>
    </PublicPage>
  );
}
