/**
 * The Messenger webhook — **server only**.
 *
 * Why this exists: someone DMs the Convocate Facebook Page, and Meta tells us.
 * Without a listening endpoint the message sits in Meta's inbox, invisible to
 * every other part of this business. With one, it becomes a row we can answer.
 * Same job as `stripe-webhook.server.ts`, same three habits:
 *
 *  1. **The signature is over the raw bytes.** `X-Hub-Signature-256` is
 *     `sha256=` + hex HMAC-SHA256 of the *exact* request body, keyed with
 *     `META_APP_SECRET`. The body is read as bytes and hashed as bytes — never
 *     re-serialised from a parsed object, which would not be the same bytes.
 *     The comparison is constant-time. A body that fails changes no row at all.
 *  2. **No secret configured means no input is accepted.** Not "accept and
 *     warn": refuse, answer 403, say so in the log. A half-configured deploy
 *     must fail closed, because an unsigned body is proof of nothing.
 *  3. **Idempotent by Meta's own id.** Meta redelivers anything it did not see
 *     answered. `mid` is UNIQUE in `messenger_messages`, and a repeat is a
 *     no-op that still answers 200 — otherwise one DM becomes two rows and gets
 *     two replies.
 *
 * What is deliberately dropped, and counted so the response says so: `delivery`
 * and `read` receipts (not messages), `message.is_echo` (our own outgoing
 * messages — storing them would make the Page answer itself), and `postback`
 * (a button tap, not a message). None of them is a person asking for an answer.
 *
 * Status codes are messages to Meta, not to a reader:
 *   - **200** — dealt with, or nothing here is ours. Meta stops.
 *   - **400** — this body is not something we can read. Nothing written.
 *   - **403** — the verification token or the signature is wrong. Nothing
 *     written. Meta treats this as a misconfiguration, not a retry.
 *   - **500** — we could not store it. Please send it again.
 *
 * Secrets: `META_WEBHOOK_VERIFY_TOKEN` and `META_APP_SECRET` are read from the
 * environment **at call time** (never at module load), are never returned, never
 * logged, and never put in an error message. Only a reason word is logged.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { recordMessengerMessage } from "./db.server";

/** A Messenger delivery is a few KB. Anything past this is not one we want. */
export const MAX_MESSENGER_BYTES = 256 * 1024;

/** The header Meta signs with. */
export const SIGNATURE_HEADER = "x-hub-signature-256";

/* --------------------------------------------------------------- the secrets */

const envText = (name: string): string => {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
};

/** The token the GET handshake must be given. Empty means "not configured". */
export const webhookVerifyToken = (): string => envText("META_WEBHOOK_VERIFY_TOKEN");

/**
 * The app secret the POST signature is keyed with.
 *
 * A Meta app secret is hex. A value pasted into Settings can pick up a stray
 * character that is invisible to the eye and fatal to the HMAC — the live Stripe
 * secret arrived with a trailing `(` — so a value whose *ends* are not hex is
 * trimmed to its hex core, and only when that core is a plausible secret length
 * (32 or 64 characters). Anything else is used as it was saved, untouched: a
 * genuinely wrong secret must still fail, loudly and honestly, rather than be
 * "repaired" into something that matches nothing.
 */
export const appSecret = (): string => {
  const raw = envText("META_APP_SECRET");
  if (raw === "") return "";
  const core = raw.replace(/^[^0-9a-fA-F]+/, "").replace(/[^0-9a-fA-F]+$/, "");
  if (core !== raw && /^[0-9a-fA-F]{32}$|^[0-9a-fA-F]{64}$/.test(core)) {
    if (!trimmedSecretLogged) {
      trimmedSecretLogged = true;
      console.warn("[convocate] messenger webhook: trimmed stray characters from META_APP_SECRET");
    }
    return core;
  }
  return raw;
};
let trimmedSecretLogged = false;

/**
 * Constant-time equality for two strings of any length.
 *
 * Both sides are hashed first, so the comparison is over 32 bytes whatever the
 * inputs are: neither the length nor the position of the first difference can be
 * read off the time taken. `timingSafeEqual` itself throws on unequal lengths,
 * which is exactly the leak this avoids.
 */
