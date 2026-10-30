/**
 * Post the 60-second demo video to the Convocate Facebook Page — once, natively.
 *
 * Why a script and not a route: this is a one-off, the owner asked for it
 * directly, and it must never be reachable from a browser. It uses the same
 * server module every other Facebook action uses, so credentials are read from
 * the database and no token is printed, logged or written to disk.
 *
 * How to run:
 *
 *   cd /home/team/shared/site
 *   . /etc/profile.d/cto-env-vars.sh
 *   bun scripts/post-promo-video.ts --dry-run   # show what would be sent, send nothing
 *   bun scripts/post-promo-video.ts             # upload, read back, poll, try captions
 *
 * Rules it follows:
 *  - **One upload, ever.** After a successful upload the video id is written to
 *    the state file and a re-run only re-reads and re-polls; it will not create a
 *    second video. `--force` is the only way past that, and nothing uses it.
 *  - The description is a constant here, copied verbatim from the brief. It is
 *    compared with `===` against what Meta stores, so a stray newline or a
 *    smart-quote substitution shows up as a failure instead of being assumed.
 *  - Captions are attempted, not faked. If Meta refuses the local `.srt`, the
 *    refusal code and message are recorded and the video stays as it is.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { attachVideoCaptions, getPageVideo, postVideoToPage } from "../src/server/facebook.server";

const PROMO = "/home/team/shared/site/public/promo";
const VIDEO = join(PROMO, "convocate-60s-720.mp4");
const CAPTIONS = join(PROMO, "convocate-60s.srt");
const STATE_DIR = "/home/team/shared/social";
const STATE = join(STATE_DIR, "promo-video-post.json");

/** Verbatim from the brief. Do not edit, do not add hashtags. */
const DESCRIPTION =
  "Convocate in 60 seconds: build the conference budget, take venue and speaker contracts through to signature, book the speaker, open registration, and collect registration fees into your own Stripe account. Flat $199 per event — no subscription, no per-seat charge. https://www.getconvocate.com";

const TITLE = "Convocate in 60 seconds";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

type State = { videoId?: string; postedAt?: string; captionId?: string };

const readState = async (): Promise<State> => {
  try {
    return JSON.parse(await readFile(STATE, "utf8")) as State;
  } catch {
    return {};
  }
};

const writeState = async (state: State): Promise<void> => {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const state = await readState();

if (dryRun) {
  say(`dry run: would upload ${VIDEO} to the Page as a native video`);
  say(`description (${String(DESCRIPTION.length)} chars):`);
  say(DESCRIPTION);
  say(`captions: ${CAPTIONS}`);
  say(`already posted: ${state.videoId ? `yes, video ${state.videoId}` : "no"}`);
  process.exit(0);
}

let videoId = state.videoId ?? "";

if (videoId === "" || force) {
  say(`uploading ${VIDEO} ...`);
  const upload = await postVideoToPage({ filePath: VIDEO, description: DESCRIPTION, title: TITLE });
  if (!upload.ok) {
    say(`UPLOAD REFUSED code=${String(upload.code)} message=${upload.message}`);
    process.exit(1);
  }
  videoId = upload.videoId;
  say(`uploaded: video id ${videoId}`);
  await writeState({ videoId, postedAt: new Date().toISOString(), ...(state.captionId ? { captionId: state.captionId } : {}) });
} else {
  say(`already uploaded in an earlier run (video id ${videoId}) — not uploading again`);
}

/** Read the video back and report every field, plus an exact text comparison. */
const readBack = async (label: string): Promise<string> => {
  const read = await getPageVideo(videoId);
  if (!read.ok) {
    say(`${label}: READ REFUSED code=${String(read.code)} message=${read.message}`);
    return "";
  }
  const v = read.video;
  say(`${label}:`);
  say(`  id=${v.id}`);
  say(`  title=${JSON.stringify(v.title)}`);
  say(`  description=${JSON.stringify(v.description)}`);
  say(`  description_matches_exactly=${String(v.description === DESCRIPTION)}`);
  say(`  status=${JSON.stringify(v.status)}`);
  say(`  raw_status=${JSON.stringify(v.rawStatus)}`);
  say(`  permalink_url=${v.permalinkUrl}`);
  say(`  created_time=${v.createdTime}`);
  return v.status;
};

const firstStatus = await readBack("read-back #1");

// Meta processes asynchronously: poll a few times over a couple of minutes and
// report the actual string each time. No retry of the upload, only of the read.
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
let status = firstStatus;
for (let attempt = 1; attempt <= 5 && status !== "ready"; attempt += 1) {
  await wait(25_000);
  status = await readBack(`read-back #${String(attempt + 1)} (poll)`);
  if (status === "") break;
}

// Captions: one attempt. A refusal is recorded, never worked around.
say("attaching captions ...");
const captions = await attachVideoCaptions(videoId, CAPTIONS);
if (captions.ok) {
  say(`captions attached: id=${JSON.stringify(captions.captionId)}`);
  await writeState({ videoId, postedAt: state.postedAt ?? new Date().toISOString(), captionId: captions.captionId });
} else {
  say(`CAPTIONS REFUSED code=${String(captions.code)} message=${captions.message}`);
}

say(`DONE video=${videoId} final_status=${status}`);
