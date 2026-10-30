import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHead, PublicPage } from "~/components/public-page";

/**
 * /terms — the agreement between an organizer and the person who operates
 * Convocate.
 *
 * Public and static, exactly like /privacy: no loader, no session, no database.
 * The text is the owner-approved Terms of Service draft, reproduced in full —
 * every section and every sentence. Do not paraphrase, trim or "improve" a
 * sentence here; it is a legal document and the wording is the point.
 *
 * The Contact section deliberately carries the email address and no postal
 * address: there is no street address to publish, and a placeholder must never
 * ship on a page a visitor reads.
 *
 * `LAST_UPDATED` is the day this copy shipped. Change it whenever the text
 * changes — section 10 tells the reader that date is how they know which
 * version they are reading.
 */
const LAST_UPDATED = "October 24, 2026";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Convocate" },
      {
        name: "description",
        content:
          "The terms that apply when you use Convocate: what the service is and is not, the $199 unlock and refunds, what stays yours, electronic signatures, third-party services, liability and governing law.",
      },
    ],
  }),
  component: Terms,
});

/*
 * The document's typography, in one place: body copy at the site measure, a
 * Fraunces section heading with a hairline rule above it, sub-headings as small
 * caps labels, and links in terracotta ink. The wording below is untouched —
 * this page is a legal document and only its presentation changed.
 */
const bodyClass = "mt-3 text-[16.5px] leading-[1.78] text-charcoal-soft";
const headingClass =
  "mt-12 border-t border-taupe/70 pt-8 font-display text-[1.4rem] font-normal leading-snug tracking-[-0.005em] text-charcoal";
const subHeadingClass = "mt-8 text-[12px] uppercase tracking-[0.18em] text-charcoal";
const listClass =
  "mt-3 list-disc space-y-2.5 pl-5 text-[16.5px] leading-[1.78] text-charcoal-soft marker:text-terracotta/70";
const leadClass = "font-medium text-charcoal";
const mailClass =
  "text-terracotta-ink underline decoration-terracotta/40 underline-offset-4 transition-colors hover:decoration-terracotta-ink";
const introClass = "text-[17.5px] leading-[1.75] text-charcoal-soft";

/** The address that actually reaches us, as a link, in the site's own style. */
function Mail() {
  return (
    <a href="mailto:hello@mail.getconvocate.com" className={mailClass}>
      hello@mail.getconvocate.com
    </a>
  );
}

/** An in-site link to the privacy policy, styled like the email links. */
function PrivacyLink() {
  return (
    <Link to="/privacy" className={mailClass}>
      Privacy Policy
    </Link>
  );
}

