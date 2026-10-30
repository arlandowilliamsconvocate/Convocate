/**
 * The repeat guard — **pure, no imports, no database, no network**.
 *
 * The owner watched the Page answer the same question twice in slightly
 * different words and asked for the obvious: do not send a reply we have already
 * sent. So before an automated reply leaves, it is measured against the replies
 * already sent in that thread, and a near-identical one is not sent — the message
 * is flagged `repeat_draft` for a person instead.
 *
 * Why a comparison rather than a rule the model is trusted to keep: rule 4 of
 * the instruction already tells it not to repeat itself, and a rule is a
 * probability, not a guarantee. This is the check that holds when the model has
 * a bad day, and it costs one string compare per earlier reply.
 *
 * What counts as "near-identical", and why it is two tests rather than one:
 *
 *  - **the same words**: the two texts, lowercased and stripped of punctuation,
 *    are equal. No judgement at all.
 *  - **the same words rearranged**: word overlap of `REPEAT_OVERLAP` or more,
 *    measured as the Jaccard index of the two word sets (shared words divided by
 *    all words either text used). 0.75 is the judgement in this file: high
 *    enough that a genuinely new answer — a price applied to their event, the
 *    next step they asked for — never trips it, low enough that the same
 *    sentence with a different opening clause does.
 *
 * Deliberately not used: edit distance. It is O(n·m) per pair for a difference
 * this does not need, and a dependency is not worth it.
 */

/** How much of two replies' wording must be shared before one is a repeat. */
export const REPEAT_OVERLAP = 0.75;

/**
 * Replies shorter than this many words are never called repeats.
 *
 * "Yes, that's right" answering "Ok great!" twice is not the failure the owner
 * saw, and flagging it would leave a short, friendly exchange for a person to
 * finish by hand.
 */
export const REPEAT_MIN_WORDS = 5;

/** Lowercase, letters and digits only, single-spaced — for an exact compare. */
const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The words worth comparing: three characters up, so "the" and "a" cannot inflate a match. */
const wordsOf = (text: string): string[] =>
  normalize(text)
    .split(" ")
    .filter((word) => word.length >= 3);

/** What the guard decided, so the caller can log it without printing a message body. */
export type RepeatVerdict = {
  /** True when this draft says what we already said. */
  repeat: boolean;
  /** The overlap with the closest earlier reply, 0–1. */
  overlap: number;
  /** How many earlier replies were compared. */
  compared: number;
};

const NO_REPEAT: RepeatVerdict = { repeat: false, overlap: 0, compared: 0 };

/**
 * Is this draft saying what we already said in this thread?
 *
 * `sent` is every reply we know we sent to this person, newest first, with the
 * wording we recorded. An empty list — a first reply, or a thread answered
 * before replies were recorded — can never be a repeat.
 */
export const isRepeatOfSentReply = (draft: string, sent: string[]): RepeatVerdict => {
  const mine = normalize(draft);
  const myWords = wordsOf(draft);
  if (mine === "") return NO_REPEAT;

  let best: RepeatVerdict = { repeat: false, overlap: 0, compared: 0 };
  for (const previous of sent) {
    const theirs = normalize(previous);
    if (theirs === "") continue;
    best.compared += 1;

    // The same words. Nothing to judge.
    if (mine === theirs) return { repeat: true, overlap: 1, compared: best.compared };

    // Short replies are compared but never called repeats.
    if (myWords.length < REPEAT_MIN_WORDS) continue;

    const theirWords = wordsOf(previous);
    if (theirWords.length === 0) continue;
    const mineSet = new Set(myWords);
    const theirSet = new Set(theirWords);
    let shared = 0;
    for (const word of mineSet) if (theirSet.has(word)) shared += 1;
    const union = mineSet.size + theirSet.size - shared;
    const overlap = union === 0 ? 0 : shared / union;
    if (overlap > best.overlap) best = { repeat: false, overlap, compared: best.compared };
    if (overlap >= REPEAT_OVERLAP) {
      return { repeat: true, overlap, compared: best.compared };
    }
  }
  return best;
};
