/**
 * The Messenger watcher — **server only**.
 *
 * The owner's requirement, twice over: "Someone should be answering those
 * messages as soon as they come in" and "It should be someone answering those
 * messages at all times." Before this file, the webhook stored every DM and
 * nothing ever answered one: a real DM arrived at 19:42 and sat for 72 minutes
 * until a person read it by hand.
 *
 * How it runs: `/etc/cron.d/convocate-messenger` calls
 * `POST /api/meta/messenger-watcher` on this server once a minute, presenting a
 * shared secret read from the database. The endpoint calls `runMessengerWatcher`
 * below, so the answering happens inside the app, where the database, the model
 * client and the send function already live. Nothing here needs the owner to
 * paste anything.
 *
 * What one run does, in order:
 *
 *  1. **Reads the switch.** Off means off: nothing is drafted, nothing is sent,
 *     nothing is flagged. The run costs one read and returns.
 *  2. **Flags what can no longer be answered.** Meta only lets a Page reply
 *     inside the 24-hour window the person's message opened. Anything past 23.5
 *     hours is marked `needs_human` with the reason `window_closed` instead of
 *     being retried forever against a send that cannot succeed.
 *  3. **Answers what is waiting**, oldest first, one message at a time.
 *  4. **Never sends twice for one row.** Before a reply is drafted the row is
 *     *claimed* with a conditional UPDATE (`claimMessengerMessageForReply`), and
 *     the row is marked answered only by an UPDATE guarded on `replied_at IS
 *     NULL`. Two runs landing together cannot both send, and a second run after
 *     a successful one finds nothing to do.
 *
 * The guards, and what each one is for:
 *
 *  - **Never answer the Page.** The query excludes `sender_id = page_id`, so an
 *    echo that somehow reached the table cannot start a conversation with
 *    itself.
 *  - **One reply per inbound message.** One row, one reply, by the claim and the
 *    `replied_at IS NULL` guard together.
 *  - **Three automated replies, then a person.** A conversation that has had
 *    ten automated replies inside one hour is flagged `loop_limit`
 *    and left alone: if nobody is reading, the machine should not keep talking.
 *  - **No wrong reply on a bad day.** If the model cannot be reached, the draft
 *    is the fallback sentence and `drafted` is false — the watcher then flags
 *    `ai_unavailable` and sends nothing. A generic sentence is worse than a
 *    person reading it later.
 *  - **No reply twice.** The draft is measured against the replies already sent
 *    in this thread (`messenger-repeat.server.ts`); a near-identical one is not
 *    sent and the message is flagged `repeat_draft` instead.
 *  - **The draft reads the conversation.** Before the model is asked for words,
 *    the last few messages from this person — and what we answered — are loaded
 *    (`messenger-thread.server.ts`) and put in the prompt, so the reply is
 *    written by the correspondent they have been talking to, not by a stranger
 *    who has just seen one line.
 *
 * What is logged: the ids, the outcome, and the text of the replies *this*
 * watcher sent (our own words, and the proof the lead asked for). A person's
 * incoming message is never logged — only its mid.
 */
import { draftMessengerReply } from "./ai";
import { readPageCredentials, sendMessengerMessage } from "./facebook.server";
import {
  claimMessengerMessageForReply,
  countConsecutiveAutoReplies,
  flagMessengerNeedsHuman,
  flagStaleMessengerMessages,
  getMessengerMessageByMid,
  listMessengerMessagesAwaitingReply,
  listSentRepliesInThread,
  markMessengerMessageReplied,
  releaseMessengerReplyClaim,
} from "./db.server";
import { recentThreadFor } from "./messenger-thread.server";
import { isRepeatOfSentReply } from "./messenger-repeat.server";
import {
  autoReplyEnabled,
  readMessengerSettingsForScreen,
  recordCheck,
  recordFailure,
  recordReplySent,
} from "./messenger-settings.server";

/** Meta's window for a `messaging_type=RESPONSE` reply: 24 hours from the DM. */
export const MESSENGER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Where the watcher stops trying to answer: 23.5 hours, not 24.
 *
 * The last half hour is the margin for a slow run, a retry, and the clock
 * disagreeing with Meta's — a reply drafted at 23h59m and sent at 24h01m is
 * refused by Meta and looks like a bug. Past this the row is flagged instead.
 */
export const MESSENGER_SAFE_WINDOW_MS = 23.5 * 60 * 60 * 1000;

/** How long one run's claim on a row lasts before another run may take it. */
export const REPLY_CLAIM_TTL_MS = 5 * 60 * 1000;

/**
 * Automated replies allowed to one person inside a rolling hour.
 *
 * Ten, not three: a real conversation can easily run to four or five replies,
 * and the guard is only here to stop a runaway flood — never to go silent on
 * somebody who is still talking to us.
 */
export const MAX_CONSECUTIVE_AUTO_REPLIES = 10;

/** How many messages one run will answer. A cron tick is a minute; this is plenty. */
export const MAX_PER_RUN = 10;

