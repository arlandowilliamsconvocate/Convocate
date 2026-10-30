import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, Card, Field, Input, Select } from "~/components/ui";
import { formatDateRange, formatMoney } from "~/lib/money";
import type { AttendeePaymentStatus } from "~/lib/types";
import {
  confirmPublicPaymentFn,
  getPublicRegistrationFn,
  startPublicPaymentFn,
  submitPublicRegistrationFn,
} from "~/server/api";

/**
 * The attendee-facing registration page — `/register/<token>`.
 *
 * This is the one page in Convocate an organizer's attendees use. It has to work
 * signed out, on a phone, for someone who has never heard of Convocate and never
 * will: no account, no sign-in, no mention of plans or prices for the product.
 *
 * It shows only what the server sent it — the conference's public fields, the
 * tickets on offer with the places left on each, and whether this event can take
 * a card. It cannot show the attendee list, anyone else's details, the totals or
 * the budget, because the server never sends them (see
 * `getPublicRegistrationPage`).
 *
 * **The page never goes dark.** When the organizer's Stripe account is ready and
 * the ticket costs something, registering records the attendee first and then
 * sends them to Stripe's own card page; when it is not ready (or the ticket is
 * free) the same registration is recorded and the page says plainly that the
 * organizer will follow up about the fee. Either way the person is on the list
 * before a browser leaves this page, and nothing is ever charged here.
 *
 * **Payment is never confirmed by this page.** It comes back from Stripe with a
 * session id, asks the server, and the server asks Stripe. A query parameter
 * alone marks nobody paid.
 */
export const Route = createFileRoute("/register/$token")({
  validateSearch: (search: Record<string, unknown>): RegisterSearch => ({
    // Stripe fills `{CHECKOUT_SESSION_ID}` in when it sends the browser back.
    paid: typeof search.paid === "string" ? search.paid : undefined,
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
    // Back from the card page without paying.
    canceled: typeof search.canceled === "string" ? search.canceled : undefined,
  }),
  head: () => ({
    meta: [{ title: "Register — Convocate" }],
  }),
  loader: async ({ params }) => ({
    page: await getPublicRegistrationFn({ data: { token: params.token } }),
  }),
  component: RegisterPage,
});

/** Only three query values are read, and each is an attendee id or a session id. */
type RegisterSearch = { paid?: string; session_id?: string; canceled?: string };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line/70">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="font-serif text-xl font-semibold tracking-tight text-brand">Convocate</span>
            <span className="hidden text-xs uppercase tracking-[0.18em] text-ink-soft sm:inline">
              Conference/Event planning
            </span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-10">{children}</main>
    </div>
  );
}