export const secretMatches = (given: string, expected: string): boolean => {
  if (expected === "") return false;
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
};

/* ------------------------------------------------------------- the signature */

export type SignatureVerdict =
  | { ok: true }
  | { ok: false; reason: "no_secret" | "no_header" | "malformed" | "mismatch" };

/**
 * `sha256=ab12…` — Meta's own header shape.
 *
 * The digest is 64 hex characters and nothing else: a header with no `sha256=`
 * prefix, the wrong algorithm, or a digest that is not 64 hex characters is
 * malformed, not "almost right". Some Meta versions send the hex in either case,
 * so both are accepted.
 */
const parseSignatureHeader = (header: string): string | null => {
  const at = header.indexOf("=");
  if (at <= 0) return null;
  const algorithm = header.slice(0, at).trim().toLowerCase();
  const digest = header.slice(at + 1).trim();
  if (algorithm !== "sha256") return null;
  if (!/^[0-9a-fA-F]{64}$/.test(digest)) return null;
  return digest.toLowerCase();
};

/**
 * Verify one delivery.
 *
 * No clock check, because Meta's header carries no timestamp — unlike Stripe's.
 * What stops a captured body being replayed by someone who never had the secret
 * is that a capture is only useful while it is fresh, and the row it would write
 * is already there: `mid` is unique, so a replay stores nothing and answers 200.
 */
export const verifyMessengerSignature = (input: {
  rawBody: Uint8Array;
  header: string | null;
  secret?: string;
}): SignatureVerdict => {
  const secret = input.secret ?? appSecret();
  if (secret === "") return { ok: false, reason: "no_secret" };
  if (!input.header) return { ok: false, reason: "no_header" };
  const given = parseSignatureHeader(input.header);
  if (!given) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", secret).update(input.rawBody).digest("hex");
  return secretMatches(given, expected) ? { ok: true } : { ok: false, reason: "mismatch" };
};

/* ---------------------------------------------------------------- the answer */

export type MessengerAnswer = {
  status: number;
  /** `text/plain` for the handshake, `application/json` for everything else. */
  contentType: "text/plain; charset=utf-8" | "application/json";
  body: string;
};

const text = (status: number, body: string): MessengerAnswer => ({
  status,
  contentType: "text/plain; charset=utf-8",
  body,
});

const json = (status: number, body: Record<string, unknown>): MessengerAnswer => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/* ------------------------------------------------------- the GET handshake */

/**
 * Meta's verification handshake, once, when a person presses "Verify and save".
 *
 * Three conditions, all required: `hub.mode` is `subscribe`, `hub.verify_token`
 * equals `META_WEBHOOK_VERIFY_TOKEN` in constant time, and there is a
 * `hub.challenge` to echo. The challenge goes back **raw** — `text/plain`, no
 * JSON wrapper and no trailing newline — because Meta compares the body it gets
 * with the string it sent, byte for byte.
 *
 * A wrong token, a wrong mode, or an unconfigured endpoint is 403 and nothing
 * else: Meta's panel then says verification failed, which is the truth.
 */
export const handleMessengerVerification = (request: Request): MessengerAnswer => {
  const params = new URL(request.url).searchParams;
  const mode = params.get("hub.mode") ?? "";
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge") ?? "";
  const expected = webhookVerifyToken();

  if (expected === "") {
    console.error(
      "[convocate] messenger handshake refused: META_WEBHOOK_VERIFY_TOKEN is not set",
    );
    return json(403, { ok: false, error: "not_configured" });
  }
  if (mode !== "subscribe") {
    console.warn(`[convocate] messenger handshake refused: hub.mode was ${mode || "(none)"}`);
    return json(403, { ok: false, error: "bad_mode" });
  }
  if (!secretMatches(token, expected)) {
    // The token is never logged — not even a prefix, not even its length.
    console.warn("[convocate] messenger handshake refused: verify token did not match");
    return json(403, { ok: false, error: "bad_token" });
  }
  if (challenge === "") {
    console.warn("[convocate] messenger handshake refused: no hub.challenge to echo");
    return json(403, { ok: false, error: "no_challenge" });
  }
  console.log("[convocate] messenger handshake accepted: verify token matched");
  return text(200, challenge);
};

