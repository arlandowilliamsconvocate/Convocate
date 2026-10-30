/**
 * The Stripe webhook — **server only**.
 *
 * Why this exists: the browser-return path (`confirmPublicPaymentFn`) only works
 * if the attendee comes back to Convocate after paying. Pay, close the tab, and
 * Stripe has the money while the registration still reads "unpaid" until the
 * organizer marks it by hand. Stripe tells *us* when a Checkout Session is paid;
 * this module is what listens, and it is the safety net — the return path is
 * untouched and both may run in either order.
 *
 * Four rules this file keeps, and why:
 *
 *  1. **The signature is over the raw bytes.** The body is read as bytes and the
 *     HMAC is computed over exactly those bytes — never over a re-serialised
 *     object. `{t}.{payload}`, HMAC-SHA256, compared in constant time, every
 *     `v1` value accepted, and a timestamp more than five minutes from now is
 *     refused. A body that fails any of that changes no row at all.
 *  2. **No secret configured means no input is accepted.** Not "accept and warn":
 *     refuse, answer 400, and say so in the log. An unsigned body is never proof
 *     of anything, and a half-configured deploy must fail closed.
 *  3. **Both Stripe modes work with no code change.** `STRIPE_WEBHOOK_SECRET`
 *     (live) and `STRIPE_WEBHOOK_SECRET_TEST` (test) are both read at call time;
 *     a delivery is accepted if it matches *either*, and the log names which.
 *     Each value has stray characters stripped from its ends before use — a
 *     pasted secret that picked up a trailing `(` must not refuse every real
 *     delivery — but the middle is never touched and nothing is ever guessed.
 *  4. **Only a connected-account event about a paid session can mark anyone
 *     paid.** `event.account` must be set (all Convocate money is on the
 *     organizer's own account), the type must be one of the two Checkout
 *     completion types, and `payment_status` must literally be `paid`.
 *
 * The status code is a message to Stripe, not to a reader: 400 means "your
 * delivery is not trustworthy, do not retry"; 200 means "we have dealt with it,
 * or there is nothing for us here"; 500 means "we could not deal with it — please
 * send it again". Nothing else is ever returned, so Stripe never retries forever
 * over an event we simply do not care about.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  claimStripeWebhookEvent,
  findAttendeeForStripePayment,
  markAttendeePaidFromStripe,
  settleStripeWebhookEvent,
  type StripeWebhookOutcome,
} from "./db.server";

/** How far a delivery's timestamp may be from our clock, in seconds. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** A Checkout event is a few KB. Anything past this is not a delivery we want. */
export const MAX_WEBHOOK_BYTES = 256 * 1024;

/** The two event types that can mean "an attendee's card was charged". */
export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
] as const;

export type WebhookSecret = { label: "live" | "test"; value: string };

/* --------------------------------------------------------------- the secrets */

/**
 * Characters that can legitimately appear in a Stripe signing secret.
 *
 * A secret is `whsec_` followed by base64url (`A-Z a-z 0-9 - _`); some values also
 * carry a trailing `=` of base64 padding, so that is tolerated at the end too.
 */
const SECRET_LEADING = /^[A-Za-z0-9_]/;
const SECRET_TRAILING = /[A-Za-z0-9_=-]$/;

/** Which env var names have already been reported as trimmed, so the log says it once. */
const trimmedAlreadyLogged = new Set<string>();

/**
 * Strip stray characters from the *ends* of a saved secret, and nothing else.
 *
 * Why: a secret pasted into Settings can pick up a trailing character that is
 * invisible to the eye but fatal to the HMAC — one live deploy had a `(` on the
 * end, which turned every genuine Stripe delivery into `400 mismatch`. Trimming
 * the ends is the whole repair. The middle is never touched, nothing is padded,
 * and a missing character is never guessed: a secret that is genuinely wrong
 * still fails, loudly and honestly, with `400 mismatch`.
 *
 * The log names the env var and the count only — never the value, never a prefix
 * longer than `whsec_`.
 */
