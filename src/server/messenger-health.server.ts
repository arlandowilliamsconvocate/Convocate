/**
 * Messenger health — **server only**.
 *
 * Why this file exists: on 27 October 2026 a direct message reached the Page at
 * 20:56 and nothing answered it. The webhook stored the row correctly, the send
 * path was healthy, and the switch said "on" — but the one process that calls the
 * watcher (a `while true` loop on this machine) was dead, because the computer had
 * been replaced and nothing restarts that loop. By the time a loop came back the
 * message was past Meta's 24-hour reply window and could not be answered at all.
 *
 * The failure was silence: every part of the system was "fine" while a person
 * waited. So the rule this module enforces is simple — **if the Page cannot
 * answer, the owner is told by email, once per incident, with ids and outcomes
 * and never the words of the message.**
 *
 * What it watches:
 *
 *  - **The runner itself.** `heartbeat_last_ok_at` is written by every watcher run
 *    that completes. If that stamp is older than ten minutes, the runner is dead
 *    and nothing will ever answer — that is the 27 October failure, and it is now
 *    an email rather than a quiet database row.
 *  - **A message that is waiting.** Anything unanswered for more than thirty
 *    minutes inside the window Meta still allows is a person being ignored. One
 *    email per message, ever (the key is the message id).
 *  - **The 24-hour cliff.** A message the watcher can no longer answer because the
 *    window closed is reported the moment it is flagged, so the owner knows a real
 *    person was left waiting and why. Same rule: one email per message.
 *
 * Deduplication is in `messenger_settings` (a key/value table that already
 * exists), one `alert:…` key per incident. Nothing here needs a schema change, and
 * a fresh database cannot produce a flood: an incident that has been reported
 * never reports again, and a successful run after a stale period starts a new
 * incident only when the watcher dies again.
 *
 * What is never included in an email or a log line: the text of anybody's
 * message. Ids, timestamps, counts and reason words only.
 */
import {
  messengerHealthCounts,
  messengerNeedsHumanRows,
  pruneMessengerAlertKeys,
  readMessengerSettings,
  writeMessengerSetting,
} from "./db.server";
import { readPageCredentials } from "./facebook.server";
import { sendMail } from "./mail.server";

/** A run older than this means nothing is answering. Ten minutes, as specified. */
export const WATCHER_STALE_MS = 10 * 60 * 1000;

/** A message waiting longer than this is a person being ignored. */
export const MESSAGE_WAITING_ALERT_MS = 30 * 60 * 1000;

/**
 * Where an alert goes.
 *
 * The owner's own address, and a database row can replace it
 * (`alert_email` on `/admin/messenger`) without a deploy. It is deliberately not
 * read from a file on disk: the app has to work on the live site too, where
 * `/home/team/shared` does not exist.
 */
export const OWNER_ALERT_EMAIL = "arlando.williams@gmail.com";
export const SETTING_ALERT_EMAIL = "alert_email";

/** Settings keys written by the watcher (see `recordHeartbeat`). */
export const SETTING_HEARTBEAT_RUN = "heartbeat_last_run_at";
export const SETTING_HEARTBEAT_OK = "heartbeat_last_ok_at";
export const SETTING_HEARTBEAT_ERROR = "heartbeat_last_error";
export const SETTING_HEARTBEAT_ERROR_AT = "heartbeat_last_error_at";
export const SETTING_LAST_ALERT_AT = "alert_last_at";
export const SETTING_LAST_ALERT_RESULT = "alert_last_result";

/** One alert key per incident. Kept short: this table is read on every screen. */
const ALERT_PREFIX = "alert:";

/** Everything `/admin/messenger` and the dead-man's switch both need. */
export type MessengerHealth = {
  /** When the numbers were taken. */
  now: number;
  /** When the watcher last *completed* a run. 0 means it never has. */
  lastOkAt: number;
  /** When a run last started, successful or not. */
  lastRunAt: number;
  /** How long ago the last completed run was, in milliseconds. */
  staleMs: number;
  /** True when nothing has completed a run inside `WATCHER_STALE_MS`. */
  stale: boolean;
  /** The last error a run recorded, already scrubbed of anything sensitive. */
  lastError: string;
  lastErrorAt: number;
  /** Newest inbound message from anybody but the Page. 0 when none. */
  lastInboundAt: number;
  /** Newest reply we recorded sending. 0 when none. */
  lastReplyAt: number;
  /** Unanswered and not yet set aside for a person. */
  unanswered: number;
  /** Unanswered and waiting more than thirty minutes. */
  waitingOver30: number;
  /** Oldest of those, so the screen can say how long the worst one has waited. */
  oldestUnansweredAt: number;
  /** Unanswered and past Meta's 24-hour window — a person a human must reach. */
  windowClosed: number;
  /** Where an alert would go. */
  alertEmail: string;
  lastAlertAt: number;
  lastAlertResult: string;
};

