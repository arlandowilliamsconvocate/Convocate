import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button, Card, Field, Input } from "~/components/ui";
import { SiteHeader } from "~/components/site-chrome";
import { renderMarkdown } from "~/lib/markdown";
import {
  CONSENT_TEXT_BODY,
  PRINTABLE_CONSENT_TEXT_BODY,
  emailProblem,
  leadMagnetPath,
  normaliseEmail,
  teaserMarkdown,
  type LeadMagnet,
} from "~/lib/lead-magnets";
import { subscribeLeadMagnetFn, unlockPrintableFn } from "~/server/api";

/**
 * The guide pages: `/resources/<slug>`.
 *
 * Two shapes, because the guides are two kinds of thing since 2026-10-23, when
 * the owner drew the free/paid line: **two of the ten guides are free and the
 * other eight come with the $199 plan on an event.**
 *
 *  - **Free** (`LeadMagnetPage`) — the conference budget template and the
 *    conference day timeline. The whole guide is in the server HTML, so a search
 *    engine indexes every word and a reader with JavaScript off reads it like any
 *    other article. Reading is never gated. Both carry a printable sheet, and a
 *    small inline form above the guide offers that sheet for an email address —
 *    the sheet itself is a separate URL (`/print/guide/<slug>`), and the server is
 *    what decides whether it opens.
 *  - **Paid** (`PaidGuidePage`) — the other eight. A stranger, and a signed-in
 *    account that has never unlocked an event, get a real opening section of the
 *    guide and then a wall that says what the rest is and what it costs. An
 *    account that has ever unlocked an event gets the whole guide on the same
 *    URL, in the HTML.
 *
 * What neither shape does: **ask a visitor for an email address in exchange for
 * something they cannot have.** The paid pages carry no form at all — the
 * address is only ever asked for where the printable sheet is genuinely one
 * submission away. And neither shape promises that anything is emailed: list
 * email does not exist in this build, and the printable opens the moment the
 * address is saved.
 */

/** The bits every guide page shares: the breadcrumb, the title and the promise. */
function GuideHeader({ magnet }: { magnet: LeadMagnet }) {
  return (
    <article className="max-w-3xl">
      <p className="text-xs uppercase tracking-[0.18em] text-ink-soft">
        <Link to="/resources" className="hover:text-ink">
          Resources
        </Link>
      </p>
      <h1 className="mt-3 text-4xl leading-[1.1] text-ink sm:text-5xl">{magnet.title}</h1>
      <p className="mt-5 text-lg leading-relaxed text-ink-soft">{magnet.promise}</p>
      {magnet.access === "paid" ? (
        <p className="mt-5 text-sm leading-relaxed text-ink-soft">
          This guide is part of the $199 plan on an event. Below is what it covers; the full guide,
          and printing it, open with the plan.
        </p>
      ) : (
        <p className="mt-5 text-sm leading-relaxed text-ink-soft">
          The whole guide is below, free to read. Printing it asks for an email address.
        </p>
      )}
    </article>
  );
}

/* ------------------------------------------------------------- printable */
/**
 * The printable form: one email field, one button, one line saying what the
 * address is for.
 *
 * It is a real server round trip. `unlockPrintableFn` validates the address,
 * writes it to `lead_signups` and sets the signed cookie that opens the sheet;
 * the browser is then sent to the printable URL. Nothing depends on an email
 * arriving, because nothing is sent.
 */
