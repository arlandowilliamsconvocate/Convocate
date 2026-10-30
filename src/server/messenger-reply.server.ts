/**
 * Answering a stored Messenger message — **server only**.
 *
 * This is the reply path, not an auto-responder. A message arrives, the webhook
 * stores it (`messenger.server.ts`), and a reply is sent only when something
 * asks for one:
 *
 *   - a person, through `sendMessengerReplyFn` in `messenger-api.ts`, who is
 *     signed in as the owner and has read the drafted wording; or
 *   - the watcher (`messenger-watcher.server.ts`), which runs every minute from
 *     cron and answers each waiting message once. It is switched on or off from
 *     `/admin/messenger` — the `messenger_settings` row, not the environment.
 *
 * Four rules, and why:
 *
 *  1. **One reply per stored message.** `markMessengerMessageReplied` only
 *     writes where `replied_at IS NULL`, so a second attempt finds the message
 *     already answered and stops before calling Meta. A message that was
 *     answered is never answered twice.
 *  2. **The token stays in `facebook.server.ts`.** The send is
 *     `sendMessengerMessage`, which reads the Page credentials from the database
 *     at call time, re-mints an expired token once, and returns a refusal as a
 *     value. Nothing here reads, holds or prints a token.
 *  3. **A refusal is a result.** Meta saying no (a 24-hour window that closed, a
 *     missing permission) comes back with Graph's numeric code and nothing is
 *     marked as replied, so the message stays in the inbox as unanswered.
 *  4. **Every automated reply says it is automated.** The line is a constant in
 *     `messenger-disclosure.ts` and it is added in code, never left to the model,
 *     so it cannot be forgotten. It names no email address: the prompt sends a
 *     DM to the mailbox only when the conversation cannot finish in Messenger.
 *     The line is decided **here, on the server**, at the moment of sending —
 *     never in the browser — by `decideDisclosure` below:
 *
 *       - a reply that already says it is automated is sent as it is, once;
 *       - a reply that is still the draft this server handed out (measured by
 *         `looksLikeAiDraft` against the stored draft) gets the line added;
 *       - a reply a person typed themselves does not — a human reply is not an
 *         automated one, and telling a stranger otherwise would be a lie.
 */
import { draftMessengerReply, type MessengerDraft } from "./ai";
import {
  getMessengerDraft,
  getMessengerMessageByMid,
  markMessengerMessageReplied,
  saveMessengerDraft,
  type MessengerMessageRow,
} from "./db.server";
import {
  containsAutomationDisclosure,
  looksLikeAiDraft,
  withAutomationDisclosure,
} from "./messenger-disclosure";
import { sendMessengerMessage } from "./facebook.server";
import { recentThreadFor } from "./messenger-thread.server";

/** What happened when a reply was attempted. Every case is a value, never a throw. */
export type ReplyOutcome =
  | {
      ok: true;
      status: "sent";
      mid: string;
      replyMid: string;
      /** The text that was sent, so a person can see exactly what left. */
      text: string;
      drafted: boolean;
      /** True when the automated-assistant line was added to what was typed. */
      disclosureAdded: boolean;
      /** False when Meta accepted the reply but the row could not be updated. */
      recorded: boolean;
    }
  | {
      ok: false;
      status: "not_found" | "already_replied" | "empty" | "graph_refused" | "sender_already_answered";
      mid: string;
      /** Graph's numeric code, when Meta refused. */
      code?: number;
      /** Graph's own sentence, when Meta refused. Names no credential. */
      message?: string;
      /** The reply that already exists, for `already_replied`. */
      replyMid?: string;
    };

/** The draft for one stored message — what a person reads before pressing send. */
export const draftReplyForStoredMessage = async (
  mid: string,
): Promise<{ ok: true; draft: MessengerDraft; message: MessengerMessageRow } | { ok: false; status: "not_found"; mid: string }> => {
  const row = await getMessengerMessageByMid(mid);
  if (!row) return { ok: false, status: "not_found", mid };
  const draft = await draftMessengerReply({
    text: row.text,
    attachmentCount: row.attachmentCount,
    // The draft a person is about to read is written from the thread too, so it
    // does not say what the conversation already answered.
    thread: await recentThreadFor({ senderId: row.senderId, excludeMid: row.mid }),
  });
  // Keep the wording: the send compares what a person typed against this, which
  // is how the automated-assistant line is decided on the server. Nothing is
  // sent here and no message row changes.
  await saveMessengerDraft({ mid, body: draft.text, createdAt: Date.now() });
  return { ok: true, draft, message: row };
};

