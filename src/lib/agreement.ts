/**
 * The engagement agreement — a draft contract document merged from the values
 * already on a contract entry and its conference.
 *
 * This sits beside the invitation letter (`lib/letter.ts`) and reuses its rules:
 *
 *  - **Nothing is invented.** Every sentence either states a value that is on the
 *    entry / conference, or is a plain-language clause whose specific depends on
 *    the organizer. A specific that is not stored prints as a blank line
 *    (`BLANK`) to be completed by hand — it is never filled with a guess.
 *  - **Denomination-neutral.** No titles, no polity, no liturgical assumption.
 *    "Speaker", "performer", "supplier", "venue" — and only where the entry says
 *    so. Honorarium is itemized as its own line because the field exists on every
 *    kind, not because any tradition expects one.
 *  - **Not legal advice, and not a regulated signature.** The document carries
 *    that in its own footer, and the page it prints from says it too. It can be
 *    accepted electronically by the other party through a private link — a typed
 *    name, a tick and a UTC timestamp, recorded against the version they were
 *    shown (see `signature_requests`) — and that record says exactly what it is
 *    and claims nothing more. There is still no send button: Convocate has no
 *    inbox, so the organizer copies the link and sends it.
 *
 * Shared module: no server imports, so the same text can be built in the browser
 * and on the server and always matches.
 */
import { formatDate, formatDateRange, formatMoney } from "./money";
import { contractTotalCents, kindLabel, type Contract, type ContractKind, type Money } from "./types";

/** The line a blank specific prints as, so the organizer can complete it by hand. */
export const BLANK = "______________________________________";

/** The medal at the bottom of every page of the document, and on the screen. */
export const DRAFT_NOTICE =
  "Draft agreement — a starting point for your own review, not legal advice.";

/**
 * The one line in the document that stands for a picture: where the guest's
 * DRAWN signature prints.
 *
 * The agreement body is plain text — that is what makes it editable on screen
 * and copyable as text — so an image cannot live inside it. Instead the body
 * carries this marker on a line of its own, and the print page swaps that line
 * for the drawing. When the guest drew nothing there is no marker, the body is
 * the string it has always been, and the printed output is unchanged.
 */
export const SIGNATURE_IMAGE_MARKER = "[[drawn-signature]]";

export const NO_SEND_NOTICE =
  "Convocate does not send this to anyone. Print it or save it as a PDF, then post or email it yourself.";

/* ------------------------------------------------------- electronic signature */

/**
 * One acceptance of this agreement by the OTHER party, recorded through a
 * private signing link (see `signature_requests`).
 *
 * A typed name, a tick and a timestamp — the owner's decision. It is a record of
 * what happened, not a claim of identity: the document says so in its own
 * signature block, in words the reader can check.
 *
 * Slice 2 adds a drawn signature image to this same record; it will print above
 * the typed name, and nothing in this type has to change for it.
 */
