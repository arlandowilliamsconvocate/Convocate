import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "~/components/site-chrome";
import { Button, Card, inputClass } from "~/components/ui";
import {
  draftMessengerReplyFn,
  getMessengerHealthFn,
  getMessengerSettingsFn,
  listMessengerInboxFn,
  sendMessengerReplyFn,
  setMessengerAutoReplyFn,
  setMessengerVoiceFn,
} from "~/server/messenger-api";
import type { MessengerSettings } from "~/server/messenger-settings.server";

/**
 * `/admin/messenger` — the Page's inbox, for the owner's account only.
 *
 * What it is for: until now the three Messenger server functions had no screen
 * in front of them, so a DM could be stored and answered only by calling code.
 * This is the screen a person actually runs the Page from — read a thread,
 * press "draft a reply", edit the wording, send it.
 *
 * Two things make it safe, and only one of them is here:
 *
 *  1. **The server**, which is the real gate. `listMessengerInboxFn`,
 *     `draftMessengerReplyFn` and `sendMessengerReplyFn` each call `requireOwner`
 *     (see `messenger-api.ts`) before a row is read or a byte leaves for Meta: a
 *     signed-out caller gets 403 `not_signed_in`, a signed-in non-admin gets 404
 *     `not_found`. The rule is the same one the rest of the admin view uses — the
 *     `users.is_admin` flag AND the owner's own address, read from the database
 *     on every request. Hiding a link would not be a guard; this file hides
 *     nothing and relies on nothing here for safety.
 *  2. **This file**, which decides what a refused caller sees: `notFound()` —
 *     the site's own not-found page, with the same 404 status an address that
 *     never existed gives. There is no "you need permission" screen, because
 *     that would tell every organizer account that the Page's inbox is
 *     reachable from here.
 *
 * The automated-assistant line is **not** decided here. A person pressing send
 * on an edited draft gets the line, a person typing their own words does not,
 * and that decision is made on the server from the stored draft — see
 * `decideDisclosure` in `messenger-reply.server.ts`. This screen only reports
 * what the server did.
 *
 * Times are printed in UTC, by hand rather than through `toLocaleString`, for
 * the reason `/admin` gives: a locale-dependent formatter can print one string
 * on the server and another in the browser and fail hydration. This cannot.
 *
 * **Why this file is called `admin_.messenger.tsx` and not `admin.messenger.tsx`.**
 * In TanStack's file routing, `admin.messenger.tsx` is a CHILD of `admin.tsx`, so
 * `/admin/messenger` rendered `admin.tsx`'s own component and this screen never
 * drew. The trailing underscore makes this a sibling of `/admin` with the same
 * URL: the route id is `/admin_/messenger`, the path is still `/admin/messenger`,
 * and the links in `admin.tsx` keep working. Renaming it back brings the bug back.
 */
export const Route = createFileRoute("/admin_/messenger")({
  loader: async () => {
    try {
      // Both reads are owner-gated on the server; either one refusing means the
      // caller is not the owner, and the answer is the site's own 404.
      const [inbox, settings, health] = await Promise.all([
        listMessengerInboxFn(),
        getMessengerSettingsFn(),
        getMessengerHealthFn(),
      ]);
      return { ...inbox, settings: settings.settings, health: health.health };
    } catch {
      // Signed out, or signed in and not the owner. Both look exactly like a URL
      // that was never a page.
      throw notFound();
    }
  },
  component: MessengerInboxPage,
});

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const pad = (value: number): string => String(value).padStart(2, "0");

