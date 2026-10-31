import { Link, createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SiteHeader } from "~/components/site-chrome";
import { getSessionUser } from "~/server/api";

/**
 * The landing page.
 *
 * Composition is the owner-approved mock in
 * `/home/team/shared/ideas/taste-after/`, rebuilt here in the site's own tokens.
 * Four rules govern it, and they are the whole design:
 *
 *  1. **Tone steps, not rules.** The page is banded cream → deep cream → cream →
 *     charcoal → deep cream → cream. There is no hairline divider, no 1px
 *     outlined box, no eyebrow label, no 01–04 numeral and no tracked all-caps
 *     string anywhere on it.
 *  2. **Four type sizes.** 17 body, 20 lede, 40 section, 62 hero — and nothing
 *     below 16px. Body is never below 17 in fact; the smallest thing on the page
 *     is the table, at body size.
 *  3. **One fill per screen.** The only filled surface is the action, painted
 *     with `bg-action` (#8a4a2a, 6.36:1 against `text-on-action`) — never the
 *     decorative terracotta accent, which `scripts/check-terracotta-fill.ts`
 *     fails the build over. Every other action is a sentence-case text link.
 *  4. **Photographs are content.** Two real photographs, each a framed block with
 *     explicit dimensions, never a background behind text.
 *
 * Two rules govern the copy. Everything claimed is a feature that ships — no
 * testimonial, no customer count, no urgency, no invented fee — and every action
 * points at a route that exists: /budget-calculator, /pricing, /resources,
 * /signin, /signup.
 *
 * The hero headline and its supporting sentence are the owner's approved
 * wording, reproduced exactly. The budget table is the worked example the
 * approved mock shows; it is one constant (`BUDGET_ROWS`) so the figures can be
 * swapped in a single edit.
 */

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Convocate — Run the whole conference from one page" },
      {
        name: "description",
        content:
          "Convocate is a planning workspace for conferences and events: a budget with planned and committed amounts, a contracts board for speakers, venue and suppliers, and one shared record for the whole committee. $199 once per conference, with a free plan to try it.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Convocate" },
      { property: "og:title", content: "Convocate — Run the whole conference from one page" },
      {
        property: "og:description",
        content:
          "The budget, the venue, the speakers and every contract in one place — instead of six spreadsheets and a group chat.",
      },
      { property: "og:url", content: "https://www.getconvocate.com/" },
      { property: "og:image", content: "https://www.getconvocate.com/og-home.jpg" },
      { property: "og:image:type", content: "image/jpeg" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      {
        property: "og:image:alt",
        content: "An empty conference hall in warm morning light, seats facing a bare stage.",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Convocate — Run the whole conference from one page" },
      {
        name: "twitter:description",
        content:
          "A budget with planned and committed amounts, a contracts board, and one shared record for the whole committee. $199 once per conference.",
      },
      { name: "twitter:image", content: "https://www.getconvocate.com/og-home.jpg" },
    ],
    links: [{ rel: "canonical", href: "https://www.getconvocate.com/" }],
  }),
  loader: async () => ({ user: await getSessionUser() }),
  component: Landing,
});

/* -------------------------------------------------------------------------- */
/* The four type sizes                                                        */
/* -------------------------------------------------------------------------- */

/** 62px at 1440, 34px at 390 — the one h1, and never smaller than 32 on a phone. */
const HERO = "text-[clamp(2.125rem,4.35vw,3.875rem)] leading-[1.05] tracking-[-0.02em]";
/** 40px at 1440, 28px at 390 — every h2, and the $199 figure. */
const SECTION = "text-[clamp(1.75rem,2.8vw,2.5rem)] leading-[1.1] tracking-[-0.015em]";
/** 20px — the supporting sentence under a heading, and every h3. */
const LEDE = "text-[20px] leading-[1.5]";
/** 17px — body. Nothing on this page is smaller. */
const BODY = "text-[17px] leading-[1.65]";