const number = (raw: string | undefined): number => {
  const value = Number((raw ?? "").trim());
  return Number.isFinite(value) && value > 0 ? value : 0;
};

/** The health snapshot, read-only, for the admin screen. */
export const readMessengerHealth = async (nowMs: number = Date.now()): Promise<MessengerHealth> => {
  const settings = await readMessengerSettings();
  /* The Page's own id, so an echo of our own reply is never counted as a person
     waiting. An unreadable credential table is not a reason to fail the panel:
     the counts then simply exclude nothing, and the screen already says the
     credentials are missing. */
  const pageId = await readPageCredentials()
    .then((credentials) => credentials.pageId)
    .catch(() => "");
  const counts = await messengerHealthCounts({
    nowMs,
    unansweredMs: MESSAGE_WAITING_ALERT_MS,
    since: nowMs - 30 * 24 * 60 * 60 * 1000,
    pageId,
  });
  const lastOkAt = number(settings[SETTING_HEARTBEAT_OK]);
  const lastRunAt = number(settings[SETTING_HEARTBEAT_RUN]);
  const alertEmail = (settings[SETTING_ALERT_EMAIL] ?? "").trim() || OWNER_ALERT_EMAIL;
  return {
    now: nowMs,
    lastOkAt,
    lastRunAt,
    staleMs: lastOkAt === 0 ? 0 : Math.max(0, nowMs - lastOkAt),
    stale: lastOkAt === 0 ? lastRunAt > 0 : nowMs - lastOkAt > WATCHER_STALE_MS,
    lastError: (settings[SETTING_HEARTBEAT_ERROR] ?? "").trim(),
    lastErrorAt: number(settings[SETTING_HEARTBEAT_ERROR_AT]),
    lastInboundAt: counts.lastInboundAt,
    lastReplyAt: counts.lastReplyAt,
    unanswered: counts.unanswered,
    waitingOver30: counts.waitingOver30,
    oldestUnansweredAt: counts.oldestUnansweredAt,
    windowClosed: counts.windowClosed,
    alertEmail,
    lastAlertAt: number(settings[SETTING_LAST_ALERT_AT]),
    lastAlertResult: (settings[SETTING_LAST_ALERT_RESULT] ?? "").trim(),
  };
};

/** Record that a watcher run started, and whether it completed. */
export const recordHeartbeat = async (input: {
  at: number;
  ok: boolean;
  error?: string;
}): Promise<void> => {
  await writeMessengerSetting(SETTING_HEARTBEAT_RUN, String(input.at));
  if (input.ok) {
    await writeMessengerSetting(SETTING_HEARTBEAT_OK, String(input.at));
    return;
  }
  await Promise.all([
    writeMessengerSetting(SETTING_HEARTBEAT_ERROR_AT, String(input.at)),
    writeMessengerSetting(SETTING_HEARTBEAT_ERROR, (input.error ?? "run_failed").slice(0, 200)),
  ]);
};