const normaliseSecret = (name: string, raw: string): string => {
  let start = 0;
  let end = raw.length;
  while (start < end && !SECRET_LEADING.test(raw[start])) start += 1;
  while (end > start && !SECRET_TRAILING.test(raw[end - 1])) end -= 1;
  const value = raw.slice(start, end);
  const removed = raw.length - value.length;
  if (removed > 0 && !trimmedAlreadyLogged.has(name)) {
    trimmedAlreadyLogged.add(name);
    console.warn(
      `[convocate] stripe webhook: trimmed ${String(removed)} stray character(s) from ${name}`,
    );
  }
  if (value && !value.startsWith("whsec_") && !trimmedAlreadyLogged.has(`${name}:shape`)) {
    trimmedAlreadyLogged.add(`${name}:shape`);
    console.warn(`[convocate] stripe webhook: ${name} does not start with whsec_ — check it`);
  }
  return value;
};

/**
 * The signing secrets this process will accept, read at call time.
 *
 * Both are optional and both are honoured at once, so the same build serves the
 * live endpoint and a test-mode endpoint without a code change. Each value has
 * its stray end characters stripped (see `normaliseSecret`); the values are never
 * logged, never returned and never put in an error message — only a count of what
 * was trimmed, once per process.
 */
export const webhookSecrets = (): WebhookSecret[] => {
  const live = normaliseSecret("STRIPE_WEBHOOK_SECRET", process.env.STRIPE_WEBHOOK_SECRET ?? "");
  const test = normaliseSecret(
    "STRIPE_WEBHOOK_SECRET_TEST",
    process.env.STRIPE_WEBHOOK_SECRET_TEST ?? "",
  );
  const secrets: WebhookSecret[] = [];
  if (live) secrets.push({ label: "live", value: live });
  if (test) secrets.push({ label: "test", value: test });
  return secrets;
};

/* ------------------------------------------------------------- the signature */

export type SignatureVerdict =
  | { ok: true; label: "live" | "test" }
  | { ok: false; reason: "no_secret" | "no_header" | "malformed" | "stale" | "mismatch" };

type ParsedHeader = { timestamp: number; signatures: string[] };

/**
 * `t=1698000000,v1=ab12...,v1=cd34...` — Stripe's own header shape.
 *
 * Every `v1` is kept: during a secret rotation Stripe signs one delivery with
 * two secrets, and refusing the second would drop a real payment. A header with
 * no usable `t`, or no `v1` at all, is malformed and refused.
 */
const parseSignatureHeader = (header: string): ParsedHeader | null => {
  let timestamp = -1;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === "t") {
      if (/^\d{1,12}$/.test(value)) timestamp = Number(value);
    } else if (key === "v1") {
      if (/^[0-9a-fA-F]{64}$/.test(value)) signatures.push(value.toLowerCase());
    }
  }
  if (timestamp < 0 || signatures.length === 0) return null;
  return { timestamp, signatures };
};

/**
 * Verify one delivery against every configured secret.
 *
 * The comparison is `timingSafeEqual` on the raw HMAC bytes, and every secret and
 * every `v1` is tried even after one matches, so the time taken says nothing
 * about which part was wrong. The clock check is on `t` — a replayed capture of a
 * genuine delivery from an hour ago is refused, which is what stops a captured
 * body being re-sent by someone who never had the secret.
 */
