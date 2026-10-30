/**
 * Free-tier and payment copy, shared by the server's refusals and the upgrade
 * panel so the message an organizer sees on the page is the same message the server
 * sends when a request is refused.
 *
 * Kept free of any server import: the client bundle reads these strings too.
 * Tradition-neutral throughout — an organizer, a conference or event, a committee.
 */

/** The one price. Charged per conference, not per account or per month. */
export const UPGRADE_PRICE = "$199";

/** The same price in the smallest unit we charge in — what Stripe collects. */
export const UPGRADE_PRICE_CENTS = 19_900;

/**
 * Where an organizer pays for the unlock. One place to change it: the Stripe payment
 * link for the "Convocate — unlock one conference" price. Its after-completion
 * redirect points at /payment-complete.
 *
 * Nothing on this page takes a card itself; the link is Stripe's own hosted
 * page, and the conference only unlocks once the payment has been confirmed
 * against that link (see `confirmPaymentFn`).
 */
export const PAYMENT_LINK_URL = "https://buy.stripe.com/14A00jg9jdME2yY9g43cc00";

/**
 * The payment link with this conference attached, so the payment that comes
 * back can be matched to the conference it is for.
 */
export const paymentLinkFor = (conferenceId: number): string =>
  `${PAYMENT_LINK_URL}?client_reference_id=${encodeURIComponent(String(conferenceId))}`;

/**
 * How many budget lines a free (locked) conference may hold (owner decision,
 * 2026-10-21). One line is the concession: a director can see the planned and
 * committed arithmetic work on a number of their own before paying for more.
 * The server enforces this — see `addBudgetItemFn` — and every piece of copy
 * that names the limit reads this constant, so the page and the gate cannot
 * drift apart.
 */
export const FREE_PLAN_BUDGET_LINES = 1;

/** What a locked conference refuses, in one sentence. */
/**
 * What an admin-owned conference shows instead of a plan badge.
 *
 * An admin account never pays for its own conferences (the server decides that
 * from `isAdminUser`/`conferenceEntitlement` in `db.server.ts`: the flag AND the
 * owner's own address), so the
 * page must not claim a free plan it is not on, nor offer an unlock it does not
 * need.
 */
export const ADMIN_PLAN_BADGE = "Admin account — all features";
/** Said once, in the workspace banner, where the free plan's limits would be. */
export const ADMIN_PLAN_NOTE = `This conference belongs to an admin account, so every feature is open on it — no payment and no free-plan limits. Your committee's Editor and Viewer roles work exactly as they do anywhere else.`;
export const UPGRADE_PITCH = `This conference is on the free plan, which includes one budget line. ${UPGRADE_PRICE} unlocks unlimited budget lines, contracts, committee invites and printing.`;

/**
 * The refusal when a locked conference is asked for its event registration.
 *
 * Event registration is one of the things the $199 unlock opens (owner
 * decision), so the read and every write are refused on the free plan — with
 * the same `upgrade_required` code the rest of the free tier uses, and a
 * message that names this feature rather than repeating the budget line.
 */
export const REGISTRATION_LOCKED_MESSAGE = `Event registration is part of the ${UPGRADE_PRICE} unlock for this conference. The free plan includes one budget line; ${UPGRADE_PRICE} unlocks unlimited budget lines, contracts, committee invites, printing and event registration.`;

/**
 * The refusal when a locked conference is asked for its checklist.
 *
 * The checklist is one of the things the $199 unlock opens, so the read and
 * every write are refused on the free plan with the same `upgrade_required`
 * code the rest of the free tier uses — and a message that names this feature.
 * Nothing is deleted when a conference drops back to the free plan: the rows
 * stay, and the list comes back the moment it is unlocked again.
 */
