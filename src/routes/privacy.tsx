import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHead, PublicPage } from "~/components/public-page";

/**
 * /privacy — what Convocate actually does with an organizer's data.
 *
 * Public and static: no loader, no session, no database. Every statement here
 * is checked against the product as it is built, so it can be read by an
 * organizer deciding whether to hand over their event money and their
 * attendees' names. Do not add a claim to this page that the code does not
 * back up — no encryption promise, no certification, no deletion timeline.
 *
 * `LAST_UPDATED` is the day this copy shipped. Change it whenever the text
 * changes.
 */
const LAST_UPDATED = "October 23, 2026";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Convocate" },
      {
        name: "description",
        content:
          "What Convocate collects from organizers and attendees, why, who can see it, where it lives, how long it is kept, and how to ask for a copy or deletion.",
      },
    ],
  }),
  component: Privacy,
});

/*
 * The document's typography, in one place: body copy at the site measure, a
 * Fraunces section heading with a hairline rule above it, sub-headings as small
 * caps labels, and links in terracotta ink. The wording below is untouched —
 * this page is a statement of what the product does and only its presentation
 * changed.
 */
const bodyClass = "mt-3 text-[16.5px] leading-[1.78] text-charcoal-soft";
const headingClass =
  "mt-12 border-t border-taupe/70 pt-8 font-display text-[1.4rem] font-normal leading-snug tracking-[-0.005em] text-charcoal";
const subHeadingClass = "mt-8 text-[12px] uppercase tracking-[0.18em] text-charcoal";
const listClass =
  "mt-3 list-disc space-y-2.5 pl-5 text-[16.5px] leading-[1.78] text-charcoal-soft marker:text-terracotta/70";
const introClass = "text-[17.5px] leading-[1.75] text-charcoal-soft";
const linkClass =
  "text-terracotta-ink underline decoration-terracotta/40 underline-offset-4 transition-colors hover:decoration-terracotta-ink";

