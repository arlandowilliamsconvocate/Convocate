/**
 * The registration confirmation — the first message Convocate sends, and the
 * template every later one should follow.
 *
 * Two rules shape everything here:
 *
 *  1. **It never changes what the registration did.** It is called after the
 *     registration transaction has already committed, it returns a status instead
 *     of throwing, and every outcome — even a database that refuses to take the
 *     log row — leaves the attendee registered. The worst case is a registration
 *     with no email, which is exactly what the product did before this existed.
 *
 *  2. **It states plainly what it knows, and nothing else.** The event name, the
 *     dates and the venue come from what the organizer entered; a field the
 *     organizer left empty is left out of the message entirely rather than
 *     printed as a blank or filled in with a guess. It never says a payment was
 *     received, because none was: no card is charged on the registration page.
 *
 * The full recipient address is written to `email_log` and nowhere else — the
 * log line says the domain only.
 */
import { formatDateRange, formatMoney } from "../lib/money";
import { recordEmailLog } from "./db.server";
import { sendMail } from "./mail.server";

/** How the confirmation ended up, as the confirmation page tells the attendee. */
export type ConfirmationStatus = "sent" | "failed" | "skipped" | "no_address";

export type RegistrationConfirmationInput = {
  event: {
    id: number;
    name: string;
    startDate: string;
    endDate: string;
    venue: string;
  };
  registration: {
    name: string;
    email: string;
    ticketName: string;
    quantity: number;
    amountDueCents: number;
  };
  /**
   * Whether the fee is being paid by card on this event's own Stripe page. It
   * changes ONE sentence: a message must never say "no payment was taken" to
   * someone who is about to be taken to a card page.
   */
  cardPayment?: boolean;
};

/** The plain-text body. Built line by line so a missing field simply is not there. */
const buildText = (input: RegistrationConfirmationInput): string => {
  const { event, registration } = input;
  const eventName = event.name.trim() || "the event";
  const when = formatDateRange(event.startDate, event.endDate);
  const venue = event.venue.trim();

  const lines: string[] = [];
  lines.push(`Hello ${registration.name.trim() || "there"},`);
  lines.push("");
  lines.push(`Your registration for ${eventName} has been recorded. This is your confirmation.`);
  lines.push("");
  lines.push(`Event: ${eventName}`);
  // "Dates not set" is what formatDateRange says when the organizer entered
  // neither date — that is a fact about the event worth passing on, and it is not
  // an invented detail.
  lines.push(`When: ${when}`);
  if (venue) lines.push(`Venue: ${venue}`);
  lines.push(`Registration option: ${registration.ticketName}`);
  lines.push(`Places: ${String(registration.quantity)}`);
  if (registration.amountDueCents > 0) {
    lines.push(`Amount due to the organizer: ${formatMoney(registration.amountDueCents)}`);
  }
  lines.push("");
  lines.push(
    input.cardPayment
      ? "Your fee is paid by card on a secure Stripe page. The organizer receives the whole " +
          "fee — Convocate takes no share of it."
      : "This is a confirmation only. No card was charged and no payment was taken online. " +
          "Any fee is handled by the organizer, who will contact you about payment.",
  );
  lines.push("");
  lines.push("If anything above is wrong, contact the organizer — whoever sent you the registration link.");
  lines.push("");
  lines.push(`Sent by Convocate for ${eventName}.`);
  return lines.join("\n");
};