export const CHECKLIST_LOCKED_MESSAGE = `The pre- and post-conference checklist is part of the ${UPGRADE_PRICE} unlock for this conference. The free plan includes one budget line; ${UPGRADE_PRICE} unlocks the checklist, unlimited budget lines, contracts, committee invites, printing and event registration. Nothing already on the list was deleted.`;
/** The same thing in one line, under the checklist section of a locked conference. */
export const CHECKLIST_LOCKED_HINT = `The pre- and post-conference checklist comes with the ${UPGRADE_PRICE} unlock — the default list, items of your own, and progress on both phases. Anything already on the list is kept and comes back the moment this conference is unlocked.`;

/** One line under the registration section of a locked conference. */
export const REGISTRATION_LOCKED_HINT = `Event registration comes with the ${UPGRADE_PRICE} unlock — the switch, ticket types, the attendee list and the CSV export. The free plan includes one budget line.`;

/**
 * Why registration has no card form: attendee money is the organizer's, and it is
 * paid into the organizer's own account (Stripe Connect, later). Until an organizer
 * can connect an account, a registration records who is coming and the organizer
 * marks a fee paid by hand.
 */
export const REGISTRATION_NO_PAYMENTS_NOTE = `No card is charged here. Registration records who is coming and what they owe; when a fee is taken in cash or by check, mark it paid by hand. Money for registration fees and donations is paid into each organizer's own payment account, never into Convocate's.`;

/**
 * The server's refusal when a free conference already holds its one budget
 * line. It names the limit, what the unlock removes, and the way back in today
 * (edit the line, or delete it to free the slot) — nothing is taken away.
 */
export const BUDGET_LINE_LIMIT_MESSAGE = `The free plan includes ${FREE_PLAN_BUDGET_LINES === 1 ? "one budget line" : `${String(FREE_PLAN_BUDGET_LINES)} budget lines`} on a conference. The ${UPGRADE_PRICE} unlock removes the limit, with category rollups and the over-budget flag across every line. You can edit the line you have, or delete it to free the slot for another — nothing you have entered is lost.`;

/** The one-line version, for under a disabled control on the budget section. */
export const BUDGET_LINE_LIMIT_HINT = `The free plan includes one budget line — edit or delete the line you have. The ${UPGRADE_PRICE} unlock removes the limit.`;

/** The button that opens the payment link. */
export const UNLOCK_BUTTON_LABEL = `Unlock for ${UPGRADE_PRICE}`;

/** What a control behind the wall says when it is hovered or disabled. */
export const LOCKED_CONTROL_HINT = `Part of the ${UPGRADE_PRICE} unlock — use “${UNLOCK_BUTTON_LABEL}” at the top of this page.`;
/**
 * The short line under a print control on a locked conference. The server
 * refuses those reads with `UPGRADE_PITCH` (see `requireSheetReader` in
 * `src/server/api.ts`), so this says the same thing in one line: what the free
 * plan holds, and that printing and print-all come with the unlock — no price
 * or promise that is not already in `UPGRADE_PITCH`.
 */
export const PRINT_LOCKED_HINT = `Printing and print-all come with the ${UPGRADE_PRICE} unlock — unlimited budget lines, contracts and committee invites too. The free plan holds one budget line.`;

/** The upgrade panel's opening paragraph. */
export const UPGRADE_PANEL_BODY = `The free plan holds the conference itself — its name, dates, venue, expected attendance, budget target and one budget line — and nobody sees it but you. Everything that does the rest of the work is behind one payment of ${UPGRADE_PRICE} for this conference. It is not a subscription and it is not charged per person or per month.`;

/** What the owner is told right after the payment link has been opened. */
export const PAYMENT_STARTED_NOTE =
  "Payment started — we will unlock this conference once the payment is confirmed.";

/** The quieter control that replaces the unlock button while a payment is open. */
export const PAYMENT_IN_PROGRESS_LABEL = "Payment in progress";

