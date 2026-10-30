import { Link, createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SiteHeader } from "~/components/site-chrome";
import { getSessionUser } from "~/server/api";

/**
 * The landing page — the one public page that is art-directed rather than
 * merely laid out.
 *
 * It is built in the warm editorial language the owner asked for: a cream
 * ground with a 3.5% paper grain, a Fraunces headline in regular weight over a
 * warm photograph, hairline taupe rules, and one muted terracotta accent that
 * only ever appears as a short underline, a rule or a small caps label. There
 * is no filled button anywhere on the page: every action is a 1px outlined
 * rule, which is what keeps it from reading as a SaaS template.
 *
 * Two rules govern the copy. Everything claimed is a feature that exists in
 * the product as it stands — no AI, no integrations, no counts, no logos, no
 * testimonials, no customer names. And every action points at a route that
 * already exists: /signup, /signin, /example (the read-only worked conference),
 * /pricing and /app.
 *
 * The photographs are served from /photos as pre-cropped WebP at the sizes the
 * layout actually asks for, with a portrait crop on a phone (`<picture>` picks
 * it by media query) so the hero is not a letterboxed sliver at 390px. Every
 * image has explicit width and height, so nothing below it moves while it
 * loads.
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
/* Copy — every line below is grounded in a feature that actually ships.      */
/* -------------------------------------------------------------------------- */

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

const label = "text-[11px] uppercase tracking-[0.26em] text-terracotta-ink";

/** The short terracotta rule that sits under every centred headline. */
function Rule() {
  return <span aria-hidden="true" className="mx-auto mt-7 block h-[2px] w-14 bg-terracotta" />;
}

/** A centred section opening: label, headline, rule, one deck line. */
function SectionHead({
  id,
  eyebrow,
  title,
  lede,
  light = false,
  measure = "58ch",
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  lede?: string;
  light?: boolean;
  measure?: string;
}) {
  return (
    <div className="text-center">
      <p className={light ? `${label} text-cream/75` : label}>{eyebrow}</p>
      <h2
        id={id}
        className={`font-display mx-auto mt-5 max-w-[26ch] text-balance text-[clamp(1.7rem,3.2vw,2.6rem)] font-normal leading-[1.15] tracking-[-0.01em] ${
          light ? "text-cream" : "text-charcoal"
        }`}
      >
        {title}
      </h2>
      <Rule />
      {lede && (
        <p
          className={`mx-auto mt-7 text-[17px] leading-[1.75] ${
            light ? "text-cream/85" : "text-charcoal-soft"
          }`}
          style={{ maxWidth: measure }}
        >
          {lede}
        </p>
      )}
    </div>
  );
}

const actionPrimary =
  "inline-flex min-h-12 items-center justify-center border border-charcoal px-7 text-[11px] uppercase tracking-[0.18em] text-charcoal transition-colors hover:bg-charcoal hover:text-cream";

const actionSecondary =
  "inline-flex min-h-12 items-center justify-center border border-taupe px-7 text-[11px] uppercase tracking-[0.18em] text-charcoal-soft transition-colors hover:border-charcoal hover:text-charcoal";

const actionOnPhoto =
  "inline-flex min-h-12 items-center justify-center border border-cream/90 px-7 text-[11px] uppercase tracking-[0.18em] text-cream transition-colors hover:bg-cream hover:text-charcoal";

const actionOnPhotoQuiet =
  "inline-flex min-h-12 items-center justify-center border border-cream/45 px-7 text-[11px] uppercase tracking-[0.18em] text-cream/90 transition-colors hover:border-cream/90 hover:text-cream";

/* -------------------------------------------------------------------------- */
/* The page                                                                   */
/* -------------------------------------------------------------------------- */