/** Minimal escaping for the HTML alternative, which carries the same words. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** The same message as a short HTML page, for clients that show the styled part. */
const buildHtml = (input: RegistrationConfirmationInput): string => {
  const { event, registration } = input;
  const eventName = event.name.trim() || "the event";
  const when = formatDateRange(event.startDate, event.endDate);
  const venue = event.venue.trim();

  const rows: string[] = [];
  rows.push(`<p style="margin:0 0 12px;color:#1f2937;font-size:15px;line-height:1.6">Hello ${escapeHtml(registration.name.trim() || "there")},</p>`);
  rows.push(
    `<p style="margin:0 0 16px;color:#1f2937;font-size:15px;line-height:1.6">Your registration for <strong>${escapeHtml(eventName)}</strong> has been recorded. This is your confirmation.</p>`,
  );
  const detail: string[] = [
    `<strong>Event:</strong> ${escapeHtml(eventName)}`,
    `<strong>When:</strong> ${escapeHtml(when)}`,
  ];
  if (venue) detail.push(`<strong>Venue:</strong> ${escapeHtml(venue)}`);
  detail.push(`<strong>Registration option:</strong> ${escapeHtml(registration.ticketName)}`);
  detail.push(`<strong>Places:</strong> ${escapeHtml(String(registration.quantity))}`);
  if (registration.amountDueCents > 0) {
    detail.push(`<strong>Amount due to the organizer:</strong> ${escapeHtml(formatMoney(registration.amountDueCents))}`);
  }
  rows.push(
    `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin:0 0 16px">${detail
      .map((line) => `<p style="margin:0 0 6px;color:#1f2937;font-size:14px;line-height:1.5">${line}</p>`)
      .join("")}</div>`,
  );
  rows.push(
    input.cardPayment
      ? `<p style="margin:0 0 16px;color:#1f2937;font-size:14px;line-height:1.6">Your fee is paid by card on a secure Stripe page. The organizer receives the whole fee &mdash; Convocate takes no share of it.</p>`
      : `<p style="margin:0 0 16px;color:#1f2937;font-size:14px;line-height:1.6">This is a confirmation only. No card was charged and no payment was taken online. Any fee is handled by the organizer, who will contact you about payment.</p>`,
  );
  rows.push(
    `<p style="margin:0 0 16px;color:#4b5563;font-size:13px;line-height:1.6">If anything above is wrong, contact the organizer — whoever sent you the registration link.</p>`,
  );
  rows.push(
    `<p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6">Sent by Convocate for ${escapeHtml(eventName)}.</p>`,
  );
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px">${rows.join("")}</div>`;
};

/**
 * Send the one confirmation a public registration earns.
 *
 * Returns what happened and never throws: the caller is a server function whose
 * primary job (recording the registration) has already finished, and the page
 * shows the attendee exactly what this returned.
 */
export const sendRegistrationConfirmation = async (
  input: RegistrationConfirmationInput,
): Promise<ConfirmationStatus> => {
  const recipient = String(input.registration.email ?? "").trim();
  const eventId = Number.isFinite(input.event.id) ? input.event.id : null;

  if (!recipient) {
    await recordEmailLog({
      kind: "registration_confirmation",
      recipientEmail: "",
      eventId,
      resendId: null,
      status: "skipped",
      error: "No email address was given on the registration.",
    });
    return "no_address";
  }

  try {
    const result = await sendMail({
      to: recipient,
      subject: `Registration confirmed — ${input.event.name.trim() || "your event"}`,
      text: buildText(input),
      html: buildHtml(input),
    });
    await recordEmailLog({
      kind: "registration_confirmation",
      recipientEmail: recipient,
      eventId,
      resendId: result.ok ? result.id : null,
      status: result.ok ? "sent" : result.skipped ? "skipped" : "failed",
      error: result.ok ? null : result.error,
    });
    if (result.ok) return "sent";
    return result.skipped ? "skipped" : "failed";
  } catch (cause) {
    // sendMail is written not to throw; this is the belt to that braces, because
    // nothing here may ever reach the attendee as a broken page.
    const error = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
    console.error(`[convocate] ERROR: the registration confirmation failed unexpectedly — ${error}`);
    await recordEmailLog({
      kind: "registration_confirmation",
      recipientEmail: recipient,
      eventId,
      resendId: null,
      status: "failed",
      error,
    });
    return "failed";
  }
};
