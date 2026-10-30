/**
 * The password-reset message — the one email that lets a locked-out organizer
 * back into their own workspace.
 *
 * It follows the rules the registration confirmation set:
 *
 *  1. **It never changes what the request did.** The row is written before this
 *     is called, and this returns a status instead of throwing. A mail failure
 *     means no email, never a broken request page and never a half-finished
 *     reset.
 *
 *  2. **It states what it knows and nothing else.** It does not say "your
 *     account was found", it does not name an organization, and it does not
 *     promise anything about a link that has not been used. It says what the
 *     link does, how long it lasts, and what to do if the message was not
 *     expected.
 *
 * The link is built from the site's own address (passed in by the caller, which
 * decides it from the request and an allowlist of our own hosts) so it opens on
 * the domain the organizer uses. The recipient address is written to `email_log`
 * and nowhere else — a log line names the domain only.
 */
import { recordEmailLog } from "./db.server";
import { sendMail } from "./mail.server";

/** How the send ended up. The page never shows this — it is for the log. */
export type ResetEmailStatus = "sent" | "failed" | "skipped";

export type PasswordResetEmailInput = {
  /** Where the message goes. */
  email: string;
  /** The name the account was created with, for the greeting. May be empty. */
  name: string;
  /** The full link, token included. The token is not logged and not stored. */
  link: string;
  /** How long the link lasts, in minutes, as the message states it. */
  minutes: number;
};

/**
 * The plain-text body. Built line by line, in American English, with no
 * church-specific wording: this message goes to conference and event
 * organizers of every kind.
 */
const buildText = (input: PasswordResetEmailInput): string => {
  const greeting = input.name.trim() ? `Hello ${input.name.trim()},` : "Hello,";
  return [
    greeting,
    "",
    "Someone asked to reset the password for the Convocate account that uses this email address.",
    "",
    "Open this link to choose a new password:",
    input.link,
    "",
    `The link works once, and it expires in ${String(input.minutes)} minutes.`,
    "",
    "If you did not ask for this, you can ignore this message. Your password has not been",
    "changed, and the link will stop working on its own.",
    "",
    "Sent by Convocate. https://www.getconvocate.com",
  ].join("\n");
};

/**
 * Send the reset link.
 *
 * Returns what happened and never throws: the caller has already written the
 * reset row and always answers the same thing, whatever this returns.
 */
export const sendPasswordResetEmail = async (
  input: PasswordResetEmailInput,
): Promise<ResetEmailStatus> => {
  const recipient = String(input.email ?? "").trim();
  if (!recipient) return "skipped";

  try {
    const result = await sendMail({
      to: recipient,
      subject: "Reset your Convocate password",
      text: buildText(input),
    });
    await recordEmailLog({
      kind: "password_reset",
      recipientEmail: recipient,
      eventId: null,
      resendId: result.ok ? result.id : null,
      status: result.ok ? "sent" : result.skipped ? "skipped" : "failed",
      error: result.ok ? null : result.error,
    });
    if (result.ok) return "sent";
    return result.skipped ? "skipped" : "failed";
  } catch (cause) {
    const error = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
    console.error(`[convocate] ERROR: the password reset email failed unexpectedly — ${error}`);
    await recordEmailLog({
      kind: "password_reset",
      recipientEmail: recipient,
      eventId: null,
      resendId: null,
      status: "failed",
      error,
    });
    return "failed";
  }
};
