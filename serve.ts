// Production server for the built site. The TanStack Start build emits a portable
// fetch handler (dist/server/server.js) plus static client assets (dist/client);
// this wraps them in a Bun server on port 3000 — static files first, SSR for the
// rest. Run `bun run build` before starting. Restart it with `bun run publish`.
//
// Starting a new instance supersedes the old one: it frees the port no matter
// which user owns the current server (provisioning starts it as `engine`; a team
// member's `bun run publish` runs as their own user), so publish never collides
// with an already-running server. Every sandbox user has passwordless sudo, so
// the takeover works across user boundaries.
import handler from "./dist/server/server.js";

// Pinned, NOT read from the environment. The published preview URL
// (<label>.<PUBLIC_SITE_DOMAIN>) is reverse-proxied to 0.0.0.0:3000 inside the
// sandbox, so the default site MUST bind there. Bun auto-loads .env files, so
// honouring process.env.PORT/HOST would let a stray env var or a .env in the site
// dir silently move the site off :3000 (or onto loopback) and break the public URL.
const PORT = 3000;
const HOST = "0.0.0.0";
/**
 * Seconds a connection may go without bytes in either direction before Bun closes
 * it. Bun's default is 10, and it counts a request whose handler is still running
 * but has written nothing yet — so a server function waiting on an AI provider for
 * 12s dies mid-flight and the platform gateway hands the visitor an empty 502.
 * 255 is the maximum Bun accepts; handlers that regularly run long should still
 * write bytes early (stream) or split into start-then-poll.
 */
const IDLE_TIMEOUT = 255;
const CLIENT_DIR = `${import.meta.dir}/dist/client`;

// Free PORT regardless of which user owns the current listener. lsof runs under
// sudo so it can see (and the kill can signal) a process owned by another user;
// the loop waits for the socket to actually release before we bind.
const freePort =
  `for _ in $(seq 1 25); do ` +
  `pids=$(lsof -t -iTCP:${String(PORT)} -sTCP:LISTEN 2>/dev/null || true); ` +
  `if [ -z "$pids" ]; then exit 0; fi; ` +
  `kill $pids 2>/dev/null || true; sleep 0.2; ` +
  `done`;

// Free the port, then bind. Bun.serve throws EADDRINUSE synchronously when another
// publish grabbed the port in the gap between freeing and binding.
const takeOverPort = async (): Promise<void> => {
  await Bun.$`sudo sh -c ${freePort}`.quiet().nothrow();
  Bun.serve({
    port: PORT,
    hostname: HOST,
    idleTimeout: IDLE_TIMEOUT,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname !== "/") {
        const file = Bun.file(CLIENT_DIR + pathname);
        if (await file.exists()) return new Response(file);
      }
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the built server entry default-exports a Bun fetch handler, and the dist import is untyped.
      return (handler as { fetch: (r: Request) => Response | Promise<Response> }).fetch(req);
    },
  });
};

const MAX_BIND_ATTEMPTS = 10;
const BIND_RETRY_MS = 200;

// Re-free and retry a raced bind (last publish wins); without this a raced publish
// would die while the shell already reported success.
const bindRetryingRace = async (): Promise<void> => {
  for (let attempt = 1; attempt < MAX_BIND_ATTEMPTS; attempt++) {
    try {
      return await takeOverPort();
    } catch {
      await Bun.sleep(BIND_RETRY_MS);
    }
  }
  // The last attempt is not retried, so whatever it throws is the process's.
  await takeOverPort();
};

await bindRetryingRace();

/**
 * Start the Messenger watcher loop.
 *
 * The owner's complaint on 2026-10-30 was that the Page went silent: a direct
 * message arrived on 27 October and nothing answered it, because the one process
 * that calls the watcher lived outside the app and nothing restarted it when the
 * machine was replaced. This box has no cron, no systemd unit and no rc.local —
 * but the platform always starts this server, so this is the one hook that is
 * actually guaranteed. Starting the loop here means a restart of the site is a
 * restart of the responder.
 *
 * Three rules, because this must never be able to take the site down:
 *   - it runs *after* the port is bound, so a failure here cannot stop the site;
 *   - it is wrapped, and a missing script is not an error;
 *   - the script holds a pid file, so starting it twice is a no-op (the platform
 *     restarts this server on every publish).
 */
const SCHEDULER_SCRIPT = "/home/team/shared/convocate-scheduler.sh";
try {
  if (await Bun.file(SCHEDULER_SCRIPT).exists()) {
    const scheduler = Bun.spawn(["bash", SCHEDULER_SCRIPT], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: process.env,
    });
    /* Unref: the loop must outlive this server process, not die with it. */
    scheduler.unref();
    console.log(`[convocate] messenger scheduler started from ${SCHEDULER_SCRIPT}`);
  } else {
    console.log(`[convocate] messenger scheduler not found at ${SCHEDULER_SCRIPT} — nothing is answering DMs`);
  }
} catch (cause) {
  console.error("[convocate] could not start the messenger scheduler", cause);
}

console.log(`team-site serving on http://${HOST}:${String(PORT)}`);
