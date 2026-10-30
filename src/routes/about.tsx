import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SitePageActions } from "~/components/site-chrome";
import { BODY, PageHead, PublicPage } from "~/components/public-page";

/**
 * /about — what the product does, in plain language.
 *
 * Public and static: no loader, no session, no database. The copy is the
 * approved text from the lead; do not add claims, numbers or names to it.
 *
 * The layout is the landing page's document rhythm: a centred opening on cream,
 * then a single column at the site's measure with hairline rules between
 * sections, one deep-cream band to separate the product from the practical
 * questions, and the closing actions in thin outlined rules.
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
    ],
  }),
  component: About,
});

const sectionClass = "mt-12 border-t border-taupe/80 pt-10";
const headingClass =
  "font-display text-[1.45rem] font-normal leading-snug tracking-[-0.005em] text-charcoal";
const bodyClass = `mt-4 ${BODY}`;
const strongClass = "font-medium text-charcoal";
const itemClass = "border-b border-taupe/70 py-4";

/** The one document column both bands use: 64 characters, centred in the frame. */
function Column({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[64ch] px-6">{children}</div>;
}

function About() {
  return (
    <PublicPage>
      <PageHead
        eyebrow="About"
        title="What Convocate does"
        lede={
          <>
            Convocate is a planning workspace for conferences and events. It keeps the budget, the
            people you are negotiating with, and the paperwork that comes out of those negotiations
            in one place, instead of spreadsheets, email threads and a payment link taped onto a
            flyer.
          </>
        }
      />

      <div className="pb-20 md:pb-24">
        <Column>
          <article>
            <section className="border-t border-taupe/80 pt-10">
              <h2 className={headingClass}>The budget</h2>
              <p className={bodyClass}>
                Build the conference budget by category, with planned amounts and committed amounts
                side by side, category rollups and a clear flag when a category has gone over its
                target. Every line says what it is for, who it is with, and what has been committed
                against what was planned.
              </p>
            </section>

            <section className={sectionClass}>
              <h2 className={headingClass}>The contracts board</h2>
              <p className={bodyClass}>
                One board for everyone the conference has to contract with: guest speakers,
                musicians, singers, bands, backline and equipment suppliers, and the venue itself.
                Each row carries a pipeline stage (where the negotiation has got to) and a contract
                state — not sent, sent, or signed — so a committee can see at a glance what is
                agreed and what is still moving.
              </p>
            </section>

            <section className={sectionClass}>
              <h2 className={headingClass}>The paperwork that comes out of it</h2>
              <ul className="mt-6 border-t border-taupe/70">
                <li className={itemClass}>
                  <strong className={strongClass}>Print a contract</strong>, or print the whole
                  board, as a clean sheet you can hand to a committee.
                </li>
                <li className={itemClass}>
                  <strong className={strongClass}>
                    Attach the signed contract or a scanned copy
                  </strong>{" "}
                  to the row it belongs to — PDF, PNG or JPG, up to 10 MB per file and 100 MB per
                  conference. Attachments open only for someone entitled to see that conference;
                  there is no public link to them.
                </li>
                <li className={itemClass}>
                  <strong className={strongClass}>Generate an invitation letter</strong> for a
                  speaker from a neutral template, with the conference, dates, speaker, role and
                  amounts filled in from what you have already entered. Edit it before you print it.
                </li>
                <li className={itemClass}>
                  <strong className={strongClass}>Generate a draft agreement</strong> for a guest,
                  supplier or venue from the terms already on the board: the parties, the scope, the
                  schedule, the fee itemized exactly as the card shows it, the deposit and the
                  balance, expenses, cancellation and force majeure, plus sections that differ by
                  kind for a speaker, musician, band, backline supplier or venue. Optional clauses
                  can be switched on for recording and streaming rights, safeguarding compliance,
                  liability and insurance, substitution, merchandise, confidentiality and data
                  protection. There is a free-text box for your organization&rsquo;s own clauses, a
                  blank governing-law line, and a signature block.
                  <p className="mt-3">
                    Anything you have not entered prints as a blank to complete by hand — never a
                    guess. Every copy is labeled a draft. It is a starting point for your own
                    review, not legal advice, and nothing is emailed or signed on your behalf.
                  </p>
                </li>
              </ul>
            </section>
          </article>
        </Column>
      </div>

      <div className="border-y border-taupe/70 bg-cream-deep py-20 md:py-24">
        <Column>
          <article>
            <section>
              <h2 className={headingClass}>Your committee</h2>
              <p className={bodyClass}>
                Invite a committee member with a link, as an Editor who can work on the conference
                or a Viewer who can read it. Roles are enforced on the server, so a Viewer cannot
                change anything even if they try, and revoking a link stops it working. Viewers do
                not see the money — that is withheld by the server, not hidden in the page.
              </p>
            </section>

            <section className={sectionClass}>
              <h2 className={headingClass}>Where your data lives</h2>
              <p className={bodyClass}>
                Your event lives in one database Convocate operates. Access is checked on the server
                on every request, so another organizer — or a Viewer you invited — cannot open what
                is not theirs, and Viewers never see money figures. We keep daily backups for 30
                days so a mistake can be undone. One administrator account, run by Convocate, can
                see the list of accounts, how many events exist and how many visits the site got; it
                does not open another organizer&rsquo;s documents. We never see your card number —
                Stripe handles the card.
              </p>
            </section>

            <section className={sectionClass}>
              <h2 className={headingClass}>See it before you enter anything</h2>
              <p className={bodyClass}>
                There is a read-only example conference, &ldquo;Bridgeway Conference 2027&rdquo; — a
                worked 260-person conference with invented figures. Every page of the product can be
                looked at there, and nothing in it can be changed.
              </p>
            </section>

            <section className={sectionClass}>
              <h2 className={headingClass}>What it costs</h2>
              <p className={bodyClass}>
                One conference is $199, paid once, and every option opens on that conference. There
                is no subscription, no per-seat charge and nothing renews. The free plan lets you
                run one conference on your own with one budget line, so you can check the arithmetic
                against a number of your own before you decide. The full comparison is on the
                Pricing page.
              </p>
            </section>
          </article>
        </Column>
      </div>

      <div className="mx-auto max-w-[78rem] px-6 pb-24 lg:px-10">
        <SitePageActions
          primary={{ label: "See pricing", to: "/pricing" }}
          secondary={{ label: "Create an account", to: "/signup" }}
        />
      </div>
    </PublicPage>
  );
}
