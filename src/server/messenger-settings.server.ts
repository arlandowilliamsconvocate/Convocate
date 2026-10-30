/**
 * The Messenger answering settings — **server only**.
 *
 * The owner's requirement, in his words: "It should be someone answering those
 * messages at all times." Nothing answered a DM by itself before this file
 * existed, because the switch that could have (`MESSENGER_AUTO_REPLY`) lived in
 * the environment and the owner does not paste environment values.
 *
 * So the switch lives in the database, in `messenger_settings` (key/value, one
 * row per name), and the team can turn it, change the voice, or change the model
 * from `/admin/messenger` with no deploy and nothing for the owner to do.
 *
 * The keys:
 *
 *   - `auto_reply_enabled` — `"1"` or `"0"`. This is what counts. It ships `"1"`:
 *     the owner asked for the Page to answer, out loud, twice.
 *   - `system_prompt` — the instruction the model writes replies under. Empty
 *     means "use the built-in one" (`MESSENGER_SYSTEM_INSTRUCTION`), so a blank
 *     row can never leave the model with no rules.
 *   - `model` — the model name. Empty means the provider's default. Only the
 *     Groq provider honours it; Gemini stays on its own models.
 *   - `watcher_secret` — the shared secret the cron job presents to
 *     `POST /api/meta/messenger-watcher`. Minted once, from 32 random bytes, and
 *     never printed: not to a log, not to a screen, not to this file's callers.
 *   - `last_check_at`, `last_reply_at`, `last_failure_at`, `last_failure` — what
 *     the admin screen shows so a person can see the watcher is alive.
 *
 * `MESSENGER_AUTO_REPLY` is still an override when it is set, so an emergency can
 * be handled without the database — but an unset variable (the normal case) means
 * the row decides, not the environment.
 */
import { randomBytes } from "node:crypto";
import {
  readMessengerSettings,
  writeMessengerSetting,
  writeMessengerSettingIfAbsent,
} from "./db.server";
import { MESSENGER_SYSTEM_INSTRUCTION } from "./ai/prompts";

/** The keys this module writes. Named, so a typo is a compile error, not a row. */
export const SETTING_AUTO_REPLY = "auto_reply_enabled";
export const SETTING_SYSTEM_PROMPT = "system_prompt";
export const SETTING_MODEL = "model";
export const SETTING_WATCHER_SECRET = "watcher_secret";
export const SETTING_LAST_CHECK = "last_check_at";
export const SETTING_LAST_REPLY = "last_reply_at";
export const SETTING_LAST_FAILURE = "last_failure_at";
export const SETTING_LAST_FAILURE_TEXT = "last_failure";

/** What the admin screen and the watcher both read. Never includes the secret. */
export type MessengerSettings = {
  /** Resolved: the environment override if it is set, otherwise the database row. */
  autoReplyEnabled: boolean;
  /** True when `MESSENGER_AUTO_REPLY` is what decided it — the screen says so. */
  envOverride: boolean;
  /** The prompt in force, which is the stored one or the built-in default. */
  systemPrompt: string;
  /** The stored model name, or "" for the provider's default. */
  model: string;
  lastCheckAt: number;
  lastReplyAt: number;
  lastFailureAt: number;
  lastFailure: string;
};

const truthy = (raw: string): boolean => {
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
};

const number = (raw: string | undefined): number => {
  const value = Number((raw ?? "").trim());
  return Number.isFinite(value) && value > 0 ? value : 0;
};

/**
 * Whether the watcher may answer.
 *
 * Order, and it matters: an environment variable that is actually set wins, so a
 * bad minute can be fixed without the database; when it is unset — which is how
 * this site has always run — the row decides, and a missing row means **on**,
 * because the owner asked for answering and a fresh database must not silently
 * go quiet.
 */