export function PrintableForm({ magnet }: { magnet: LeadMagnet }) {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const errorId = "printable-email-error";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const problem = emailProblem(email);
    if (problem) {
      setError(problem);
      emailRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await unlockPrintableFn({
        data: { email: normaliseEmail(email), guide: magnet.slug, website: honeypot },
      });
      if (!result.ok) {
        setError(result.error);
        emailRef.current?.focus();
        setBusy(false);
        return;
      }
      // A full page load, not a client route change: the printable is rendered
      // by the server from the cookie that was just set, and this is the
      // simplest way to guarantee the server sees it.
      window.location.assign(result.url);
    } catch {
      setError("We could not save that just now. Please try again in a moment.");
      setBusy(false);
    }
  };

  return (
    <form
      id="printable"
      onSubmit={submit}
      noValidate
      className="print-hide mt-8 scroll-mt-6 rounded-xl border border-line bg-white p-5 shadow-sm"
    >
      <h2 className="font-serif text-xl text-ink">Get the printable version</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{magnet.printableNote}</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <label htmlFor="printable-email" className="sr-only">
            Email address
          </label>
          <Input
            ref={emailRef}
            id="printable-email"
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            required
            value={email}
            disabled={busy}
            aria-invalid={error === null ? undefined : true}
            aria-describedby={error === null ? undefined : errorId}
            onChange={(event) => {
              setEmail(event.target.value);
              if (error !== null) setError(null);
            }}
            placeholder="you@example.org"
          />
        </div>
        <Button type="submit" disabled={busy} className="px-5 py-2 font-semibold">
          {busy ? "Opening…" : "Get the printable version"}
        </Button>
      </div>
      {/* The honeypot: off-screen, not announced, never filled in by a person. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto" }}>
        <label>
          Leave this field empty
          <input
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(event) => setHoneypot(event.target.value)}
          />
        </label>
      </div>
      {error === null ? null : (
        <p
          id={errorId}
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <p className="mt-3 text-xs leading-relaxed text-ink-soft">
        {PRINTABLE_CONSENT_TEXT_BODY}{" "}
        See our{" "}
        <Link to="/privacy" className="font-medium text-brand underline">
          privacy page
        </Link>
        .
      </p>
    </form>
  );
}

/* ------------------------------------------------------------------ free */
/**
 * A free guide: the whole thing, in the HTML, for anyone.
 *
 * The guide body is rendered on the server and is not conditional on anything.
 * When the guide has a printable sheet, the form sits directly under the
 * introduction, where a reader decides whether they want the paper version —
 * and the guide continues below it, unbroken.
 */
export function LeadMagnetPage({ magnet }: { magnet: LeadMagnet }) {
  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 pb-20 pt-14 sm:pt-20">
        <GuideHeader magnet={magnet} />
        {magnet.printableHeading ? (
          <div className="max-w-3xl">
            <PrintableForm magnet={magnet} />
          </div>
        ) : null}
        <article
          id="guide"
          aria-label={`${magnet.title} — the full guide`}
          className="print-sheet mx-auto mt-10 max-w-3xl scroll-mt-6 rounded-xl border border-line bg-white p-6 shadow-sm sm:p-10"
        >
          {renderMarkdown(magnet.markdown)}
          <p className="mt-10 border-t border-line pt-5 text-sm leading-relaxed text-ink-soft">
            This guide is free to read and to keep. Printing it asks for an email address.{" "}
            <Link to="/example" className="font-medium text-brand underline">
              See a filled-in example event
            </Link>{" "}
            if you would like to see the budget and the contracts together.
          </p>
        </article>
        {magnet.printableHeading ? null : <NotesForm magnet={magnet} />}
      </main>
    </div>
  );
}

/* ----------------------------------------------------------------- notes */
/**
 * The planning-notes form: one free guide, one email field, and a line saying
 * what the address is for.
 *
 * It only renders on a free guide that has **no** printable sheet to offer —
 * with both free guides carrying a printable today, the printable form is the
 * one a reader actually meets, and this is the fallback for a free guide that
 * ever ships without a sheet. It never appears on a paid guide: asking for an
 * address in exchange for something the visitor cannot have yet would be a dark
 * pattern. It stores the address and says plainly that nothing is sent to
 * deliver a guide that is already above it.
 */
function NotesForm({ magnet }: { magnet: LeadMagnet }) {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [unsubscribeToken, setUnsubscribeToken] = useState("");
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const errorId = "lead-magnet-email-error";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const problem = emailProblem(email);
    if (problem) {
      setError(problem);
      emailRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await subscribeLeadMagnetFn({
        data: {
          email: normaliseEmail(email),
          guide: magnet.slug,
          sourcePath: leadMagnetPath(magnet.slug),
          website: honeypot,
        },
      });
      if (!result.ok) {
        setError(result.error);
        emailRef.current?.focus();
        return;
      }
      setSent(true);
      setUnsubscribeToken(result.token);
      window.requestAnimationFrame(() => statusRef.current?.focus());
    } catch {
      setError("We could not save that just now. Please try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="notes" className="print-hide mx-auto mt-14 max-w-3xl scroll-mt-6">
      <Card className="p-6">
        {sent ? (
          <div>
            <p
              ref={statusRef}
              role="status"
              tabIndex={-1}
              className="font-serif text-2xl text-ink outline-none"
            >
              Thank you — you are on the list.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              We will send the occasional planning note for conference organizers — usually no more
              than once a month, and nothing else. Nothing was emailed to you: the printable is open
              on this page, and you can print it or save it now.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="secondary" type="button" onClick={() => window.print()}>
                Print this guide
              </Button>
              {unsubscribeToken === "" ? (
                <span className="text-sm leading-relaxed text-ink-soft">
                  You can ask us to stop any time.
                </span>
              ) : (
                <Link
                  to="/unsubscribe"
                  search={{ token: unsubscribeToken }}
                  className="text-sm font-medium text-brand underline"
                >
                  Unsubscribe this address now
                </Link>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <h2 className="font-serif text-2xl text-ink">Planning notes by email, if they are useful</h2>
            <p className="text-sm leading-relaxed text-ink-soft">{magnet.notesNote}</p>
            <Field label="Email address">
              <Input
                ref={emailRef}
                type="email"
                name="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                required
                value={email}
                disabled={busy}
                aria-invalid={error === null ? undefined : true}
                aria-describedby={error === null ? undefined : errorId}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (error !== null) setError(null);
                }}
                placeholder="you@example.org"
              />
            </Field>
            <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto" }}>
              <label>
                Leave this field empty
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={(event) => setHoneypot(event.target.value)}
                />
              </label>
            </div>
            {error === null ? null : (
              <p
                id={errorId}
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {error}
              </p>
            )}
            <div>
              <Button type="submit" disabled={busy} className="px-5 py-2.5 font-semibold">
                {busy ? "Saving…" : "Send me planning notes"}
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-ink-soft">
              {CONSENT_TEXT_BODY}{" "}
              See our{" "}
              <Link to="/privacy" className="font-medium text-brand underline">
                privacy page
              </Link>
              .
            </p>
          </form>
        )}
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ paid */
/**
 * The wall under a paid guide.
 *
 * Everything it says is true and checkable: what the guide is, that it is
 * included with Convocate, the flat $199 per event, the free tier, the 48-hour
 * refund, and one button. It does not promise to email anything, and it does not
 * pretend the guide is a download — it opens on this page.
 */
function GuideWall({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="print-hide mx-auto mt-10 max-w-3xl">
      <Card className="p-6 sm:p-8">
        <p className="text-xs uppercase tracking-[0.18em] text-brand">Included with Convocate</p>
        <h2 className="mt-3 font-serif text-2xl leading-snug text-ink">
          The rest of this guide comes with Convocate
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          Convocate is a planning workspace for conferences and events: the budget, the venue and
          speaker contracts through to a signature, the speaker booked, and registration open with
          fees paid into your own Stripe account. This guide is one of the working documents that
          comes with it, and it opens here in full, on this page, for any account that has unlocked
          an event.
        </p>
        <ul className="mt-5 space-y-2 text-sm leading-relaxed text-ink-soft">
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-brand/50" />
            <span>
              <strong className="font-semibold text-ink">$199 per event, paid once.</strong> No
              subscription, no per-seat charge, and nothing renews.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-brand/50" />
            <span>
              <strong className="font-semibold text-ink">The free plan</strong> holds one event, the
              account owner alone, and one budget line — enough to see the arithmetic work on your
              own number before you pay.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-brand/50" />
            <span>
              <strong className="font-semibold text-ink">A full refund, no questions asked</strong>,
              within 48 hours of paying. The event returns to the free plan and keeps its data.
            </span>
          </li>
        </ul>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            to="/pricing"
            className="inline-flex items-center justify-center rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand/90"
          >
            See what $199 includes
          </Link>
          {signedIn ? (
            <Link to="/app" className="text-sm font-medium text-brand underline underline-offset-2">
              Open your workspace
            </Link>
          ) : (
            <Link to="/signup" className="text-sm font-medium text-brand underline underline-offset-2">
              Create an account
            </Link>
          )}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-ink-soft">
          {signedIn
            ? "Your account has not unlocked an event yet, so this guide stops here. It opens in full on this same page as soon as an event on your account is unlocked — nothing is sent to you by email."
            : "Nothing is sent to you by email. The guide opens in full on this same page once your account has unlocked an event."}
        </p>
      </Card>
    </section>
  );
}

/**
 * A paid guide: the opening for anyone, the whole thing for an account that has
 * ever unlocked an event.
 *
 * `access` comes from the loader, which asks the server (`guideAccessFn`). The
 * teaser is cut at a section boundary by `teaserMarkdown`, so it ends where the
 * author ended a section rather than mid-sentence, and it is a few hundred words
 * — long enough to be worth the visit a search engine just made.
 */
export function PaidGuidePage({
  magnet,
  access,
}: {
  magnet: LeadMagnet;
  access: { signedIn: boolean; full: boolean };
}) {
  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 pb-20 pt-14 sm:pt-20">
        <GuideHeader magnet={magnet} />
        <article
          id="guide"
          aria-label={
            access.full ? `${magnet.title} — the full guide` : `${magnet.title} — the opening section`
          }
          className="print-sheet mx-auto mt-10 max-w-3xl scroll-mt-6 rounded-xl border border-line bg-white p-6 shadow-sm sm:p-10"
        >
          {renderMarkdown(access.full ? magnet.markdown : teaserMarkdown(magnet.markdown))}
          {access.full ? (
            <p className="mt-10 border-t border-line pt-5 text-sm leading-relaxed text-ink-soft">
              This guide comes with the $199 plan on an event.{" "}
              <Link to="/example" className="font-medium text-brand underline">
                See a filled-in example event
              </Link>{" "}
              if you would like to see the budget and the contracts together.
            </p>
          ) : null}
        </article>
        {access.full ? null : <GuideWall signedIn={access.signedIn} />}
        <p className="print-hide mx-auto mt-10 max-w-3xl text-sm leading-relaxed text-ink-soft">
          <Link to="/resources" className="font-medium text-brand underline">
            All the guides
          </Link>{" "}
          — which two are free to read in full, and which eight come with the $199 plan.
        </p>
      </main>
    </div>
  );
}