export type AgreementAcceptance = {
  /** The name the other party typed. */
  name: string;
  /** The address they chose to give, or "". Never required, never guessed. */
  email: string;
  /** When they accepted, epoch milliseconds (printed in UTC). */
  acceptedAt: number;
  /** The version of the text they accepted — `agreementFingerprint` of it. */
  version: string;
  /**
   * The signature they drew, as a `data:image/png;base64,` URL, or "" if they
   * drew none. Optional: the typed name and the tick are the legal act, and this
   * is the picture of what their hand did.
   *
   * Only the organizer's own copy carries it — the agreement view and the print
   * page. The public signing page never returns it once a link is used.
   */
  signatureImage?: string;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * "22 October 2026 at 15:04 UTC" — built by hand, in UTC, so the same record
 * prints the same way on every machine and in every locale. A timestamp that
 * moved with the reader's timezone would not be a record of anything.
 */
export const formatMoment = (ms: number): string => {
  const at = new Date(ms);
  if (Number.isNaN(at.getTime())) return "";
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${String(at.getUTCDate())} ${MONTH_NAMES[at.getUTCMonth()]} ${String(at.getUTCFullYear())} at ${two(at.getUTCHours())}:${two(at.getUTCMinutes())} UTC`;
};


/* ------------------------------------------------------------------ terms */

/**
 * Everything an organizer can add for the agreement, beyond the values the
 * contract card already holds. All optional; empty means a blank line.
 */
export type AgreementTerms = {
  /** What exactly is provided — sessions, set, equipment list. Pre-filled from the entry's description. */
  engagement: string;
  /** Arrival, set-up or soundcheck, session or performance times, finish. */
  schedule: string;
  /** The kind-specific detail block (sessions / set length / equipment list / rooms). */
  detail: string;
  /** ISO date the balance is due. */
  balanceDue: string;
  /** How payment is made — bank transfer, check, and the details. */
  paymentNote: string;
  /** Travel, accommodation, meals, local transport — as text, with any caps. */
  inclusions: string;
  /** Days of notice before a cancellation is free. 0 = not stated (prints a blank). */
  cancellationNoticeDays: number;
  /** What happens to the deposit on cancellation. */
  cancellationDeposit: string;
  /** The organizer’s own clauses, printed as written. */
  additionalTerms: string;
  /** The country/state whose law governs, and whose courts hear disputes. */
  governingLaw: string;
  /** Keys from `OPTIONAL_CLAUSES` the organizer has switched on. */
  clauses: string[];
};

export const EMPTY_AGREEMENT_TERMS: AgreementTerms = {
  engagement: "",
  schedule: "",
  detail: "",
  balanceDue: "",
  paymentNote: "",
  inclusions: "",
  cancellationNoticeDays: 0,
  cancellationDeposit: "",
  additionalTerms: "",
  governingLaw: "",
  clauses: [],
};

/**
 * The optional clauses, in a fixed order. All default OFF — the core agreement
 * stands on its own without them. `hint` is what the organizer reads on the
 * toggle; the clause text itself is built by `optionalClause`.
 */
export const OPTIONAL_CLAUSES: readonly { key: string; label: string; hint: string }[] = [
  {
    key: "recording",
    label: "Recording, streaming and photography",
    hint: "May the organizer record and stream it, may the guest record, and for how long.",
  },
  {
    key: "promotion",
    label: "Use of name, biography and likeness in promotion",
    hint: "Name, photo and biography in printed and online promotion.",
  },
  {
    key: "merchandise",
    label: "Merchandise or book sales",
    hint: "Whether books or merchandise may be sold, and on what arrangement.",
  },
  {
    key: "substitution",
    label: "Substitution",
    hint: "Must the named person appear, or may they send a substitute.",
  },
  {
    key: "safeguarding",
    label: "Safeguarding and background checks",
    hint: "Following the organizer's safeguarding policy and any background-check requirements.",
  },
  {
    key: "confidentiality",
    label: "Confidentiality",
    hint: "Keeping each other's private information private.",
  },
  {
    key: "data",
    label: "Data protection for contact details",
    hint: "How contact details are used, kept and deleted.",
  },
  {
    key: "liability",
    label: "Liability and insurance",
    hint: "Who insures equipment, injury and damage.",
  },
] as const;

export const OPTIONAL_CLAUSE_KEYS: readonly string[] = OPTIONAL_CLAUSES.map((c) => c.key);

/** Keep only clause keys this build knows, in catalog order, without duplicates. */
export const normalizeClauses = (value: unknown): string[] => {
  const list = Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry : ""))
    : typeof value === "string"
      ? value.split(",").map((entry) => entry.trim())
      : [];
  const wanted = new Set(list.filter(Boolean));
  return OPTIONAL_CLAUSE_KEYS.filter((key) => wanted.has(key));
};

/** How a stored term is read back: from a raw DB row or from a parsed payload. */
export const termsFromRow = (row: {
  agreement_engagement?: unknown;
  agreement_schedule?: unknown;
  agreement_detail?: unknown;
  agreement_balance_due?: unknown;
  agreement_payment_note?: unknown;
  agreement_inclusions?: unknown;
  agreement_cancellation_notice?: unknown;
  agreement_cancellation_deposit?: unknown;
  agreement_additional_terms?: unknown;
  agreement_governing_law?: unknown;
  agreement_clauses?: unknown;
}): AgreementTerms => ({
  engagement: String(row.agreement_engagement ?? ""),
  schedule: String(row.agreement_schedule ?? ""),
  detail: String(row.agreement_detail ?? ""),
  balanceDue: String(row.agreement_balance_due ?? ""),
  paymentNote: String(row.agreement_payment_note ?? ""),
  inclusions: String(row.agreement_inclusions ?? ""),
  cancellationNoticeDays: Number(row.agreement_cancellation_notice ?? 0) || 0,
  cancellationDeposit: String(row.agreement_cancellation_deposit ?? ""),
  additionalTerms: String(row.agreement_additional_terms ?? ""),
  governingLaw: String(row.agreement_governing_law ?? ""),
  clauses: normalizeClauses(row.agreement_clauses),
});

/* --------------------------------------------------- the organizer identity */

/**
 * The organizer's own details, as stored in `organizer_profiles` (one row per
 * account, filled in at `/app/settings`).
 *
 * The rules this type exists to enforce:
 *
 *  - **Empty is empty.** Every field is a plain trimmed string, and a field the
 *    organizer has not filled in prints as `BLANK` — never as a guess, never
 *    filled in from anywhere else.
 *  - **The email is never the legal name.** A legal name is a fact the organizer
 *    states; an account's email address is not a party to a contract.
 *  - **The signer falls back to the account.** `signerName` empty means "the
 *    person signed in" — the same name the document printed before this table
 *    existed — so an account that never opened the settings page gets exactly the
 *    document it got before.
 */
export type OrganizerIdentity = {
  legalName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateRegion: string;
  postalCode: string;
  country: string;
  signerName: string;
  signerTitle: string;
  noticesEmail: string;
  phone: string;
};

/** No profile at all — what an account that never filled one in reads as. */
export const EMPTY_ORGANIZER: OrganizerIdentity = {
  legalName: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateRegion: "",
  postalCode: "",
  country: "",
  signerName: "",
  signerTitle: "",
  noticesEmail: "",
  phone: "",
};

/**
 * The postal lines that are actually filled in, in print order: street lines
 * first, then "city, state postal code" as one line, then the country. A line
 * with nothing in it is left out rather than printed as a blank gap.
 */
export const organizerAddressLines = (organizer: OrganizerIdentity): string[] => {
  const lines = [organizer.addressLine1, organizer.addressLine2]
    .map((line) => line.trim())
    .filter(Boolean);
  const locality = [organizer.city, organizer.stateRegion, organizer.postalCode]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  if (locality) lines.push(locality);
  const country = organizer.country.trim();
  if (country) lines.push(country);
  return lines;
};

/* ------------------------------------------------------- wording helpers */

/** How the other party is called in the document. Neutral, from the kind alone. */
export const partyNoun = (kind: ContractKind): string => {
  switch (kind) {
    case "speaker":
      return "Speaker";
    case "musician":
      return "Musician";
    case "singer":
      return "Vocalist";
    case "band":
      return "Band";
    case "backline":
      return "Supplier";
    case "venue":
      return "Venue";
    default:
      return "Guest";
  }
};

/**
 * The label for the kind-specific detail box, per kind. The organizer types the
 * block's content there; the clause headings themselves are fixed below.
 */
export const detailLabel = (kind: ContractKind): string => {
  switch (kind) {
    case "speaker":
      return "Sessions, titles and Q&A (number of sessions, titles, Q&A time, biography and photo deadline, book table)";
    case "musician":
    case "singer":
    case "band":
      return "Set length, rehearsal and soundcheck, band members covered, backline provided vs brought, setlist approval";
    case "backline":
      return "Equipment list with quantities, delivery and collection windows, power requirements";
    case "venue":
      return "Rental dates and hours (including setup and teardown), rooms and capacity, access and keys, catering and AV";
    default:
      return "Details of what is provided";
  }
};

const value = (text: string): string => text.trim() || BLANK;

const filled = (text: string): boolean => text.trim().length > 0;

const amount = (cents: Money): number => (typeof cents === "number" ? cents : 0);

const money = (cents: Money): string => formatMoney(amount(cents));

/** "31 March 2027" or a blank line when no date was entered. */
const dateOrBlank = (iso: string): string => (iso ? formatDate(iso) : BLANK);

/* ------------------------------------------------------------- the document */

export type AgreementSection = {
  key: string;
  heading: string;
  /** Paragraphs, in order. A paragraph may hold its own newlines. */
  paragraphs: string[];
};

export type AgreementDocument = {
  title: string;
  subtitle: string;
  /** Everything the organizer prints or edits, headings and all, as plain text. */
  body: string;
  sections: AgreementSection[];
  /** The clause keys that actually rendered (enabled and known). */
  clauses: string[];
};

export type AgreementConference = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  venue: string;
  expectedAttendance: number;
};

export type AgreementInput = {
  conference: AgreementConference;
  contract: Contract;
  terms: AgreementTerms;
  /**
   * The organizer's own details, merged into the parties line, the notices
   * clause and the signature block. Optional: omitted means every one of those
   * fields prints as a blank line, which is what an account that has not filled
   * its profile in gets.
   */
  organizer?: OrganizerIdentity;
  /**
   * The signed-in organizer's account name — a wire key, used only as the last
   * fallback for the signer's name. It is never printed as the Organizer: the
   * legal name comes from `organizer.legalName` or prints as a blank.
   */
  organiserName: string;
  /**
   * The other party's electronic acceptance, once there is one. Absent or null
   * means the signature block prints the blank lines it has always printed.
   */
  acceptance?: AgreementAcceptance | null;
  /** ISO date, supplied by the server so the document is stable across renderers. */
  today: string;
};

/** itemized money exactly as the contract card shows it — same labels, same total. */
export const agreementAmountRows = (
  contract: Pick<Contract, "kind" | "feeCents" | "honorariumCents" | "travelCents" | "equipmentCents" | "depositCents">,
): { label: string; cents: Money }[] => {
  const rows: { label: string; cents: Money }[] = [
    { label: contract.kind === "venue" ? "Rental fee" : "Fee", cents: contract.feeCents },
    { label: "Honorarium", cents: contract.honorariumCents },
    { label: "Travel", cents: contract.travelCents },
    { label: "Equipment / rental", cents: contract.equipmentCents },
  ];
  if (contract.kind === "venue") {
    rows.push({ label: "Deposit (part of the rental fee)", cents: contract.depositCents });
  }
  return rows;
};

/** The balance: total less any deposit. Both are part of the total, never added to it. */
export const agreementBalanceCents = (contract: Contract): number => {
  const total = contractTotalCents(contract);
  return (total ?? 0) - amount(contract.depositCents);
};

const optionalClause = (key: string, party: string, name: string): string | null => {
  switch (key) {
    case "recording":
      return [
        `The Organizer intends to ${BLANK} (for example record, photograph or stream) the ${party}'s contribution.`,
        `Any recording may be used for ${BLANK} and will be kept until ${BLANK}. That is the whole of the permission given here; any other use needs written agreement.`,
        `${name} may make their own recording of the event only as follows: ${BLANK}.`,
      ].join("\n");
    case "promotion":
      return [
        `The Organizer may use ${name}'s name, biographical note, photograph and likeness to promote the Conference — in printed material, on the Conference website and on its social media accounts. No other use is permitted without written agreement.`,
        `${name} will supply a biography and a photograph by ${BLANK}, and either party may ask the other to stop a particular use.`,
      ].join("\n");
    case "merchandise":
      return [
        `${name} may sell books or merchandise at the Conference only as agreed here: ${BLANK}.`,
        `Table space, staffing, any share of sales and how payment is handled: ${BLANK}.`,
      ].join("\n");
    case "substitution":
      return [
        `${name} is expected to appear in person. ${name} may send a substitute only with the Organizer's written agreement before the Conference, and only if ${BLANK}.`,
        `If the named person cannot appear and no substitute is agreed, the Organizer may end this agreement on the terms in the cancellation clause above.`,
      ].join("\n");
    case "safeguarding":
      return [
        `${name} will follow the Organizer's safeguarding policy — ${BLANK} (policy name and date) — and will complete any background checks the Organizer requires: ${BLANK}.`,
        `${name} will not be left alone with children or vulnerable adults except as arranged in writing: ${BLANK}.`,
      ].join("\n");
    case "confidentiality":
      return [
        `Each party will keep the other's confidential information private. That includes ${BLANK}.`,
        `This does not cover information that is already public, that the other party already had, or that the law requires to be shared.`,
      ].join("\n");
    case "data":
      return [
        `Each party will look after the other's contact details and use them only to plan and run the Conference.`,
        `Contact details will be deleted ${BLANK} after the Conference unless ${BLANK}. Each party will follow the data protection law that applies to it.`,
      ].join("\n");
    case "liability":
      return [
        `Each party is responsible for ${BLANK}. The Organizer insures ${BLANK} and ${name} insures ${BLANK}.`,
        `${name} is responsible for loss of or damage to their own equipment, except where the loss or damage is caused by the Organizer's own fault.`,
        `Nothing in this agreement limits liability that cannot be limited by law.`,
      ].join("\n");
    default:
      return null;
  }
}

