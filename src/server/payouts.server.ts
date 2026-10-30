/**
 * Stripe Connect onboarding for an organizer's own payouts — **server only**.
 *
 * Why this exists: registration fees and donations belong to the organizer, not
 * to Convocate (owner decision, 2026-10-21). So the money has to land in the
 * organizer's own Stripe account, which means Convocate has to create a Connect
 * account for them and send them through Stripe's own onboarding. That is all
 * this file does — it takes no money, it charges no fee, and it never sends
 * `application_fee_amount` or any other platform cut: Convocate's share of
 * attendee money is $0.
 *
 * Three rules this file follows, and why:
 *
 *  1. **No `stripe` package.** There is no dependency on the official SDK, so
 *     every call is a plain `fetch` to `https://api.stripe.com/v1/...` with a
 *     form-encoded body (`application/x-www-form-urlencoded`), the way Stripe's
 *     REST API is specified. Nested parameters are written literally as
 *     `capabilities[transfers][requested]=true`.
 *  2. **The key is read at call time, from `process.env`, and never leaves this
 *     process.** It is not returned to a caller, not put in an error, and not
 *     logged. If it is absent the honest answer is `not_configured`, not a crash.
 *  3. **Every failure is a sentence, not a stack trace, and never Stripe's own
 *     wording.** A reader gets "Stripe could not be reached just now. Nothing was
 *     changed." — never a raw API message, which is written for developers and
 *     can carry identifiers. Stripe's error *code* (and only the code) goes to the
 *     server log so the team can tell a key problem from a rate limit.
 *
 * Who may call any of this is decided in `api.ts` (`connectPayoutsStartFn`,
 * `connectPayoutsStatusFn`), never here: this module assumes its caller has
 * already established that the signed-in account runs an event of its own.
 */

import {
  getPayoutAccount,
  savePayoutAccount,
  savePayoutAccountStatus,
  type PayoutAccount,
} from "./db.server";

/** Stripe's REST base. Hard-coded: there is no second Stripe to talk to. */
const STRIPE_API = "https://api.stripe.com/v1";

/** A hung socket must not hold a server function open. */
const TIMEOUT_MS = 20_000;

/** A plain, stable identifier — Stripe's logs are easier to read with one. */
const USER_AGENT = "Convocate/1.0 (+https://www.getconvocate.com)";

/* --------------------------------------------------------------- sentences */

/**
 * What a reader sees. Each is a complete thought: what is wrong, and whether
 * anything changed. None of them repeats Stripe's own message.
 */
export const PAYOUTS_NOT_CONFIGURED =
  "Payouts aren't available yet — Convocate hasn't been connected to Stripe.";
export const PAYOUTS_REFUSED =
  "Stripe refused that request, so nothing was changed. Try again in a moment.";
export const PAYOUTS_UNREACHABLE =
  "Stripe could not be reached just now, so nothing was changed. Try again in a moment.";
export const PAYOUTS_KEY_REFUSED =
  "Convocate's connection to Stripe was refused, so nothing was changed. The team has to check the Stripe key before payouts can be set up.";

/* ------------------------------------------------------------------ types */

/** Why a payouts call did not finish. Always a sentence for the reader. */
export type PayoutFailure = {
  ok: false;
  code: "not_configured" | "stripe_refused" | "stripe_unreachable" | "stripe_key";
  error: string;
};

/**
 * What the settings card needs to know — and the whole of what it may know.
 *
 * There is deliberately no account id here, only its last four characters:
 * the full `acct_...` id is a handle on the organizer's Stripe account and the
 * browser has no use for it.
 */
export type PayoutCardState = {
  configured: boolean;
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  last4: string | null;
};

/** Stripe's own words about an account, narrowed to the four fields we store. */
type StripeAccountBody = {
  id?: unknown;
  country?: unknown;
  charges_enabled?: unknown;
  payouts_enabled?: unknown;
  details_submitted?: unknown;
};

type StripeCall =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; code: "stripe_refused" | "stripe_key" | "stripe_unreachable" };

/* ------------------------------------------------------------- the client */