/** The polite page for a link that cannot take a registration right now. */
function CannotRegister({ code }: { code: "not_found" | "not_open" | "closed" | "sold_out" }) {
  const copy =
    code === "closed"
      ? {
          title: "Registration is closed",
          body: "Registration for this conference is closed at the moment. If you were expecting to register, contact whoever sent you this link — they can tell you whether places are still being taken.",
        }
      : code === "sold_out"
        ? {
            title: "Every place has been registered",
            body: "All the places at this conference have now been registered. Nothing has been taken from you and nothing was charged. Contact whoever sent you this link if you would like to be told about a cancellation.",
          }
        : {
            // Wrong link or a conference whose registration is not open: the same
            // sentence, and no conference detail at all.
            title: "Registration is not open for this conference",
            body: "This link does not open a registration form. Nothing has been taken from you and nothing was charged. If you were expecting to register, check the link with whoever sent it.",
          };
  return (
    <Shell>
      <Card className="p-7">
        <h1 className="font-serif text-2xl text-ink">{copy.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">{copy.body}</p>
      </Card>
    </Shell>
  );
}

/** Whether the confirmation email actually went out — as the server reported it. */
type EmailStatus = "sent" | "failed" | "skipped" | "no_address";

type Registration = {
  name: string;
  email: string;
  ticketName: string;
  quantity: number;
  amountDueCents: number;
  emailStatus: EmailStatus;
  /** Where the browser goes next, when this event can take a card. */
  paymentUrl: string | null;
  /** Whether a card is on offer for this event at all. */
  cardPayment: boolean;
};

/** What the page knows while it is coming back from Stripe, and after. */
type ReturnState =
  | { kind: "checking" }
  | { kind: "checked"; paymentStatus: AttendeePaymentStatus; amountCents: number; verified: boolean }
  | { kind: "unknown" }
  | { kind: "canceled"; attendeeId: number };

function RegisterPage() {
  // Every hook runs before any branch below returns. `useParams` used to be
  // called inside the JSX further down, so once `done` was set the early return
  // skipped it and React saw one hook fewer between renders (error #300) — the
  // confirmation screen arrived as the error boundary instead.
  const { page } = Route.useLoaderData();
  const { token } = Route.useParams();
  const { paid, session_id: sessionId, canceled } = Route.useSearch();
  const [done, setDone] = useState<Registration | null>(null);
  const [returning, setReturning] = useState<ReturnState | null>(
    paid ? { kind: "checking" } : canceled ? { kind: "canceled", attendeeId: Number(canceled) } : null,
  );

  // Back from Stripe: ask the server, which asks Stripe. Nothing here decides
  // that anybody paid — it only reports what the server said.
  useEffect(() => {
    if (!paid) return;
    const attendeeId = Number(paid);
    if (!Number.isInteger(attendeeId) || attendeeId <= 0) {
      setReturning({ kind: "unknown" });
      return;
    }
    let abandoned = false;
    void (async () => {
      try {
        const result = await confirmPublicPaymentFn({
          data: { token, attendeeId, sessionId: sessionId ?? "" },
        });
        if (abandoned) return;
        setReturning(
          result.ok
            ? {
                kind: "checked",
                paymentStatus: result.paymentStatus,
                amountCents: result.amountCents,
                verified: result.verified,
              }
            : { kind: "unknown" },
        );
      } catch {
        if (!abandoned) setReturning({ kind: "unknown" });
      }
    })();
    return () => {
      abandoned = true;
    };
  }, [paid, sessionId, token]);

  if (returning) return <ReturnScreen state={returning} token={token} />;
  if (done) return <Confirmed registration={done} />;
  if (!page.ok) return <CannotRegister code={page.code} />;

  return (
    <Shell>
      <Card className="p-7">
        <ConferenceHeading
          name={page.page.conferenceName}
          startDate={page.page.startDate}
          endDate={page.page.endDate}
          venue={page.page.venue}
          placesLeft={page.page.placesLeft}
        />
        {page.page.instructions ? (
          <div className="mt-5 rounded-lg border border-line bg-paper-deep/40 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">From the organizer</p>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{page.page.instructions}</p>
          </div>
        ) : null}

        <h2 className="mt-7 font-serif text-xl text-ink">Register</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Fill this in and you are on the list. You don&rsquo;t need an account.
        </p>

        <RegistrationForm
          token={token}
          ticketTypes={page.page.ticketTypes}
          cardPayment={page.page.cardPayment}
          onRegistered={setDone}
        />

        <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-ink-soft">
          {page.page.cardPayment
            ? "Payment is handled by the organizer through Stripe. Your fee goes to the organizer in full — Convocate takes no share of it."
            : "No card is charged on this page. Registering tells the organizer you are coming and what your fee comes to; the organizer arranges payment with you directly."}
        </p>
      </Card>
    </Shell>
  );
}

function ConferenceHeading({
  name,
  startDate,
  endDate,
  venue,
  placesLeft,
}: {
  name: string;
  startDate: string;
  endDate: string;
  venue: string;
  placesLeft: number | null;
}) {
  const dates = startDate ? formatDateRange(startDate, endDate) : "";
  return (
    <div>
      <h1 className="font-serif text-2xl leading-tight text-ink">{name}</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        {dates ? <span>{dates}</span> : null}
        {dates && venue ? <span> · </span> : null}
        {venue ? <span>{venue}</span> : null}
      </p>
      {placesLeft === null ? null : (
        <p className="mt-2 text-xs text-ink-soft">
          {placesLeft === 0
            ? "Every place has been registered."
            : `${String(placesLeft)} ${placesLeft === 1 ? "place" : "places"} left.`}
        </p>
      )}
    </div>
  );
}

function RegistrationForm({
  token,
  ticketTypes,
  cardPayment,
  onRegistered,
}: {
  token: string;
  ticketTypes: { id: number; name: string; priceCents: number; placesLeft: number | null }[];
  cardPayment: boolean;
  onRegistered: (registration: Registration) => void;
}) {
  const firstAvailable = ticketTypes.find((ticket) => ticket.placesLeft === null || ticket.placesLeft > 0);
  const [ticketTypeId, setTicketTypeId] = useState(String(firstAvailable?.id ?? ticketTypes[0]?.id ?? ""));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);

  const selected = ticketTypes.find((ticket) => String(ticket.id) === ticketTypeId);
  const maxPlaces = selected?.placesLeft ?? null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setField(null);
    try {
      const result = await submitPublicRegistrationFn({
        data: {
          token,
          ticketTypeId: Number(ticketTypeId),
          name,
          email,
          phone,
          notes,
          quantity,
          website,
        },
      });
      if (result.ok) {
        onRegistered({
          ...result.registration,
          emailStatus: result.emailStatus,
          paymentUrl: result.payment?.url ?? null,
          cardPayment: result.cardPayment,
        });
        return;
      }
      setError("error" in result ? result.error : "That registration could not be completed.");
      setField("field" in result && result.field ? result.field : null);
    } catch {
      setError("That registration could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mt-4 space-y-4" onSubmit={(event) => void submit(event)} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name">
          <Input
            value={name}
            autoComplete="name"
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            placeholder="The name the organizer should know you by"
          />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.org"
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Registration option">
          <Select
            value={ticketTypeId}
            disabled={busy}
            onChange={(event) => setTicketTypeId(event.target.value)}
          >
            {ticketTypes.map((ticket) => (
              <option
                key={ticket.id}
                value={String(ticket.id)}
                disabled={ticket.placesLeft !== null && ticket.placesLeft <= 0}
              >
                {ticket.name} — {formatMoney(ticket.priceCents)}
                {ticket.placesLeft === null
                  ? ""
                  : ticket.placesLeft <= 0
                    ? " (full)"
                    : ` (${String(ticket.placesLeft)} left)`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Places" hint={maxPlaces === null ? undefined : `Up to ${String(maxPlaces)}.`}>
          <Input
            type="number"
            min={1}
            max={maxPlaces ?? undefined}
            inputMode="numeric"
            value={quantity}
            disabled={busy}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone (optional)">
          <Input
            type="tel"
            autoComplete="tel"
            value={phone}
            disabled={busy}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="If the organizer needs to reach you"
          />
        </Field>
        <Field label="Anything to add (optional)">
          <Input
            value={notes}
            disabled={busy}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Accessibility, dietary needs, who you are coming with"
          />
        </Field>
      </div>

      {/* The honeypot: off-screen, not announced to a screen reader, and never
          filled in by a person. Anything in it means a machine sent the form. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto" }}>
        <label>
          Leave this field empty
          <input
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </label>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || ticketTypes.length === 0}>
          {busy ? "Sending…" : "Register"}
        </Button>
        {selected ? (
          <span className="text-sm text-ink-soft">
            {formatMoney(selected.priceCents)} per place
            {/^[0-9]+$/.test(quantity) && Number(quantity) > 0
              ? ` · ${formatMoney(selected.priceCents * Number(quantity))} for ${quantity}`
              : ""}
          </span>
        ) : null}
      </div>
      {field === "quantity" && maxPlaces === 0 ? <p className="text-xs text-ink-soft">That option is full.</p> : null}
      {cardPayment ? (
        <p className="text-xs leading-relaxed text-ink-soft">
          If this option has a fee, you will be taken to a secure card page to pay it after registering.
        </p>
      ) : null}
    </form>
  );
}

function Confirmed({ registration }: { registration: Registration }) {
  // A card page was opened: send the browser there. The registration is already
  // recorded, so leaving here loses nobody.
  if (registration.paymentUrl) {
    return (
      <Shell>
        <Card className="p-7">
          <h1 className="font-serif text-2xl text-ink">You are on the list</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Thank you, {registration.name}. Your registration has been recorded. Taking you to the secure card
            page to pay {formatMoney(registration.amountDueCents)}…
          </p>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            If nothing happens,{" "}
            <a className="text-brand underline" href={registration.paymentUrl}>
              open the card page
            </a>
            . Your place is already saved either way.
          </p>
          <PaymentRedirect url={registration.paymentUrl} />
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card className="p-7">
        <h1 className="font-serif text-2xl text-ink">You are on the list</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Thank you, {registration.name}. Your registration has been recorded for the organizer.
        </p>
        <dl className="mt-5 divide-y divide-line rounded-lg border border-line">
          <Row label="Name" value={registration.name} />
          <Row label="Email" value={registration.email} />
          <Row label="Registration option" value={registration.ticketName} />
          <Row label="Places" value={String(registration.quantity)} />
          <Row label="Amount due" value={formatMoney(registration.amountDueCents)} />
        </dl>
        <div className="mt-5 rounded-lg border border-line bg-paper-deep/50 px-4 py-3">
          <p className="text-sm leading-relaxed text-ink">
            Registration is open and your place is recorded. Card payment isn&rsquo;t available for this event
            yet, so the organizer will follow up with you about the fee.
          </p>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-ink-soft">
          {registration.emailStatus === "sent"
            ? `A confirmation was emailed to ${registration.email}. Keep this page or that email if you need a record of what you registered.`
            : registration.emailStatus === "no_address"
              ? "No email address given, so nothing was sent. Keep a note of what is shown here."
              : "The confirmation email could not be sent, so keep a note of what is shown here."}{" "}
          If anything above is wrong, contact whoever sent you the link.
        </p>
      </Card>
    </Shell>
  );
}

/** Sends the browser to Stripe once, from an effect — never during a render. */
function PaymentRedirect({ url }: { url: string }) {
  useEffect(() => {
    window.location.assign(url);
  }, [url]);
  return null;
}

/**
 * What the page shows when it comes back from the card page.
 *
 * The status shown is the SERVER's answer, which came from Stripe. A `paid` here
 * is the only place this page says anyone paid.
 */
function ReturnScreen({ state, token }: { state: ReturnState; token: string }) {
  if (state.kind === "checking") {
    return (
      <Shell>
        <Card className="p-7">
          <h1 className="font-serif text-2xl text-ink">Checking your payment</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            One moment — confirming with Stripe that the payment went through. Your registration is already
            recorded either way.
          </p>
        </Card>
      </Shell>
    );
  }

  if (state.kind === "unknown") {
    return (
      <Shell>
        <Card className="p-7">
          <h1 className="font-serif text-2xl text-ink">We can&rsquo;t find that registration</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            This link and that registration don&rsquo;t match, so nothing here was changed and nothing was
            charged. If you were expecting to register, check the link with whoever sent it.
          </p>
          <p className="mt-4 text-sm">
            <Link to="/register/$token" params={{ token }} className="text-brand underline">
              Back to the registration page
            </Link>
          </p>
        </Card>
      </Shell>
    );
  }

  if (state.kind === "canceled") {
    return <RetryPayment token={token} attendeeId={state.attendeeId} />;
  }

  const paid = state.paymentStatus === "paid";
  return (
    <Shell>
      <Card className="p-7">
        <h1 className="font-serif text-2xl text-ink">
          {paid ? "You are registered and paid" : "You are registered"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          {paid
            ? "Stripe confirmed your payment. Keep this page as your record."
            : "Your place is recorded. A card payment for this registration has not been confirmed."}
        </p>
        {paid ? (
          <dl className="mt-5 divide-y divide-line rounded-lg border border-line">
            <Row label="Paid" value={formatMoney(state.amountCents)} />
            <Row label="Paid to" value="The organizer, through Stripe" />
          </dl>
        ) : null}
        <div className="mt-5 rounded-lg border border-line bg-paper-deep/50 px-4 py-3">
          <p className="text-sm leading-relaxed text-ink">
            {paid
              ? "Your fee went to the organizer in full — Convocate takes no share of it. The organizer also has your registration in their list."
              : "If you completed the payment, the organizer will see it. If you did not, the organizer will follow up with you about the fee — your place is safe."}
          </p>
        </div>
        {!paid ? (
          <p className="mt-4 text-sm">
            <Link to="/register/$token" params={{ token }} className="text-brand underline">
              Back to the registration page
            </Link>
          </p>
        ) : null}
      </Card>
    </Shell>
  );
}

/**
 * "Try the card payment again" — for someone who came back from the card page
 * without paying.
 *
 * It re-opens a card page for the registration that already exists; it never
 * creates a second registration. If the event can no longer take a card, the
 * sentence says so and the organizer follows up — the page still does not block
 * anybody.
 */
function RetryPayment({ token, attendeeId }: { token: string; attendeeId: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await startPublicPaymentFn({ data: { token, attendeeId } });
      if (result.ok) setUrl(result.payment.url);
      else setError(result.error);
    } catch {
      setError("That could not be started. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (url) {
    return (
      <Shell>
        <Card className="p-7">
          <h1 className="font-serif text-2xl text-ink">Taking you to the card page</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Your registration is already recorded.{" "}
            <a className="text-brand underline" href={url}>
              Open the card page
            </a>{" "}
            if nothing happens.
          </p>
          <PaymentRedirect url={url} />
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card className="p-7">
        <h1 className="font-serif text-2xl text-ink">Payment not completed</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Your place is recorded and nothing has been charged. You can try the card payment again, or pay the
          organizer directly.
        </p>
        {error ? (
          <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="button" disabled={busy} onClick={() => void retry()}>
            {busy ? "Opening…" : "Try the card payment again"}
          </Button>
          <Link to="/register/$token" params={{ token }} className="text-sm text-brand underline">
            Back to the registration page
          </Link>
        </div>
      </Card>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="text-right text-sm text-ink">{value}</dd>
    </div>
  );
}