/**
 * Build the whole document. Everything that is a value comes from the conference
 * or the entry; everything that is a specific the organizer has not entered prints
 * as `BLANK`.
 */
export const buildAgreement = (input: AgreementInput): AgreementDocument => {
  const { conference, contract, terms, organiserName, today } = input;
  /**
   * The organizer's own details, or nothing at all. `EMPTY_ORGANIZER` is the
   * same object an account that never opened the settings page reads as, so an
   * empty profile prints exactly what this document printed before the profile
   * existed: a blank legal name, a blank notices address and a blank role.
   */
  const organizer = input.organizer ?? EMPTY_ORGANIZER;
  /**
   * Who signs. The profile's own signer name first; when it is empty, the
   * account name this document has always used; then a blank line. Never an
   * email address as the legal name — that rule lives on `legalName` below,
   * which has no fallback at all.
   */
  const signerName = organizer.signerName.trim() || organiserName.trim();
  const signerTitle = organizer.signerTitle.trim();
  /**
   * The Organizer as it appears on the parties line: the legal name they stated
   * (or a blank), then their postal address lines. An empty profile is just the
   * blank, so nothing here is invented.
   */
  const organizerParty = [organizer.legalName.trim() || BLANK, ...organizerAddressLines(organizer)].join(", ");
  const party = partyNoun(contract.kind);
  const name = contract.name;
  const dates = conference.startDate || conference.endDate
    ? formatDateRange(conference.startDate, conference.endDate)
    : BLANK;
  const venue = conference.venue ? conference.venue : BLANK;
  const total = contractTotalCents(contract) ?? 0;
  const deposit = amount(contract.depositCents);
  const balance = total - deposit;
  const clauses = normalizeClauses(terms.clauses);
  const engagement = filled(terms.engagement)
    ? terms.engagement.trim()
    : filled(contract.topic)
      ? contract.topic.trim()
      : filled(contract.contractNote)
        ? contract.contractNote.trim()
        : "";

  const sections: AgreementSection[] = [];

  /* 1 — the two parties and what is being agreed */
  sections.push({
    key: "parties",
    heading: "The parties and the engagement",
    paragraphs: [
      `This agreement is made on ${BLANK} between ${organizerParty} (the "Organizer" — the body or organization running the Conference or event) and ${name} (the "${party}").`,
      `The Organizer is running ${conference.name}, to be held ${dates} at ${venue}.`,
      `The Organizer engages ${name} as the ${party.toLowerCase()} for this Conference on the terms set out in this agreement.`,
    ],
  });

  /* 2 — what is provided */
  sections.push({
    key: "scope",
    heading: "Scope of services — what is provided",
    paragraphs: [
      engagement ||
        `${BLANK}\n(What exactly is provided — sessions, set, equipment list.)`,
      `The ${party.toLowerCase()} will provide the services described above with reasonable skill and care, and will follow the reasonable directions of the Organizer's Conference lead.`,
    ].filter((paragraph) => paragraph !== ""),
  });

  /* 3 — schedule */
  sections.push({
    key: "schedule",
    heading: "Schedule",
    paragraphs: [
      filled(terms.schedule)
        ? terms.schedule.trim()
        : `Arrival: ${BLANK}\nSet-up or soundcheck: ${BLANK}\nSession or performance: ${BLANK}\nFinish: ${BLANK}`,
      `Times that are not stated above will be agreed in writing before the Conference.`,
    ],
  });

  /* 4 — the money, itemized exactly as the card shows it */
  const moneyLines = agreementAmountRows(contract)
    .map((row) => `${row.label}: ${money(row.cents)}`)
    .join("\n");
  const depositLine =
    deposit > 0
      ? `Deposit: ${money(deposit)} — ${contract.kind === "venue" ? "part of the rental fee above" : "paid on signing, part of the total above"}.`
      : `Deposit: ${BLANK}`;
  sections.push({
    key: "fees",
    heading: "Fee and payment",
    paragraphs: [
      `The amounts recorded for this engagement are:\n${moneyLines}\nTotal: ${money(total)}`,
      depositLine,
      `Balance: ${money(balance)} — due ${dateOrBlank(terms.balanceDue)}.`,
      `How payment is made: ${value(terms.paymentNote)}`,
      `The amounts above are stated in US dollars. Any change to them must be agreed in writing under the "Amendments" clause.`,
    ],
  });

  /* 5 — expenses */
  const travel = amount(contract.travelCents);
  const equipment = amount(contract.equipmentCents);
  sections.push({
    key: "expenses",
    heading: "Expenses, travel and what the Organizer covers",
    paragraphs: [
      travel > 0
        ? `Travel: ${money(travel)}, included in the total above.`
        : `Travel costs: ${BLANK}`,
      equipment > 0
        ? `Equipment or rental: ${money(equipment)}, included in the total above.`
        : `Equipment or rental costs: ${BLANK}`,
      `The Organizer covers the following — travel, accommodation, meals, local transport — and any caps on them: ${value(terms.inclusions)}`,
      `Anything not listed above is the ${party.toLowerCase()}'s own cost, unless the Organizer agrees to it in writing before it is spent.`,
    ],
  });

  /* 6 — cancellation */
  const notice = terms.cancellationNoticeDays > 0 ? `${String(terms.cancellationNoticeDays)} days` : BLANK;
  sections.push({
    key: "cancellation",
    heading: "Cancellation and postponement",
    paragraphs: [
      `Either party may cancel or postpone by giving the other written notice at least ${notice} before the first day of the Conference.`,
      `What happens to the deposit on cancellation: ${value(terms.cancellationDeposit)}`,
      `If the Conference is postponed rather than canceled, the parties will agree in writing whether this agreement moves to the new dates and how the fee and the deposit are affected: ${BLANK}`,
    ],
  });

  /* 7 — force majeure */
  sections.push({
    key: "forceMajeure",
    heading: "Force majeure — illness, restriction, weather",
    paragraphs: [
      `Neither party is in breach if they cannot do what this agreement asks because of something outside their reasonable control — for example illness that prevents travel, a government restriction, a natural disaster or extreme weather.`,
      `The party affected will tell the other as soon as they reasonably can, and the parties will agree whether to postpone or end the engagement, and what happens to money already paid: ${BLANK}`,
    ],
  });

  /* kind-specific block, if any */
  const kindSection = kindClause(contract, terms, BLANK);
  if (kindSection) sections.push(kindSection);

  /* optional clauses, only the enabled ones */
  const renderedClauses: string[] = [];
  for (const clause of OPTIONAL_CLAUSES) {
    if (!clauses.includes(clause.key)) continue;
    const text = optionalClause(clause.key, party, name);
    if (!text) continue;
    renderedClauses.push(clause.key);
    sections.push({
      key: `clause-${clause.key}`,
      heading: `${clause.label}`,
      paragraphs: text.split("\n\n"),
    });
  }

  /* the organizer's own clauses */
  if (filled(terms.additionalTerms)) {
    sections.push({
      key: "additional",
      heading: "Additional terms agreed by the Organizer",
      paragraphs: terms.additionalTerms.trim().split(/\n{2,}/),
    });
  }

  /* the core tail clauses */
  sections.push({
    key: "independent",
    heading: "Independent status",
    paragraphs: [
      `${name} is an independent contractor, not an employee, worker or agent of the Organizer. ${name} is responsible for their own tax, their own insurance and anyone they bring with them to the Conference, and nothing in this agreement creates an employment relationship, a partnership or a joint venture.`,
    ],
  });
  sections.push({
    key: "amendments",
    heading: "Amendments in writing",
    paragraphs: [
      `Any change to this agreement must be in writing and agreed by both parties. An exchange of emails between the addresses in the notices clause counts as writing. Nothing agreed only by word of mouth changes these terms.`,
    ],
  });
  sections.push({
    key: "notices",
    heading: "Notices",
    paragraphs: [
      `Notices under this agreement go by email — Organizer: ${organizer.noticesEmail.trim() || BLANK}${signerName ? ` (${signerName})` : ""}; ${party}: ${contract.contactEmail || BLANK}.`,
      `A notice sent to those addresses counts as received the next working day, unless the sending system reports that it did not arrive.`,
    ],
  });
  sections.push({
    key: "governingLaw",
    heading: "Governing law and jurisdiction",
    paragraphs: [
      `This agreement is governed by the law of ${value(terms.governingLaw)}, and the courts of ${value(terms.governingLaw)} have jurisdiction over any dispute about it. The Organizer chooses this — Convocate does not assume a country, a state or a legal system.`,
    ],
  });
  sections.push({
    key: "entire",
    heading: "Entire agreement",
    paragraphs: [
      `This agreement, together with anything attached to or referenced in it, is the whole agreement between the parties about this engagement. It replaces anything said or written before it about the same subject.`,
    ],
  });
  /**
   * The signature block.
   *
   * With no acceptance it prints exactly what it printed before electronic
   * acceptance existed: two blank lines, the organizer's side and the other
   * party's, and the general sentence about electronic signature. With one, the
   * other party's side carries what actually happened — the name they typed, the
   * UTC moment, the version of the text they accepted, and what that record does
   * and does not mean. The organizer's own side never changes: they still sign
   * their own line by hand.
   */
  const acceptance = input.acceptance ?? null;
  const guestSignature = acceptance ? acceptance.name : BLANK;
  const guestDate = acceptance ? formatMoment(acceptance.acceptedAt) : BLANK;
  /**
   * The drawing, if the guest made one. Its marker sits on its own line directly
   * above the line the typed name appears on — so the picture of their hand is
   * above the name they typed, in their column of the signature block. No
   * drawing, no marker: the text below is then byte-for-byte what it was before
   * drawn signatures existed.
   */
  const drawnSignature = acceptance?.signatureImage ? acceptance.signatureImage : "";
  const drawnLine = drawnSignature ? `${SIGNATURE_IMAGE_MARKER}\n` : "";
  sections.push({
    key: "signatures",
    heading: "Signatures",
    paragraphs: [
      `Signed for the Organizer:                    Signed for ${name}:\n\n${drawnLine}${BLANK}      ${guestSignature}\nName: ${signerName || BLANK}\nRole: ${signerTitle || BLANK}\nDate: ${BLANK}\n\nName: ${name}\nRole: ${BLANK}\nDate: ${guestDate}`,
      acceptance
        ? `Electronic signature: this agreement may be signed and accepted electronically. A signed copy sent by email is treated as an original. A typed name, or a check in one of these boxes, is accepted as a signature:\n☐ Organizer    ☒ ${name} — accepted electronically on ${formatMoment(acceptance.acceptedAt)}`
        : `Electronic signature: this agreement may be signed and accepted electronically. A signed copy sent by email is treated as an original. A typed name, or a check in one of these boxes, is accepted as a signature:\n☐ Organizer    ☐ ${name}`,
      ...(acceptance
        ? [
            `Accepted electronically by ${acceptance.name} on ${formatMoment(acceptance.acceptedAt)}, by typing that name${drawnSignature ? ", drawing the signature above" : ""} and checking the acceptance box on a private signing page. The version accepted was ${acceptance.version.slice(0, 16)}. This is an electronic acceptance and nothing more: it is not a notarized signature, and not a qualified or otherwise regulated electronic signature such as one issued under eIDAS, and Convocate has not verified who typed the name.${acceptance.email ? ` The address given at the time was ${acceptance.email}.` : ""}`,
          ]
        : []),
    ],
  });

  const title = `${name} — engagement agreement for ${conference.name}`;
  const subtitle = [
    `Organizer: ${BLANK}`,
    dates,
    conference.venue ? conference.venue : "",
    `${kindLabel(contract.kind)} engagement`,
  ]
    .filter(Boolean)
    .join(" · ");

  const heading = "AGREEMENT";
  const bodyLines: string[] = [
    heading,
    title,
    subtitle,
    "",
    DRAFT_NOTICE,
    "",
    ...sections.flatMap((section, index) => [
      `${String(index + 1)}. ${section.heading.toUpperCase()}`,
      "",
      ...section.paragraphs,
      "",
    ]),
    "—",
    acceptance
      ? `${DRAFT_NOTICE} Generated by Convocate on ${formatDate(today)} from the details entered for this engagement. ${name} accepted this document electronically on ${formatMoment(acceptance.acceptedAt)}; the Organizer's own signature line is still blank until the Organizer signs it.`
      : `${DRAFT_NOTICE} Generated by Convocate on ${formatDate(today)} from the details entered for this engagement. Nothing has been sent to ${name}, and nothing is signed until both parties sign.`,
  ];

  return {
    title,
    subtitle,
    body: bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    sections,
    clauses: renderedClauses,
  };
};