export const verifyStripeSignature = (input: {
  rawBody: Uint8Array;
  header: string | null;
  nowMs: number;
  secrets?: WebhookSecret[];
}): SignatureVerdict => {
  const secrets = input.secrets ?? webhookSecrets();
  if (secrets.length === 0) return { ok: false, reason: "no_secret" };
  if (!input.header) return { ok: false, reason: "no_header" };
  const parsed = parseSignatureHeader(input.header);
  if (!parsed) return { ok: false, reason: "malformed" };

  const skew = Math.abs(Math.floor(input.nowMs / 1000) - parsed.timestamp);
  if (skew > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };

  const signed = Buffer.concat([
    Buffer.from(`${parsed.timestamp}.`, "utf8"),
    Buffer.from(input.rawBody),
  ]);
  let matched: "live" | "test" | null = null;
  for (const secret of secrets) {
    const expected = createHmac("sha256", secret.value).update(signed).digest();
    for (const signature of parsed.signatures) {
      const given = Buffer.from(signature, "hex");
      if (given.length === expected.length && timingSafeEqual(given, expected)) {
        matched = secret.label;
      }
    }
  }
  return matched ? { ok: true, label: matched } : { ok: false, reason: "mismatch" };
};

/* ---------------------------------------------------------------- the answer */

export type WebhookAnswer = {
  status: number;
  body: Record<string, unknown>;
};

const answer = (status: number, body: Record<string, unknown>): WebhookAnswer => ({
  status,
  body,
});

/* ------------------------------------------------------------ event handling */