/**
 * How stale the "last checked" line may get while the watcher is idle.
 *
 * A no-op run must be cheap and must not write a row every minute, so an idle
 * run refreshes the timestamp at most every five minutes. The screen is then
 * never more than five minutes behind, and the database takes 288 writes a day
 * instead of 1,440.
 */
const IDLE_CHECK_REFRESH_MS = 5 * 60 * 1000;

/** One reply the watcher sent, so the caller can report it. */
export type WatcherReply = { mid: string; replyMid: string; text: string };

/** One message the watcher deliberately left for a person. */
export type WatcherFlag = { mid: string; reason: string };

export type WatcherOutcome = {
  ok: true;
  /** The switch as this run saw it. */
  enabled: boolean;
  /** True when `MESSENGER_AUTO_REPLY` decided it rather than the database row. */
  envOverride: boolean;
  /** How many waiting messages this run looked at. */
  considered: number;
  sent: number;
  /** Messages left for a person by this run (window closed, model down, loop). */
  flagged: number;
  /** Waiting messages another run had already claimed. */
  skipped: number;
  replies: WatcherReply[];
  flags: WatcherFlag[];
  /** One line per thing that went wrong, without any secret or message body. */
  errors: string[];
  /** True when this run changed anything at all — the cron script logs only then. */
  didWork: boolean;
};

const emptyOutcome = (input: {
  enabled: boolean;
  envOverride: boolean;
}): WatcherOutcome => ({
  ok: true,
  enabled: input.enabled,
  envOverride: input.envOverride,
  considered: 0,
  sent: 0,
  flagged: 0,
  skipped: 0,
  replies: [],
  flags: [],
  errors: [],
  didWork: false,
});

/**
 * Answer whatever is waiting. Never throws: every failure is a value, because a
 * cron job that gets a stack trace learns nothing and a run that dies halfway
 * leaves the claim behind (the TTL handles that, but a clean return is better).
 */