/** Read at call time, trimmed, and never cached or logged. */
const secretKey = (): string => {
  const value = process.env.STRIPE_SECRET_KEY;
  return typeof value === "string" ? value.trim() : "";
};

/** Whether the owner has saved a Stripe key yet — no key is sent anywhere. */
export const isPayoutsConfigured = (): boolean => secretKey() !== "";

/**
 * Only the last four characters of an account id ever leave the server.
 * `acct_1QxAbCdEfGhIjKl` becomes `IjKl`.
 */
export const lastFour = (accountId: string): string | null => {
  const bare = accountId.trim();
  return bare.length >= 4 ? bare.slice(-4) : null;
};

/**
 * A Stripe form body. `URLSearchParams` percent-encodes the bracket characters
 * (`capabilities[transfers][requested]` → `capabilities%5Btransfers%5D%5Brequested%5D`),
 * which is exactly what Stripe expects: their own Go client encodes nested keys
 * the same way, and the API decodes the body before parsing it.
 */
const formEncode = (fields: Record<string, string>): string =>
  new URLSearchParams(fields).toString();

/**
 * One call to Stripe.
 *
 * A refusal is not thrown: it comes back as a code, and the caller turns it into
 * the sentence a reader sees. Nothing about the response body is echoed to the
 * browser — only the server log gets Stripe's error *code*, which is enough to
 * tell "the key is wrong" from "we are being rate limited" without copying text
 * that was written for developers.
 */
const callStripe = async (
  method: "GET" | "POST",
  path: string,
  fields?: Record<string, string>,
  /**
   * The organizer's Connect account (`acct_...`) when the call must act ON THEIR
   * ACCOUNT rather than on the platform. Sent as Stripe's `Stripe-Account` header:
   * that is what makes a Checkout Session — and its money, its fee and its
   * dispute — belong to the organizer instead of to Convocate.
   */
  account?: string,
): Promise<StripeCall> => {
  const key = secretKey();
  // Belt and braces: every caller checks `isPayoutsConfigured` first, and this
  // makes a missed check a refusal rather than a request with an empty bearer.
  if (!key) return { ok: false, code: "stripe_key" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${STRIPE_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": USER_AGENT,
        ...(account ? { "stripe-account": account } : {}),
      },
      body: method === "GET" ? undefined : formEncode(fields ?? {}),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as
        | { error?: { type?: unknown; code?: unknown } }
        | null;
      const code =
        typeof detail?.error?.code === "string"
          ? detail.error.code
          : typeof detail?.error?.type === "string"
            ? detail.error.type
            : "";
      console.error(
        `[convocate] stripe ${method} ${path} answered ${String(response.status)}${code ? ` (${code})` : ""}`,
      );
      // 401/403 is a credential problem and asks the team to act; anything else
      // is Stripe refusing this particular request.
      const failure: "stripe_key" | "stripe_refused" =
        response.status === 401 || response.status === 403 ? "stripe_key" : "stripe_refused";
      return { ok: false, code: failure };
    }

    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      console.error(`[convocate] stripe ${method} ${path} answered with no usable body`);
      return { ok: false, code: "stripe_refused" };
    }
    return { ok: true, body };
  } catch {
    // Timeout, DNS, a dropped connection: nothing reached Stripe, or nothing
    // came back. Either way nothing changed on our side.
    console.error(`[convocate] stripe ${method} ${path} could not be reached`);
    return { ok: false, code: "stripe_unreachable" };
  } finally {
    clearTimeout(timer);
  }
};

/** Turn a failed call into the typed refusal the server function returns. */
const failureOf = (call: { code: "stripe_refused" | "stripe_key" | "stripe_unreachable" }): PayoutFailure => {
  if (call.code === "stripe_unreachable") {
    return { ok: false, code: "stripe_unreachable", error: PAYOUTS_UNREACHABLE };
  }
  if (call.code === "stripe_key") {
    return { ok: false, code: "stripe_key", error: PAYOUTS_KEY_REFUSED };
  }
  return { ok: false, code: "stripe_refused", error: PAYOUTS_REFUSED };
};

/** A Connect account id looks like `acct_` and letters/digits — nothing else. */
const isAccountId = (value: unknown): value is string =>
  typeof value === "string" && /^acct_[A-Za-z0-9]+$/.test(value);

