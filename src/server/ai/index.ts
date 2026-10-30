/**
 * The one function the app calls: `askHelp`.
 *
 * Everything about a question is decided here, on the server:
 *
 *   * the account comes from the session, never from the request body — this
 *     module never accepts a user id, an account id or a conference id;
 *   * both usage guards are counted from `ai_usage` before a call is made, so a
 *     browser cannot talk its way past them;
 *   * the model is handed the help topics and the question and nothing else —
 *     no organizer's event data is read, and none is passed in this slice;
 *   * every outcome is a plain result. Nothing throws, so a quota that runs dry
 *     or a key that is missing reads as a sentence, never as a stack trace.
 *
 * It also writes nothing except one row in `ai_usage`. No conference, contract,
 * budget line, document, checklist, attendee or signature is touched.
 */
import {
  countAiQuestionsForUserSince,
  countAiQuestionsSince,
  recordAiQuestion,
} from "../db.server";
import { helpDocsAsText } from "./help-docs";
import {
  HELP_SYSTEM_INSTRUCTION,
  MESSENGER_SYSTEM_INSTRUCTION,
  STAND_SYSTEM_INSTRUCTION,
  buildHelpPrompt,
  buildMessengerPrompt,
  buildStandPrompt,
  type MessengerThreadEntry,
} from "./prompts";
// The facts the status summary is written from, and the check that keeps it to
// them. Shared with the page, so the figures the model was given and the figures
// the reader is shown are the same ones.
import {
  standAllowedNumbers,
  standFactsBlock,
  ungroundedFigures,
  type StandFacts,
} from "../../lib/stand";
import { AI_NOT_CONFIGURED, askAi, isAiConfigured } from "./provider";
import { withAutomationDisclosure } from "../messenger-disclosure";

/** Questions one account may ask in a rolling hour. */
export const AI_HOURLY_LIMIT = 20;
/** The site-wide window and how many questions may go to Google inside it. */
export const AI_GLOBAL_WINDOW_MS = 60_000;
export const AI_GLOBAL_LIMIT = 4;
/** The longest question accepted; longer ones are refused by the server function. */
export const AI_QUESTION_MAX = 1_000;
/** How much of an answer the card will print. */
const ANSWER_MAX = 4_000;

const HOUR_MS = 60 * 60 * 1000;

export const AI_HOURLY_MESSAGE =
  "You have asked a lot in the last hour — try again shortly. If you need an answer now, email hello@mail.getconvocate.com.";
export const AI_BUSY_MESSAGE = "The assistant is busy right now — try again in a minute.";
export const AI_EMPTY_MESSAGE = "Type a question first — for example, \"What does the $199 unlock include?\"";

export type HelpResult =
  | { ok: true; answer: string }
  | { ok: false; reason: "quota" | "config" | "error"; message: string };

export const askHelp = async (input: { userId: number; question: string }): Promise<HelpResult> => {
  const question = String(input.question ?? "").trim().slice(0, AI_QUESTION_MAX);
  if (!question) return { ok: false, reason: "error", message: AI_EMPTY_MESSAGE };

  // No key: say so before counting anything, and never call Google.
  if (!isAiConfigured()) return { ok: false, reason: "config", message: AI_NOT_CONFIGURED };

  const now = Date.now();

  // 20 per account per hour.
  const forThisAccount = await countAiQuestionsForUserSince(input.userId, now - HOUR_MS);
  if (forThisAccount >= AI_HOURLY_LIMIT) {
    return { ok: false, reason: "quota", message: AI_HOURLY_MESSAGE };
  }

  // At most 4 site-wide in any 60 seconds — this is what keeps a small
  // free-tier key from being hammered by the whole site at once.
  const siteWide = await countAiQuestionsSince(now - AI_GLOBAL_WINDOW_MS);
  if (siteWide >= AI_GLOBAL_LIMIT) {
    return { ok: false, reason: "quota", message: AI_BUSY_MESSAGE };
  }

  // The row is written only now — an attempt is about to be made.
  await recordAiQuestion(input.userId, question, now);

  const result = await askAi(HELP_SYSTEM_INSTRUCTION, buildHelpPrompt(helpDocsAsText(), question));
  if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
  return { ok: true, answer: result.text.trim().slice(0, ANSWER_MAX) };
};

/* ------------------------------------------------- the Messenger reply draft */

/**
 * The line every automated Messenger reply ends with, added in code rather than
 * asked of the model.
 *
 * Why fixed: one claim in a reply to a stranger has to be true every time — that
 * the reply is automated. A model can forget it; a constant cannot. It names no
 * email address, because the address is now the model's own judgement: the
 * prompt sends a DM to the mailbox only when the conversation cannot finish in
 * Messenger (see `MESSENGER_SYSTEM_INSTRUCTION`), and a fixed line offering it
 * on every reply is exactly the deflection the owner asked us to stop.
 *
 * It lives in `messenger-disclosure.ts` with the check that stops it being said
 * twice; it is re-exported here because this is where the draft is assembled.
 */
export { MESSENGER_REPLY_FOOTER } from "../messenger-disclosure";

/**
 * What a reply says when the model cannot be reached.
 *
 * The old sentence promised that "a person will read your message and reply as
 * soon as they can" — which nobody is set up to do, and which would have been a
 * promise made on the owner's behalf by a fallback. This one says what actually
 * happened, and sends the reader to the one place a person does answer.
 */
export const MESSENGER_FALLBACK_BODY =
  "Thanks for writing to Convocate — the reply system had trouble just now, so this one didn't get a real answer. Email hello@mail.getconvocate.com and a person will answer there.";

/** The longest reply body kept, before the fixed line is added. */
export const MESSENGER_REPLY_MAX = 600;