/* ----------------------------------------------------------- the delivery */

/** What one `entry[].messaging[]` item turned out to be. */
type Classified =
  | {
      kind: "message";
      mid: string;
      senderId: string;
      recipientId: string;
      sentAt: number;
      messageText: string;
      attachmentCount: number;
    }
  | { kind: "skip"; reason: "echo" | "read" | "delivery" | "postback" | "unknown" | "unusable" };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const idText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() : "";

/**
 * Read one messaging item.
 *
 * The order of the checks is the order Meta's own documentation implies: a
 * receipt is a receipt whatever else it carries, an echo is our own outgoing
 * message, a postback is a button, and only what is left is a person's message.
 */
export const classifyMessagingItem = (
  item: Record<string, unknown>,
  nowMs: number,
): Classified => {
  if (item.delivery !== undefined) return { kind: "skip", reason: "delivery" };
  if (item.read !== undefined) return { kind: "skip", reason: "read" };
  if (item.postback !== undefined) return { kind: "skip", reason: "postback" };
  const message = asRecord(item.message);
  if (!message) return { kind: "skip", reason: "unknown" };
  if (message.is_echo === true) return { kind: "skip", reason: "echo" };
  const mid = idText(message.mid);
  const senderId = idText(asRecord(item.sender)?.id);
  const recipientId = idText(asRecord(item.recipient)?.id);
  if (mid === "" || senderId === "" || recipientId === "") {
    return { kind: "skip", reason: "unusable" };
  }
  const stamp = Number(item.timestamp ?? message.timestamp ?? 0);
  const attachments = Array.isArray(message.attachments) ? message.attachments.length : 0;
  return {
    kind: "message",
    mid,
    senderId,
    recipientId,
    sentAt: Number.isFinite(stamp) && stamp > 0 ? Math.trunc(stamp) : nowMs,
    messageText: typeof message.text === "string" ? message.text : "",
    attachmentCount: attachments,
  };
};

export type DeliveryTally = {
  stored: number;
  duplicates: number;
  skipped: number;
  skippedBy: Record<string, number>;
};

/**
 * The whole of `POST /api/meta/messenger`, in one place.
 *
 * Returns the status and body to answer Meta with; it never throws, because a
 * thrown error would be answered by the framework with a status nobody chose.
 * Genuine breakage is answered 500 *on purpose* so Meta redelivers.
 */