export const runMessengerWatcher = async (nowMs: number = Date.now()): Promise<WatcherOutcome> => {
  const gate = await autoReplyEnabled();
  const outcome = emptyOutcome(gate);
  if (!gate.enabled) return outcome;

  let pageId = "";
  try {
    pageId = (await readPageCredentials()).pageId;
  } catch {
    outcome.errors.push("credentials_unavailable");
    return outcome;
  }
  if (pageId === "") {
    outcome.errors.push("no_page_id_stored");
    await recordFailure(nowMs, "no_page_id_stored").catch(() => undefined);
    return outcome;
  }

  const settings = await readMessengerSettingsForScreen();

  /* 1. Anything already past the window is flagged, not retried. */
  try {
    const stale = await flagStaleMessengerMessages({
      pageId,
      before: nowMs - MESSENGER_SAFE_WINDOW_MS,
      after: nowMs - 30 * 24 * 60 * 60 * 1000,
    });
    if (stale > 0) {
      outcome.flagged += stale;
      outcome.didWork = true;
      console.log(`[convocate] messenger watcher: flagged ${String(stale)} past the window`);
    }
  } catch (cause) {
    outcome.errors.push("could_not_flag_stale");
    console.error("[convocate] messenger watcher: could not flag stale messages", cause);
  }

  /* 2. What is waiting, inside the window Meta still allows a reply in. */
  let waiting: Awaited<ReturnType<typeof listMessengerMessagesAwaitingReply>> = [];
  try {
    waiting = await listMessengerMessagesAwaitingReply({
      pageId,
      since: nowMs - MESSENGER_WINDOW_MS,
      limit: MAX_PER_RUN,
    });
  } catch (cause) {
    outcome.errors.push("could_not_read_inbox");
    console.error("[convocate] messenger watcher: could not read the inbox", cause);
    return outcome;
  }
  outcome.considered = waiting.length;

  for (const row of waiting) {
    /* The row as it is *now*: another run or a person may have answered it. */
    const fresh = await getMessengerMessageByMid(row.mid).catch(() => null);
    if (!fresh) {
      outcome.skipped += 1;
      continue;
    }
    if (fresh.repliedAt !== null || fresh.needsHuman) {
      outcome.skipped += 1;
      continue;
    }
    if (nowMs - fresh.receivedAt > MESSENGER_SAFE_WINDOW_MS) {
      await flagMessengerNeedsHuman({ mid: fresh.mid, reason: "window_closed" }).catch(
        () => undefined,
      );
      outcome.flags.push({ mid: fresh.mid, reason: "window_closed" });
      outcome.flagged += 1;
      outcome.didWork = true;
      continue;
    }
    /* A flood of automated replies in one hour: stop and ask for a person. */
    const consecutive = await countConsecutiveAutoReplies(fresh.senderId).catch(() => 0);
    if (consecutive >= MAX_CONSECUTIVE_AUTO_REPLIES) {
      await flagMessengerNeedsHuman({ mid: fresh.mid, reason: "loop_limit" }).catch(
        () => undefined,
      );
      outcome.flags.push({ mid: fresh.mid, reason: "loop_limit" });
      outcome.flagged += 1;
      outcome.didWork = true;
      console.log(
        `[convocate] messenger watcher: stopped after ${String(consecutive)} automated replies in one hour — left for a person (mid=${fresh.mid})`,
      );
      continue;
    }
    /* The claim: one run, one row, one reply. */
    const claimed = await claimMessengerMessageForReply({
      mid: fresh.mid,
      nowMs,
      ttlMs: REPLY_CLAIM_TTL_MS,
    }).catch(() => false);
    if (!claimed) {
      outcome.skipped += 1;
      continue;
    }

    const thread = await recentThreadFor({ senderId: fresh.senderId, excludeMid: fresh.mid });
    const draft = await draftMessengerReply({
      text: fresh.text,
      attachmentCount: fresh.attachmentCount,
      systemInstruction: settings.systemPrompt,
      model: settings.model,
      thread,
    });
    if (!draft.drafted || draft.text.trim() === "") {
      // The model did not answer. A stand-in sentence is not an answer, so
      // nothing is sent and a person is told to look.
      await flagMessengerNeedsHuman({ mid: fresh.mid, reason: "ai_unavailable" }).catch(
        () => undefined,
      );
      await recordFailure(nowMs, "ai_unavailable").catch(() => undefined);
      outcome.flags.push({ mid: fresh.mid, reason: "ai_unavailable" });
      outcome.flagged += 1;
      outcome.didWork = true;
      outcome.errors.push("ai_unavailable");
      console.error(
        `[convocate] messenger watcher: no model answer for mid=${fresh.mid} — left for a person`,
      );
      continue;
    }

    /* Do not send what we already sent. */
    const alreadySent = await listSentRepliesInThread({
      senderId: fresh.senderId,
      limit: 6,
    }).catch(() => []);
    const repeat = isRepeatOfSentReply(draft.text, alreadySent);
    if (repeat.repeat) {
      // A person decides. The message stays unanswered rather than being told
      // the same thing twice, and the reason says exactly why.
      await flagMessengerNeedsHuman({ mid: fresh.mid, reason: "repeat_draft" }).catch(
        () => undefined,
      );
      outcome.flags.push({ mid: fresh.mid, reason: "repeat_draft" });
      outcome.flagged += 1;
      outcome.didWork = true;
      console.log(
        `[convocate] messenger watcher: draft repeats a reply already sent (overlap ${repeat.overlap.toFixed(2)}, ${String(repeat.compared)} compared) — left for a person (mid=${fresh.mid})`,
      );
      continue;
    }

    const sent = await sendMessengerMessage(fresh.senderId, draft.text);
    if (!sent.ok) {
      if (sent.code === 0) {
        // A transport failure: give the claim back so the next tick retries.
        await releaseMessengerReplyClaim(fresh.mid).catch(() => undefined);
        outcome.errors.push(`send_transport_failed:${sent.message}`);
        await recordFailure(nowMs, `send_transport_failed: ${sent.message}`).catch(
          () => undefined,
        );
        console.error(`[convocate] messenger watcher: send failed mid=${fresh.mid} (transport)`);
      } else {
        // Meta refused. Retrying a refusal every minute is noise, so this one is
        // left for a person, with Graph's numeric code and nothing else.
        await flagMessengerNeedsHuman({
          mid: fresh.mid,
          reason: `graph_refused:${String(sent.code)}`,
        }).catch(() => undefined);
        await recordFailure(nowMs, `graph_refused:${String(sent.code)}`).catch(() => undefined);
        outcome.flags.push({ mid: fresh.mid, reason: `graph_refused:${String(sent.code)}` });
        outcome.flagged += 1;
        outcome.didWork = true;
        outcome.errors.push(`graph_refused:${String(sent.code)}`);
        console.error(
          `[convocate] messenger watcher: graph refused mid=${fresh.mid} code=${String(sent.code)}`,
        );
      }
      continue;
    }

    const recorded = await markMessengerMessageReplied({
      mid: fresh.mid,
      replyMid: sent.messageId,
      repliedAt: Date.now(),
      repliedBy: "auto",
      // The words, so the next draft in this thread can read what we said and
      // the repeat guard has something to compare against.
      replyText: draft.text,
    }).catch(() => false);
    if (!recorded) {
      // Meta took the reply but the row already said answered. The reply exists;
      // say so rather than pretend it did not happen.
      console.warn(
        `[convocate] messenger watcher: sent for mid=${fresh.mid} but the row was already marked`,
      );
    }
    await recordReplySent(nowMs).catch(() => undefined);
    outcome.sent += 1;
    outcome.didWork = true;
    outcome.replies.push({ mid: fresh.mid, replyMid: sent.messageId, text: draft.text });
    console.log(
      `[convocate] messenger watcher: replied mid=${fresh.mid} reply=${sent.messageId} to=${fresh.senderId}\n${draft.text}`,
    );
  }

  /* 3. "Last checked", refreshed at most every five minutes while idle. */
  if (outcome.didWork || nowMs - settings.lastCheckAt >= IDLE_CHECK_REFRESH_MS) {
    await recordCheck(nowMs).catch(() => undefined);
  }
  return outcome;
};