export type MessengerDraft = {
  /** The whole reply: body, then the fixed line. Ready to send or to show a person. */
  text: string;
  /** True when a model wrote the body; false when the fallback sentence was used. */
  drafted: boolean;
};

export type { MessengerThreadEntry };

/**
 * Draft a reply to one DM.
 *
 * This is **not** an auto-responder. It is called by the reply path — a person
 * pressing send on a stored message — and by the `MESSENGER_AUTO_REPLY` branch,
 * which is off by default and has to be switched on deliberately.
 *
 * It never throws and never fails: if there is no key, or the model is busy, the
 * reader gets the fallback sentence plus the same fixed line. That is the whole
 * contract, and it is why the return type has no `ok` — there is always a reply
 * to show.
 *
 * No quota is counted here, on purpose: `ai_usage` counts *visitors asking the
 * site questions*, and a Page DM is answered at most once per stored message, by
 * hand or by the (off) auto-reply branch. Nothing loops.
 */
export const draftMessengerReply = async (input: {
  text: string;
  attachmentCount: number;
  /**
   * The instruction to write under. The watcher passes the one stored in
   * `messenger_settings`, so the voice can be changed from `/admin/messenger`
   * without a deploy; omitted means the built-in one.
   */
  systemInstruction?: string;
  /** The model name, also from `messenger_settings`. "" means the provider's own. */
  model?: string;
  /**
   * The recent exchange with this person, oldest first, **without** the message
   * being answered (the caller drops it). Omitted or empty means "no earlier
   * messages", and the prompt says so rather than leaving a blank.
   *
   * This is what turns one-line answering into a conversation: before it, the
   * model saw a single message and told a reader who had already asked twice
   * that it had "no visibility into your previous inquiry".
   */
  thread?: MessengerThreadEntry[];
}): Promise<MessengerDraft> => {
  const message = String(input.text ?? "").trim().slice(0, AI_QUESTION_MAX);
  const attachments = Number.isFinite(input.attachmentCount)
    ? Math.max(0, Math.trunc(input.attachmentCount))
    : 0;
  // The line is added only when the body does not already say it — a model that
  // answered "am I talking to a bot?" with "I'm an automated assistant" must not
  // be told twice.
  const finish = (body: string, drafted: boolean): MessengerDraft => ({
    text: withAutomationDisclosure(body.trim().slice(0, MESSENGER_REPLY_MAX)).text,
    drafted,
  });
  // An attachment with no words is still a message worth answering — the model
  // is told it cannot see the file, and asks what is needed.
  if (message === "" && attachments === 0) return finish(MESSENGER_FALLBACK_BODY, false);
  if (!isAiConfigured()) return finish(MESSENGER_FALLBACK_BODY, false);
  const instruction = (input.systemInstruction ?? "").trim();
  const result = await askAi(
    instruction === "" ? MESSENGER_SYSTEM_INSTRUCTION : instruction,
    buildMessengerPrompt(message, attachments, input.thread ?? []),
    { model: input.model ?? "" },
  );
  if (!result.ok || result.text.trim() === "") return finish(MESSENGER_FALLBACK_BODY, false);
  return finish(result.text, true);
};
/* ------------------------------------------------------- where you stand */
/** The longest summary kept. Five sentences sit well under this; a runaway one is cut. */
export const STAND_SUMMARY_MAX = 900;
/**
 * What came back for a status summary.
 *
 * `ungrounded` is its own reason rather than an error: it means a model answered
 * but wrote a figure that was not in the data it was given, and the sentence was
 * thrown away. The panel treats it exactly like `error` — the numbers line stays
 * and no paragraph appears — but the distinction is kept because it is the one
 * failure that is about honesty rather than availability, and it should be
 * visible in a log rather than hidden inside "it did not work".
 */
export type StandSummaryResult =
  | { ok: true; summary: string }
  | { ok: false; reason: "empty" | "config" | "quota" | "error" | "ungrounded" };
/** Whitespace, stray markdown and a wrapping pair of quotes — nothing else is rewritten. */
const tidySummary = (text: string): string =>
  text
    .replace(/\r/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .trim();
/**
 * Write the "Where you stand" summary for one conference.
 *
 * The whole of its input is `facts` — the object built by `buildStandFacts` from
 * rows that already exist. Nothing else is passed and nothing else can be
 * reached from here, so the summary can only ever restate what the organizer's
 * own records hold.
 *
 * Two guards run after the model answers:
 *
 *   * `ungroundedFigures` compares every figure in the reply against the figures
 *     the model was given; one that is not there discards the whole summary; and
 *   * the reply is cut at `STAND_SUMMARY_MAX` so a model that ignores "three to
 *     five sentences" cannot fill the panel.
 *
 * It never throws. A missing key, a busy provider or an invented figure all come
 * back as `ok: false`, and the panel then shows the numbers line on its own —
 * which is true, and is the whole of what the reader needs.
 */
export const summarizeEventStand = async (facts: StandFacts): Promise<StandSummaryResult> => {
  // Nothing on the conference: no call is made at all, and none is needed.
  if (!facts.hasData) return { ok: false, reason: "empty" };
  if (!isAiConfigured()) return { ok: false, reason: "config" };
  const result = await askAi(STAND_SYSTEM_INSTRUCTION, buildStandPrompt(standFactsBlock(facts)));
  if (!result.ok) return { ok: false, reason: result.reason === "quota" ? "quota" : "error" };
  const summary = tidySummary(result.text);
  if (summary === "") return { ok: false, reason: "error" };
  if (ungroundedFigures(summary, standAllowedNumbers(facts)).length > 0) {
    return { ok: false, reason: "ungrounded" };
  }
  return { ok: true, summary: summary.slice(0, STAND_SUMMARY_MAX) };
};