export const autoReplyEnabled = async (): Promise<{ enabled: boolean; envOverride: boolean }> => {
  const env = (process.env.MESSENGER_AUTO_REPLY ?? "").trim();
  if (env !== "") return { enabled: truthy(env), envOverride: true };
  const settings = await readMessengerSettings();
  const stored = settings[SETTING_AUTO_REPLY];
  if (stored === undefined) return { enabled: true, envOverride: false };
  return { enabled: truthy(stored), envOverride: false };
};

/** Everything the admin screen shows, in one read. */
export const readMessengerSettingsForScreen = async (): Promise<MessengerSettings> => {
  const [settings, gate] = await Promise.all([readMessengerSettings(), autoReplyEnabled()]);
  const storedPrompt = (settings[SETTING_SYSTEM_PROMPT] ?? "").trim();
  return {
    autoReplyEnabled: gate.enabled,
    envOverride: gate.envOverride,
    systemPrompt: storedPrompt === "" ? MESSENGER_SYSTEM_INSTRUCTION : storedPrompt,
    model: (settings[SETTING_MODEL] ?? "").trim(),
    lastCheckAt: number(settings[SETTING_LAST_CHECK]),
    lastReplyAt: number(settings[SETTING_LAST_REPLY]),
    lastFailureAt: number(settings[SETTING_LAST_FAILURE]),
    lastFailure: (settings[SETTING_LAST_FAILURE_TEXT] ?? "").trim(),
  };
};

/** Turn answering on or off. One row; the next watcher tick obeys it. */
export const setAutoReplyEnabled = async (enabled: boolean): Promise<void> => {
  await writeMessengerSetting(SETTING_AUTO_REPLY, enabled ? "1" : "0");
};

/** Change the voice. A blank prompt is stored as blank, which means "the default". */
export const setSystemPrompt = async (prompt: string): Promise<void> => {
  await writeMessengerSetting(SETTING_SYSTEM_PROMPT, prompt.trim().slice(0, 12_000));
};

/** Change the model name. Blank means the provider's default. */
export const setModel = async (model: string): Promise<void> => {
  await writeMessengerSetting(SETTING_MODEL, model.trim().slice(0, 120));
};

/** Record that the watcher ran and found something to do (see the idle note below). */
export const recordCheck = async (at: number): Promise<void> => {
  await writeMessengerSetting(SETTING_LAST_CHECK, String(at));
};

/** Record a reply the watcher sent. */
export const recordReplySent = async (at: number): Promise<void> => {
  await writeMessengerSetting(SETTING_LAST_REPLY, String(at));
};

/**
 * Record a failure a person should see on the screen.
 *
 * The text is cut short and carries no token, no message body and no Graph
 * response — a reason word and a number only, because this row is shown on a
 * page and kept in the database.
 */
export const recordFailure = async (at: number, reason: string): Promise<void> => {
  await Promise.all([
    writeMessengerSetting(SETTING_LAST_FAILURE, String(at)),
    writeMessengerSetting(SETTING_LAST_FAILURE_TEXT, reason.trim().slice(0, 200)),
  ]);
};

/**
 * The shared secret the cron job presents, minted once.
 *
 * 32 random bytes as hex. It is written to the database the first time anything
 * asks for it and never changes afterwards, so a cron job holding a copy keeps
 * working across restarts, deploys and database reads. Nothing in this codebase
 * returns it to a browser or logs it.
 */
export const watcherSecret = async (): Promise<string> => {
  const settings = await readMessengerSettings();
  const stored = (settings[SETTING_WATCHER_SECRET] ?? "").trim();
  if (stored !== "") return stored;
  const minted = randomBytes(32).toString("hex");
  const written = await writeMessengerSettingIfAbsent(SETTING_WATCHER_SECRET, minted);
  if (written) return minted;
  // Another process minted it between the read and the write: use theirs, since
  // that is the one the cron job may already hold.
  const again = await readMessengerSettings();
  return (again[SETTING_WATCHER_SECRET] ?? "").trim();
};