/** `2 minutes`, `3 hours`, `4 days` — the phrase a person reads on the screen. */
export const describeGap = (ms: number): string => {
  if (ms <= 0) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${String(minutes)} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${String(hours)} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${String(days)} day${days === 1 ? "" : "s"}`;
};

/** `27 Oct 2026, 20:56 UTC` — UTC by hand, so server and browser always agree. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const describeStamp = (ms: number): string => {
  if (!ms) return "never";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "never";
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${String(
    date.getUTCFullYear(),
  )}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
};

/** One thing worth telling the owner about. */
type PendingAlert = {
  /** The dedupe key. One key, one email, ever. */
  key: string;
  /** The sentence the email is built from. */
  line: string;
};

/**
 * Send the owner one email about whatever is wrong, then mark each incident as
 * reported so the next run says nothing.
 *
 * Returns what it did, so the caller can log it — and so a test can assert on it
 * without reading the owner's inbox. Never throws: an alerting bug must not take
 * the responder down with it.
 */
export const runMessengerHealthChecks = async (
  nowMs: number = Date.now(),
): Promise<{ alerted: string[]; skipped: string[]; errors: string[]; mailId: string }> => {
  const result: {
    alerted: string[];
    skipped: string[];
    errors: string[];
    /** The provider's id for the alert email, so a person can prove it was sent. */
    mailId: string;
  } = {
    alerted: [],
    skipped: [],
    errors: [],
    mailId: "",
  };
  try {
    const settings = await readMessengerSettings();
    const health = await readMessengerHealth(nowMs);
    const pageId = await readPageCredentials()
      .then((credentials) => credentials.pageId)
      .catch(() => "");
    const pending: PendingAlert[] = [];

    /* 1. Is anything running at all? The 27 October failure, as an email. */
    if (health.stale) {
      const incident = `stale:${String(health.lastOkAt)}`;
      if ((settings[`${ALERT_PREFIX}stale_runner`] ?? "") !== incident) {
        pending.push({
          key: "stale_runner",
          line:
            health.lastOkAt === 0
              ? `The Messenger watcher has never completed a run. Nothing will answer a direct message until it does.`
              : `The Messenger watcher has not completed a run for ${describeGap(health.staleMs)} (last one ${describeStamp(health.lastOkAt)}). Nothing is answering direct messages while it is down.`,
        });
      } else {
        result.skipped.push("stale_runner");
      }
    }

    /* 2. A person waiting inside the window: something is wrong but not fatal. */
    if (health.waitingOver30 > 0) {
      const waiting = await messengerNeedsHumanRows({
        reason: "",
        olderThan: nowMs - MESSAGE_WAITING_ALERT_MS,
        since: nowMs - 30 * 24 * 60 * 60 * 1000,
        pageId,
        limit: 20,
      });
      for (const row of waiting) {
        const key = `waiting:${row.mid}`;
        if (settings[`${ALERT_PREFIX}${key}`] !== undefined) {
          result.skipped.push(key);
          continue;
        }
        pending.push({
          key,
          line: `Unanswered for ${describeGap(nowMs - row.receivedAt)}: message ${row.mid} from ${row.senderId} (received ${describeStamp(row.receivedAt)}). It can still be answered, but not for much longer.`,
        });
      }
    }

    /* 3. The 24-hour cliff: a person we can no longer reach automatically. */
    const closed = await messengerNeedsHumanRows({
      reason: "window_closed",
      olderThan: 0,
      since: nowMs - 30 * 24 * 60 * 60 * 1000,
      pageId,
      limit: 20,
    });
    for (const row of closed) {
      const key = `window_closed:${row.mid}`;
      if (settings[`${ALERT_PREFIX}${key}`] !== undefined) {
        result.skipped.push(key);
        continue;
      }
      pending.push({
        key,
        line: `Past the 24-hour reply window and unanswered: message ${row.mid} from ${row.senderId}, received ${describeStamp(row.receivedAt)}. It cannot be answered automatically now — the person has to write again, or a human replies from the Page inbox.`,
      });
    }

    if (pending.length === 0) return result;

    const subject = `[Convocate] Messenger: ${String(pending.length)} thing${pending.length === 1 ? "" : "s"} needs you`;
    const text = [
      "The Convocate Page is not answering Messenger the way it should. Nothing is needed from you to restart it — this is the alert that used to be silence.",
      "",
      ...pending.map((item) => `- ${item.line}`),
      "",
      `Watcher last completed a run: ${health.lastOkAt === 0 ? "never" : `${describeStamp(health.lastOkAt)} (${describeGap(health.staleMs)} ago)`}`,
      `Last direct message received: ${health.lastInboundAt === 0 ? "never" : describeStamp(health.lastInboundAt)}`,
      `Last reply sent: ${health.lastReplyAt === 0 ? "never" : describeStamp(health.lastReplyAt)}`,
      `Unanswered right now: ${String(health.unanswered)}`,
      "",
      "The health panel is at /admin/messenger. No message text is included in this alert.",
    ].join("\n");

    const sent = await sendMail({ to: health.alertEmail, subject, text });
    if (!sent.ok) {
      const why = sent.skipped ? "mail_not_configured" : (sent.error ?? "send_failed");
      /* Not marked as alerted, so the next run tries again rather than going quiet. */
      result.errors.push(`alert_send_failed:${why}`);
      await writeMessengerSetting(SETTING_LAST_ALERT_RESULT, `failed: ${why}`.slice(0, 200));
      console.error(`[convocate] messenger alert: send failed (${why})`);
      return result;
    }

    await Promise.all(
      pending.map(async (item) => {
        /* The stale key stores the incident, so a later death is a new alert. */
        const value = item.key === "stale_runner" ? `stale:${String(health.lastOkAt)}` : "1";
        await writeMessengerSetting(`${ALERT_PREFIX}${item.key}`, value);
        result.alerted.push(item.key);
      }),
    );
    result.mailId = sent.id ?? "";
    result.mailId = sent.id ?? "";
    await Promise.all([
      writeMessengerSetting(SETTING_LAST_ALERT_AT, String(nowMs)),
      writeMessengerSetting(SETTING_LAST_ALERT_RESULT, `sent ${String(pending.length)}`),
    ]);
    /* Keep the dedupe table from growing forever: a month of history is plenty. */
    await pruneMessengerAlertKeys(nowMs - 30 * 24 * 60 * 60 * 1000).catch(() => undefined);
    console.log(
      `[convocate] messenger alert: sent ${String(pending.length)} item(s) to the owner (${pending.map((item) => item.key).join(", ")}) mail=${result.mailId}`,
    );
    return result;
  } catch (cause) {
    result.errors.push("health_check_threw");
    console.error("[convocate] messenger health checks failed", cause);
    return result;
  }
};