/** The one filled surface on a screen. */
const ACTION =
  "inline-flex items-center justify-center bg-action px-8 py-5 text-[17px] font-semibold text-on-action transition-colors hover:bg-action-strong";

/** A sentence-case text link that stands in for a second button. */
const LINK =
  "text-terracotta-ink underline decoration-terracotta/40 underline-offset-4 transition-colors hover:decoration-terracotta-ink";

/* -------------------------------------------------------------------------- */
/* Copy — every line below is grounded in a feature that actually ships.      */
/* -------------------------------------------------------------------------- */

/** The worked example the approved mock shows: line / planned / committed. */
const BUDGET_ROWS = [
  { line: "Musicians", planned: "$125", committed: "$0" },
  { line: "Drums", planned: "$125", committed: "$0" },
  { line: "Honorarium", planned: "$500", committed: "$500" },
] as const;

const BUDGET_TOTAL = "Three lines";
const BUDGET_TOTAL_PLANNED = "$750";
const BUDGET_TOTAL_COMMITTED = "$500";
const BUDGET_UNALLOCATED = "In this example, $2,850 is still unallocated against a $3,600 target.";

const BUDGET_POINTS = [
  {
    title: "Planned against committed",
    body: "What you expect to spend, next to what is already agreed, with the difference always on screen.",
  },
  {
    title: "Rolled up by category",
    body: "Venue, speaker fees, music, equipment, travel, hospitality and production — every line counted once and totaled by kind.",
  },
  {
    title: "Over budget before it is a crisis",
    body: "When the planned lines pass the target, the budget says so, while there is still room to move something.",
  },
];

const CONTRACT_POINTS = [
  {
    title: "Not sent, sent, signed",
    body: "Each row carries its own contract status, so you can see the difference between “we agreed on the phone” and “the signature is here”.",
  },
  {
    title: "The signed copy stays with the row",
    body: "Attach the signed contract or a scan of it to the person it belongs to. It is private: there is no public link, and nobody outside the event can open it.",
  },
  {
    title: "The people you actually book",
    body: "Speakers, musicians, the venue and equipment suppliers — one board, one set of stages, no separate tracker for each.",
  },
];

const SCATTER = [
  {
    title: "The budget lives in three files",
    body: "One for the treasurer, one for the venue, one you keep editing at night. Nobody can say which of them is current.",
  },
  {
    title: "The decision was made in the group chat",
    body: "A fee moves in a thread at nine in the evening. The contract still carries last week's number, and the invoice arrives at the new one.",
  },
  {
    title: "The signed copy is in someone's inbox",
    body: "When the board asks for proof that the speaker is booked, you search four mailboxes for a PDF that may only exist on a phone.",
  },
];

const SHARED = [
  {
    title: "The budget",
    body: "Planned and committed amounts, rolled up by category, with anything past your target flagged rather than discovered.",
  },
  {
    title: "The contracts",
    body: "Speakers, musicians, the venue and equipment suppliers, each at a stage, each with its contract status and its paper attached.",
  },
  {
    title: "The record",
    body: "Your committee reads the same live numbers you do, instead of the export you sent on Tuesday.",
  },
];

const STEPS = [
  {
    title: "Name the event",
    body: "Dates, venue, expected attendance and the budget you have to hit. A minute, and there is nothing to configure first.",
  },
  {
    title: "Build the budget",
    body: "Add lines as quotes come in. Watch committed catch up with planned, and the categories total themselves.",
  },
  {
    title: "Work the contracts",
    body: "Move each speaker and supplier from invited to booked as the paperwork moves, and file the signed copy as it lands.",
  },
  {
    title: "Share one set of numbers",
    body: "Invite your committee. They read the live totals, so nobody rebuilds a spreadsheet the night before the meeting.",
  },
];