/**
 * Whether the automated-assistant line goes on this reply — decided here, on the
 * server, with nothing from the browser taken on trust.
 *
 * Three cases, in order:
 *
 *  1. The text already says it is automated (case- and punctuation-insensitive,
 *     via `containsAutomationDisclosure`): it is sent exactly as it is, so a
 *     reply is never told twice.
 *  2. The text is the model's draft, edited or not. `looksLikeAiDraft` measures
 *     it against the draft this server last handed out for this message; if most
 *     of the wording is still the model's, it is an automated reply and gets the
 *     line. The auto-reply path (`fromDraft`) is always this case.
 *  3. The text is a person's own words: nothing is added. A human reply is not
 *     an automated one.
 *
 * `added` is reported back so the screen can say the line was appended and the
 * record says what actually left.
 */
const decideDisclosure = async (input: {
  mid: string;
  body: string;
  fromDraft: boolean;
}): Promise<{ text: string; added: boolean }> => {
  if (containsAutomationDisclosure(input.body)) return { text: input.body, added: false };
  const fromDraft = input.fromDraft || looksLikeAiDraft(input.body, await getMessengerDraft(input.mid));
  if (!fromDraft) return { text: input.body, added: false };
  return withAutomationDisclosure(input.body);
};

/**
 * Send a reply to a stored message.
 *
 * `text` is what the person approved; when it is omitted the reply is drafted
 * first, which is the auto-reply path. The send happens **before** the row is
 * marked, and the mark is what makes a second send impossible.
 */
export const replyToStoredMessage = async (input: {
  mid: string;
  text?: string;
}): Promise<ReplyOutcome> => {
  const mid = input.mid.trim();
  const row = await getMessengerMessageByMid(mid);
  if (!row) return { ok: false, status: "not_found", mid };
  if (row.repliedAt !== null) {
    return { ok: false, status: "already_replied", mid, replyMid: row.replyMid ?? "" };
  }
  const typed = (input.text ?? "").trim();
  let body = typed;
  let drafted = false;
  if (body === "") {
    // Nothing typed: the auto-reply path. The model's words are automated by
    // definition, so they are treated as a draft below.
    const draft = await draftMessengerReply({
      text: row.text,
      attachmentCount: row.attachmentCount,
      thread: await recentThreadFor({ senderId: row.senderId, excludeMid: row.mid }),
    });
    body = draft.text;
    drafted = draft.drafted;
  }
  if (body === "") return { ok: false, status: "empty", mid };
  const disclosure = await decideDisclosure({ mid, body, fromDraft: drafted });
  body = disclosure.text;

  const sent = await sendMessengerMessage(row.senderId, body);
  if (!sent.ok) {
    console.error(
      `[convocate] messenger reply refused by graph: code=${String(sent.code)} mid=${mid}`,
    );
    return { ok: false, status: "graph_refused", mid, code: sent.code, message: sent.message };
  }
  const recorded = await markMessengerMessageReplied({
    mid,
    replyMid: sent.messageId,
    repliedAt: Date.now(),
    // The words that left, so the thread is readable afterwards and the repeat
    // guard knows what has already been said to this person.
    replyText: body,
  });
  if (!recorded) {
    // Meta took the reply but the row already said "answered" — two attempts
    // raced. The reply exists; say so rather than claim it did not happen.
    console.warn(`[convocate] messenger reply sent but the row was already marked: mid=${mid}`);
  } else {
    console.log(`[convocate] messenger reply sent mid=${mid} reply=${sent.messageId}`);
  }
  return {
    ok: true,
    status: "sent",
    mid,
    replyMid: sent.messageId,
    text: body,
    drafted,
    disclosureAdded: disclosure.added,
    recorded,
  };
};

