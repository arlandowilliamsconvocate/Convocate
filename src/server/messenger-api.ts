/**
 * The Messenger reply path as server functions — **server only**.
 *
 * These are the doors a person uses to read the Page's stored DMs and answer
 * one. They are not an auto-responder: nothing here runs unless somebody calls
 * it, and the only automatic branch in the codebase is `MESSENGER_AUTO_REPLY`,
 * which is off by default (see `messenger-reply.server.ts`).
 *
 * Who may call them: **the owner's account only**, decided here on the server
 * with `isAdminUser` — the flag in `users.is_admin` *and* the owner's own
 * address, read from the row on every request. The two refusals match the rest
 * of the app:
 *
 *   - signed out            → 403 `not_signed_in`;
 *   - signed in, not admin  → 404 `not_found`, the same answer a URL that never
 *                             existed gives, so a stranger cannot even learn
 *                             that the Page's inbox is reachable from here.
 *
 * No Page token is returned by anything in this file: the send reads the
 * credentials inside `facebook.server.ts` and hands back Meta's message id.
 *
 * The screen in front of these doors is `/admin/messenger`
 * (`src/routes/admin.messenger.tsx`). `listMessengerInboxFn` is the one read it
 * needs beyond the three below: every stored message, grouped into one
 * conversation per sender so a person can read a thread and answer it.
 */
import { createServerFn } from "@tanstack/react-start";
import { currentUser } from "./auth.server";
import {
  isAdminUser,
  listMessengerMessages,
  messengerMessageCounts,
  type MessengerMessageRow,
} from "./db.server";
import {
  draftReplyForStoredMessage,
  replyToStoredMessage,
  type ReplyOutcome,
} from "./messenger-reply.server";
import {
  readMessengerSettingsForScreen,
  setAutoReplyEnabled,
  setModel,
  setSystemPrompt,
  type MessengerSettings,
} from "./messenger-settings.server";

/** A readable refusal that survives the server-function layer. */
const refuse: (code: string, message: string, status?: number) => never = (
  code,
  message,
  status = 403,
) => {
  throw new Response(JSON.stringify({ ok: false, code, error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
};

/** The owner, or a real refusal — before anything is read or sent. */
const requireOwner = async (): Promise<{ id: number }> => {
  const user = await currentUser();
  if (!user) refuse("not_signed_in", "Sign in to your account to open this. Nothing was shown.");
  if (!(await isAdminUser(user.id))) refuse("not_found", "There is no page at that address.", 404);
  return { id: user.id };
};

/**
 * The Page's stored DMs, newest first, with how many are unanswered.
 *
 * Read-only. It returns what was stored and nothing about the sender beyond the
 * id Meta gave us: no name, no profile, no photo — none of that is fetched.
 */
export const listMessengerMessagesFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireOwner();
  const [messages, counts] = await Promise.all([listMessengerMessages(50), messengerMessageCounts()]);
  return { ok: true as const, messages, counts };
});

/**
 * The drafted reply for one stored message, for a person to read and edit.
 *
 * Drafting costs one model call, and the model is a third party's free tier —
 * which is exactly why the draft is shown before it is sent rather than sent by
 * itself.
 */
export const draftMessengerReplyFn = createServerFn({ method: "POST" })
  .inputValidator((data: { mid?: unknown }) => ({ mid: String(data?.mid ?? "").trim() }))
  .handler(async ({ data }) => {
    await requireOwner();
    if (data.mid === "") refuse("bad_request", "No message was named.", 400);
    const result = await draftReplyForStoredMessage(data.mid);
    if (!result.ok) refuse("not_found", "There is no message with that id.", 404);
    return {
      ok: true as const,
      text: result.draft.text,
      drafted: result.draft.drafted,
      message: result.message,
    };
  });

/**
 * Send a reply to one stored message.
 *
 * `text` is what the person approved. When it is empty the reply is drafted
 * first — that is the only path that can send words nobody read, so the card
 * must always send what it showed.
 */
export const sendMessengerReplyFn = createServerFn({ method: "POST" })
  .inputValidator((data: { mid?: unknown; text?: unknown }) => ({
    mid: String(data?.mid ?? "").trim(),
    text: String(data?.text ?? "").trim().slice(0, 2000),
  }))
  .handler(async ({ data }): Promise<ReplyOutcome | never> => {
    await requireOwner();
    if (data.mid === "") refuse("bad_request", "No message was named.", 400);
    const outcome = await replyToStoredMessage({ mid: data.mid, text: data.text });
    if (!outcome.ok && outcome.status === "not_found") {
      refuse("not_found", "There is no message with that id.", 404);
    }
    return outcome;
  });

/**
 * One sender's messages, as the inbox screen lists and reads them.
 *
 * `messages` is oldest first — the order a conversation is read in. `replyTo`
 * is the id of the newest message that has not been answered, which is the one
 * a reply is sent against (one reply per stored message, see
 * `messenger-reply.server.ts`); null means the whole conversation is answered.
 */
export type MessengerConversation = {
  senderId: string;
  messages: MessengerMessageRow[];
  lastText: string;
  lastAt: number;
  count: number;
  unanswered: number;
  waiting: boolean;
  replyTo: string | null;
};

/**
 * Group stored messages into conversations, one per sender.
 *
 * Pure, and exported for that reason: the ordering rules are the whole of what
 * makes this screen usable — the person opening it has to see what is waiting
 * without reading anything — so they are here rather than buried in the page.
 *
 *  - Within a conversation: oldest first, by Meta's own `sentAt` (our
 *    `receivedAt` breaks a tie, then the row id), so a thread reads in the order
 *    the sender wrote it.
 *  - Between conversations: anyone waiting on an answer first, then the most
 *    recent message. A conversation with two unanswered messages and an
 *    answered one is still waiting.
 */
export const groupMessengerConversations = (
  rows: MessengerMessageRow[],
): MessengerConversation[] => {
  const bySender = new Map<string, MessengerMessageRow[]>();
  for (const row of rows) {
    const list = bySender.get(row.senderId);
    if (list) list.push(row);
    else bySender.set(row.senderId, [row]);
  }
  const conversations: MessengerConversation[] = [];
  for (const [senderId, list] of bySender) {
    const messages = [...list].sort(
      (a, b) => a.sentAt - b.sentAt || a.receivedAt - b.receivedAt || a.id - b.id,
    );
    const newest = messages[messages.length - 1];
    const unansweredMessages = messages.filter((message) => message.repliedAt === null);
    conversations.push({
      senderId,
      messages,
      lastText: newest.text,
      lastAt: newest.sentAt || newest.receivedAt,
      count: messages.length,
      unanswered: unansweredMessages.length,
      waiting: unansweredMessages.length > 0,
      replyTo:
        unansweredMessages.length > 0 ? unansweredMessages[unansweredMessages.length - 1].mid : null,
    });
  }
  return conversations.sort(
    (a, b) => Number(b.waiting) - Number(a.waiting) || b.lastAt - a.lastAt,
  );
};

/**
 * The Page's inbox: every stored message, grouped by sender, plus the totals.
 *
 * Owner only, refused before anything is read (see `requireOwner`). The newest
 * 200 stored messages are read — enough for a Page that has never had a public
 * DM, and a cap that keeps the page's own payload small if it ever does.
 */
export const listMessengerInboxFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireOwner();
  const [messages, counts] = await Promise.all([
    listMessengerMessages(200),
    messengerMessageCounts(),
  ]);
  return {
    ok: true as const,
    conversations: groupMessengerConversations(messages),
    counts,
  };
});