/**
 * How long a payment attempt stays "in progress" before the organizer may start
 * another one. One number, read by the server's rule, the page and the copy, so
 * they cannot drift apart.
 *
 * 60 minutes, chosen deliberately:
 *  - Long enough that a checkout genuinely in flight — a card being typed, a
 *    bank challenge — can never spawn a second one. A couple of minutes would be
 *    far too short for that.
 *  - Short enough that an organizer who opened the payment page and closed it
 *    without paying is back in business in the same sitting, without asking us.
 *  - It is a clock, not a verification: we cannot ask Stripe whether the earlier
 *    attempt was paid (no Checkout Session id is stored for it, and the only
 *    saved Stripe key is test-mode while the payment link is live), so the
 *    sentence beside the retry button tells the organizer not to pay twice if
 *    their card was charged.
 */
export const PAYMENT_RETRY_AFTER_MINUTES = 60;
export const PAYMENT_RETRY_AFTER_MS = PAYMENT_RETRY_AFTER_MINUTES * 60_000;

/**
 * Whether an attempt that was never confirmed is old enough to be set aside and
 * a fresh one started. Pure, so the server and the page answer identically.
 */
export const isPaymentAttemptStale = (startedAt: number, now: number = Date.now()): boolean =>
  Number.isFinite(startedAt) && startedAt > 0 && now - startedAt >= PAYMENT_RETRY_AFTER_MS;

/** "in about 37 minutes" — how long until a fresh attempt can be replaced. */
export const paymentRetryWaitLabel = (startedAt: number, now: number = Date.now()): string => {
  const left = Math.max(1, Math.ceil((startedAt + PAYMENT_RETRY_AFTER_MS - now) / 60_000));
  return left === 1 ? "in about a minute" : `in about ${left} minutes`;
};

/**
 * Said beside the disabled button while an attempt is still fresh — the honest
 * way out of what used to be a dead end, without inviting a second charge.
 */
export const PAYMENT_PENDING_RETRY_NOTE = (waitLabel: string): string =>
  `If that attempt was not completed, nothing was charged — you can start a new one ${waitLabel}.`;

/** The paywall when an earlier attempt was never completed and a retry is open. */
export const PAYMENT_RETRY_HEADLINE = "Your earlier payment attempt was not completed";
export const PAYMENT_RETRY_NOTE = `The payment page for this conference was opened earlier and no payment has been confirmed against it, so you can start a new attempt. If your card was charged, do not pay again — reply to the Stripe receipt for that charge and we will unlock this conference.`;
export const PAYMENT_RETRY_BUTTON_LABEL = "Start the payment again";

/**
 * How the confirmation actually happens: by hand, after the payment has been
 * seen in our Stripe account. Said plainly so nobody waits for an instant unlock
 * that is not coming.
 */
export const PAYMENT_CONFIRM_NOTE =
  "We confirm each payment by hand in the payment account, then unlock the conference here. If you have just paid, come back to this page and reload it once that is done.";

/**
 * The owner's refund promise — one string, used everywhere it is stated so the
 * wording can never drift between the paywall, the thank-you page and the
 * payment page.
 *
 * The clock runs from the moment the card was charged, never from the unlock.
 * A refund puts the conference back on the free plan and keeps its data.
 */
export const REFUND_PROMISE = `${UPGRADE_PRICE}, one conference, charged once. If it isn't right for you, tell us within 48 hours of this payment and we'll refund it in full — the conference goes back to the free plan and everything you entered stays.`;
/** The same promise in one line, for under a button where space is tight. */
export const REFUND_SHORT = "48 hours to change your mind — full refund, no questions.";
/**
 * How to ask for the refund. Said plainly: Convocate has no inbox of its own, so
 * the receipt from the payment processor is the route that exists today. No
 * address is invented here.
 */
export const REFUND_HOW_TO_ASK =
  "To ask for it, reply to the receipt Stripe sends you when your card is charged, naming the conference. That receipt is the only way to reach us today — Convocate has no inbox of its own. The 48 hours runs from the charge, not from when the conference opens.";
/**
 * The server's refusal when a conference already has a payment attempt that is
 * still fresh. It names the wait, and the way out of it: once the hour is up a
 * new attempt can be started, so this is a pause and not a dead end.
 */
