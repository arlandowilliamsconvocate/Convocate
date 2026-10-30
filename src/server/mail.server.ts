/**
 * Outbound mail — one function, one provider, no SDK.
 *
 * Convocate sends mail through Resend's HTTP API with `fetch`. There is no npm
 * client on purpose: the API is one POST, and a dependency that wraps one POST is
 * a dependency that can break the build for no benefit.
 *
 * What this module guarantees the caller
 * --------------------------------------
 *   - **It never throws.** Every failure — missing configuration, a network
 *     error, a provider refusal — comes back as a result object. Mail is never
 *     allowed to take a registration, a payment or a page down with it.
 *   - **A missing configuration is not an error.** If the provider key or the
 *     sender address is not in the environment, the send is *skipped*: one
 *     warning is logged for the whole process, and every later call is silent.
 *     A site with no mail set up behaves exactly as one whose mail is broken —
 *     the feature that triggered the message still works.
 *   - **No secrets in the log.** The API key is never printed, and an error
 *     string is scrubbed of it before it is logged or stored. Recipient addresses
 *     are logged by domain only (`example.org`), never in full — the full address
 *     belongs in the `email_log` row, in the database, where support can look it
 *     up, not in a log file anyone can read.
 *
 * Configuration, read at call time (never at import time, so a secret that is
 * added to a running process is picked up on the next message):
 *
 *   RESEND_API_KEY  the sending key (never leaves the server)
 *   MAIL_FROM       the From header, e.g. `Convocate <hello@getconvocate.com>`
 *   MAIL_REPLY_TO   the Reply-To header — where a reply should land
 *
 * This module deliberately imports nothing from the database or the app, so it
 * can be called from a one-line script to prove the configuration works without
 * booting the whole site (see `/home/team/shared/mail-smoke.sh`).
 */

/** Resend's one endpoint for sending. */
const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * How long a send may take before it is abandoned. A registration page that is
 * waiting on a confirmation email must not wait forever: the row is already
 * committed, and an answer of "sent" or "could not be sent" is what the attendee
 * is shown. Resend answers in well under a second when it is healthy.
 */
const SEND_TIMEOUT_MS = 8000;

/** The message, as the caller describes it. */
export type MailInput = {
  /** One address: `name@example.org` or `Name <name@example.org>`. */
  to: string;
  subject: string;
  /** The plain-text body. Always sent; this is the message that must arrive. */
  text: string;
  /** Optional HTML alternative. The provider delivers both, and the client picks. */
  html?: string;
};

/**
 * What a send did.
 *
 * `ok: false` with `skipped: true` means nothing was attempted because the site
 * has no mail configuration — a state the caller should treat as "no email was
 * sent", not as a fault to report to the person reading the page.
 */
export type MailResult = {
  ok: boolean;
  /** The provider's message id, when the send was accepted. */
  id: string | null;
  /** True when the configuration is missing, so no request was made at all. */
  skipped: boolean;
  /** Why it failed, already safe to store in the database and to log. */
  error: string | null;
};

/** One warning for the life of the process, however many messages are attempted. */
let warnedAboutConfiguration = false;

/** The environment, trimmed, with empty strings treated as absent. */
const envText = (name: string): string => {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
};

/** The bare domain of an address, for a log line that identifies nobody. */
const domainOf = (address: string): string => {
  const angle = /<([^>]+)>/.exec(address);
  const bare = (angle ? angle[1] : address).trim();
  const at = bare.lastIndexOf("@");
  return at === -1 || at === bare.length - 1 ? "(no domain)" : bare.slice(at + 1).toLowerCase();
};

/** A shape check only: the provider is the authority on whether an address exists. */
const looksLikeAddress = (address: string): boolean => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address.trim());

/** Strip the API key out of any text that came back from the provider. */
const scrub = (text: string, secret: string): string => {
  const cleaned = secret ? text.split(secret).join("[redacted]") : text;
  return cleaned.length > 500 ? `${cleaned.slice(0, 500)}…` : cleaned;
};

/** Is the site able to send at all? For diagnostics — reveals no values. */
export const mailConfigured = (): { configured: boolean; missing: string[] } => {
  const missing = (["RESEND_API_KEY", "MAIL_FROM", "MAIL_REPLY_TO"] as const).filter(
    (name) => envText(name) === "",
  );
  return { configured: missing.length === 0, missing: [...missing] };
};

/**
 * Send one message.
 *
 * Resolves with a result and never rejects. The caller is expected to look at
 * `ok` and carry on either way: nothing that matters may depend on this
 * succeeding.
 */
export const sendMail = async (input: MailInput): Promise<MailResult> => {
  const fail = (error: string, skipped = false): MailResult => ({
    ok: false,
    id: null,
    skipped,
    error,
  });

  const recipient = String(input.to ?? "").trim();
  const subject = String(input.subject ?? "").replace(/[\r\n]+/g, " ").trim();
  const text = String(input.text ?? "");

  if (!looksLikeAddress(recipient)) return fail("The recipient address is not a usable email address.");
  if (!subject) return fail("The message has no subject.");
  if (!text.trim()) return fail("The message has no body.");

  const apiKey = envText("RESEND_API_KEY");
  const from = envText("MAIL_FROM");
  const replyTo = envText("MAIL_REPLY_TO");

  if (!apiKey || !from || !replyTo) {
    if (!warnedAboutConfiguration) {
      warnedAboutConfiguration = true;
      const missing = (["RESEND_API_KEY", "MAIL_FROM", "MAIL_REPLY_TO"] as const).filter(
        (name) => !envText(name),
      );
      console.warn(
        `[convocate] mail: not configured — ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing, ` +
          `so no email will be sent from this process. Everything else keeps working; ` +
          `messages are recorded in email_log as 'skipped'. (This warning is logged once.)`,
      );
    }
    return fail("Mail is not configured on this server.", true);
  }

  const body: Record<string, unknown> = {
    from,
    to: [recipient],
    reply_to: replyTo,
    subject,
    text,
  };
  if (input.html && input.html.trim() !== "") body.html = input.html;

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    const raw = await response.text();
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    const record = (parsed ?? {}) as { id?: unknown; message?: unknown; name?: unknown };

    if (!response.ok) {
      const detail =
        typeof record.message === "string" && record.message.trim() !== ""
          ? record.message
          : raw.slice(0, 200) || `HTTP ${String(response.status)}`;
      const error = scrub(`Resend refused it (${String(response.status)}): ${detail}`, apiKey);
      console.error(`[convocate] mail: FAILED to ${domainOf(recipient)} — ${error}`);
      return fail(error);
    }

    const id = typeof record.id === "string" && record.id !== "" ? record.id : null;
    console.log(`[convocate] mail: sent ${id ?? "(no id returned)"} to ${domainOf(recipient)}`);
    return { ok: true, id, skipped: false, error: null };
  } catch (cause) {
    const reason =
      cause instanceof Error
        ? `${cause.name}: ${cause.message}${cause.name === "TimeoutError" ? ` (gave up after ${String(SEND_TIMEOUT_MS)}ms)` : ""}`
        : String(cause);
    const error = scrub(`The request did not complete — ${reason}`, apiKey);
    console.error(`[convocate] mail: FAILED to ${domainOf(recipient)} — ${error}`);
    return fail(error);
  }
};
