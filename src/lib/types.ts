/** Shared domain types and constants — safe to import from client components. */

/**
 * Pipeline stage for a guest or supplier. Separate from the contract status:
 * a party can sit in "contracted" with the contract still not signed.
 */
export type ContractStage = "invited" | "negotiating" | "contracted" | "booked";

/** Who the conference is negotiating with — a person, a group, or a supplier. */
export type ContractKind =
  | "speaker"
  | "musician"
  | "singer"
  | "band"
  | "backline"
  | "venue"
  | "other";

/** Paperwork state, tracked independently of the pipeline stage. */
export type ContractStatus = "not_sent" | "sent" | "signed";

/**
 * An amount in integer cents — or `null` when the server withheld it.
 *
 * Owners and editors always receive a number. A committee Viewer receives
 * `null`: the server strips every figure out of the read path before the
 * payload leaves it, so a viewer's copy of a row genuinely has no amount in
 * it. The UI renders a placeholder for `null`; it never has a number to hide.
 */
export type Money = number | null;

export type BudgetItem = {
  id: number;
  conferenceId: number;
  category: string;
  label: string;
  plannedCents: Money;
  committedCents: Money;
  notes: string;
};

export type Contract = {
  id: number;
  conferenceId: number;
  kind: ContractKind;
  name: string;
  topic: string;
  feeCents: Money;
  honorariumCents: Money;
  travelCents: Money;
  equipmentCents: Money;
  /**
   * Venue-only: the deposit already paid or promised inside the rental fee.
   * Informational — it is *part of* the fee, never added to the per-entry total,
   * so a venue's deposit is not counted twice.
   */
  depositCents: Money;
  contractStatus: ContractStatus;
  contractDate: string;
  contractNote: string;
  contactEmail: string;
  stage: ContractStage;
};

/* --------------------------------------------------------- registrations */

/**
 * Where a registration came from. Phase A writes 'workspace' — the organizer
 * adding a walk-up by hand (or a registration taken at the door). 'public' is
 * the attendee-facing page, which is phase B; the column exists now so that
 * page needs no migration of its own.
 */
export type AttendeeSource = "workspace" | "public";

/**
 * How an attendee's fee stands.
 *
 *  - `unpaid`      — every new row, and every registration taken while the
 *                    organizer has no Stripe account ready to take a card.
 *  - `pending`     — a card payment was started (a Stripe Checkout Session was
 *                    created for this attendee) and has not been confirmed yet.
 *                    The person is already on the list; abandoning the card page
 *                    does not lose the registration.
 *  - `paid`        — Stripe told us the session was paid. Only the server sets
 *                    this, and only after asking Stripe.
 *  - `paid_by_hand` — the organizer marked it paid: cash, a check, a comp, or a
 *                    fee taken at the door.
 *  - `refunded`    — the organizer refunded it. Nothing sets this yet; the value
 *                    exists so a refund never has to be squeezed into another.
 *
 * Convocate never holds an organizer's money and takes no share of a fee.
 */
export type AttendeePaymentStatus = "unpaid" | "pending" | "paid" | "paid_by_hand" | "refunded";

/** Both of these mean the organizer has the money. */
export const ATTENDEE_PAID_STATUSES: AttendeePaymentStatus[] = ["paid", "paid_by_hand"];

export const isAttendeePaid = (status: AttendeePaymentStatus): boolean =>
  ATTENDEE_PAID_STATUSES.includes(status);

export type TicketType = {
  id: number;
  conferenceId: number;
  name: string;
  /** Price per place, or `null` when the server withheld it from this reader. */
  priceCents: Money;
  /** 0 = no limit on how many of this ticket can be sold. */
  quantityLimit: number;
  sortOrder: number;
  active: boolean;
  /** Places already taken by this ticket type (the sum of its quantities). */
  registered: number;
};