export const PAYMENT_PENDING_REFUSAL = `A payment for this conference was started less than ${PAYMENT_RETRY_AFTER_MINUTES} minutes ago and has not been confirmed yet. A second payment would charge you twice, so this one was not started. If that attempt was not completed, nothing was charged — you can start a new one once the ${PAYMENT_RETRY_AFTER_MINUTES} minutes are up.`;

/** A committee member cannot pay for someone else's conference. */
export const PAYMENT_OWNER_ONLY_NOTE = `Only the account owner can unlock this conference for ${UPGRADE_PRICE}.`;

/** Why an account cannot create a second conference today. */
export const CONFERENCE_LIMIT_MESSAGE = `The free plan includes one conference per account, and that is the limit today. The ${UPGRADE_PRICE} unlock removes the limit on that conference's budget lines and opens its contracts, committee invites and printing — it does not add a second conference to the account.`;

/** What the free plan includes, as bullets. */
export const FREE_PLAN_INCLUDES = [
  "One conference on your account",
  "Its name, dates, venue and expected attendance",
  `Its budget target — and ${FREE_PLAN_BUDGET_LINES === 1 ? "one budget line" : `${String(FREE_PLAN_BUDGET_LINES)} budget lines`} against it, with planned and committed amounts, so you can see the arithmetic work on your own numbers`,
  "Access for you — the owner — alone",
  "The shared example conference, to look through and see what a worked conference looks like",
];

/**
 * What /payment-complete says. It is an honest receipt notice and nothing more:
 * the page cannot see the payment and does not unlock anything, so it does not
 * claim the amount was checked.
 */
export const PAYMENT_COMPLETE_TITLE = "Thank you — payment received";
export const PAYMENT_COMPLETE_BODY = [
  "Your payment for unlocking a conference has gone through. We confirm each payment by hand in the payment account, then the conference opens on the free plan's wall being lifted — unlimited budget lines, contracts, committee invites and printing.",
  "Nothing else is needed from you: when the payment is confirmed, open the conference and reload the page. This page does not unlock anything by itself, and nothing is charged again from here.",
];
export const PAYMENT_COMPLETE_PAID_AT_LEAST = `One payment of ${UPGRADE_PRICE} unlocks one conference.`;

/**
 * The read-only example conference, in copy the server and the page share.
 *
 * One sentence for the refusal (the server sends it with its 403 and the page
 * shows the same words when a control is pressed), one for the badge, one for
 * the notice at the top of the page.
 */
export const SAMPLE_READ_ONLY_MESSAGE =
  "This is an example conference. Create your own conference to start planning.";
export const SAMPLE_BADGE = "Example · view only";
export const SAMPLE_NOTICE_TITLE = "This is an example conference.";
export const SAMPLE_NOTICE_BODY = `It is here to show what Convocate does — a real budget with planned and committed amounts and an over-budget flag, a signed venue, and guests still in negotiation. Every figure is invented for the example, and nothing on it can be changed.`;
export const SAMPLE_COMMITTEE_NOTE = `Committee access is switched off on the example. On your own conference you can invite your committee by link — as Editor or Viewer — and revoke a link at any time.`;
/** The sample is not for sale: nobody pays for it, so nobody can unlock it. */
export const SAMPLE_NOT_PAYABLE = "The example conference is not on sale, so it cannot be unlocked or paid for.";

/** What the one-off charge opens on this conference. */
export const UPGRADE_INCLUDES = [
  "Unlimited budget lines — as many as the conference needs, beyond the free plan's one, with planned vs. committed, category rollups and an over-budget flag",
  "Unlimited contracts — speakers, musicians, singers, bands, backline and equipment, and the venue itself — with their contract state (not sent, sent, signed)",
  "Committee invites by link, as Editor or Viewer",
  "Printing a contract and print-all of the contracts board — a clean sheet for the committee",
];