/** The bits of a Checkout Session this module acts on. All optional: Stripe's body is not ours. */
type SessionShape = {
  id: string;
  paymentStatus: string;
  amountCents: number;
  currency: string;
  paymentIntentId: string;
  attendeeId: number;
  conferenceId: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const positiveInt = (value: unknown): number => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

const readSession = (object: Record<string, unknown>): SessionShape => {
  const metadata = asRecord(object.metadata) ?? {};
  const intent = object.payment_intent;
  const intentId =
    typeof intent === "string"
      ? intent
      : typeof asRecord(intent)?.id === "string"
        ? String(asRecord(intent)?.id)
        : "";
  const currency = typeof object.currency === "string" ? object.currency.trim().toLowerCase() : "";
  return {
    id: typeof object.id === "string" ? object.id : "",
    paymentStatus: typeof object.payment_status === "string" ? object.payment_status : "",
    amountCents: Number(object.amount_total ?? 0),
    currency: /^[a-z]{3}$/.test(currency) ? currency : "usd",
    paymentIntentId: intentId,
    attendeeId: positiveInt(metadata.convocate_attendee_id),
    conferenceId: positiveInt(metadata.convocate_conference_id),
  };
};

/** A session id looks like `cs_test_...` / `cs_live_...`; an event id like `evt_...`. */
const isSessionId = (value: string): boolean => /^cs_[A-Za-z0-9_]{8,200}$/.test(value);
const isEventId = (value: string): boolean => /^evt_[A-Za-z0-9_]{4,200}$/.test(value);
const isAccountId = (value: string): boolean => /^acct_[A-Za-z0-9]+$/.test(value);

/**
 * The whole of the endpoint, in one place.
 *
 * Returns the status and body to answer Stripe with; it never throws, because a
 * thrown error would be answered by the framework with a status nobody chose.
 * Genuine breakage is answered 500 *on purpose* so Stripe redelivers.
 */
export const handleStripeWebhookRequest = async (
  request: Request,
  nowMs: number = Date.now(),
): Promise<WebhookAnswer> => {
  /* 1. Size. Refused before the body is buffered. */
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) {
    console.error(`[convocate] stripe webhook refused: body over ${String(MAX_WEBHOOK_BYTES)} bytes`);
    return answer(400, { received: false, error: "body_too_large" });
  }

  let rawBody: Uint8Array;
  try {
    rawBody = new Uint8Array(await request.arrayBuffer());
  } catch {
    console.error("[convocate] stripe webhook refused: body could not be read");
    return answer(400, { received: false, error: "body_unreadable" });
  }
  if (rawBody.length === 0 || rawBody.length > MAX_WEBHOOK_BYTES) {
    console.error("[convocate] stripe webhook refused: empty or oversized body");
    return answer(400, { received: false, error: "body_unusable" });
  }

  /* 2. The signature, over those exact bytes. Nothing is written until it passes. */
  const verdict = verifyStripeSignature({
    rawBody,
    header: request.headers.get("stripe-signature"),
    nowMs,
  });
  if (!verdict.ok) {
    // The reason, never the header, the secret or the body: a bad signature is
    // somebody else's payload and has no business in our log.
    console.error(`[convocate] stripe webhook refused: ${verdict.reason}`);
    return answer(400, { received: false, error: verdict.reason });
  }

  /* 3. A signed body that is not JSON is not something to act on. */
  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(rawBody).toString("utf8"));
    const record = asRecord(parsed);
    if (!record) throw new Error("not an object");
    event = record;
  } catch {
    console.error("[convocate] stripe webhook refused: signed body was not a JSON object");
    return answer(400, { received: false, error: "not_json" });
  }

  const eventId = typeof event.id === "string" ? event.id : "";
  const eventType = typeof event.type === "string" ? event.type : "";
  const accountId = typeof event.account === "string" ? event.account : "";
  if (!isEventId(eventId)) {
    console.error("[convocate] stripe webhook refused: event has no usable id");
    return answer(400, { received: false, error: "no_event_id" });
  }

  const session = readSession(asRecord(asRecord(event.data)?.object) ?? {});

  /* 4. Claim the event id. A redelivery of something already settled is a no-op. */
  let claim: { isNew: boolean; receipt: { outcome: StripeWebhookOutcome; note: string } };
  try {
    claim = await claimStripeWebhookEvent({
      eventId,
      eventType,
      accountId,
      sessionId: session.id,
      receivedAt: nowMs,
    });
  } catch (cause) {
    // The database could not be reached: this is exactly the case Stripe's retry
    // is for, so say 500 and let it come back.
    console.error(`[convocate] stripe webhook ${eventId}: could not record the event`, cause);
    return answer(500, { received: false, error: "database_unavailable" });
  }
  if (!claim.isNew && claim.receipt.outcome !== "received") {
    console.log(
      `[convocate] stripe webhook ${eventId}: duplicate delivery of an event already ${claim.receipt.outcome} — nothing changed`,
    );
    return answer(200, { received: true, outcome: "duplicate", settled: claim.receipt.outcome });
  }

  /** Settle the receipt and answer, in one step, so no path forgets to write it down. */
  const settle = async (
    status: number,
    outcome: StripeWebhookOutcome,
    note: string,
    body: Record<string, unknown> = {},
  ): Promise<WebhookAnswer> => {
    try {
      await settleStripeWebhookEvent({ eventId, outcome, note, settledAt: nowMs });
    } catch (cause) {
      // The receipt is a record, not the payment: the row is already right (or
      // already wrong in a way we cannot fix here). Answer as we would have.
      console.error(`[convocate] stripe webhook ${eventId}: could not settle the receipt`, cause);
    }
    return answer(status, { received: true, outcome, ...body });
  };

  /* 5. Not an event we act on. Answered 200 so Stripe stops sending it. */
  if (!(HANDLED_EVENT_TYPES as readonly string[]).includes(eventType)) {
    console.log(`[convocate] stripe webhook ${eventId}: type ${eventType || "(none)"} ignored`);
    return settle(200, "ignored", `type ${eventType || "(none)"} is not handled`);
  }

  /* 6. All Convocate money is on the organizer's own account: no account, no action. */
  if (!isAccountId(accountId)) {
    console.log(
      `[convocate] stripe webhook ${eventId}: ${eventType} with no connected account — ignored`,
    );
    return settle(200, "ignored", "no connected account on the event");
  }

  /* 7. The money has to have actually arrived. */
  if (session.paymentStatus !== "paid") {
    console.log(
      `[convocate] stripe webhook ${eventId}: session ${session.id || "(none)"} is ${session.paymentStatus || "(no status)"}, not paid — nothing changed`,
    );
    return settle(
      200,
      "ignored",
      `payment_status ${session.paymentStatus || "(none)"}`,
    );
  }
  if (!isSessionId(session.id)) {
    console.error(`[convocate] stripe webhook ${eventId}: paid session with no usable id`);
    return settle(200, "unmatched", "paid event without a usable session id");
  }
  if (!Number.isInteger(session.amountCents) || session.amountCents <= 0) {
    console.log(
      `[convocate] stripe webhook ${eventId}: session ${session.id} is paid but names no amount — nothing changed`,
    );
    return settle(200, "unmatched", "paid session with no amount");
  }

  /* 8. Which registration is this? The stored session id first, then Stripe's metadata. */
  let found: Awaited<ReturnType<typeof findAttendeeForStripePayment>>;
  try {
    found = await findAttendeeForStripePayment({
      sessionId: session.id,
      attendeeId: session.attendeeId,
    });
  } catch (cause) {
    console.error(`[convocate] stripe webhook ${eventId}: could not look the registration up`, cause);
    return answer(500, { received: false, error: "database_unavailable" });
  }
  if (!found) {
    console.log(
      `[convocate] stripe webhook ${eventId}: session ${session.id} matches no registration — nothing changed`,
    );
    return settle(200, "unmatched", `no registration for session ${session.id}`);
  }

  const attendee = found.attendee;
  // The session's metadata names a conference; when it does, it must be the one
  // the row belongs to. A mismatch means these two things are not the same sale.
  if (session.conferenceId && session.conferenceId !== attendee.conferenceId) {
    console.log(
      `[convocate] stripe webhook ${eventId}: session ${session.id} names event ${String(session.conferenceId)} but registration ${String(attendee.attendeeId)} belongs to event ${String(attendee.conferenceId)} — nothing changed`,
    );
    return settle(200, "unmatched", "session and registration name different events");
  }
  if (attendee.paymentStatus === "paid" || attendee.paymentStatus === "paid_by_hand") {
    console.log(
      `[convocate] stripe webhook ${eventId}: registration ${String(attendee.attendeeId)} was already ${attendee.paymentStatus} — nothing changed`,
    );
    return settle(200, "already_paid", `registration already ${attendee.paymentStatus}`);
  }
  if (attendee.paymentStatus === "refunded") {
    console.log(
      `[convocate] stripe webhook ${eventId}: registration ${String(attendee.attendeeId)} was refunded — left alone`,
    );
    return settle(200, "ignored", "registration was refunded");
  }

  /* 9. Mark it paid, on Stripe's word, once. */
  try {
    const changed = await markAttendeePaidFromStripe({
      attendeeId: attendee.attendeeId,
      conferenceId: attendee.conferenceId,
      sessionId: session.id,
      paymentIntentId: session.paymentIntentId,
      amountCents: session.amountCents,
      currency: session.currency,
      paidAt: nowMs,
      // Reached through Stripe's metadata because the row holds a *different*
      // session: the attendee paid an older tab after the organizer pressed
      // "try again". The session the money came from becomes the one on the row.
      allowOtherSession: found.matchedBy === "attendee" && attendee.sessionId !== session.id,
    });
    if (!changed) {
      // The row moved under us between the read and the write (paid by hand, a
      // refund, a second delivery). Whatever it says now is the truth.
      console.log(
        `[convocate] stripe webhook ${eventId}: registration ${String(attendee.attendeeId)} did not change — it was already settled`,
      );
      return settle(200, "already_paid", "registration did not need changing");
    }
  } catch (cause) {
    // The write failed. Do NOT settle the receipt: the next delivery must retry.
    console.error(`[convocate] stripe webhook ${eventId}: could not mark the registration paid`, cause);
    return answer(500, { received: false, error: "database_unavailable" });
  }

  console.log(
    `[convocate] stripe webhook ${eventId}: registration ${String(attendee.attendeeId)} on event ${String(attendee.conferenceId)} marked paid, ${String(session.amountCents)} ${session.currency} (via ${found.matchedBy})`,
  );
  return settle(200, "applied", `marked registration ${String(attendee.attendeeId)} paid`, {
    attendeeId: attendee.attendeeId,
  });
};