export type Attendee = {
  id: number;
  conferenceId: number;
  ticketTypeId: number | null;
  /** The ticket's name at read time; a deleted ticket leaves this blank. */
  ticketTypeName: string;
  name: string;
  email: string;
  /** Optional, from the public registration form; empty for a row entered by hand. */
  phone: string;
  /** Optional note from the attendee; empty for a row entered by hand. */
  notes: string;
  quantity: number;
  /**
   * What this attendee owed when they registered — a snapshot, so changing a
   * ticket's price later never rewrites history. `null` for a Viewer.
   */
  amountDueCents: Money;
  paymentStatus: AttendeePaymentStatus;
  /**
   * What the card payment was created for, in cents — `null` for a Viewer, and
   * `0` on a row where no card payment was ever started. Kept apart from
   * `amountDueCents` so "what they owe" and "what was charged" can never be
   * confused after a price change.
   */
  amountPaidCents: Money;
  /** ISO 4217, lower case, as Stripe reports it. `usd` when nothing was charged. */
  currency: string;
  /** When Stripe confirmed the payment, or `null`. */
  paidAt: number | null;
  paidNote: string;
  registeredAt: number;
  source: AttendeeSource;
};

/** One conference's registration switch, cap and words for attendees. */
export type RegistrationSettings = {
  conferenceId: number;
  isOpen: boolean;
  /** 0 = no cap. */
  capacity: number;
  instructions: string;
  /** 0 when the organizer has never saved a setting. */
  updatedAt: number;
};

export const ATTENDEE_PAYMENT_STATUSES: { key: AttendeePaymentStatus; label: string }[] = [
  { key: "unpaid", label: "Unpaid" },
  { key: "pending", label: "Payment started" },
  { key: "paid", label: "Paid by card" },
  { key: "paid_by_hand", label: "Paid by hand" },
  { key: "refunded", label: "Refunded" },
];

export const attendeePaymentLabel = (status: AttendeePaymentStatus): string =>
  ATTENDEE_PAYMENT_STATUSES.find((s) => s.key === status)?.label ?? "Unpaid";

/** Is this a payment status the database accepts? Anything else is 'unpaid'. */
export const attendeePaymentStatus = (value: unknown): AttendeePaymentStatus =>
  value === "paid" || value === "paid_by_hand" || value === "pending" || value === "refunded"
    ? value
    : "unpaid";

export const BUDGET_CATEGORIES = [
  "Venue",
  "Speaker fees",
  "Music / worship",
  "Equipment / backline",
  "Travel",
  "Hospitality",
  "Production",
  "Other",
] as const;

export const CONTRACT_STAGES: { key: ContractStage; label: string }[] = [
  { key: "invited", label: "Invited" },
  { key: "negotiating", label: "Negotiating" },
  { key: "contracted", label: "Contracted" },
  { key: "booked", label: "Booked" },
];

export const CONTRACT_KINDS: { key: ContractKind; label: string }[] = [
  { key: "speaker", label: "Speaker" },
  { key: "musician", label: "Musician" },
  { key: "singer", label: "Singer / vocalist" },
  { key: "band", label: "Band or ensemble" },
  { key: "backline", label: "Backline / equipment" },
  { key: "venue", label: "Venue" },
  { key: "other", label: "Other" },
];

export const CONTRACT_STATUSES: { key: ContractStatus; label: string }[] = [
  { key: "not_sent", label: "Not sent" },
  { key: "sent", label: "Sent" },
  { key: "signed", label: "Signed" },
];

export const kindLabel = (kind: ContractKind): string =>
  CONTRACT_KINDS.find((k) => k.key === kind)?.label ?? "Other";

export const contractStatusLabel = (status: ContractStatus): string =>
  CONTRACT_STATUSES.find((s) => s.key === status)?.label ?? "Not sent";

/**
 * Every money field is optional in the form; the total treats blanks as zero.
 * Returns `null` when any component was withheld — a viewer must not be able to
 * reconstruct a total from fields the server removed.
 */
export const contractTotalCents = (c: {
  feeCents: Money;
  honorariumCents: Money;
  travelCents: Money;
  equipmentCents: Money;
}): Money => {
  const parts = [c.feeCents, c.honorariumCents, c.travelCents, c.equipmentCents];
  if (parts.some((part) => part === null || part === undefined)) return null;
  return parts.reduce<number>((sum, part) => sum + (part || 0), 0);
};
