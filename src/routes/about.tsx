import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ACTION,
  BODY,
  Band,
  LEDE,
  LINK,
  PageOpening,
} from "~/components/editorial-page";
import { PublicPage } from "~/components/public-page";

/**
 * /about — what the product does, in plain language.
 *
 * Public and static: no loader, no session, no database. The copy is the
 * approved text from the lead; do not add claims, numbers or names to it.
 *
 * Composition, in the landing page's language (src/routes/index.tsx): one h1 on
 * the cream, then bands separated by a step in tone — deep cream, cream, deep
 * cream, charcoal, cream — with sentence-case headings, no eyebrow labels, no
 * tracked caps, no hairline rule between sections and no 1px outlined button.
 * The only filled surface is the closing action to the pricing page. The type
 * scale is the same four sizes as the landing page (62 / 40 / 20 / 17).
 */

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "What Convocate does — Convocate" },
      {
        name: "description",
        content:
          "Convocate is a planning workspace for conferences and events: the budget, the contracts board for speakers, musicians, suppliers and the venue, and the paperwork that comes out of it.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Convocate" },
      { property: "og:title", content: "What Convocate does — Convocate" },
      {
        property: "og:description",
        content:
          "The budget, the contracts board for speakers, musicians, suppliers and the venue, and the paperwork that comes out of it.",
      },
      { property: "og:url", content: "https://www.getconvocate.com/about" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "What Convocate does — Convocate" },
      {
        name: "twitter:description",
        content:
          "A planning workspace for conferences and events: the budget, the contracts board, and the paperwork that comes out of it.",
      },
    ],
    links: [{ rel: "canonical", href: "https://www.getconvocate.com/about" }],
  }),
  component: About,
});

/** The four pieces of paper the product hands back to an organizer. */
const PAPERWORK = [
  {
    title: "Print a contract",
    body: "or print the whole board, as a clean sheet you can hand to a committee.",
  },
  {
    title: "Attach the signed contract or a scanned copy",
    body: "to the row it belongs to: PDF, PNG or JPG, up to 10 MB per file and 100 MB per conference. Attachments open only for someone entitled to see that conference; there is no public link to them.",
  },
  {
    title: "Generate an invitation letter",
    body: "for a speaker from a neutral template, with the conference, dates, speaker, role and amounts filled in from what you have already entered. Edit it before you print it.",
  },
  {
    title: "Generate a draft agreement",
    body: "for a guest, supplier or venue from the terms already on the board: the parties, the scope, the schedule, the fee itemized exactly as the card shows it, the deposit and the balance, expenses, cancellation and force majeure, plus sections that differ by kind for a speaker, musician, band, backline supplier or venue. Optional clauses can be switched on for recording and streaming rights, safeguarding compliance, liability and insurance, substitution, merchandise, confidentiality and data protection. There is a free-text box for your organization’s own clauses, a blank governing-law line, and a signature block. Anything you have not entered prints as a blank to complete by hand, never a guess. Every copy is labeled a draft: a starting point for your own review, not legal advice, and nothing is emailed or signed on your behalf.",
  },
];

