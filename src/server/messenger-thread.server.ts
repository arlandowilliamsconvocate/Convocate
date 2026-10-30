/**
 * The conversation as the drafter reads it — **server only**.
 *
 * A reply is half of a conversation, and until this file existed the drafter was
 * handed the other half only: one message, on its own. So the Page answered
 * "How much does the package cost?" with the price, and then answered "I haven't
 * received an answers yet?" with "I don't have visibility into your previous
 * inquiry" — a sentence that was true of the prompt and false of the business.
 *
 * What this turns the stored rows into: the last few messages this person sent,
 * oldest first, each followed by the reply we sent to it. That is the whole
 * thread as the database holds it, shaped for `buildMessengerPrompt`.
 *
 * Two rules about what goes in:
 *
 *  - **The message being answered is left out.** It is passed to the prompt
 *    separately, as "the message you are answering now"; having it in both
 *    places makes the model answer it twice.
 *  - **A reply whose wording was not recorded says only that it was answered.**
 *    Rows answered before `reply_text` existed keep no words, and inventing them
 *    — or hiding that a reply went out — would both be worse than the plain
 *    truth "(you replied to this)".
 */
import { listMessengerThread } from "./db.server";
import type { MessengerThreadEntry } from "./ai/prompts";

/** How many of the person's messages the drafter sees. The last six, as briefed. */
export const THREAD_MESSAGES = 6;

/** The placeholder for a reply we sent before its wording was kept. */
export const UNRECORDED_REPLY = "(you replied to this)";

/**
 * The recent thread with one person, oldest first, without the message being
 * answered. Never throws: a failed read is an empty thread, which the prompt
 * states plainly ("nothing earlier") rather than failing the reply.
 */
export const recentThreadFor = async (input: {
  senderId: string;
  /** The message being answered now — dropped from the history. */
  excludeMid: string;
  limit?: number;
}): Promise<MessengerThreadEntry[]> => {
  const rows = await listMessengerThread({
    senderId: input.senderId,
    limit: input.limit ?? THREAD_MESSAGES,
  }).catch(() => []);

  const entries: MessengerThreadEntry[] = [];
  for (const row of rows) {
    if (row.mid === input.excludeMid) continue;
    if (row.text.trim() !== "" || row.attachmentCount > 0) {
      entries.push({ from: "them", text: row.text, at: row.receivedAt });
    }
    if (row.repliedAt !== null) {
      entries.push({
        from: "us",
        text: row.replyText.trim() === "" ? UNRECORDED_REPLY : row.replyText,
        at: row.repliedAt,
      });
    }
  }
  return entries;
};