function Landing() {
  const { user } = Route.useLoaderData();
  const start = user ? "/app" : "/signup";

  return (
    <div className="paper-grain min-h-screen bg-cream font-sans text-charcoal">
      {/* The first thing a keyboard reaches: straight past the header to the page. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-charcoal focus:px-5 focus:py-3 focus:text-[11px] focus:uppercase focus:tracking-[0.18em] focus:text-cream"
      >
        Skip to content
      </a>

      <SiteHeader signedIn={Boolean(user)} />

      <main id="main">
        {/* ---------------------------------------------------------------- */}
        {/* 1. Hero                                                           */}
        {/* ---------------------------------------------------------------- */}
        <section
          aria-labelledby="hero-title"
          className="relative isolate flex min-h-[620px] items-center overflow-hidden py-16 md:min-h-[80vh] lg:min-h-[84vh]"
        >
          <picture>
            <source
              media="(max-width: 767px)"
              srcSet="/photos/hall-m-600.webp 600w, /photos/hall-m-900.webp 900w"
              sizes="100vw"
            />
            <img
              src="/photos/hall-1600.webp"
              srcSet="/photos/hall-800.webp 800w, /photos/hall-1200.webp 1200w, /photos/hall-1600.webp 1600w"
              sizes="100vw"
              alt=""
              width={1600}
              height={900}
              fetchPriority="high"
              decoding="async"
              className="absolute inset-0 -z-10 h-full w-full object-cover"
            />
          </picture>
          {/* A flat warm scrim, not a gradient: it holds cream text above 5:1
              against the brightest window in the hall and tints the film warmer. */}
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[#2B2724]/45" />
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[#8F4E2E]/10" />

          <div className="mx-auto w-full max-w-[78rem] px-6 py-20 text-center lg:px-10">
            <div className="mx-auto flex max-w-[46rem] flex-col items-center">
              <p className="text-[11px] uppercase tracking-[0.3em] text-cream/80">
                Conference and event planning
              </p>
              <h1
                id="hero-title"
                className="font-display mt-7 max-w-[22ch] text-balance text-[clamp(1.95rem,4.4vw,3.6rem)] font-normal leading-[1.08] tracking-[-0.015em] text-cream"
              >
                Run the whole conference from one page — not from six spreadsheets and a group
                chat.
              </h1>
              <span aria-hidden="true" className="mt-9 block h-[2px] w-16 bg-terracotta" />
              <p className="mt-9 max-w-[44ch] text-[17px] leading-[1.7] text-cream/90">
                One budget, one contracts board, and one set of numbers your whole committee can
                read.
              </p>
              <div className="mt-10 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
                <Link to={start} className={`${actionOnPhoto} w-full sm:w-auto`}>
                  Create a conference
                </Link>
                <Link to="/example" className={`${actionOnPhotoQuiet} w-full sm:w-auto`}>
                  See the worked example
                </Link>
              </div>
              <p className="mt-7 text-[11px] uppercase tracking-[0.2em] text-cream/70">
                Under a minute · No credit card · No setup call
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 2. Problem — the scattered reality                                */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="scatter-title" className="px-6 py-24 md:py-32 lg:px-10">
          <div className="mx-auto max-w-[78rem]">
            <SectionHead
              id="scatter-title"
              eyebrow="The week before"
              title="Six spreadsheets, and none of them agree."
              lede="It is rarely a planning problem. It is a record problem: the numbers live in four places, and the version people read depends on who sent it last."
            />

            <div className="mt-16 grid items-center gap-12 md:mt-20 md:grid-cols-[1fr_1.02fr] md:gap-16 lg:gap-20">
              <ul className="border-t border-taupe/80">
                {SCATTER.map((item) => (
                  <li key={item.title} className="border-b border-taupe/80 py-7">
                    <h3 className="font-display text-[1.3rem] font-normal leading-snug text-charcoal">
                      {item.title}
                    </h3>
                    <p className="mt-2.5 max-w-[46ch] text-[15.5px] leading-[1.75] text-charcoal-soft">
                      {item.body}
                    </p>
                  </li>
                ))}
              </ul>

              <figure className="relative">
                <img
                  src="/photos/hands-1200.webp"
                  srcSet="/photos/hands-600.webp 600w, /photos/hands-900.webp 900w, /photos/hands-1200.webp 1200w"
                  sizes="(min-width: 768px) 48vw, 100vw"
                  alt="Two people leaning over a printed floor plan on a wooden table, one of them marking a room with a pencil."
                  width={1200}
                  height={1493}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[4/5] w-full object-cover"
                />
                <figcaption className="mt-4 flex items-baseline gap-3 border-t border-taupe/80 pt-3 text-[13px] leading-relaxed text-charcoal-soft">
                  <span aria-hidden="true" className="h-[2px] w-6 shrink-0 bg-sage" />
                  The plan on paper is fine. Losing the paper is the problem.
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 3. Solution — one page, one shared record                         */}
        {/* ---------------------------------------------------------------- */}
        <section
          aria-labelledby="shared-title"
          className="border-y border-taupe/70 bg-cream-deep px-6 py-24 md:py-28 lg:px-10"
        >
          <div className="mx-auto max-w-[78rem]">
            <SectionHead
              id="shared-title"
              eyebrow="One shared record"
              title="One page holds the budget and the contracts."
              lede="Convocate is a planning workspace for a single conference. The budget in planned and committed amounts, a contracts board for everyone you are booking, and one record the people around you can actually read."
              measure="60ch"
            />

            <dl className="mt-14 grid gap-8 border-t border-taupe/90 pt-10 text-left sm:grid-cols-3 sm:gap-10 md:mt-16">
              {SHARED.map((item) => (
                <div key={item.title}>
                  <dt className="font-display text-[1.2rem] font-normal text-charcoal">
                    {item.title}
                  </dt>
                  <dd className="mt-2.5 max-w-[38ch] text-[15px] leading-[1.75] text-charcoal-soft">
                    {item.body}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 4. Budget                                                         */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="budget-title" className="px-6 py-24 md:py-32 lg:px-10">
          <div className="mx-auto max-w-[78rem]">
            <SectionHead
              id="budget-title"
              eyebrow="Budget"
              title="Planned money, committed money, and the gap between them."
              lede="A line is what you expect to spend. A commitment is what you have already agreed to. The budget keeps both, so the total is honest at any point in the year."
            />

            <div className="mt-16 grid items-start gap-12 md:mt-20 md:grid-cols-[0.95fr_1fr] md:gap-16 lg:gap-20">
              <ul className="border-t border-taupe/80">
                {BUDGET_POINTS.map((point) => (
                  <li key={point.title} className="border-b border-taupe/80 py-6">
                    <h3 className="font-display text-[1.2rem] font-normal leading-snug text-charcoal">
                      {point.title}
                    </h3>
                    <p className="mt-2 max-w-[44ch] text-[15px] leading-[1.75] text-charcoal-soft">
                      {point.body}
                    </p>
                  </li>
                ))}
              </ul>

              <BudgetSketch />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 5. Contracts board                                                */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="contracts-title">
          <div className="relative isolate flex min-h-[380px] items-center overflow-hidden md:min-h-[440px]">
            <img
              src="/photos/contract-1600.webp"
              srcSet="/photos/contract-600.webp 600w, /photos/contract-1000.webp 1000w, /photos/contract-1600.webp 1600w"
              sizes="100vw"
              alt=""
              width={1600}
              height={820}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 -z-10 h-full w-full object-cover"
            />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[#2B2724]/50" />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[#8F4E2E]/10" />

            <div className="mx-auto w-full max-w-[78rem] px-6 py-20 text-center lg:px-10">
              <p className="text-[11px] uppercase tracking-[0.3em] text-cream/75">Contracts</p>
              <h2
                id="contracts-title"
                className="font-display mx-auto mt-6 max-w-[24ch] text-balance text-[clamp(1.7rem,3.2vw,2.6rem)] font-normal leading-[1.15] tracking-[-0.01em] text-cream"
              >
                Every contract, at the stage it is actually at.
              </h2>
              <span aria-hidden="true" className="mx-auto mt-8 block h-[2px] w-14 bg-terracotta" />
              <ol className="mt-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[11px] uppercase tracking-[0.22em] text-cream/85">
                {["Invited", "Negotiating", "Contracted", "Booked"].map((stage, index) => (
                  <li key={stage} className="flex items-center gap-3">
                    {index > 0 && (
                      <span aria-hidden="true" className="text-cream/40">
                        —
                      </span>
                    )}
                    <span>{stage}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="px-6 py-20 md:py-24 lg:px-10">
            <div className="mx-auto grid max-w-[78rem] gap-10 border-t border-taupe/80 pt-12 sm:grid-cols-3 sm:gap-10">
              {CONTRACT_POINTS.map((point) => (
                <div key={point.title}>
                  <h3 className="font-display text-[1.2rem] font-normal leading-snug text-charcoal">
                    {point.title}
                  </h3>
                  <p className="mt-2.5 max-w-[38ch] text-[15px] leading-[1.75] text-charcoal-soft">
                    {point.body}
                  </p>
                </div>
              ))}
            </div>
            <p className="mx-auto mt-12 max-w-[58ch] text-center text-[15px] leading-[1.75] text-charcoal-soft">
              The worked example shows a board with all four stages on it, and a conference of 260
              people around it — figures invented, everything else real.
            </p>
            <div className="mt-8 text-center">
              <Link to="/example" className={actionSecondary}>
                See the worked example
              </Link>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 6. How it works                                                   */}
        {/* ---------------------------------------------------------------- */}
        <section
          aria-labelledby="steps-title"
          className="border-y border-taupe/70 bg-cream-deep px-6 py-24 md:py-28 lg:px-10"
        >
          <div className="mx-auto max-w-[78rem]">
            <SectionHead
              id="steps-title"
              eyebrow="How it works"
              title="Four steps, in the order you do them."
              lede="Nothing to import and nothing to integrate. You start with the event you already have in front of you."
            />

            <ol className="mt-16 grid gap-y-10 sm:grid-cols-2 sm:gap-x-10 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="relative border-t border-taupe pt-7">
                  <span
                    aria-hidden="true"
                    className="absolute -top-px left-0 h-[2px] w-8 bg-terracotta"
                  />
                  <span
                    aria-hidden="true"
                    className="font-display block text-[1.9rem] leading-none text-charcoal/70"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-4 font-display text-[1.2rem] font-normal leading-snug text-charcoal">
                    {step.title}
                  </h3>
                  <p className="mt-2.5 text-[15px] leading-[1.7] text-charcoal-soft">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 7. Pricing                                                        */}
        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="price-title" className="px-6 py-24 md:py-32 lg:px-10">
          <div className="mx-auto max-w-[78rem]">
            <SectionHead
              id="price-title"
              eyebrow="Price"
              title="One price for one conference. $199, once."
              lede="No subscription, no per-seat charge, and nothing renews. The free plan is a real plan, not a trial that expires."
            />

            <div className="mt-16 grid items-stretch gap-14 border-t border-taupe/80 pt-14 md:mt-20 md:grid-cols-2 md:gap-0">
              <div className="flex flex-col md:pr-14">
                <p className={label}>Free</p>
                <h3 className="font-display mt-4 text-balance text-[1.55rem] font-normal leading-snug text-charcoal">
                  One conference, one budget line.
                </h3>
                <p className="mt-4 max-w-[44ch] text-[15.5px] leading-[1.75] text-charcoal-soft">
                  Just you, on a single event, with a single line in the budget. It is enough to see
                  the arithmetic work on your own numbers before you decide anything.
                </p>
                <Link to={start} className={`${actionSecondary} mt-8 self-start md:mt-auto`}>
                  {user ? "Open your workspace" : "Create a free account"}
                </Link>
              </div>

              <div className="flex flex-col md:border-l md:border-taupe/80 md:pl-14">
                <p className={label}>Per conference</p>
                <p className="font-display mt-3 text-[clamp(3rem,6vw,4.25rem)] font-normal leading-none tracking-[-0.02em] text-charcoal">
                  $199
                </p>
                <h3 className="font-display mt-5 text-balance text-[1.55rem] font-normal leading-snug text-charcoal">
                  Then everything on that conference is unlocked.
                </h3>
                <ul className="mt-6 grid gap-x-8 gap-y-2.5 text-[15px] leading-[1.6] text-charcoal-soft sm:grid-cols-2">
                  {UNLOCKED.map((item) => (
                    <li key={item} className="flex gap-2.5">
                      <span aria-hidden="true" className="mt-2 h-[1px] w-3 shrink-0 bg-terracotta" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 max-w-[46ch] text-[15px] leading-[1.75] text-charcoal-soft">
                  Registration fees and donations are paid into your own Stripe account. Convocate
                  takes nothing from them.
                </p>
                <Link to={start} className={`${actionPrimary} mt-8 self-start md:mt-auto`}>
                  Create a conference
                </Link>
              </div>
            </div>

            <p className="mx-auto mt-16 max-w-[62ch] border-t border-taupe/80 pt-8 text-center text-[15px] leading-[1.8] text-charcoal-soft">
              If it is not right for you, say so within 48 hours of paying and the whole amount comes
              back — no questions, and the conference stays, back on the free plan with its data in
              place.
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 8. Final call                                                     */}
        {/* ---------------------------------------------------------------- */}
        <section
          aria-labelledby="close-title"
          className="bg-charcoal px-6 py-24 md:py-32 lg:px-10"
        >
          <div className="mx-auto max-w-[78rem] text-center">
            <p className="text-[11px] uppercase tracking-[0.28em] text-cream/65">
              Ready when you are
            </p>
            <h2
              id="close-title"
              className="font-display mx-auto mt-6 max-w-[24ch] text-balance text-[clamp(1.8rem,3.6vw,2.9rem)] font-normal leading-[1.14] tracking-[-0.01em] text-cream"
            >
              Start with the conference you already have in front of you.
            </h2>
            <span aria-hidden="true" className="mx-auto mt-8 block h-[2px] w-14 bg-terracotta" />
            <p className="mx-auto mt-8 max-w-[50ch] text-[17px] leading-[1.75] text-cream/85">
              Create it in under a minute. No credit card, no setup call, and no one will ask you to
              sit through a demo first.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to={start}
                className="inline-flex min-h-12 w-full items-center justify-center border border-cream px-7 text-[11px] uppercase tracking-[0.18em] text-cream transition-colors hover:bg-cream hover:text-charcoal sm:w-auto"
              >
                Create a conference
              </Link>
              <Link to="/example" className={`${actionOnPhotoQuiet} w-full sm:w-auto`}>
                See the worked example
              </Link>
            </div>
            <p className="mt-8 text-[13px] leading-relaxed text-cream/60">
              Already have an account?{" "}
              <Link
                to="/signin"
                className="underline decoration-cream/40 underline-offset-4 transition-colors hover:text-cream hover:decoration-cream"
              >
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

/* -------------------------------------------------------------------------- */
/* The budget sketch                                                          */
/* -------------------------------------------------------------------------- */

/**
 * An illustration of the budget view, drawn from the real categories the
 * product uses. There are no amounts anywhere in it, on purpose: the page is
 * not allowed to invent a figure, and a schematic does not need one. The
 * lengths only carry proportion — planned is the rule across the row, committed
 * is what is filled in, and one category has committed more than it planned, so
 * its fill runs past the rule and the row says so in words as well as in shape.
 *
 * It is one `<figure>` with a caption: the bars themselves are hidden from
 * assistive technology and the caption describes what the picture shows, so a
 * screen reader gets the meaning instead of six unlabelled rectangles.
 */
const SKETCH = [
  { name: "Venue", planned: 88, committed: 88 },
  { name: "Speaker fees", planned: 74, committed: 52 },
  { name: "Hospitality", planned: 64, committed: 78, over: true },
  { name: "Music", planned: 70, committed: 34 },
  { name: "Equipment", planned: 58, committed: 22 },
  { name: "Travel", planned: 46, committed: 16 },
];

function BudgetSketch() {
  return (
    <figure className="border border-taupe/90 bg-cream-deep/60 px-6 py-7 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-taupe/80 pb-4">
        <p className="text-[11px] uppercase tracking-[0.22em] text-charcoal">By category</p>
        <p className="flex flex-wrap items-center gap-4 text-[11px] uppercase tracking-[0.16em] text-charcoal-soft">
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="h-[1px] w-5 bg-charcoal/40" />
            Planned
          </span>
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2 w-5 bg-terracotta" />
            Committed
          </span>
        </p>
      </div>

      <div aria-hidden="true" className="mt-5 space-y-4">
        {SKETCH.map((row) => (
          <div
            key={row.name}
            className="grid grid-cols-[5rem_1fr_4.75rem] items-center gap-3 sm:grid-cols-[6.5rem_1fr_5rem] sm:gap-4"
          >
            <span className="text-[13px] leading-tight text-charcoal">{row.name}</span>
            <div className="relative flex h-4 items-center">
              <span
                className="absolute left-0 h-px bg-charcoal/35"
                style={{ width: `${row.planned}%` }}
              />
              <span
                className={`absolute left-0 top-1/2 -translate-y-1/2 bg-terracotta ${row.over ? "h-[9px]" : "h-[6px]"}`}
                style={{ width: `${row.committed}%` }}
              />
            </div>
            <span className="text-right text-[9.5px] uppercase leading-tight tracking-[0.14em] text-terracotta-ink">
              {row.over ? "Over budget" : ""}
            </span>
          </div>
        ))}
      </div>

      <figcaption className="mt-6 border-t border-taupe/80 pt-4 text-[12.5px] leading-relaxed text-charcoal-soft">
        An illustration of the budget view: planned and committed amounts by category, with one
        category committed past its plan and flagged.
      </figcaption>
    </figure>
  );
}