function About() {
  return (
    <PublicPage>
      <PageOpening
        title="What Convocate does."
        lede={
          <>
            Convocate is a planning workspace for conferences and events. It keeps the budget, the
            people you are negotiating with, and the paperwork that comes out of those negotiations
            in one place, instead of spreadsheets, email threads and a payment link taped onto a
            flyer.
          </>
        }
      />

      {/* ---------------------------------------------------------------- */}
      {/* 1. The money                                                      */}
      {/* ---------------------------------------------------------------- */}
      <Band
        id="budget"
        tone="deep"
        title="The budget."
        lede="Build the conference budget by category, with planned amounts and committed amounts side by side, category rollups and a clear flag when a category has gone over its target. Every line says what it is for, who it is with, and what has been committed against what was planned."
        measure="52ch"
      />

      {/* ---------------------------------------------------------------- */}
      {/* 2. The people                                                     */}
      {/* ---------------------------------------------------------------- */}
      <Band
        id="contracts-board"
        title="The contracts board."
        lede="One board for everyone the conference has to contract with: guest speakers, musicians, singers, bands, backline and equipment suppliers, and the venue itself. Each row carries a pipeline stage, where the negotiation has got to, and a contract state (not sent, sent, or signed), so a committee can see at a glance what is agreed and what is still moving."
        measure="52ch"
      >
        <p className={`mt-8 ${BODY} text-charcoal-soft`}>
          <Link to="/example" className={LINK}>
            Look around the contracts board in the example conference
          </Link>
          , read-only and with invented figures.
        </p>
      </Band>

      {/* ---------------------------------------------------------------- */}
      {/* 3. The paper                                                     */}
      {/* ---------------------------------------------------------------- */}
      <Band id="paperwork" tone="deep" title="The paperwork that comes out of it.">
        <dl className="mt-12 grid gap-12 md:grid-cols-2 md:gap-x-14 md:gap-y-14">
          {PAPERWORK.map((item) => (
            <div key={item.title}>
              <dt className="font-display font-medium text-charcoal text-[20px] leading-snug">
                {item.title}
              </dt>
              <dd className={`mt-2.5 ${BODY} text-charcoal-soft`}>{item.body}</dd>
            </div>
          ))}
        </dl>
      </Band>

      {/* ---------------------------------------------------------------- */}
      {/* 4. The committee                                                 */}
      {/* ---------------------------------------------------------------- */}
      <Band id="committee" title="Your committee." lede="Invite a committee member with a link, as an Editor who can work on the conference or a Viewer who can read it. Roles are enforced on the server, so a Viewer cannot change anything even if they try, and revoking a link stops it working. Viewers do not see the money: that is withheld by the server, not hidden in the page." measure="54ch" />

      {/* ---------------------------------------------------------------- */}
      {/* 5. The example                                                    */}
      {/* ---------------------------------------------------------------- */}
      <Band
        id="example"
        tone="deep"
        title="See it before you enter anything."
        lede="There is a read-only example conference, “Bridgeway Conference 2027”: a worked 260-person conference with invented figures. Every page of the product can be looked at there, and nothing in it can be changed."
        measure="54ch"
      >
        <p className={`mt-8 ${BODY} text-charcoal`}>
          <Link to="/example" className={LINK}>
            Look around the example conference
          </Link>
          .
        </p>
      </Band>

      {/* ---------------------------------------------------------------- */}
      {/* 6. Where the data lives                                           */}
      {/* ---------------------------------------------------------------- */}
      <Band
        id="your-data"
        tone="charcoal"
        title="Where your data lives."
        lede="Your event lives in one database Convocate operates. Access is checked on the server on every request, so another organizer, or a Viewer you invited, cannot open what is not theirs, and Viewers never see money figures."
        measure="54ch"
      >
        <p className={`mt-6 max-w-[54ch] ${LEDE} text-cream/85`}>
          We keep daily backups for 30 days so a mistake can be undone. One administrator account,
          run by Convocate, can see the list of accounts, how many events exist and how many visits
          the site got; it does not open another organizer’s documents. We never see your card
          number: Stripe handles the card.
        </p>
      </Band>

      {/* ---------------------------------------------------------------- */}
      {/* 7. What it costs, and the page's one filled action                */}
      {/* ---------------------------------------------------------------- */}
      <Band
        id="cost"
        title="What it costs."
        lede="One conference is $199, paid once, and every option opens on that conference. There is no subscription, no per-seat charge and nothing renews."
        measure="50ch"
      >
        <p className={`mt-5 max-w-[56ch] ${LEDE} text-charcoal-soft`}>
          The free plan lets you run one conference on your own with one budget line, so you can
          check the arithmetic against a number of your own before you decide. The full comparison
          is on the pricing page.
        </p>
        <p className="mt-10">
          <Link to="/pricing" className={ACTION}>
            See the pricing
          </Link>
        </p>
        <p className={`mt-8 ${BODY} text-charcoal-soft`}>
          Or{" "}
          <Link to="/signup" search={{ redirect: undefined }} className={LINK}>
            create a free account
          </Link>{" "}
          and start on the free plan.{" "}
          <Link to="/budget-calculator" className={LINK}>
            Get your budget number first
          </Link>
          , with no account at all.
        </p>
      </Band>
    </PublicPage>
  );
}