function Terms() {
  return (
    <PublicPage>
      <PageHead
        eyebrow="Terms"
        title="Terms of Service"
        meta={`Last updated: ${LAST_UPDATED}`}
      />

      <div className="mx-auto max-w-[64ch] px-6 pb-24">
        <article>
          <p className={introClass}>
            Convocate is a planning workspace for conferences and events. It is operated by Arlando
            L. Williams II, an individual &mdash; not a company, and not a registered business
            entity. In these terms, &ldquo;Convocate&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo; and
            &ldquo;our&rdquo; mean that person, and &ldquo;you&rdquo; means the person who holds the
            account.
          </p>

          <p className={bodyClass}>
            This page is written to be read once, in plain language. It says what we actually do, and
            where a limit exists it says so rather than hiding it. If something here is unclear,
            email <Mail /> and ask before you rely on it.
          </p>

          <section>
            <h2 className={headingClass}>1. Acceptance of these terms</h2>
            <ul className={listClass}>
              <li>
                By creating an account, or by using Convocate, you agree to these terms. If you do
                not agree, do not use the service.
              </li>
              <li>
                If you are using Convocate for an organization &mdash; a church, a school, an
                association, a company &mdash; you are confirming that you are allowed to agree to
                these terms on its behalf.
              </li>
              <li>
                These terms go together with the <PrivacyLink />, which describes what we collect,
                who can see it, how long we keep it and how to have it deleted. Where the two pages
                touch the same subject, the privacy policy is the detailed one.
              </li>
              <li>
                These terms are the whole agreement between us about the service itself. They do not
                replace any agreement you make with your own speakers, suppliers, venue or attendees
                &mdash; those are yours, and we are not a party to them.
              </li>
            </ul>
          </section>

          <section>
            <h2 className={headingClass}>2. What the service is</h2>
            <p className={bodyClass}>
              Convocate is software for planning one event at a time &mdash; the app calls each one
              a conference. For each event it holds:
            </p>
            <ul className={listClass}>
              <li>
                the budget: budget lines by category, planned against committed, rollups against a
                target, and a flag when you go over it;
              </li>
              <li>
                the contracts board: speakers, musicians, singers, bands, backline and equipment
                suppliers, and the venue, each with a pipeline stage and whether its contract is
                signed;
              </li>
              <li>
                invitation letters and draft agreements generated from what you have entered,
                printable, with your own clauses and free text;
              </li>
              <li>the pre- and post-conference checklist;</li>
              <li>
                attached documents against a contract &mdash; PDF, PNG or JPG, up to 10 MB per file
                and 100 MB per event;
              </li>
              <li>a public registration page, ticket types and the attendee list;</li>
              <li>a set of planning guides, some free to read and some included with the full plan.</li>
            </ul>
            <p className={bodyClass}>
              Some things to be clear about, because they are easy to assume and wrong:
            </p>
            <ul className={listClass}>
              <li>
                <strong className={leadClass}>
                  It is a workspace and a document generator, not professional advice.
                </strong>{" "}
                We are not your lawyer, your accountant, your tax adviser, your insurer or your event
                manager. Nothing in the product or on this site is legal, financial or tax advice.
              </li>
              <li>
                <strong className={leadClass}>
                  The documents are drafts built from what you typed.
                </strong>{" "}
                Blank fields print as blank lines on purpose, because we will not invent a term you
                did not agree. Read an agreement before anyone signs it.
              </li>
              <li>
                <strong className={leadClass}>
                  We do not send anything to your speakers, suppliers, venues or attendees.
                </strong>{" "}
                Nothing is delivered on your behalf. You print it or save it and send it yourself.
              </li>
              <li>
                <strong className={leadClass}>
                  Nothing is signed until both parties sign it.
                </strong>{" "}
                A document you generate is not a contract just because it exists.
              </li>
              <li>
                <strong className={leadClass}>We do not promise an outcome.</strong> Convocate does
                not promise your event comes in under budget, that a speaker accepts, that a venue
                is available, or that a document is complete for your situation.
              </li>
            </ul>
          </section>

          <section>
            <h2 className={headingClass}>3. Accounts and eligibility</h2>
            <ul className={listClass}>
              <li>
                You need an account to use Convocate. Give accurate details, keep them current, and
                keep your password to yourself. You are responsible for what happens under your
                account.
              </li>
              <li>
                You must be able to enter a binding contract in your own name to hold an account. In
                most places that means you are 18 or older. We do not verify your age or your
                identity.
              </li>
              <li>
                You can invite other people to an event as an Editor or a Viewer, and you can revoke
                an invitation at any time. You are responsible for what the people you invite do with
                the event, so invite people you trust.
              </li>
              <li>
                You can delete an event yourself, and its data goes with it. To close an account,
                email <Mail /> and we will remove the account and its events.
              </li>
              <li>
                We may suspend or close an account that breaks these terms, that we are required by
                law to stop serving, or that puts the service or another person at risk. If we do, we
                will tell you why by email. You can still ask us for a copy of your data, as the
                privacy policy describes.
              </li>
              <li>Do not create an account if you have already had one closed for breaking these terms.</li>
            </ul>
          </section>

          <section>
            <h2 className={headingClass}>4. Payments, fees, and refunds</h2>

            <h3 className={subHeadingClass}>The free plan</h3>
            <p className={bodyClass}>
              The free plan needs no card and costs nothing. It holds one event, you as the only
              person on it, and one budget line against your target &mdash; enough to see the
              arithmetic work on a number of your own. It also includes the read-only example
              conference, so you can look around before you start.
            </p>
            <p className={bodyClass}>
              Not on the free plan: more than one budget line, contracts, committee invitations,
              printing a contract or the whole board, attached documents, invitation letters,
              generated agreements, and registration.
            </p>

            <h3 className={subHeadingClass}>The $199 unlock</h3>
            <ul className={listClass}>
              <li>
                <strong className={leadClass}>$199 per event, paid once.</strong> It unlocks the full
                plan on that one event. It is not a subscription, there is no per-seat charge,
                nothing renews, and there is nothing to cancel.
              </li>
              <li>
                What it opens on that event: unlimited budget lines, unlimited contracts, printing a
                contract and the whole board, attached documents, invitation letters, draft
                agreements, committee invitations, registration with its public page and attendee
                list, and the six planning guides included with the full plan.
              </li>
              <li>
                <strong className={leadClass}>The price is $199 today.</strong> If it changes, the
                new price applies to events unlocked after the change. An event you have already paid
                for stays unlocked at the price you paid.
              </li>
              <li>
                If we are ever required to add tax to the price, we will say so on the pricing page
                before you pay.
              </li>
              <li>The payment is taken by Stripe on a card. We never see or store your card number.</li>
            </ul>

            <h3 className={subHeadingClass}>Refunds</h3>
            <ul className={listClass}>
              <li>
                <strong className={leadClass}>
                  Full refund, no questions asked, if you ask within 48 hours of the card being
                  charged.
                </strong>{" "}
                The 48 hours is counted from the charge, not from when you first use the event.
              </li>
              <li>A refund returns that event to the free plan, and its data is kept.</li>
              <li>
                After 48 hours, refund requests are handled case by case. We look at them; we do not
                promise one.
              </li>
              <li>
                To ask, email <Mail />. We refund to the same card, through Stripe.
              </li>
              <li>
                <strong className={leadClass}>Attendee money is not ours to refund.</strong>{" "}
                Registration fees and donations are paid into your own Stripe account, not ours, so
                refunding an attendee is between you and your attendee. See section 7.
              </li>
            </ul>
          </section>

          <section>
            <h2 className={headingClass}>5. Your events and content, and acceptable use</h2>

            <h3 className={subHeadingClass}>What stays yours</h3>
            <p className={bodyClass}>
              Your event data, the documents you generate or upload, your logo and your attendee
              records are yours. We do not sell them, rent them or claim ownership of them. We store,
              display, print and back them up only in order to run the service for you, and that
              permission ends when you delete the event or close the account.
            </p>
            <p className={bodyClass}>
              You are responsible for having the right to put the content in. In particular: the
              attendee details you store must have been collected with your attendees&rsquo;
              knowledge, the contracts and scans must be yours to store, and any logo or image you
              upload must be yours to use.
            </p>

            <h3 className={subHeadingClass}>Attendee data</h3>
            <p className={bodyClass}>
              You decide what to collect from an attendee, and you are the one with a relationship
              with them. Point them at the <PrivacyLink /> if they ask what Convocate does with their
              details. Do not put card numbers, bank details, passwords or government identification
              numbers in attendee notes or in a contract &mdash; nothing in Convocate is built to
              hold them safely.
            </p>

            <h3 className={subHeadingClass}>Acceptable use</h3>
            <p className={bodyClass}>Do not use Convocate to do any of these:</p>
            <ul className={listClass}>
              <li>break the law, or help someone else break it;</li>
              <li>infringe someone else&rsquo;s copyright, trademark or privacy;</li>
              <li>
                impersonate another person, or claim a relationship with an organization you do not
                have;
              </li>
              <li>
                send unsolicited bulk email or messages, or use attendee records for a purpose your
                attendees did not agree to;
              </li>
              <li>
                scrape, copy, resell or sublicense the service, or give access to someone who has not
                agreed to these terms;
              </li>
              <li>
                probe, overload, attack or try to get around the service&rsquo;s limits, the paywall
                or another account&rsquo;s permissions;
              </li>
              <li>store card numbers or other data you do not need.</li>
            </ul>
            <p className={bodyClass}>
              We may remove content, or suspend an account, where one of these is happening. We do
              not look inside your event except to run the service, to help you when you ask, or
              where the law requires it.
            </p>
          </section>

          <section>
            <h2 className={headingClass}>6. Electronic signatures</h2>
            <p className={bodyClass}>
              Agreements can be accepted electronically through a private signing link. Here is
              exactly what that means, because it matters more than the feature does.
            </p>
            <p className={bodyClass}>
              <strong className={leadClass}>What is recorded when someone signs.</strong> The name
              they type, a tick in the acceptance box, the date and time in UTC, the IP address the
              acceptance came from, the version of the agreement text they accepted, and &mdash; if
              they draw one &mdash; a picture of their drawn signature. If they give an email
              address, that is recorded too.
            </p>
            <p className={bodyClass}>
              <strong className={leadClass}>What it is.</strong> A record of an electronic
              acceptance. Nothing more.
            </p>
            <p className={bodyClass}>
              <strong className={leadClass}>What it is not.</strong>
            </p>
            <ul className={listClass}>
              <li>It is not a notarized signature, and it is not witnessed.</li>
              <li>
                It is not a qualified or otherwise regulated electronic signature &mdash; not one
                issued under eIDAS or any similar certification scheme. There is no certificate
                authority, no identity document check and no certified audit trail behind it.
              </li>
              <li>
                <strong className={leadClass}>We have not verified who typed the name.</strong>{" "}
                Anyone holding the signing link can type a name into it. Treat a signing link like a
                password and send it only to the person it is meant for; there is one live link per
                contract.
              </li>
              <li>
                The organizer&rsquo;s own signature line still prints blank. You sign your own side
                by hand, or however you normally sign.
              </li>
            </ul>
            <p className={bodyClass}>
              <strong className={leadClass}>What that means for you.</strong> Whether an electronic
              acceptance is enough for a particular agreement is a legal question, and the answer
              depends on the agreement and on where you and the other party are. That is a question
              for you and your own adviser, not for us. If you need a signature that is witnessed,
              notarized or otherwise formally certified, print the document and do it on paper.
            </p>
          </section>

          <section>
            <h2 className={headingClass}>7. Third-party services</h2>
            <p className={bodyClass}>
              <strong className={leadClass}>Stripe handles the money.</strong> The $199 unlock is
              charged through Stripe, and Stripe&rsquo;s terms apply to that payment in addition to
              these. We never see or store your card number.
            </p>
            <p className={bodyClass}>
              <strong className={leadClass}>
                Attendee payments go to you, not to us.
              </strong>{" "}
              When registration fees or donations are collected through Convocate, they are paid into
              your own Stripe account, which you open and verify yourself. Convocate takes $0 of that
              money and is not the merchant of record for it. You are the seller to your attendee:
              refunds to attendees, chargebacks, disputes and any tax on that money are yours to
              handle, through your own Stripe account and under Stripe&rsquo;s connected-account
              terms. Convocate cannot refund money it never received.
            </p>
            <p className={bodyClass}>
              <strong className={leadClass}>Other third parties.</strong> The privacy policy names
              the others &mdash; the host that serves this website, the database that holds your
              data, Facebook and Messenger if you message our Page, and the AI service that drafts
              Messenger replies. What they do with data is described there.
            </p>
            <p className={bodyClass}>
              <strong className={leadClass}>
                Their availability is theirs, not ours.
              </strong>{" "}
              If Stripe is down we cannot take a payment, and we cannot speed them up.
            </p>
          </section>

          <section>
            <h2 className={headingClass}>8. Disclaimers and limitation of liability</h2>
            <p className={bodyClass}>
              <strong className={leadClass}>What we try to do.</strong> We work to keep Convocate
              running and correct, and we fix what we find.
            </p>
            <p className={bodyClass}>
              <strong className={leadClass}>What we do not promise.</strong> We do not promise that
              the service will be uninterrupted or free of errors, that every document it generates
              is complete for your situation, or that the arithmetic on screen is a substitute for
              checking your own numbers. Your data is backed up as the privacy policy describes
              &mdash; daily, with the most recent 30 days kept &mdash; but a backup is not a
              guarantee that a particular deletion can be undone.
            </p>
            <p className={bodyClass}>
              <strong className={leadClass}>What we are not responsible for.</strong> Your event is
              yours. We are not liable for lost profit, lost bookings, lost donations or ticket sales,
              a speaker or supplier who cancels, a venue that double-books, attendee no-shows, a
              document a third party refuses to accept, or any indirect or consequential loss arising
              from your use of Convocate. We are also not liable for what you or anyone you invite
              does with the product, or for an agreement you enter into with a third party.
            </p>
            <p className={bodyClass}>
              <strong className={leadClass}>The cap.</strong> To the extent the law allows, our total
              liability for all claims relating to the service is limited to the amount you have paid
              us for the event the claim is about.
            </p>
            <p className={bodyClass}>
              <strong className={leadClass}>What this section does not do.</strong> It does not take
              away the 48-hour refund in section 4, and it does not limit any liability that cannot
              be limited by law where you live.
            </p>
            <p className={bodyClass}>
              <strong className={leadClass}>Your side.</strong> If someone makes a claim against us
              because of content you put into Convocate, or because of how you ran your event, you
              agree to cover the reasonable cost of answering it.
            </p>
          </section>

          <section>
            <h2 className={headingClass}>9. Governing law</h2>
            <p className={bodyClass}>
              These terms are governed by the law of the State of North Carolina, in the United
              States, without regard to its conflict-of-law rules.
            </p>
            <p className={bodyClass}>
              You and we agree that the state and federal courts located in North Carolina are the
              place to bring a claim about these terms or the service, and that either of us may
              bring a small claim in a small claims court that has jurisdiction.
            </p>
            <p className={bodyClass}>
              Nothing in this section stops you from raising a matter with a consumer protection
              agency where you live, or from relying on a right that the law where you live gives you
              and that cannot be waived.
            </p>
          </section>

          <section>
            <h2 className={headingClass}>10. Changes to these terms</h2>
            <p className={bodyClass}>
              We may change these terms. When we do, the text on this page changes and the date at
              the top of it changes with it.{" "}
              <strong className={leadClass}>
                The date at the top is how you can tell whether you are reading the current version
              </strong>{" "}
              &mdash; check it before you rely on a section. We cannot email every account holder
              today, so do not wait for a message about it.
            </p>
            <p className={bodyClass}>
              A change applies from the date on the page. It does not change what you already paid
              for: an event you have unlocked stays unlocked, at the price you paid.
            </p>
            <p className={bodyClass}>
              If a change matters to you and you do not agree with it, stop using the service and
              email <Mail /> to close your account. If you are still inside the 48 hours on a charge,
              the refund promise in section 4 still applies.
            </p>
            <p className={bodyClass}>
              If Convocate ever stops being offered at all, we will say so on this page before it
              happens, and we will not take a new payment for an event after that point.
            </p>
          </section>

          <section>
            <h2 className={headingClass}>11. Contact</h2>
            <p className={bodyClass}>Convocate is operated by Arlando L. Williams II, an individual.</p>
            {/*
              Email only. There is no street address to publish, and a bracket
              placeholder must never reach a page a visitor reads.
            */}
            <ul className={listClass}>
              <li>
                Email: <Mail /> &mdash; this is the address that actually reaches us, for questions
                about these terms, refunds, a copy of your data, or closing your account.
              </li>
            </ul>
            <p className={bodyClass}>
              We read everything sent to that address. Allow us a few days to reply.
            </p>

            <h3 className={subHeadingClass}>A note on this page</h3>
            <p className={bodyClass}>
              This page describes how Convocate works, in plain language, and it is the agreement
              between you and the person who operates it. It is not legal advice. If you are
              organizing an event with money, contracts or attendees in a particular place, take your
              own advice on what your local law requires of you.
            </p>
          </section>
        </article>
      </div>
    </PublicPage>
  );
}