/** The kind-specific block, rendered as its own clause only for the kinds it fits. */
function kindClause(
  contract: Contract,
  terms: AgreementTerms,
  blank: string,
): AgreementSection | null {
  const detail = filled(terms.detail) ? terms.detail.trim() : "";
  switch (contract.kind) {
    case "speaker":
      return {
        key: "kind-speaker",
        heading: "Speaker arrangements",
        paragraphs: [
          detail || `Number and titles of sessions: ${blank}\nQuestion and answer time: ${blank}\nDeadline for biography and photograph: ${blank}\nBook table: ${blank}`,
          `The Organizer will provide ${detail ? "" : blank} for the speaker: a room to speak in, a working sound system and the timings above. ${contract.name} will give the titles of the sessions and an outline of each by ${blank}.`,
        ],
      };
    case "musician":
    case "singer":
    case "band":
      return {
        key: "kind-performer",
        heading: "Performance arrangements",
        paragraphs: [
          detail || `Set length: ${blank}\nRehearsal and soundcheck: ${blank}\nNamed band members covered by these terms: ${blank}\nBackline provided by the Organizer, or brought: ${blank}\nSetlist or repertoire approval: ${blank}`,
          `The setlist or repertoire will be agreed with the Organizer by ${blank}. The Organizer provides ${blank}; everything else is brought by ${contract.name}.`,
        ],
      };
    case "backline":
      return {
        key: "kind-supplier",
        heading: "Equipment, delivery and collection",
        paragraphs: [
          detail || `Equipment, with quantities: ${blank}\nDelivery window: ${blank}\nCollection window: ${blank}\nPower requirements: ${blank}`,
          `Delivery ${blank} and collection ${blank} windows are included in the total above; any extension of them is charged as agreed in writing.`,
          `${contract.name} is responsible for loss of or damage to the equipment while it is being rented, except fair wear and normal use: ${blank}`,
          `If equipment fails or does not arrive, ${blank} will supply a working substitute ${blank}, and the Organizer will tell ${contract.name} as soon as it can.`,
          `The Organizer will provide power as listed above: ${blank}.`,
        ],
      };
    case "venue":
      return {
        key: "kind-venue",
        heading: "Venue rental, access and condition",
        paragraphs: [
          detail || `Rental dates and hours, including setup and teardown: ${blank}\nRooms and capacity: ${blank}\nAccess and keys: ${blank}\nCleaning: ${blank}\nCatering and AV arrangements: ${blank}`,
          `The venue is rented for the dates and hours set out above. Additional hours are charged at ${blank}.`,
          `Access and keys: ${blank}. The Organizer leaves the venue clean and in the condition it was found: ${blank}.`,
          `Damage: the Organizer is responsible for damage caused by the Organizer or its guests beyond fair wear and tear, up to ${blank}.`,
          `The deposit of ${contract.depositCents === null ? blank : formatMoney(contract.depositCents)} is part of the rental fee above and is dealt with on cancellation under the cancellation clause, and at the end of the rental period as follows: ${blank}.`,
          `Catering and AV arrangements: ${blank}.`,
        ],
      };
    default:
      return null;
  }
}

