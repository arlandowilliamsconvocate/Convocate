/**
 * Post the next queued caption to the Convocate Facebook Page — one post per run.
 *
 * Why this exists: the Page is a background presence, not a growth channel, so it
 * gets one post a week drawn from content we have already written. A cron entry
 * (/etc/cron.d/convocate-facebook-post) runs this weekly; nobody has to remember
 * it, and the owner never has to post anything himself.
 *
 * How to run by hand:
 *
 *   cd /home/team/shared/site
 *   . /etc/profile.d/cto-env-vars.sh
 *   bun scripts/facebook-weekly-post.ts --dry-run   # show what would post, post nothing
 *   bun scripts/facebook-weekly-post.ts             # post the next caption
 *
 * The queue lives at /home/team/shared/social/weekly-posts.json:
 *
 *   { "posts": [ { "id": "2026-10-27-budget", "message": "...", "linkUrl": "https://www.getconvocate.com/resources" } ] }
 *
 * Rules this script follows:
 *  - It posts the OLDEST caption with no `postedAt`. When the queue is empty it
 *    exits 0 and says so — an empty queue is not an error, and it must never
 *    cause a made-up post.
 *  - After a successful post it writes `postedAt` and `postId` back onto that
 *    caption, so a caption can never be posted twice.
 *  - A failure is written to the log and exits non-zero; the caption stays
 *    unposted so next week retries it. Nothing is retried inside the run.
 *  - It never prints a token. `postToPage` reads credentials from the database.
 */
import { readFile, writeFile, appendFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { postToPage } from "../src/server/facebook.server";

type QueuedPost = {
  id: string;
  message: string;
  linkUrl?: string;
  postedAt?: string;
  postId?: string;
};

type QueueFile = { posts: QueuedPost[] };

const SHARED = "/home/team/shared/social";
const QUEUE = join(SHARED, "weekly-posts.json");
const LOG = join(SHARED, "posted.log");
const dryRun = process.argv.includes("--dry-run");

const logLine = async (line: string): Promise<void> => {
  const stamped = `${new Date().toISOString()} ${line}\n`;
  process.stdout.write(stamped);
  await mkdir(SHARED, { recursive: true });
  await appendFile(LOG, stamped, "utf8");
};

const readQueue = async (): Promise<QueueFile> => {
  try {
    const raw = await readFile(QUEUE, "utf8");
    const parsed = JSON.parse(raw) as QueueFile;
    if (!Array.isArray(parsed.posts)) throw new Error("posts is not an array");
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { posts: [] };
    throw error;
  }
};

/** Write via a temp file so a crash mid-write cannot corrupt the queue. */
const writeQueue = async (queue: QueueFile): Promise<void> => {
  const tmp = `${QUEUE}.tmp`;
  await mkdir(dirname(QUEUE), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(queue, null, 2)}\n`, "utf8");
  await rename(tmp, QUEUE);
};

const queue = await readQueue();
const pending = queue.posts.filter((post) => !post.postedAt);

if (pending.length === 0) {
  await logLine(`queue empty (${String(queue.posts.length)} captions on file, all posted) — nothing posted`);
  process.exit(0);
}

const next = pending[0];
const message = next.message.trim();
if (message === "") {
  await logLine(`caption ${next.id} has an empty message — refusing to post it, nothing posted`);
  process.exit(1);
}

if (dryRun) {
  await logLine(
    `DRY RUN — would post caption ${next.id} (${String(message.length)} chars)` +
      `${next.linkUrl ? ` with link ${next.linkUrl}` : ""}: ${message}`,
  );
  process.exit(0);
}

const result = await postToPage(message, next.linkUrl);
if (!result.ok) {
  await logLine(`FAILED caption ${next.id} — Graph code ${String(result.code)}: ${result.message}`);
  process.exit(1);
}

next.postedAt = new Date().toISOString();
next.postId = result.postId;
await writeQueue(queue);
await logLine(
  `posted caption ${next.id} — post ${result.postId}` +
    ` (${String(pending.length - 1)} captions left in the queue)`,
);