/** Four of the ten guides that exist on /resources, with their real access. */
const GUIDES = [
  {
    to: "/resources/conference-budget-template",
    title: "Conference budget template",
    body: "Every line a conference really has, with the percentages to check your own numbers against.",
    access: "Free to read in full.",
  },
  {
    to: "/resources/conference-day-timeline",
    title: "Conference day timeline",
    body: "A run-of-show from a month out to the last chair, with an owner named against every line.",
    access: "Free to read in full.",
  },
  {
    to: "/resources/speaker-contract-template",
    title: "Speaker contract template",
    body: "Eighteen clauses, every blank named, ready to fill in and sign.",
    access: "Included with the $199 plan.",
  },
  {
    to: "/resources/speaker-fees-and-honorariums",
    title: "How much should I pay a guest speaker?",
    body: "What actually drives a fee, and the questions to put to a speaker's office.",
    access: "Included with the $199 plan.",
  },
] as const;

const UNLOCKED = [
  "Unlimited budget lines",
  "Unlimited contracts",
  "Committee invites",
  "Attached signed documents",
  "Printed contracts and letters",
  "Agreements with electronic signing",
  "Planning checklists",
  "Event registration",
];

/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */

function Section({
  id,
  title,
  lede,
  children,
  tone = "cream",
  measure = "52ch",
}: {
  id: string;
  title: string;
  lede?: ReactNode;
  children?: ReactNode;
  tone?: "cream" | "deep";
  measure?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={tone === "deep" ? "bg-cream-deep py-20 md:py-24" : "py-20 md:py-24"}
    >
      <div className="mx-auto max-w-[74rem] px-6 lg:px-12">
        <h2 id={id} className={`font-display font-medium text-charcoal ${SECTION}`}>
          {title}
        </h2>
        {lede && (
          <p className={`mt-5 ${LEDE} text-charcoal-soft`} style={{ maxWidth: measure }}>
            {lede}
          </p>
        )}
        {children}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* The page                                                                   */
/* -------------------------------------------------------------------------- */

function Landing() {
  const { user } = Route.useLoaderData();

  return (
    <div className="paper-grain min-h-screen bg-cream font-sans text-charcoal">
      {/* The first thing a keyboard reaches: straight past the header to the page. */}
      <a
        href="#main"
        className="sr-only text-[17px] focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-charcoal focus:px-5 focus:py-3 focus:text-[17px] focus:text-cream"
      >
        Skip to content
      </a>

      <SiteHeader signedIn={Boolean(user)} onHome />

      <main id="main">
        {/* ---------------------------------------------------------------- */}
        {/* 1. Hero — headline, one sentence, one action, one photograph      */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="hero-title" className="pt-4 pb-16 md:pt-8 md:pb-24">
          <div className="mx-auto grid max-w-[74rem] items-center gap-10 px-6 md:grid-cols-[1.15fr_0.85fr] md:gap-14 lg:gap-16 lg:px-12">
            <div>
              <h1
                id="hero-title"
                className={`font-display font-medium text-charcoal ${HERO}`}
              >
                Run the conference from one page.
              </h1>
              <p className={`mt-6 max-w-[34ch] ${LEDE} text-charcoal-soft`}>
                Budget, venue and speaker negotiations, signed contracts and registration in one
                place — <span className="text-charcoal">$199 per conference, paid once.</span>
              </p>
              <Link to="/budget-calculator" className={`${ACTION} mt-8`}>
                Get your budget number
              </Link>
            </div>

            <figure className="m-0">
              <div className="relative aspect-[4/3] overflow-hidden md:aspect-[4/5]">
                <picture>
                  <source
                    media="(max-width: 767px)"
                    srcSet="/photos/hall-m-600.webp 600w, /photos/hall-m-900.webp 900w"
                    sizes="100vw"
                  />
                  <img
                    src="/photos/hall-1200.webp"
                    srcSet="/photos/hall-800.webp 800w, /photos/hall-1200.webp 1200w, /photos/hall-1600.webp 1600w"
                    sizes="(min-width: 768px) 44vw, 100vw"
                    alt="An empty conference hall in warm afternoon light: rows of wooden chairs facing a bare stage and tall windows."
                    width={1600}
                    height={900}
                    fetchPriority="high"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                </picture>
                <figcaption className="absolute inset-x-0 bottom-0 bg-[#2B2724]/65 px-5 py-4 text-[17px] leading-[1.45] text-cream">
                  Our free estimator gives you a low-to-high range before you pay anything.
                </figcaption>
              </div>
            </figure>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 2. The budget, in the product's own terms                         */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="budget-title" className="bg-cream-deep py-20 md:py-24">
          <div className="mx-auto max-w-[74rem] px-6 lg:px-12">
            <div className="grid gap-12 md:grid-cols-[0.92fr_1.08fr] md:gap-16 lg:gap-24">
              <div>
                <h2 id="budget-title" className={`font-display font-medium text-charcoal ${SECTION}`}>
                  Planned money, committed money.
                </h2>
                <p className={`mt-5 max-w-[34ch] ${LEDE} text-charcoal-soft`}>
                  The number you agreed with the speaker is on the same page as the venue deposit,
                  so you can see what is still unspoken for.
                </p>
                <p className={`mt-6 font-semibold text-sage-ink ${BODY}`}>{BUDGET_UNALLOCATED}</p>
              </div>

              <table className="w-full border-collapse text-left tabular-nums">
                <caption className={`pb-4 text-left ${BODY} text-charcoal-soft`}>
                  An example budget, three of its lines
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className={`${BODY} font-semibold text-charcoal-soft`}>
                      Line
                    </th>
                    <th scope="col" className={`${BODY} text-right font-semibold text-charcoal-soft`}>
                      Planned
                    </th>
                    <th
                      scope="col"
                      className={`${BODY} text-right font-semibold text-charcoal-soft`}
                    >
                      Committed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {BUDGET_ROWS.map((row) => (
                    <tr key={row.line}>
                      <td className={`py-4 align-baseline ${BODY}`}>{row.line}</td>
                      <td className={`py-4 text-right align-baseline ${BODY}`}>{row.planned}</td>
                      <td className={`py-4 text-right align-baseline ${BODY}`}>{row.committed}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-charcoal font-semibold">
                    <td className={`pb-0 pt-4 align-baseline ${BODY}`}>{BUDGET_TOTAL}</td>
                    <td className={`pb-0 pt-4 text-right align-baseline ${BODY}`}>
                      {BUDGET_TOTAL_PLANNED}
                    </td>
                    <td className={`pb-0 pt-4 text-right align-baseline ${BODY}`}>
                      {BUDGET_TOTAL_COMMITTED}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <dl className="mt-16 grid gap-10 sm:grid-cols-3 sm:gap-10">
              {BUDGET_POINTS.map((point) => (
                <div key={point.title}>
                  <dt className="font-display font-medium text-charcoal text-[20px] leading-snug">
                    {point.title}
                  </dt>
                  <dd className={`mt-2.5 max-w-[38ch] ${BODY} text-charcoal-soft`}>{point.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 3. Contracts — photograph and the plain sentence                  */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="contracts-title" className="py-20 md:py-24">
          <div className="mx-auto max-w-[74rem] px-6 lg:px-12">
            <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16 lg:gap-24">
              <img
                src="/photos/hands-900.webp"
                srcSet="/photos/hands-600.webp 600w, /photos/hands-900.webp 900w, /photos/hands-1200.webp 1200w"
                sizes="(min-width: 768px) 44vw, 100vw"
                alt="Two people leaning over a printed floor plan on a wooden table, one of them marking a room with a pencil."
                width={1200}
                height={1493}
                loading="lazy"
                decoding="async"
                className="aspect-[5/4] w-full object-cover"
              />
              <div>
                <h2
                  id="contracts-title"
                  className={`font-display font-medium text-charcoal ${SECTION}`}
                >
                  The contract, not the email thread.
                </h2>
                <p className={`mt-5 max-w-[34ch] ${LEDE} text-charcoal-soft`}>
                  Invite the venue and the speaker, move each one from invited to booked, and keep
                  the signed copy on the same record as the fee.
                </p>
              </div>
            </div>

            <dl className="mt-16 grid gap-10 sm:grid-cols-3 sm:gap-10">
              {CONTRACT_POINTS.map((point) => (
                <div key={point.title}>
                  <dt className="font-display font-medium text-charcoal text-[20px] leading-snug">
                    {point.title}
                  </dt>
                  <dd className={`mt-2.5 max-w-[38ch] ${BODY} text-charcoal-soft`}>{point.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 4. The one statement the business needs said out loud             */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="statement-title" className="bg-charcoal py-20 md:py-28">
          <div className="mx-auto max-w-[74rem] px-6 lg:px-12">
            <blockquote>
              <p
                id="statement-title"
                className={`font-display font-medium text-cream ${SECTION}`}
                style={{ maxWidth: "24ch" }}
              >
                Attendee money never touches us.
              </p>
            </blockquote>
            <p className={`mt-6 max-w-[46ch] ${LEDE} text-cream/85`}>
              Registration fees and donations go into your own Stripe account. We take{" "}
              <strong className="font-semibold text-cream">$0</strong> of it — not a percentage, not
              a fee. Ours is the $199, paid once, and refunded in full within 48 hours if it is not
              for you.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 5. The record problem                                             */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="scatter-title" className="bg-cream-deep py-20 md:py-24">
          <div className="mx-auto max-w-[74rem] px-6 lg:px-12">
            <div className="grid gap-12 md:grid-cols-[0.92fr_1.08fr] md:gap-16 lg:gap-24">
              <div>
                <h2
                  id="scatter-title"
                  className={`font-display font-medium text-charcoal ${SECTION}`}
                >
                  Six spreadsheets, and none of them agree.
                </h2>
                <p className={`mt-5 max-w-[38ch] ${LEDE} text-charcoal-soft`}>
                  It is rarely a planning problem. It is a record problem: the numbers live in four
                  places, and the version people read depends on who sent it last.
                </p>
              </div>
              <dl className="grid gap-9">
                {SCATTER.map((item) => (
                  <div key={item.title}>
                    <dt className="font-display font-medium text-charcoal text-[20px] leading-snug">
                      {item.title}
                    </dt>
                    <dd className={`mt-2 max-w-[52ch] ${BODY} text-charcoal-soft`}>{item.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 6. One shared record                                              */}
        {/* ---------------------------------------------------------------- */}
        <Section
          id="shared-title"
          title="One page holds the budget and the contracts."
          measure="60ch"
          lede="Convocate is a planning workspace for a single conference: the budget in planned and committed amounts, a contracts board for everyone you are booking, and one record the people around you can read."
        >
          <dl className="mt-14 grid gap-10 sm:grid-cols-3 sm:gap-10">
            {SHARED.map((item) => (
              <div key={item.title}>
                <dt className="font-display font-medium text-charcoal text-[20px] leading-snug">
                  {item.title}
                </dt>
                <dd className={`mt-2.5 max-w-[38ch] ${BODY} text-charcoal-soft`}>{item.body}</dd>
              </div>
            ))}
          </dl>
        </Section>

        {/* ---------------------------------------------------------------- */}
        {/* 7. How it works                                                   */}
        {/* ---------------------------------------------------------------- */}
        <Section
          id="how-it-works"
          tone="deep"
          title="Four steps, in the order you do them."
          measure="56ch"
          lede="Nothing to import and nothing to integrate. You start with the event you already have in front of you."
        >
          <ol role="list" className="mt-14 grid max-w-[64rem] gap-10 md:grid-cols-2 md:gap-x-16">
            {STEPS.map((step) => (
              <li key={step.title}>
                <h3 className="font-display font-medium text-charcoal text-[20px] leading-snug">
                  {step.title}
                </h3>
                <p className={`mt-2.5 max-w-[42ch] ${BODY} text-charcoal-soft`}>{step.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* ---------------------------------------------------------------- */}
        {/* 8. The guides                                                     */}
        {/* ---------------------------------------------------------------- */}
        <Section
          id="guides-title"
          title="Ten guides, two of them free."
          measure="56ch"
          lede="Two you can read in full without an account, and no page asks you for an email. The other eight come with the $199 plan."
        >
          <ul role="list" className="mt-14 grid gap-10 md:grid-cols-2 md:gap-x-16">
            {GUIDES.map((guide) => (
              <li key={guide.to}>
                <h3 className="text-[20px] leading-snug">
                  <Link
                    to={guide.to}
                    className="font-display font-medium text-charcoal underline decoration-taupe underline-offset-4 transition-colors hover:decoration-action"
                  >
                    {guide.title}
                  </Link>
                </h3>
                <p className={`mt-2.5 max-w-[42ch] ${BODY} text-charcoal-soft`}>
                  {guide.body} {guide.access}
                </p>
              </li>
            ))}
          </ul>
          <p className={`mt-12 ${BODY}`}>
            <Link to="/resources" className={LINK}>
              All ten guides
            </Link>
          </p>
        </Section>

        {/* ---------------------------------------------------------------- */}
        {/* 9. Price                                                          */}
        {/* ---------------------------------------------------------------- */}
        <Section
          id="price-title"
          tone="deep"
          title="One price for one conference."
          measure="52ch"
          lede="No subscription, no per-seat charge, and nothing renews. The free plan is a real plan, not a trial that expires."
        >
          <div className="mt-14 grid gap-14 md:grid-cols-2 md:gap-20">
            <div>
              <p className={`font-display font-medium text-charcoal ${SECTION}`}>Free</p>
              <h3 className="mt-4 font-display font-medium text-charcoal text-[20px] leading-snug">
                One conference, one budget line.
              </h3>
              <p className={`mt-3 max-w-[42ch] ${BODY} text-charcoal-soft`}>
                Just you, on a single event, with a single line in the budget. It is enough to see
                the arithmetic work on your own numbers before you decide anything.
              </p>
              <p className={`mt-6 ${BODY}`}>
                <Link to="/signup" className={LINK}>
                  Create a free account
                </Link>
              </p>
            </div>

            <div>
              <p className={`font-display font-medium text-charcoal ${SECTION}`}>$199</p>
              <h3 className="mt-4 font-display font-medium text-charcoal text-[20px] leading-snug">
                Then everything on that conference is unlocked.
              </h3>
              <ul className={`mt-4 grid gap-x-8 gap-y-2 ${BODY} text-charcoal-soft sm:grid-cols-2`}>
                {UNLOCKED.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className={`mt-6 max-w-[46ch] ${BODY} text-charcoal-soft`}>
                Registration fees and donations are paid into your own Stripe account. Convocate
                takes nothing from them.
              </p>
            </div>
          </div>

          <p className={`mt-14 max-w-[64ch] ${BODY} text-charcoal-soft`}>
            If it is not right for you, say so within 48 hours of paying and the whole amount comes
            back — no questions, and the conference stays, back on the free plan with its data in
            place. The detail is on the{" "}
            <Link to="/pricing" className={LINK}>
              pricing page
            </Link>
            .
          </p>
        </Section>

        {/* ---------------------------------------------------------------- */}
        {/* 10. Close — the estimator handoff                                 */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="close-title" className="py-20 md:py-28">
          <div className="mx-auto max-w-[74rem] px-6 lg:px-12">
            <h2 id="close-title" className={`font-display font-medium text-charcoal ${SECTION}`}>
              Start with the number, not the sales call.
            </h2>
            <p className={`mt-5 max-w-[52ch] ${LEDE} text-charcoal-soft`}>
              The estimator is free, needs no account, and asks you for seven things you already
              know.
            </p>
            <Link to="/budget-calculator" className={`${ACTION} mt-8`}>
              Get your budget number
            </Link>
            <p className={`mt-8 ${BODY} text-charcoal-soft`}>
              Already have an account?{" "}
              <Link to="/signin" className={LINK}>
                Sign in
              </Link>
              .
            </p>
          </div>
        </section>
      </main>

      {/* The footer is shared, mounted once in src/routes/__root.tsx. */}
    </div>
  );
}
