/**
 * `POST /api/meta/messenger-watcher` — the endpoint cron calls every minute.
 *
 * Why an HTTP endpoint rather than a script that talks to the database and
 * Graph directly: the database client, the model client and
 * `sendMessengerMessage` all live inside this app, and the app is the only thing
 * that already knows how to reach them. A cron job that re-implemented any of
 * that would be a second copy of the send path — which is exactly how the
 * `content-type` trap bites (Meta rejects a JSON body on `/{page-id}/messages`
 * with "An unknown error has occurred."; only a form-encoded body carrying
 * `recipient` and `message` as JSON strings works, and `sendMessengerMessage`
 * already does that).
 *
 * Who may call it: whoever holds the shared secret, which is minted once from 32
 * random bytes into `messenger_settings.watcher_secret` and handed to the cron
 * script in a root-only file. The comparison is constant-time and the secret is
 * never logged, never returned, and never sent to a browser. Without it the
 * answer is 401 and nothing runs — the endpoint is public on the internet, so
 * "no secret, no work" is the whole of its protection and it must fail closed.
 *
 * What it answers: the watcher's own outcome as JSON — how many were considered,
 * sent, flagged, skipped, and the text of anything it sent. A no-op run is
 * `{ sent: 0, flagged: 0, didWork: false }` and costs one settings read.
 *
 * It is safe to call twice: a second call straight after a successful one finds
 * nothing waiting, and two calls that overlap are separated by the row claim
 * (`claimMessengerMessageForReply`), so one message never gets two replies.
 */
import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { runMessengerWatcher } from "~/server/messenger-watcher.server";
import { watcherSecret } from "~/server/messenger-settings.server";

/** The header the cron script presents. */
const WATCHER_SECRET_HEADER = "x-convocate-watcher-secret";

/**
 * Constant-time comparison of two strings.
 *
 * `timingSafeEqual` needs equal-length buffers, so the lengths are compared
 * first — a length is not a secret, and returning early on it leaks nothing an
 * attacker cannot measure anyway. The bytes are compared only when the lengths
 * match.
 */
const secretMatches = (presented: string, expected: string): boolean => {
  if (expected === "" || presented === "") return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

export const Route = createFileRoute("/api/meta/messenger-watcher")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let expected = "";
        try {
          expected = await watcherSecret();
        } catch {
          // No database, no work: a watcher that cannot read its own settings
          // cannot answer anybody, and saying so is better than guessing.
          console.error("[convocate] messenger watcher: settings unavailable");
          return json(503, { ok: false, error: "settings_unavailable" });
        }
        const presented = (request.headers.get(WATCHER_SECRET_HEADER) ?? "").trim();
        if (!secretMatches(presented, expected)) {
          // The reason only — never the header, never the expected value.
          console.error("[convocate] messenger watcher refused: bad or missing secret");
          return json(401, { ok: false, error: "unauthorized" });
        }
        try {
          const outcome = await runMessengerWatcher();
          return json(200, outcome);
        } catch (cause) {
          // The watcher is written not to throw; this is the belt.
          console.error("[convocate] messenger watcher failed", cause);
          return json(500, { ok: false, error: "watcher_failed" });
        }
      },
      GET: async () => json(405, { ok: false, error: "method_not_allowed" }),
    },
  },
});
