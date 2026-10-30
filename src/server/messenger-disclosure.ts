/**
 * The automation disclosure, and the two decisions built on it — **pure, no
 * imports, no database, no network**.
 *
 * Why this file exists on its own: the privacy page promises, in public, that
 * "every automated reply says that it is automated". That promise is kept by
 * code in two different places — the drafting path (`ai/index.ts`) and the send
 * path (`messenger-reply.server.ts`) — and both must agree on exactly what the
 * line says and what counts as having said it. One constant, one check, one
 * place to change.
 *
 * The three functions:
 *
 *  - `containsAutomationDisclosure` — does this text already say it is
 *    automated? Case- and punctuation-insensitive, so "Automated assistant!"
 *    counts and the line is never printed twice.
 *  - `withAutomationDisclosure` — the same text, with the line added only when
 *    it is missing.
 *  - `looksLikeAiDraft` — was this text written by the model and then edited,
 *    rather than typed from scratch by a person? Used server-side on send: a
 *    person pressing send on an edited draft is sending an automated reply and
 *    gets the line; a person typing their own words is a human reply and does
 *    not.
 */

/**
 * No line is added to a reply. The owner asked for it removed on 2026-10-24:
 * "I do not want that wording in the message."
 *
 * Kept as an empty constant rather than deleted so every caller keeps compiling
 * and `withAutomationDisclosure` stays the one place a line would ever be added.
 * The honesty it protected does not disappear with it: the prompt still tells the
 * model to say plainly that it is automated whenever somebody asks whether they
 * are talking to a person, and the privacy page says the same thing in public.
 */
export const MESSENGER_REPLY_FOOTER = "";

/**
 * Lowercase, punctuation and spacing flattened to single spaces, with one space
 * at each end so a phrase check can require word boundaries without a regex
 * escaping a customer's apostrophe.
 */
const flatten = (text: string): string =>
  ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/**
 * The ways a reply can say it is automated. Short on purpose: a phrase not on
 * this list means the fixed line is added, and a line too many is a far smaller
 * problem than an automated reply that pretends to be a person.
 */
const DISCLOSURE_PHRASES = [
  "automated assistant",
  "automated reply",
  "automated replies",
  "automated message",
  "automated response",
  "automated bot",
  "am a bot",
  "is a bot",
  "not a person",
] as const;

/** Does this text already tell the reader it is automated? */
export const containsAutomationDisclosure = (text: string): boolean => {
  const flat = flatten(text);
  if (flat.includes(flatten(MESSENGER_REPLY_FOOTER).trim())) return true;
  return DISCLOSURE_PHRASES.some((phrase) => flat.includes(` ${phrase} `));
};

/**
 * The text with the line added when it is missing.
 *
 * `added` is returned rather than guessed at by the caller: the inbox screen
 * tells the person that the line was appended, and the reply outcome carries it
 * back so the record says what actually left.
 */
export const withAutomationDisclosure = (text: string): { text: string; added: boolean } => {
  const trimmed = text.trim();
  if (trimmed === "") return { text: "", added: false };
  // Nothing is appended: the reply goes out as written. `added` stays false so
  // the inbox screen and the record never claim a line was added.
  if (MESSENGER_REPLY_FOOTER === "") return { text: trimmed, added: false };
  if (containsAutomationDisclosure(trimmed)) return { text: trimmed, added: false };
  return { text: `${trimmed}\n\n${MESSENGER_REPLY_FOOTER}`, added: true };
};

/** Words worth comparing: lowercase, letters and digits, three characters up. */
const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length >= 3);

/**
 * How much of the sent text has to have come from the draft before it is
 * treated as the draft. Measured as the share of the sent text's words that
 * appear in the draft.
 *
 * 0.6 is a judgement, and it is the only judgement in this file: below it, the
 * person has rewritten the reply in their own words and it is theirs; above it,
 * the wording is still the model's and the line belongs on it.
 */
export const AI_DRAFT_OVERLAP = 0.6;

/**
 * Was the text that is about to be sent the model's draft, edited — or a
 * person's own reply?
 *
 * `draft` is the draft this server handed out for this message (stored when the
 * draft was made), or null when nobody asked for one. A reply shorter than four
 * words is never treated as a draft: "Yes, that's right" is a person typing.
 */
export const looksLikeAiDraft = (sent: string, draft: string | null): boolean => {
  if (draft === null || draft.trim() === "") return false;
  const mine = words(sent);
  if (mine.length < 4) return false;
  const theirs = new Set(words(draft));
  let shared = 0;
  for (const word of mine) if (theirs.has(word)) shared += 1;
  return shared / mine.length >= AI_DRAFT_OVERLAP;
};