export const handleMessengerDelivery = async (
  request: Request,
  nowMs: number = Date.now(),
): Promise<MessengerAnswer> => {
  /* 1. Size. Refused before the body is buffered. */
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_MESSENGER_BYTES) {
    console.error(
      `[convocate] messenger webhook refused: body over ${String(MAX_MESSENGER_BYTES)} bytes`,
    );
    return json(400, { received: false, error: "body_too_large" });
  }

  let rawBody: Uint8Array;
  try {
    rawBody = new Uint8Array(await request.arrayBuffer());
  } catch {
    console.error("[convocate] messenger webhook refused: body could not be read");
    return json(400, { received: false, error: "body_unreadable" });
  }
  if (rawBody.length === 0 || rawBody.length > MAX_MESSENGER_BYTES) {
    console.error("[convocate] messenger webhook refused: empty or oversized body");
    return json(400, { received: false, error: "body_unusable" });
  }

  /* 2. The signature, over those exact bytes. Nothing is written until it passes. */
  const verdict = verifyMessengerSignature({
    rawBody,
    header: request.headers.get(SIGNATURE_HEADER),
  });
  if (!verdict.ok) {
    // The reason, never the header, the secret or the body: an unsigned payload
    // is somebody else's traffic and has no business in our log.
    console.error(`[convocate] messenger webhook refused: ${verdict.reason}`);
    return json(403, { received: false, error: verdict.reason });
  }

  /* 3. A signed body that is not a JSON object is not something to act on. */
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(rawBody).toString("utf8"));
    const record = asRecord(parsed);
    if (!record) throw new Error("not an object");
    payload = record;
  } catch {
    console.error("[convocate] messenger webhook refused: signed body was not a JSON object");
    return json(400, { received: false, error: "not_json" });
  }

  /* 4. A page webhook that is not about this Page is answered and dropped. */
  if (payload.object !== "page") {
    console.log(
      `[convocate] messenger webhook: object ${idText(payload.object) || "(none)"} ignored`,
    );
    return json(200, { received: true, stored: 0, ignored: "not_a_page_payload" });
  }
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  if (entries.length === 0) {
    return json(200, { received: true, stored: 0, ignored: "no_entry" });
  }

  const tally: DeliveryTally = { stored: 0, duplicates: 0, skipped: 0, skippedBy: {} };
  for (const entry of entries) {
    const messaging = Array.isArray(asRecord(entry)?.messaging)
      ? ((asRecord(entry)?.messaging as unknown[]) ?? [])
      : [];
    for (const raw of messaging) {
      const item = asRecord(raw);
      const classified: Classified = item
        ? classifyMessagingItem(item, nowMs)
        : { kind: "skip", reason: "unknown" };
      if (classified.kind === "skip") {
        tally.skipped += 1;
        tally.skippedBy[classified.reason] = (tally.skippedBy[classified.reason] ?? 0) + 1;
        continue;
      }
      let written: { inserted: boolean; id: number };
      try {
        written = await recordMessengerMessage({
          mid: classified.mid,
          senderId: classified.senderId,
          recipientId: classified.recipientId,
          sentAt: classified.sentAt,
          text: classified.messageText,
          attachmentCount: classified.attachmentCount,
          receivedAt: nowMs,
        });
      } catch (cause) {
        // The database could not be reached: exactly the case Meta's retry is
        // for, so say 500 and let it come back.
        console.error("[convocate] messenger webhook: could not store a message", cause);
        return json(500, { received: false, error: "database_unavailable", ...tally });
      }
      if (!written.inserted) {
        tally.duplicates += 1;
        continue;
      }
      tally.stored += 1;
      // The mid is Meta's own id for a message; the body is a person's private
      // words and is never logged.
      console.log(
        `[convocate] messenger webhook: stored mid=${classified.mid} from=${classified.senderId} attachments=${String(classified.attachmentCount)}`,
      );
    }
  }

  /*
   * 5. Answering is NOT done here any more.
   *
   * It used to be an optional branch of this handler, switched by
   * `MESSENGER_AUTO_REPLY` and off in practice — which is why a real DM sat
   * unanswered for 72 minutes on 2026-10-23. Answering now belongs to one
   * place: the watcher (`messenger-watcher.server.ts`), run every minute by
   * `/etc/cron.d/convocate-messenger` through `POST /api/meta/messenger-watcher`.
   *
   * One answering path and not two, on purpose. The watcher owns the 24-hour
   * window check, the three-in-a-row guard, the claim that stops a double send
   * and the `needs_human` flag; a second path here would have to repeat all
   * four, and the two would disagree the first time one of them changed.
   *
   * The webhook's job is to store the message and answer Meta fast. Storing is
   * what makes it answerable within the minute.
   */
  return json(200, { received: true, ...tally });
};

/* -------------------------------------------------------------- the endpoint */

/**
 * Both halves of the endpoint, in one call: GET is Meta's handshake, POST is a
 * delivery. Anything else is 405 — Meta sends neither, and answering a PUT with
 * anything but a refusal would be inventing behaviour.
 */
export const handleMessengerRequest = async (
  request: Request,
  nowMs: number = Date.now(),
): Promise<MessengerAnswer> => {
  if (request.method === "GET") return handleMessengerVerification(request);
  if (request.method === "POST") return handleMessengerDelivery(request, nowMs);
  return json(405, { ok: false, error: "method_not_allowed" });
};