/* ------------------------------------------------ the answering switch (cron) */

/**
 * The switch, the voice and the model — what the watcher answers with.
 *
 * These are here rather than in an environment file on purpose: the owner does
 * not paste environment values, and the person who has to be able to stop the
 * machine talking is whoever is on the team at that moment. Owner-only, like
 * everything else in this file: `requireOwner` runs before a row is read or
 * written, and a signed-in non-owner gets the same 404 as an address that never
 * existed.
 */
export const getMessengerSettingsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ ok: true; settings: MessengerSettings }> => {
    await requireOwner();
    return { ok: true as const, settings: await readMessengerSettingsForScreen() };
  },
);

/**
 * Turn automated answering on or off.
 *
 * The row is the switch. `MESSENGER_AUTO_REPLY`, when it is set in the
 * environment, still overrides it — the screen says so, because a toggle that
 * silently does nothing is worse than no toggle.
 */
export const setMessengerAutoReplyFn = createServerFn({ method: "POST" })
  .inputValidator((data: { enabled?: unknown }) => ({ enabled: data?.enabled === true }))
  .handler(async ({ data }): Promise<{ ok: true; settings: MessengerSettings }> => {
    await requireOwner();
    await setAutoReplyEnabled(data.enabled);
    return { ok: true as const, settings: await readMessengerSettingsForScreen() };
  });

/**
 * Change the wording the model writes under, and the model name.
 *
 * Both are stored as typed, so a blank prompt means "use the built-in one" and a
 * blank model means "the provider's default" — a half-filled form can never
 * leave the model with no rules or a model that does not exist.
 */
export const setMessengerVoiceFn = createServerFn({ method: "POST" })
  .inputValidator((data: { systemPrompt?: unknown; model?: unknown }) => ({
    systemPrompt: String(data?.systemPrompt ?? "").slice(0, 12_000),
    model: String(data?.model ?? "").slice(0, 120),
  }))
  .handler(async ({ data }): Promise<{ ok: true; settings: MessengerSettings }> => {
    await requireOwner();
    await Promise.all([setSystemPrompt(data.systemPrompt), setModel(data.model)]);
    return { ok: true as const, settings: await readMessengerSettingsForScreen() };
  });