/** `22 Oct 2026, 14:07 UTC` — always UTC, and always says so. */
function formatStamp(ms: number): string {
  if (!ms) return "—";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "—";
  return `${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${String(
    date.getUTCFullYear(),
  )}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/** A message's first line, cut to something that fits a list row. */
function truncate(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return "(no text — an attachment or a sticker)";
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function MessengerInboxPage() {
  const inbox = Route.useLoaderData();
  const router = useRouter();
  const { conversations, counts } = inbox;

  /* The answering switch. Held in state so a press shows its result at once, and
     refreshed from the loader after a write so the page and the row agree. */
  const [settings, setSettings] = useState<MessengerSettings>(inbox.settings);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(inbox.settings.systemPrompt);
  const [model, setModel] = useState(inbox.settings.model);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);

  const toggleAnswering = async () => {
    setSwitchBusy(true);
    setSwitchError(null);
    try {
      const result = await setMessengerAutoReplyFn({ data: { enabled: !settings.autoReplyEnabled } });
      setSettings(result.settings);
    } catch (cause) {
      setSwitchError(
        cause instanceof Error ? cause.message : "The switch could not be changed.",
      );
    } finally {
      setSwitchBusy(false);
    }
  };

  const saveVoice = async (event: React.FormEvent) => {
    event.preventDefault();
    setVoiceBusy(true);
    setVoiceNote(null);
    try {
      const result = await setMessengerVoiceFn({ data: { systemPrompt: prompt, model } });
      setSettings(result.settings);
      setPrompt(result.settings.systemPrompt);
      setModel(result.settings.model);
      setVoiceNote("Saved. The next reply uses this.");
    } catch (cause) {
      setVoiceNote(
        cause instanceof Error ? cause.message : "That could not be saved — nothing changed.",
      );
    } finally {
      setVoiceBusy(false);
    }
  };

  const [selectedId, setSelectedId] = useState<string | null>(
    conversations[0]?.senderId ?? null,
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [drafted, setDrafted] = useState(false);
  /** Exactly what the server sent, once it has sent it. */
  const [sentText, setSentText] = useState<string | null>(null);

  const selected =
    conversations.find((conversation) => conversation.senderId === selectedId) ??
    conversations[0] ??
    null;

  /** Switching threads clears the box: a half-written reply belongs to one person. */
  const open = (senderId: string) => {
    setSelectedId(senderId);
    setText("");
    setError(null);
    setNote(null);
    setDrafted(false);
    setSentText(null);
  };

  const draft = async () => {
    if (!selected || !selected.replyTo) return;
    setBusy("draft");
    setError(null);
    setNote(null);
    try {
      const result = await draftMessengerReplyFn({ data: { mid: selected.replyTo } });
      setText(result.text);
      setDrafted(true);
      setNote(
        result.drafted
          ? "Draft written by the assistant. Edit it before you send — what is in the box is what goes."
          : "The assistant could not be reached, so this is the stand-in reply. Edit it or write your own.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The draft could not be made.");
    } finally {
      setBusy(null);
    }
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !selected.replyTo) return;
    const body = text.trim();
    if (body === "") {
      setError("Type a reply first, or press “Draft a reply”.");
      return;
    }
    setBusy("send");
    setError(null);
    setNote(null);
    try {
      const outcome = await sendMessengerReplyFn({
        data: { mid: selected.replyTo, text: body },
      });
      if (outcome.ok) {
        setText("");
        setDrafted(false);
        setSentText(outcome.text);
        setNote("Sent. What went out is shown below.");
        await router.invalidate();
        return;
      }
      // A refusal is a result, not a throw: Meta's own sentence is shown, and the
      // text stays in the box so nothing has to be retyped.
      const detail = outcome.message ? ` (${outcome.message})` : "";
      setError(
        outcome.status === "graph_refused"
          ? `Facebook refused the reply${detail}. Nothing was sent and the message is still unanswered.`
          : outcome.status === "already_replied"
            ? "This message was already answered — nothing was sent twice."
            : `Nothing was sent (${outcome.status}).`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Nothing was sent: ${cause.message}`
          : "Nothing was sent — the request failed.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader signedIn />
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
            Owner only · the Facebook Page
          </p>
          <h1 className="mt-1 text-3xl text-ink">Messenger inbox</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Every direct message the Convocate Page has received, one conversation per sender,
            newest first and anyone waiting on an answer at the top. Times are UTC. Nothing is sent
            until you press Send.
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            {counts.total === 0
              ? "No messages stored yet."
              : `${counts.total} message${counts.total === 1 ? "" : "s"} stored · ${counts.unanswered} unanswered`}
          </p>
        </header>

        <Card
          className={`p-5 ${inbox.health.stale ? "border-red-300 bg-red-50" : ""}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg text-ink">Is it answering?</h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-soft">
                The watcher is what answers a direct message. If it stops, nothing answers — so
                this panel says when it last finished a run, not just when it last tried.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2">
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  inbox.health.stale ? "bg-red-600 text-white" : "bg-emerald-600 text-white"
                }`}
              >
                {inbox.health.stale ? "Not answering" : "Answering"}
              </span>
              <Button type="button" variant="secondary" onClick={() => void router.invalidate()}>
                Refresh
              </Button>
            </div>
          </div>

          {inbox.health.stale ? (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-red-800"
            >
              {inbox.health.lastOkAt === 0
                ? "The watcher has never completed a run. Nothing will answer a direct message until it does."
                : `The watcher has not completed a run for ${inbox.health.runAgo} — nothing is answering direct messages. Last run: ${formatStamp(inbox.health.lastOkAt)}.`}
            </p>
          ) : null}

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Watcher last ran
              </dt>
              <dd className={inbox.health.stale ? "font-semibold text-red-800" : "text-ink"}>
                {inbox.health.lastOkAt === 0 ? "never" : `${inbox.health.runAgo} ago`}
              </dd>
              <dd className="text-xs text-ink-soft">{formatStamp(inbox.health.lastOkAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Last direct message
              </dt>
              <dd className="text-ink">
                {inbox.health.lastInboundAt === 0 ? "never" : `${inbox.health.inboundAgo} ago`}
              </dd>
              <dd className="text-xs text-ink-soft">{formatStamp(inbox.health.lastInboundAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Last reply sent
              </dt>
              <dd className="text-ink">
                {inbox.health.lastReplyAt === 0 ? "never" : `${inbox.health.replyAgo} ago`}
              </dd>
              <dd className="text-xs text-ink-soft">{formatStamp(inbox.health.lastReplyAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Waiting now
              </dt>
              <dd className={inbox.health.unanswered > 0 ? "font-semibold text-amber-800" : "text-ink"}>
                {inbox.health.unanswered === 0
                  ? "nothing"
                  : `${inbox.health.unanswered} unanswered`}
              </dd>
              <dd className="text-xs text-ink-soft">
                {inbox.health.unanswered === 0
                  ? "no one is waiting"
                  : `oldest waiting ${inbox.health.oldestWaitingAgo}`}
              </dd>
            </div>
          </dl>

          {inbox.health.windowClosed > 0 ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {inbox.health.windowClosed} message
              {inbox.health.windowClosed === 1 ? "" : "s"} arrived more than 24 hours ago and were
              never answered. Facebook will not let the Page send to those conversations now, so
              they are listed below as left for a person. Anyone in that position has to write
              again before they can be answered.
            </p>
          ) : null}

          {inbox.health.lastError ? (
            <p className="mt-3 text-xs text-ink-soft">
              Last run error: {inbox.health.lastError} ({formatStamp(inbox.health.lastErrorAt)})
            </p>
          ) : null}
          <p className="mt-3 text-xs text-ink-soft">
            If the watcher goes quiet for ten minutes, or a message waits more than thirty minutes,
            an email goes to {inbox.health.alertEmail} — once per incident, never with the words of
            anyone&rsquo;s message.
            {inbox.health.lastAlertAt > 0
              ? ` Last alert: ${formatStamp(inbox.health.lastAlertAt)} (${inbox.health.lastAlertResult}).`
              : ""}
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg text-ink">Automated answering</h2>
              <p className="mt-1 max-w-2xl text-sm text-ink-soft">
                A watcher runs every minute and answers any direct message that has not been
                answered yet, inside the 24 hours Facebook allows a reply. It writes in the voice
                below, sends once per message, stops after three automated replies in one
                conversation, and leaves anything it cannot answer for a person.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2">
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  settings.autoReplyEnabled
                    ? "bg-brand text-white"
                    : "bg-paper-deep text-ink-soft"
                }`}
              >
                {settings.autoReplyEnabled ? "Answering: ON" : "Answering: OFF"}
              </span>
              <Button
                type="button"
                variant={settings.autoReplyEnabled ? "secondary" : "primary"}
                onClick={toggleAnswering}
                disabled={switchBusy}
              >
                {switchBusy
                  ? "Saving…"
                  : settings.autoReplyEnabled
                    ? "Turn answering off"
                    : "Turn answering on"}
              </Button>
            </div>
          </div>

          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Last checked
              </dt>
              <dd className="text-ink">{formatStamp(settings.lastCheckAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Last reply sent
              </dt>
              <dd className="text-ink">{formatStamp(settings.lastReplyAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Last failure
              </dt>
              <dd className="text-ink">
                {formatStamp(settings.lastFailureAt)}
                {settings.lastFailure ? ` — ${settings.lastFailure}` : ""}
              </dd>
            </div>
          </dl>

          {settings.envOverride ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              A setting in the server environment (MESSENGER_AUTO_REPLY) is overriding this switch
              right now. The badge above shows what is actually in force.
            </p>
          ) : null}
          {switchError ? (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {switchError}
            </p>
          ) : null}

          <details className="mt-4 rounded-lg border border-line bg-white px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-ink">
              The voice and the model
            </summary>
            <form onSubmit={saveVoice} className="mt-3 space-y-3">
              <p className="text-xs text-ink-soft">
                The instruction the model writes under. Leave it empty to go back to the built-in
                one. Changes take effect on the next reply — no deploy.
              </p>
              <label className="block">
                <span className="sr-only">System prompt</span>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={10}
                  className={`${inputClass} font-mono text-xs`}
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  Model
                </span>
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="Leave empty for the provider's default"
                  className={`${inputClass} mt-1 font-mono text-xs`}
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="secondary" disabled={voiceBusy}>
                  {voiceBusy ? "Saving…" : "Save voice"}
                </Button>
                {voiceNote ? <span className="text-xs text-ink-soft">{voiceNote}</span> : null}
              </div>
            </form>
          </details>
        </Card>

        {conversations.length === 0 ? (
          <Card className="p-8">
            <h2 className="text-lg text-ink">There are no messages yet</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              Nothing has reached the Page since the Messenger webhook went live. When someone
              messages Convocate on Facebook, their conversation appears here within a moment and
              can be answered from this screen.
            </p>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
            <Card className="overflow-hidden">
              <div className="border-b border-line/70 px-4 py-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
                  Conversations
                </h2>
              </div>
              <ul className="divide-y divide-line/70">
                {conversations.map((conversation) => {
                  const active = selected?.senderId === conversation.senderId;
                  return (
                    <li key={conversation.senderId}>
                      <button
                        type="button"
                        onClick={() => open(conversation.senderId)}
                        aria-current={active ? "true" : undefined}
                        className={`block w-full px-4 py-3 text-left transition ${
                          active ? "bg-paper-deep" : "hover:bg-paper-deep/60"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-ink-soft">
                            {conversation.senderId}
                          </span>
                          {conversation.waiting ? (
                            <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white">
                              {conversation.unanswered === 1
                                ? "Waiting"
                                : `${conversation.unanswered} waiting`}
                            </span>
                          ) : (
                            <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
                              Answered
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block text-sm text-ink">
                          {truncate(conversation.lastText)}
                        </span>
                        <span className="mt-1 block text-xs text-ink-soft">
                          {conversation.count} message{conversation.count === 1 ? "" : "s"} ·{" "}
                          {formatStamp(conversation.lastAt)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>

            {selected ? (
              <div className="space-y-4">
                <Card className="overflow-hidden">
                  <div className="border-b border-line/70 px-5 py-4">
                    <h2 className="text-lg text-ink">Conversation</h2>
                    <p className="mt-0.5 break-all font-mono text-xs text-ink-soft">
                      sender {selected.senderId}
                    </p>
                  </div>
                  <ol className="divide-y divide-line/70">
                    {selected.messages.map((message) => (
                      <li key={message.mid} className="px-5 py-4">
                        <p className="text-xs text-ink-soft">
                          {formatStamp(message.sentAt || message.receivedAt)}
                          {message.attachmentCount > 0
                            ? ` · ${message.attachmentCount} attachment${message.attachmentCount === 1 ? "" : "s"} (not stored)`
                            : ""}
                          {message.repliedAt !== null
                            ? ` · answered ${formatStamp(message.repliedAt)}`
                            : " · not answered"}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">
                          {message.text.trim() === "" ? "(no text)" : message.text}
                        </p>
                        <p className="mt-1 break-all font-mono text-[11px] text-ink-soft/70">
                          mid {message.mid}
                        </p>
                      </li>
                    ))}
                  </ol>
                </Card>

                <Card className="p-5">
                  <h2 className="text-lg text-ink">Reply</h2>
                  {selected.replyTo === null ? (
                    <p className="mt-1 text-sm text-ink-soft">
                      Every message from this sender has been answered. Convocate sends one reply
                      per message, so there is nothing to answer here until they write again.
                    </p>
                  ) : (
                    <form onSubmit={send} className="mt-2 space-y-3">
                      <p className="text-sm text-ink-soft">
                        Replying to the message from{" "}
                        {formatStamp(
                          selected.messages.find((message) => message.mid === selected.replyTo)
                            ?.sentAt ?? selected.lastAt,
                        )}
                        . What is in this box is exactly what is sent.
                      </p>
                      <label className="block">
                        <span className="sr-only">Reply text</span>
                        <textarea
                          value={text}
                          onChange={(event) => setText(event.target.value)}
                          rows={7}
                          placeholder="Write the reply, or press “Draft a reply” and edit it."
                          className={inputClass}
                        />
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={draft}
                          disabled={busy !== null}
                        >
                          {busy === "draft" ? "Drafting…" : "Draft a reply"}
                        </Button>
                        <Button type="submit" disabled={busy !== null}>
                          {busy === "send" ? "Sending…" : "Send to Messenger"}
                        </Button>
                        {drafted ? (
                          <span className="text-xs text-ink-soft">
                            This box holds an assistant draft — edit it freely.
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-ink-soft">
                        A reply goes out exactly as written. The assistant draft is a starting
                        point you can send unchanged or rewrite in your own words.
                      </p>
                    </form>
                  )}

                  {error ? (
                    <p
                      role="alert"
                      className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                    >
                      {error}
                    </p>
                  ) : null}
                  {note ? (
                    <p
                      role="status"
                      className="mt-3 rounded-lg border border-line bg-paper-deep/50 px-3 py-2 text-sm text-ink"
                    >
                      {note}
                    </p>
                  ) : null}
                  {sentText ? (
                    <div className="mt-3 rounded-lg border border-line bg-white px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                        What was sent
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">
                        {sentText}
                      </p>
                    </div>
                  ) : null}
                </Card>
              </div>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