/* ------------------------------------------------------------- the actions */

/**
 * Start (or resume) onboarding: make sure this organizer has a Connect account,
 * then hand back a fresh Stripe onboarding link.
 *
 * An onboarding link expires, so one is minted on every call — including when an
 * account already exists. That is also the "Update payout details" path: the
 * same link takes an organizer back into Stripe to change a bank account.
 *
 * The account is a US account whose shape is set in the create call below: the
 * organizer pays Stripe's own fees out of their own money, Stripe is liable for
 * negative balances, and the organizer gets a full Stripe dashboard. Convocate
 * takes nothing of it.
 */
export const startPayoutOnboarding = async (input: {
  userId: number;
  email: string;
  origin: string;
}): Promise<{ ok: true; url: string } | PayoutFailure> => {
  if (!isPayoutsConfigured()) {
    return { ok: false, code: "not_configured", error: PAYOUTS_NOT_CONFIGURED };
  }

  const existing = await getPayoutAccount(input.userId);
  let accountId = existing?.stripeAccountId ?? "";

  if (!accountId) {
    const created = await callStripe("POST", "/accounts", {
      country: "US",
      email: input.email,
      // The account shape is spelled out here rather than with `type: "express"`.
      // Stripe refuses to create an Express account for a platform that is not
      // liable for negative balances ("When stripe_dashboard[type]=express, your
      // platform must collect fees and be liable for negative balances or
      // refunds and chargebacks"), and Convocate is deliberately NOT liable: the
      // owner's platform profile says Stripe carries that risk. Spelling out the
      // controller gives the organizer a full Stripe dashboard, has them pay
      // Stripe's own fees out of their own money, and leaves Stripe holding the
      // risk. Verified against the live Stripe test API on 2026-10-22: this
      // creates an account whose `type` reads "standard".
      "controller[fees][payer]": "account",
      "controller[losses][payments]": "stripe",
      "controller[stripe_dashboard][type]": "full",
      "controller[requirement_collection]": "stripe",
      "metadata[convocate_user_id]": String(input.userId),
    });
    if (!created.ok) return failureOf(created);
    const createdId = created.body.id;
    if (!isAccountId(createdId)) {
      console.error("[convocate] stripe created an account without a usable id");
      return { ok: false, code: "stripe_refused", error: PAYOUTS_REFUSED };
    }
    const country =
      typeof created.body.country === "string" && created.body.country.trim()
        ? created.body.country.trim().toUpperCase()
        : "US";
    await savePayoutAccount(input.userId, createdId, country, Date.now());
    accountId = createdId;
  }

  const link = await callStripe("POST", "/account_links", {
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${input.origin}/app/settings?connect=refresh`,
    return_url: `${input.origin}/app/settings?connect=return`,
  });
  if (!link.ok) return failureOf(link);

  const url = typeof link.body.url === "string" ? link.body.url : "";
  // A link must be https — anything else is not something to send a browser to.
  if (!url.startsWith("https://")) {
    console.error("[convocate] stripe returned an onboarding link that is not https");
    return { ok: false, code: "stripe_refused", error: PAYOUTS_REFUSED };
  }
  return { ok: true, url };
};

/**
 * Ask Stripe how the organizer's account is doing, store the answer, and return
 * it. This is what `?connect=return` runs when the organizer comes back.
 *
 * An organizer with no account yet is not an error: they simply are not
 * connected, and the card says so.
 */
export const refreshPayoutStatus = async (
  userId: number,
): Promise<({ ok: true } & PayoutCardState) | PayoutFailure> => {
  if (!isPayoutsConfigured()) {
    return { ok: false, code: "not_configured", error: PAYOUTS_NOT_CONFIGURED };
  }

  const existing = await getPayoutAccount(userId);
  if (!existing) {
    return {
      ok: true,
      configured: true,
      connected: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      last4: null,
    };
  }

  const account = await callStripe(
    "GET",
    `/accounts/${encodeURIComponent(existing.stripeAccountId)}`,
  );
  if (!account.ok) return failureOf(account);

  const body = account.body as StripeAccountBody;
  const status = {
    chargesEnabled: body.charges_enabled === true,
    payoutsEnabled: body.payouts_enabled === true,
    detailsSubmitted: body.details_submitted === true,
  };
  await savePayoutAccountStatus(userId, status, Date.now());

  return {
    ok: true,
    configured: true,
    connected: true,
    ...status,
    last4: lastFour(existing.stripeAccountId),
  };
};

/* --------------------------------------- taking a registration fee by card */

/**
 * Is this organizer's Stripe account ready to take a card AND be paid out?
 *
 * Both flags, never one: an account that can take a charge but cannot receive a
 * payout would hold the organizer's money at Stripe with nowhere to go, which is
 * not "ready" for anybody. Anything else — no account, onboarding half finished,
 * a Stripe restriction — answers false, and the registration page records the
 * attendee as unpaid instead of failing. (Owner decision, 2026-10-22.)
 */
export const isAccountReadyForCharges = (account: PayoutAccount | null): boolean =>
  Boolean(account && account.chargesEnabled && account.payoutsEnabled);

/** A Checkout Session as we need it: where to send the browser, and for how much. */
export type AttendeeCheckout = {
  id: string;
  url: string;
  amountCents: number;
  currency: string;
};

/** A session id looks like `cs_test_...` / `cs_live_...` — nothing else. */
const isSessionId = (value: unknown): value is string =>
  typeof value === "string" && /^cs_[A-Za-z0-9_]{8,200}$/.test(value);

/** Stripe's own lower-case currency code, and only that. */
const isCurrency = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z]{3}$/.test(value);

/** A payment intent id looks like `pi_...`. */
const isPaymentIntentId = (value: unknown): value is string =>
  typeof value === "string" && /^pi_[A-Za-z0-9_]{4,200}$/.test(value);

/**
 * Create a Stripe Checkout Session **on the organizer's own account** for one
 * registration.
 *
 * Three things this deliberately does NOT do, each of them the money rule:
 *
 *  - **No `application_fee_amount`.** Not zero, absent. Convocate takes no share
 *    of an attendee's fee, so there is no platform cut to state.
 *  - **No platform account.** The call carries `Stripe-Account: <acct_...>`, so
 *    the charge, Stripe's processing fee, the payout and any dispute all sit on
 *    the organizer's account. Convocate never touches the money.
 *  - **No stored card.** Stripe hosts the page; no card number reaches Convocate,
 *    and the session is the only handle we keep.
 *
 * The attendee id and the conference id ride along in metadata so the return path
 * can check the session really belongs to the registration it is being applied to.
 */
export const createAttendeeCheckout = async (input: {
  accountId: string;
  amountCents: number;
  currency: string;
  /** What the attendee sees on the card page and on their statement. */
  description: string;
  attendeeId: number;
  conferenceId: number;
  email: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ ok: true; checkout: AttendeeCheckout } | PayoutFailure> => {
  if (!isPayoutsConfigured()) {
    return { ok: false, code: "not_configured", error: PAYOUTS_NOT_CONFIGURED };
  }
  // A charge of nothing is not a charge. The caller checks this first; this is the
  // belt to that braces, because a zero-amount session is a Stripe error.
  if (!isAccountId(input.accountId) || !Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, code: "stripe_refused", error: PAYOUTS_REFUSED };
  }
  const currency = isCurrency(input.currency) ? input.currency : "usd";
  const name = input.description.trim().slice(0, 250) || "Registration";

  const fields: Record<string, string> = {
    mode: "payment",
    "payment_method_types[0]": "card",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": currency,
    "line_items[0][price_data][unit_amount]": String(input.amountCents),
    "line_items[0][price_data][product_data][name]": name,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "metadata[convocate_attendee_id]": String(input.attendeeId),
    "metadata[convocate_conference_id]": String(input.conferenceId),
    "payment_intent_data[metadata][convocate_attendee_id]": String(input.attendeeId),
  };
  const email = input.email.trim();
  if (email) fields.customer_email = email;

  const created = await callStripe("POST", "/checkout/sessions", fields, input.accountId);
  if (!created.ok) return failureOf(created);

  const id = created.body.id;
  const url = typeof created.body.url === "string" ? created.body.url : "";
  const amount = Number(created.body.amount_total ?? 0);
  const returnedCurrency =
    typeof created.body.currency === "string" && created.body.currency.trim()
      ? created.body.currency.trim().toLowerCase()
      : currency;

  // A session we cannot send a browser to, or one for a different amount than we
  // asked for, is not something to act on.
  if (!isSessionId(id) || !url.startsWith("https://") || amount !== input.amountCents) {
    console.error("[convocate] stripe created a checkout session we cannot use");
    return { ok: false, code: "stripe_refused", error: PAYOUTS_REFUSED };
  }
  return { ok: true, checkout: { id, url, amountCents: amount, currency: returnedCurrency } };
};

/** What Stripe says about one Checkout Session, narrowed to what we act on. */
export type CheckoutVerdict = {
  id: string;
  /** 'paid' | 'unpaid' | 'no_payment_required' — Stripe's own word. */
  paymentStatus: string;
  /** 'open' | 'complete' | 'expired'. */
  status: string;
  amountCents: number;
  currency: string;
  paymentIntentId: string;
  /** The registration this session says it is for, from its metadata. */
  attendeeId: string;
  conferenceId: string;
};

/**
 * Ask Stripe what became of one Checkout Session — on the organizer's account.
 *
 * This is the only thing that can make an attendee `paid`. The browser tells us a
 * session id and we ask Stripe about it; a query parameter on its own is worth
 * nothing, and is never trusted (see `confirmPublicPaymentFn`).
 */
export const retrieveCheckoutSession = async (
  accountId: string,
  sessionId: string,
): Promise<{ ok: true; verdict: CheckoutVerdict } | PayoutFailure> => {
  if (!isPayoutsConfigured()) {
    return { ok: false, code: "not_configured", error: PAYOUTS_NOT_CONFIGURED };
  }
  if (!isAccountId(accountId) || !isSessionId(sessionId)) {
    return { ok: false, code: "stripe_refused", error: PAYOUTS_REFUSED };
  }

  const found = await callStripe(
    "GET",
    `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`,
    undefined,
    accountId,
  );
  if (!found.ok) return failureOf(found);

  const intent = found.body.payment_intent;
  const metadata = (found.body.metadata ?? {}) as Record<string, unknown>;
  const id = found.body.id;
  if (!isSessionId(id)) {
    console.error("[convocate] stripe returned a checkout session without a usable id");
    return { ok: false, code: "stripe_refused", error: PAYOUTS_REFUSED };
  }
  return {
    ok: true,
    verdict: {
      id,
      paymentStatus: typeof found.body.payment_status === "string" ? found.body.payment_status : "unpaid",
      status: typeof found.body.status === "string" ? found.body.status : "open",
      amountCents: Number(found.body.amount_total ?? 0),
      currency:
        typeof found.body.currency === "string" && found.body.currency.trim()
          ? found.body.currency.trim().toLowerCase()
          : "usd",
      paymentIntentId: isPaymentIntentId(intent)
        ? intent
        : typeof intent === "object" && intent !== null && isPaymentIntentId((intent as { id?: unknown }).id)
          ? String((intent as { id?: unknown }).id)
          : "",
      attendeeId: typeof metadata.convocate_attendee_id === "string" ? metadata.convocate_attendee_id : "",
      conferenceId:
        typeof metadata.convocate_conference_id === "string" ? metadata.convocate_conference_id : "",
    },
  };
};

/**
 * What the settings card shows on a plain page load: the stored flags, with no
 * call to Stripe. "Configured" is whether a key is present at all, which is what
 * the honest "not available yet" state is about.
 */
export const payoutsCardState = async (userId: number): Promise<PayoutCardState> => {
  const configured = isPayoutsConfigured();
  const account = await getPayoutAccount(userId);
  return {
    configured,
    connected: Boolean(account),
    chargesEnabled: account?.chargesEnabled ?? false,
    payoutsEnabled: account?.payoutsEnabled ?? false,
    detailsSubmitted: account?.detailsSubmitted ?? false,
    last4: account ? lastFour(account.stripeAccountId) : null,
  };
};