function Privacy() {
  return (
    <PublicPage>
      <PageHead eyebrow="Privacy" title="Privacy Policy" meta={`Last updated ${LAST_UPDATED}`} />

      <div className="mx-auto max-w-[64ch] px-6 pb-24">
        <article>
          <p className={introClass}>
            This page says what Convocate collects, why we collect it, who can see it, and how to
            ask us to remove it. It is written to be read once, in plain language.
          </p>

          <p className={bodyClass}>
            This page goes together with our{" "}
            <Link to="/terms" className={linkClass}>
              Terms of Service
            </Link>
            , which cover the agreement between you and us &mdash; the $199 unlock, refunds,
            electronic signatures, third-party services and liability. Where the two pages touch the
            same subject, this page is the detailed one.
          </p>

          <section>
            <h2 className={headingClass}>Who we are</h2>
            <p className={bodyClass}>
              Convocate is a planning workspace for conferences and events. It holds the budget, the
              contracts, the documents and the registration for an event in one place. If you have a
              question about anything on this page, email{" "}
              <a href="mailto:hello@mail.getconvocate.com" className={linkClass}>
                hello@mail.getconvocate.com
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className={headingClass}>What we collect, and why</h2>

            <h3 className={subHeadingClass}>Your account</h3>
            <ul className={listClass}>
              <li>Your name and email address, so you can sign in and so we can reach you.</li>
              <li>
                Your password. We store only a scrambled hash of it, never the password itself.
              </li>
              <li>When the account was created.</li>
            </ul>

            <h3 className={subHeadingClass}>Your organizer details</h3>
            <p className={bodyClass}>
              These are optional, on the &ldquo;Your details&rdquo; page: legal name, address, signer
              name and title, notices email, phone number, and your organization&rsquo;s logo image
              if you upload one. They fill the party, notices and signature lines on the documents
              you generate.
            </p>

            <h3 className={subHeadingClass}>Your event data</h3>
            <ul className={listClass}>
              <li>The event itself, its budget lines and categories, and the fees and amounts on it.</li>
              <li>
                The contracts on the board — guest speakers, musicians, singers, bands, backline or
                equipment suppliers, and the venue.
              </li>
              <li>The agreements you generate, and the documents you attach to a contract.</li>
              <li>
                Attached documents are PDF, PNG or JPG, up to 10 MB per file and 100 MB per event.
              </li>
              <li>The pre- and post-conference checklist.</li>
              <li>Registration settings and ticket types.</li>
              <li>
                Attendee records: attendee names, email addresses, the number of places taken, a
                phone number and any notes — either entered by you or typed by the attendee on the
                public registration page, where the phone number and the note are optional.
              </li>
            </ul>

            <h3 className={subHeadingClass}>Signatures</h3>
            <p className={bodyClass}>
              When a guest signs an agreement through a signing link, we record the typed name, the
              hand-drawn signature image if they draw one, the acceptance itself, the date and time
              in UTC, and the IP address the acceptance came from. That is an electronic
              acceptance. It is not a notarized signature, and it is not a qualified or regulated
              electronic signature.
            </p>

            <h3 className={subHeadingClass}>The help assistant</h3>
            <p className={bodyClass}>
              When you ask the in-app help assistant a question, we record the question and the time
              it was asked, only to enforce a usage limit — it is not used to train anything, and
              the assistant is never given your event data.
            </p>

            <h3 className={subHeadingClass}>Payments</h3>
            <p className={bodyClass}>
              The $199 unlock is paid through Stripe. We record that a payment was made and which
              event it unlocks. We never see or store your card number — Stripe handles the card.
              Attendee registration fees are not taken through Convocate today: the registration
              page records who is coming and lets you mark fees paid by hand.
            </p>

            <h3 className={subHeadingClass}>The guides, and the email address</h3>
            <p className={bodyClass}>
              Two of the guides at <code>/resources</code> are free to read in full — the conference
              budget template and the conference day timeline — and reading either one never asks
              for an address. Both have a printable one-page sheet. That sheet asks for an email
              address first. This is what happens when you leave one.
            </p>
            <p className={bodyClass}>
              We store the address, which guide you asked for, which page you asked on, whether you
              asked for a printable sheet or for planning notes, and the exact sentence you agreed
              to — so we can show what you consented to, and when. The address is kept for the
              occasional planning note for conference organizers, usually no more than once a month,
              and for nothing else. No email is sent when you submit the form: the printable opens
              on the page immediately, and nothing has to arrive in your inbox for it to work. You
              can leave the list at any time with one click, using the link in any message we send,
              and we never sell or share the address. To have an address
              deleted rather than just unsubscribed, email{" "}
              <a href="mailto:hello@mail.getconvocate.com" className={linkClass}>
                hello@mail.getconvocate.com
              </a>{" "}
              and we will delete the row.
            </p>
            <p className={bodyClass}>
              The other guides are included with Convocate. Their pages show an opening section to
              anyone and the whole guide to an account that has unlocked an event; nothing on those
              pages asks a visitor for an email address.
            </p>
            <h3 className={subHeadingClass}>Visits</h3>
            <p className={bodyClass}>
              We count visits on our own server, in our own database: which public page was opened,
              the day, and the host of the site that linked here &mdash; with no cookie, no
              JavaScript and no IP address stored.
            </p>
            <p className={bodyClass}>
              Convocate sets two cookies and no others. One is the session cookie that keeps you
              signed in. The other is set when you unlock a printable guide sheet, and it does one
              thing: it tells our server that this browser may open that one-page sheet, so you are
              not asked for the address again. It holds no address and no name — only which of the
              two printable sheets it unlocks and when it stops working, signed so it cannot be
              altered. Clearing your browser cookies removes it, and the printable then asks for an
              address again.
            </p>
          </section>

          <section>
            <h2 className={headingClass}>Our Facebook Page and Messenger</h2>
            <p className={bodyClass}>
              Convocate has a Facebook Page. If you send that Page a message, we receive what you
              sent: the text, the time it was sent, and how many attachments came with it. The
              attachments themselves are not stored. We also receive an identifier that Facebook
              uses for your conversation with our Page — we do not use it to look up your name, your
              profile or your friends, and messaging us does not create a Convocate account.
            </p>
            <p className={bodyClass}>
              Replies are written by an automated assistant: the text of your message is sent to a
              third-party AI service to draft the reply, and the reply is sent to you through
              Facebook. A person at Convocate can also read the conversation and answer by hand.
              If you ask whether you are talking to a person or to a computer, the reply will tell you.
            </p>
            <p className={bodyClass}>
              We keep the message so the conversation can be continued, and for no other purpose. We
              do not use it for advertising, we do not add you to an email list, we do not sell or
              share it, and we do not message people on Facebook who have not messaged us first. Ask
              us by email and we will delete the conversation.
            </p>
            <p className={bodyClass}>
              If you comment on a post on our Page, we can read the comment and reply to it. That is
              all we use comments for.
            </p>
            <p className={bodyClass}>
              Facebook itself is run by Meta, which handles what happens on Facebook under{" "}
              <a
                href="https://www.facebook.com/privacy/policy"
                className={linkClass}
              >
                its own privacy policy
              </a>
              , not this one. Our Page is not a place to send card numbers, passwords, or anything
              else you would not want a third party to hold.
            </p>
          </section>

          <section>
            <h2 className={headingClass}>What we do not do</h2>
            <ul className={listClass}>
              <li>We do not sell your data, and we do not rent it.</li>
              <li>We do not use third-party advertising or tracking cookies.</li>
              <li>We do not scrape contact lists, and we do not buy them.</li>
              <li>
                We do not email your attendees anything except the registration confirmation their
                own registration triggers.
              </li>
              <li>
                We do not add anyone to a list by guessing, buying or scraping an address. The only
                addresses on our planning-notes list are ones someone typed into one of the guide
                forms themselves.
              </li>
            </ul>
          </section>

          <section>
            <h2 className={headingClass}>Who can see your data</h2>
            <ul className={listClass}>
              <li>
                You, and anyone you invite to that event as an Editor or a Viewer. A Viewer never
                sees money figures — the server withholds them, so they cannot be revealed in the
                page.
              </li>
              <li>
                A guest you send a signing link to sees that agreement, and nothing else from your
                event.
              </li>
              <li>The public registration page shows only what it needs to take a registration.</li>
              <li>
                One administrator account, operated by Convocate, can see the list of accounts, how
                many events exist and the visit counts. Those administrator features work on its own
                events; it does not open another organizer&rsquo;s documents.
              </li>
            </ul>
          </section>

          <section>
            <h2 className={headingClass}>Where the data lives</h2>
            <p className={bodyClass}>
              Your data lives in one managed database that Convocate operates, plus the host that
              serves this website. Daily backups are kept on Convocate&rsquo;s own machines, and the
              most recent 30 days are kept.
            </p>
          </section>

          <section>
            <h2 className={headingClass}>How long we keep it</h2>
            <p className={bodyClass}>
              For as long as your account exists. Deleting an event deletes its data. If you ask us
              by email, we will remove an account and its events. Backups roll off within 30 days.
            </p>
          </section>

          <section>
            <h2 className={headingClass}>Refunds</h2>
            <p className={bodyClass}>
              If you ask within 48 hours of the card being charged — counted from the charge — you
              get a full refund, no questions asked, and the event returns to the free plan with its
              data kept. After 48 hours, requests are handled case by case. Ask by emailing{" "}
              <a href="mailto:hello@mail.getconvocate.com" className={linkClass}>
                hello@mail.getconvocate.com
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className={headingClass}>Payment of attendee fees</h2>
            <p className={bodyClass}>
              Today the registration page records who is coming and lets you mark fees paid by hand.
              It does not take a card. When Convocate opens card payment for attendee fees, the money
              will be paid into the organizer&rsquo;s own payment account, not into Convocate&rsquo;s.
            </p>
          </section>

          <section>
            <h2 className={headingClass}>Your choices</h2>
            <p className={bodyClass}>
              Ask us at{" "}
              <a href="mailto:hello@mail.getconvocate.com" className={linkClass}>
                hello@mail.getconvocate.com
              </a>{" "}
              for a copy of your data, a correction, or deletion. You can also remove an uploaded
              logo and delete events yourself in the app.
            </p>
          </section>

          <section>
            <h2 className={headingClass}>Changes to this policy</h2>
            <p className={bodyClass}>
              When this policy changes, we will update this page and change the date at the top of
              it.
            </p>
          </section>

          <section>
            <h2 className={headingClass}>A note on this page</h2>
            <p className={bodyClass}>
              This page describes how Convocate works, in plain language. It is not legal advice,
              and an organizer with attendees in a specific jurisdiction should take their own
              advice on it.
            </p>
          </section>
        </article>
      </div>
    </PublicPage>
  );
}
