/**
 * The speaker invitation letter — a template, merged from data already on the
 * conference, never a message that is sent from here.
 *
 * Convocate has no inbox, so this builds text for the organizer to edit, print
 * and post or take with them. Nothing in the product claims it was emailed, and
 * there is no send button anywhere.
 *
 * The wording rules are deliberately strict, and they are the reason this lives
 * in its own file rather than as a string in a component:
 *
 *  - **Denomination-neutral.** No "Pastor", "Rev.", "Pastor's wife", and no
 *    liturgical assumption in the template's own words. Those titles appear only
 *    where they are literally part of the name the committee typed into the
 *    entry — the template never adds one.
 *  - **No invented promises.** The letter states the amounts that are on the
 *    entry (fee, honorarium, travel, equipment) and nothing more. It never says
 *    "we will cover all expenses", never promises accommodation, flights or an
 *    honorarium that is not on the entry.
 *  - **Plain, volunteer-readable.** Short sentences. A committee member with no
 *    lawyer should be able to read it and sign it.
 *
 * Shared module: no server imports, so the letter can also be rebuilt in the
 * browser if the organizer edits the conference fields on the page.
 */
import { EMPTY_ORGANIZER, type OrganizerIdentity } from "./agreement";
import { formatDate, formatDateRange, formatMoney } from "./money";
import { contractTotalCents, type Contract, type ContractKind, type Money } from "./types";

/**
 * Which entries can have an invitation letter. A speaker, musician, singer or
 * band is invited to take part; a venue or a backline supplier is engaged, and
 * the letter's "we would be glad if you would join us as…" wording would be
 * wrong for them. (Their contract sheet and attached documents work the same.)
 */
export const LETTER_KINDS: readonly ContractKind[] = ["speaker", "musician", "singer", "band"];

export const canHaveInvitationLetter = (kind: ContractKind): boolean =>
  LETTER_KINDS.includes(kind);

/** How the entry is described in the invitation. Neutral: no titles, no roles inferred. */
const rolePhrase = (kind: ContractKind): string => {
  switch (kind) {
    case "speaker":
      return "a guest speaker";
    case "musician":
      return "a musician";
    case "singer":
      return "a vocalist";
    case "band":
      return "the band or worship team";
    default:
      return "a guest";
  }
};

export type LetterConference = {
  name: string;
  startDate: string;
  endDate: string;
  venue: string;
};

export type LetterContract = Pick<
  Contract,
  | "name"
  | "kind"
  | "topic"
  | "feeCents"
  | "honorariumCents"
  | "travelCents"
  | "equipmentCents"
  | "contractNote"
>;

const amount = (cents: Money): string | null =>
  cents === null || cents === undefined || cents <= 0 ? null : formatMoney(cents);

/**
 * The paragraph that states the money — one line per amount that is actually on
 * the entry, and an honest line when the entry states none.
 */
const moneyParagraph = (contract: LetterContract): string => {
  const parts: string[] = [];
  const fee = amount(contract.feeCents);
  const honorarium = amount(contract.honorariumCents);
  const travel = amount(contract.travelCents);
  const equipment = amount(contract.equipmentCents);
  if (fee) parts.push(`a fee of ${fee}`);
  if (honorarium) parts.push(`an honorarium of ${honorarium}`);
  if (travel) parts.push(`${travel} set aside for travel`);
  if (equipment) parts.push(`${equipment} for equipment`);

  if (parts.length === 0) {
    return "The fee for this part is not stated in this letter; we will agree it with you directly and put it in writing before the conference.";
  }

  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const total = contractTotalCents(contract);
  const totalLine =
    parts.length > 1 && total !== null && total > 0 ? ` The total for this part is ${formatMoney(total)}.` : "";
  return `For this part the conference has budgeted ${list}.${totalLine}`;
};

/**
 * Build the letter. Everything in `body` comes from the conference and the
 * entry; nothing is added that the committee did not enter.
 */
export const buildInvitationLetter = (input: {
  conference: LetterConference;
  contract: LetterContract;
  /** The signed-in organizer's name — the person who signs off. */
  organiserName: string;
  /**
   * The organizer's own details from their profile (see `OrganizerIdentity`).
   * Optional, and empty means empty: an account that has not filled one in gets
   * exactly the letter this template produced before the profile existed.
   */
  organizer?: OrganizerIdentity;
  /** ISO date, supplied by the server so the letter is stable across renderers. */
  today: string;
}): { subject: string; body: string } => {
  const { conference, contract, organiserName, today } = input;
  const organizer = input.organizer ?? EMPTY_ORGANIZER;
  /**
   * Who signs the letter: the profile's signer name, then the account name, then
   * the neutral word the template always used. The legal name, when the organizer
   * has stated one, prints under the signature as the organization — it is never
   * used as the signer's name and never replaces it.
   */
  const signer = organizer.signerName.trim() || organiserName || "Organizer";
  const organisation = organizer.legalName.trim();
  const dates = formatDateRange(conference.startDate, conference.endDate);
  const dateIsKnown = Boolean(conference.startDate || conference.endDate);
  const where = conference.venue ? ` at ${conference.venue}` : "";

  const whenLine = dateIsKnown
    ? `which takes place ${dates}${where}`
    : `which we are planning${where} — the exact dates will follow`;

  const intro = `On behalf of the planning committee, I am writing to invite you to take part in ${conference.name}, ${whenLine}.`;

  const role = `We would be glad if you would join us as ${rolePhrase(contract.kind)}${
    contract.topic ? `. The part we have in mind is “${contract.topic}”` : ""
  }.`;

  const note = contract.contractNote ? `\n\nFor clarity: ${contract.contractNote}` : "";

  const body = [
    conference.name,
    `${dates}${conference.venue ? ` · ${conference.venue}` : ""}`,
    "",
    formatDate(today),
    "",
    `Dear ${contract.name},`,
    "",
    intro,
    "",
    role,
    "",
    moneyParagraph(contract) + note,
    "",
    "If any of this needs adjusting — timing, travel, or the shape of the session — please tell us and we will work it out.",
    "",
    "With thanks,",
    "",
    "",
    "______________________________",
    signer,
    ...(organisation ? [organisation] : []),
    conference.name,
  ].join("\n");

  return {
    subject: `Invitation — ${conference.name}${dateIsKnown ? `, ${dates}` : ""}`,
    body,
  };
};
