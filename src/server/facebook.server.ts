/**
 * Posting to the Convocate Facebook Page — **server only**.
 *
 * Why this exists: the Page is one of the few channels the business can run
 * without the owner's hands (business plan, 2026-10-22: "inbound only, operated
 * entirely by us"). Meta's Graph API is free and needs no third-party scheduler,
 * so a post is one HTTPS call.
 *
 * Three rules this file follows, and why:
 *
 *  1. **No SDK, no new dependency.** Every call is a plain `fetch` to
 *     `https://graph.facebook.com/v21.0/...`. A token travels in the
 *     `Authorization: Bearer` header, never in a URL — a URL ends up in logs,
 *     `ps` output and error text, a header does not.
 *  2. **The tokens never leave this process and are never logged.** They are
 *     read from the database at call time, used, and dropped. No function here
 *     returns a token, no error message contains one, and the failure paths log
 *     Graph's numeric `code` and nothing else. There is no client-side surface
 *     for any of this: `facebook.server.ts` is imported only by server code.
 *  3. **A Graph error is a value, not a throw.** Callers get
 *     `{ ok: false, code, message }` and decide what to say. A code of 190 means
 *     the access token is invalid or expired — the one error this file can fix
 *     by itself, which it does exactly once (see `refreshPageToken`).
 *
 * Where the credentials live: one small table in the team's Turso database,
 * `facebook_page_credentials` (key/value, one row per name). Not in a file, not
 * in the environment, not in `/home/team/shared` — a page token is a credential
 * that can post as the Page, so it is kept where the rest of the business's
 * server-side state lives and nowhere else.
 *
 * Scope note: posting, reading comments, and **replying to a Messenger DM that a
 * person sent the Page first** (`sendMessengerMessage`, added 2026-10-22 with the
 * Messenger webhook). The reply is always `messaging_type=RESPONSE` — Meta's
 * 24-hour window — and it is never sent unprompted: the inbound message has to
 * exist in `messenger_messages` first. Nothing here starts a conversation, sends
 * a broadcast, or reads anyone's profile.
 */
import { readFile } from "node:fs/promises";
import { getDb } from "./db.server";

/** Meta's REST base. Hard-coded: there is no second Graph API to talk to. */
const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * The credential table. One row per name, so a token can be replaced without
 * touching the page id, and a missing row is simply "not stored yet".
 */
const CREDENTIALS_TABLE = "facebook_page_credentials";

/** The four values kept server-side. `user_token` is only used to refresh. */
export type PageCredentials = {
  pageId: string;
  pageName: string;
  pageToken: string;
  /** A long-lived user token: the source a page token is re-minted from. */
  userToken: string;
};

/** What a Graph refusal looks like to a caller — a code and Meta's sentence. */
export type GraphFailure = { ok: false; code: number; message: string };
type GraphResult = { ok: true; body: Record<string, unknown> } | GraphFailure;

/**
 * Create the credential table if it is not there yet.
 *
 * `CREATE TABLE IF NOT EXISTS`, so it is safe on every call and on a database
 * that already has it. It is also in the main schema in `db.server.ts`; this
 * copy exists so a process running an older build — or a one-off script — can
 * still store credentials without waiting for a boot.
 */
const ensureTable = async (): Promise<void> => {
  await getDb().exec(`
    CREATE TABLE IF NOT EXISTS ${CREDENTIALS_TABLE} (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
};

/** Every stored credential, empty strings where a name has no row yet. */
export const readPageCredentials = async (): Promise<PageCredentials> => {
  await ensureTable();
  const rows = await getDb()
    .query<{ key: string; value: string }, []>(`SELECT key, value FROM ${CREDENTIALS_TABLE}`)
    .all();
  const byName = new Map(rows.map((row) => [row.key, row.value]));
  return {
    pageId: byName.get("page_id") ?? "",
    pageName: byName.get("page_name") ?? "",
    pageToken: byName.get("page_token") ?? "",
    userToken: byName.get("user_token") ?? "",
  };
};

/**
 * Store the credentials. `INSERT OR REPLACE` per name: writing the same values
 * twice is a no-op in effect, and a refreshed page token replaces the old one
 * without leaving a stale row behind. Values are never logged or echoed.
 */
export const savePageCredentials = async (credentials: Partial<PageCredentials>): Promise<void> => {
  await ensureTable();
  const now = Date.now();
  const db = getDb();
  const entries: [string, string][] = [];
  if (credentials.pageId) entries.push(["page_id", credentials.pageId.trim()]);
  if (credentials.pageName) entries.push(["page_name", credentials.pageName.trim()]);
  if (credentials.pageToken) entries.push(["page_token", credentials.pageToken.trim()]);
  if (credentials.userToken) entries.push(["user_token", credentials.userToken.trim()]);
  for (const [key, value] of entries) {
    await db
      .query<unknown, [string, string, number]>(
        `INSERT OR REPLACE INTO ${CREDENTIALS_TABLE} (key, value, updated_at) VALUES (?, ?, ?)`,
      )
      .run(key, value, now);
  }
};

/**
 * One call to the Graph API.
 *
 * The token is sent as a bearer header. A refusal is returned, never thrown, and
 * carries Graph's own `code` so the caller can tell an expired token (190) from
 * a permission problem (200/10) from a rate limit (4/32/613). Meta's message is
 * passed through to the caller because it names no credential — the team reads
 * it when something is wrong, and it never reaches a browser.
 */
const graphCall = async (
  method: "GET" | "POST",
  path: string,
  token: string,
  params?: Record<string, string>,
): Promise<GraphResult> => {
  const search = new URLSearchParams();
  if (method === "GET" && params) {
    for (const [key, value] of Object.entries(params)) search.set(key, value);
  }
  const url = `${GRAPH}/${path.replace(/^\/+/, "")}${search.size > 0 ? `?${search.toString()}` : ""}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: method === "POST" ? new URLSearchParams(params ?? {}).toString() : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // Unreachable is not a Graph verdict: report it as its own code so a caller
    // never mistakes a network blip for "the Page refused this".
    return { ok: false, code: 0, message: "graph_unreachable" };
  }
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    return { ok: false, code: response.status, message: "graph_unparseable" };
  }
  if (!response.ok || body.error) {
    const error = (body.error ?? {}) as { code?: unknown; message?: unknown };
    const code = typeof error.code === "number" ? error.code : response.status;
    const message = typeof error.message === "string" ? error.message : "graph_refused";
    // Code only: Meta's message can quote a token fragment on a malformed call.
    console.log(`[convocate] facebook graph refusal code=${String(code)} path=${path.split("?")[0] ?? path}`);
    return { ok: false, code, message };
  }
  return { ok: true, body };
};

/**
 * One **multipart** call to the Graph API — the shape a file upload needs.
 *
 * Why a second transport instead of `graphCall`: Meta takes a video as an
 * uploaded file on the `source` field, and a file cannot travel in a
 * form-urlencoded body. `Content-Type` is deliberately *not* set here: `fetch`
 * writes the multipart boundary itself, and setting the header by hand omits the
 * boundary and makes Meta answer `(#100) param source must be a file`.
 *
 * Everything else is the same contract as `graphCall`: bearer header, a refusal
 * is a value, the timeout is generous (a 2 MB video over a slow link is not a
 * hung request), and only Graph's numeric code is logged.
 */
const graphUpload = async (
  path: string,
  token: string,
  fields: Record<string, string>,
  file: { field: string; filePath: string; fileName: string; mimeType: string },
  timeoutMs = 120_000,
): Promise<GraphResult> => {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(file.filePath);
  } catch {
    // A missing file is not a Graph verdict — its own code, so a caller never
    // reports "the Page refused this" when the asset was simply not there.
    return { ok: false, code: 0, message: "upload_file_unreadable" };
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set(file.field, new Blob([bytes], { type: file.mimeType }), file.fileName);
  const url = `${GRAPH}/${path.replace(/^\/+/, "")}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, code: 0, message: "graph_unreachable" };
  }
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    return { ok: false, code: response.status, message: "graph_unparseable" };
  }
  if (!response.ok || body.error) {
    const error = (body.error ?? {}) as { code?: unknown; message?: unknown };
    const code = typeof error.code === "number" ? error.code : response.status;
    const message = typeof error.message === "string" ? error.message : "graph_refused";
    console.log(`[convocate] facebook graph refusal code=${String(code)} path=${path.split("?")[0] ?? path}`);
    return { ok: false, code, message };
  }
  return { ok: true, body };
};

/**
 * A multipart upload that fixes an expired token once — the upload twin of
 * `callWithRefresh`, with the same rule: only code 190 is replayed, and only
 * after a fresh page token has been minted. A code 190 means the request was
 * rejected before anything was created, so replaying it cannot post twice.
 */
const uploadWithRefresh = async (
  path: string,
  fields: Record<string, string>,
  file: { field: string; filePath: string; fileName: string; mimeType: string },
  timeoutMs = 120_000,
): Promise<GraphResult> => {
  const credentials = await readPageCredentials();
  if (!credentials.pageToken) return { ok: false, code: 190, message: "no_page_token_stored" };
  const first = await graphUpload(path, credentials.pageToken, fields, file, timeoutMs);
  if (first.ok || first.code !== 190) return first;
  const refreshed = await refreshPageToken();
  if (refreshed === "") return first;
  return graphUpload(path, refreshed, fields, file, timeoutMs);
};

/**
 * Re-mint the Page access token from the stored long-lived user token.
 *
 * `GET /me/accounts` lists every Page the user runs; the entry whose id matches
 * our stored page id carries a fresh page token. One attempt, no loop: if this
 * fails the caller reports it rather than retrying, because a token that cannot
 * be refreshed is the owner's to reissue.
 *
 * Returns the new token, or an empty string when the refresh did not work.
 */
const refreshPageToken = async (): Promise<string> => {
  const current = await readPageCredentials();
  if (!current.userToken || !current.pageId) return "";
  const listing = await graphCall(
    "GET",
    "me/accounts",
    current.userToken,
    { fields: "id,name,access_token", limit: "100" },
  );
  if (!listing.ok) return "";
  const data = Array.isArray(listing.body.data) ? (listing.body.data as unknown[]) : [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue;
    const page = entry as { id?: unknown; name?: unknown; access_token?: unknown };
    if (String(page.id ?? "") !== current.pageId) continue;
    const token = typeof page.access_token === "string" ? page.access_token : "";
    if (token === "") return "";
    await savePageCredentials({
      pageToken: token,
      ...(typeof page.name === "string" && page.name !== "" ? { pageName: page.name } : {}),
    });
    return token;
  }
  return "";
};

/**
 * A Graph call that fixes an expired token once.
 *
 * Code 190 is Meta's "this access token is invalid or has expired". That is the
 * single failure this file can repair without a human: mint a new page token
 * from the long-lived user token and replay the call exactly once. Any other
 * failure — a permission refusal especially — is handed straight back, because
 * retrying a refusal is how an app gets rate-limited for nothing.
 */
const callWithRefresh = async (
  method: "GET" | "POST",
  path: string,
  params?: Record<string, string>,
): Promise<GraphResult> => {
  const credentials = await readPageCredentials();
  if (!credentials.pageToken) {
    return { ok: false, code: 190, message: "no_page_token_stored" };
  }
  const first = await graphCall(method, path, credentials.pageToken, params);
  if (first.ok || first.code !== 190) return first;
  const refreshed = await refreshPageToken();
  if (refreshed === "") return first;
  return graphCall(method, path, refreshed, params);
};

/** Whether a page token is stored at all — no token is read out or returned. */
export const isPageConfigured = async (): Promise<boolean> =>
  (await readPageCredentials()).pageToken !== "";

/**
 * Post a message to the Page's feed. `POST /{page-id}/feed`.
 *
 * `linkUrl` is optional; when given, Meta renders the link preview under the
 * message. Returns the new post id (`{page-id}_{post-id}`) on success.
 */
export const postToPage = async (
  message: string,
  linkUrl?: string,
): Promise<{ ok: true; postId: string } | GraphFailure> => {
  const credentials = await readPageCredentials();
  if (!credentials.pageId) return { ok: false, code: 0, message: "no_page_id_stored" };
  const params: Record<string, string> = { message };
  if (linkUrl) params.link = linkUrl;
  const result = await callWithRefresh("POST", `${credentials.pageId}/feed`, params);
  if (!result.ok) return result;
  const postId = typeof result.body.id === "string" ? result.body.id : "";
  return postId === ""
    ? { ok: false, code: 0, message: "no_post_id_returned" }
    : { ok: true, postId };
};

/**
 * The Page's comments, newest first.
 *
 * Why not `GET /{page-id}/comments`: Meta has no such edge. It answers with
 * `(#100) Tried accessing nonexisting field (comments)` — measured on this Page
 * on 2026-10-22 — so the only honest way to read "the Page's comments" is to
 * read the recent posts and their comments with it. That is what this does:
 * `GET /{page-id}/feed?fields=comments.limit(N){...}`, flattened into one list.
 *
 * An empty list with no error is the honest "reading works, nobody has
 * commented", which is why that case is an array and not a failure.
 */
export const listPageComments = async (
  limit = 25,
): Promise<{ ok: true; comments: PageComment[] } | GraphFailure> => {
  const credentials = await readPageCredentials();
  if (!credentials.pageId) return { ok: false, code: 0, message: "no_page_id_stored" };
  const perPost = Math.max(1, Math.min(100, Math.trunc(limit)));
  const result = await callWithRefresh("GET", `${credentials.pageId}/feed`, {
    fields: `comments.limit(${String(perPost)}){id,message,created_time,from,permalink_url}`,
    limit: "25",
  });
  if (!result.ok) return result;
  const feed = Array.isArray(result.body.data) ? (result.body.data as unknown[]) : [];
  const comments: PageComment[] = [];
  for (const entry of feed) {
    if (typeof entry !== "object" || entry === null) continue;
    const bucket = (entry as { comments?: { data?: unknown[] } }).comments;
    const rows = Array.isArray(bucket?.data) ? (bucket.data as unknown[]) : [];
    for (const row of rows) {
      if (typeof row !== "object" || row === null) continue;
      const comment = row as {
        id?: unknown;
        message?: unknown;
        created_time?: unknown;
        from?: { name?: unknown };
        permalink_url?: unknown;
      };
      comments.push({
        id: String(comment.id ?? ""),
        message: typeof comment.message === "string" ? comment.message : "",
        createdTime: typeof comment.created_time === "string" ? comment.created_time : "",
        authorName: typeof comment.from?.name === "string" ? comment.from.name : "",
        permalinkUrl: typeof comment.permalink_url === "string" ? comment.permalink_url : "",
      });
    }
  }
  comments.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
  return { ok: true, comments: comments.slice(0, perPost) };
};

/** One comment on the Page, as `listPageComments` reports it. */
export type PageComment = {
  id: string;
  message: string;
  createdTime: string;
  authorName: string;
  permalinkUrl: string;
};

/** Comments on one specific post — `GET /{post-id}/comments`. Used to verify a post. */
export const listPostComments = async (
  postId: string,
  limit = 25,
): Promise<{ ok: true; comments: PageComment[] } | GraphFailure> => {
  const result = await callWithRefresh("GET", `${postId}/comments`, {
    fields: "id,message,created_time,from,permalink_url",
    limit: String(Math.max(1, Math.min(100, Math.trunc(limit)))),
  });
  if (!result.ok) return result;
  const data = Array.isArray(result.body.data) ? (result.body.data as unknown[]) : [];
  const comments: PageComment[] = data.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as {
      id?: unknown;
      message?: unknown;
      created_time?: unknown;
      from?: { name?: unknown };
      permalink_url?: unknown;
    };
    return [
      {
        id: String(row.id ?? ""),
        message: typeof row.message === "string" ? row.message : "",
        createdTime: typeof row.created_time === "string" ? row.created_time : "",
        authorName: typeof row.from?.name === "string" ? row.from.name : "",
        permalinkUrl: typeof row.permalink_url === "string" ? row.permalink_url : "",
      },
    ];
  });
  return { ok: true, comments };
};

/**
 * Reply to a comment. `POST /{comment-id}/comments`.
 *
 * A reply is a comment whose parent is a comment, which is why it is the same
 * edge. Returns the new comment's id.
 */
export const replyToComment = async (
  commentId: string,
  message: string,
): Promise<{ ok: true; commentId: string } | GraphFailure> => {
  const result = await callWithRefresh("POST", `${commentId}/comments`, { message });
  if (!result.ok) return result;
  const id = typeof result.body.id === "string" ? result.body.id : "";
  return id === "" ? { ok: false, code: 0, message: "no_comment_id_returned" } : { ok: true, commentId: id };
};

/**
 * The Page's recent posts — read-only, used to verify that a post really landed
 * rather than trusting the write's own response.
 */
export const listPagePosts = async (
  limit = 10,
): Promise<{ ok: true; posts: { id: string; message: string; createdTime: string }[] } | GraphFailure> => {
  const credentials = await readPageCredentials();
  if (!credentials.pageId) return { ok: false, code: 0, message: "no_page_id_stored" };
  const result = await callWithRefresh("GET", `${credentials.pageId}/posts`, {
    fields: "id,message,created_time,permalink_url",
    limit: String(Math.max(1, Math.min(100, Math.trunc(limit)))),
  });
  if (!result.ok) return result;
  const data = Array.isArray(result.body.data) ? (result.body.data as unknown[]) : [];
  const posts = data.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as { id?: unknown; message?: unknown; created_time?: unknown };
    return [
      {
        id: String(row.id ?? ""),
        message: typeof row.message === "string" ? row.message : "",
        createdTime: typeof row.created_time === "string" ? row.created_time : "",
      },
    ];
  });
  return { ok: true, posts };
};

/**
 * Upload a video **natively** to the Page. `POST /{page-id}/videos`.
 *
 * Why native and not a link to the mp4: a link post shows a thumbnail and sends
 * the viewer off-site to a raw file; a native upload plays inside Facebook, gets
 * captions, and is the only form that counts as the Page's own video. The owner
 * asked for the demo to be watchable in the feed, so this is the shape used.
 *
 * `description` is the post text. `title` is the video's own title field (Meta
 * shows it above the player). The file is read once per attempt and sent as
 * `source`; nothing is written to disk and no token is returned or logged.
 *
 * Meta answers `{ id }` immediately and processes the file asynchronously — a
 * non-empty id means *accepted*, not *playable*. Use `getPageVideo` to see where
 * processing got to.
 */
export const postVideoToPage = async (video: {
  filePath: string;
  description: string;
  title?: string;
}): Promise<{ ok: true; videoId: string } | GraphFailure> => {
  const credentials = await readPageCredentials();
  if (!credentials.pageId) return { ok: false, code: 0, message: "no_page_id_stored" };
  const fields: Record<string, string> = { description: video.description };
  if (video.title) fields.title = video.title;
  const result = await uploadWithRefresh(`${credentials.pageId}/videos`, fields, {
    field: "source",
    filePath: video.filePath,
    fileName: video.filePath.split("/").pop() ?? "video.mp4",
    mimeType: "video/mp4",
  });
  if (!result.ok) return result;
  const videoId = typeof result.body.id === "string" ? result.body.id : "";
  return videoId === ""
    ? { ok: false, code: 0, message: "no_video_id_returned" }
    : { ok: true, videoId };
};

/** The fields `getPageVideo` reads back — the ones that prove a video landed. */
export type PageVideo = {
  id: string;
  title: string;
  description: string;
  /** Meta's processing state: `processing`, `ready`, `error`, ... */
  status: string;
  permalinkUrl: string;
  createdTime: string;
  /** Raw `status` object, so a caller can report the whole truth, not a guess. */
  rawStatus: Record<string, unknown>;
};

/**
 * Read a video back — `GET /{video-id}?fields=...`. Used to verify that an
 * upload really landed with the text we sent, rather than trusting the write's
 * own response. Processing is asynchronous, so call it again to watch `status`.
 */
export const getPageVideo = async (
  videoId: string,
): Promise<{ ok: true; video: PageVideo } | GraphFailure> => {
  const result = await callWithRefresh("GET", videoId, {
    fields: "id,title,description,status,permalink_url,created_time",
  });
  if (!result.ok) return result;
  const body = result.body;
  const rawStatus =
    typeof body.status === "object" && body.status !== null
      ? (body.status as Record<string, unknown>)
      : {};
  return {
    ok: true,
    video: {
      id: typeof body.id === "string" ? body.id : "",
      title: typeof body.title === "string" ? body.title : "",
      description: typeof body.description === "string" ? body.description : "",
      status: typeof rawStatus.video_status === "string" ? rawStatus.video_status : "",
      permalinkUrl: typeof body.permalink_url === "string" ? body.permalink_url : "",
      createdTime: typeof body.created_time === "string" ? body.created_time : "",
      rawStatus,
    },
  };
};

/**
 * Attach a caption file to a video — `POST /{video-id}/captions`.
 *
 * Meta accepts captions three ways: a `captions_file` upload, a `captions_url`
 * it fetches itself, or an already-uploaded caption id. This uses the first, so
 * a local `.srt` needs no hosting and no public URL. Captions are a separate,
 * optional step: a video that is already posted stays posted if this fails, and
 * the failure is returned rather than thrown.
 */
export const attachVideoCaptions = async (
  videoId: string,
  srtPath: string,
  locale = "en_US",
): Promise<{ ok: true; captionId: string } | GraphFailure> => {
  const result = await uploadWithRefresh(
    `${videoId}/captions`,
    { default_locale: locale },
    {
      field: "captions_file",
      filePath: srtPath,
      fileName: srtPath.split("/").pop() ?? "captions.srt",
      mimeType: "application/x-subrip",
    },
    60_000,
  );
  if (!result.ok) return result;
  const captionId = typeof result.body.id === "string" ? result.body.id : "";
  // Meta answers `{ success: true }` on some versions instead of an id; treat a
  // bare success as accepted rather than inventing an id.
  if (captionId === "" && result.body.success === true) return { ok: true, captionId: "" };
  return captionId === ""
    ? { ok: false, code: 0, message: "no_caption_id_returned" }
    : { ok: true, captionId };
};

/**
 * Reply to a Messenger message. `POST /{page-id}/messages`.
 *
 * `messaging_type=RESPONSE` is not a preference: Meta only lets a Page answer
 * inside the 24-hour window that the person's own message opens, and `RESPONSE`
 * is the tag that says so. Anything else (a `MESSAGE_TAG`, a broadcast) is a
 * different permission and a different promise, and neither is built here.
 *
 * `recipient` and `message` are JSON **strings** inside the form body — that is
 * Meta's shape, not a mistake: the Send API takes them as serialized objects.
 *
 * The transport is `callWithRefresh`, so an expired page token is re-minted once
 * and the reply replayed; a refusal comes back as a value, never a throw, and
 * only Graph's numeric code is logged. No token is returned or printed.
 */
export const sendMessengerMessage = async (
  recipientId: string,
  text: string,
): Promise<{ ok: true; messageId: string } | GraphFailure> => {
  const recipient = recipientId.trim();
  const body = text.trim();
  if (recipient === "") return { ok: false, code: 0, message: "no_recipient_id" };
  if (body === "") return { ok: false, code: 0, message: "empty_message" };
  const credentials = await readPageCredentials();
  if (!credentials.pageId) return { ok: false, code: 0, message: "no_page_id_stored" };
  const result = await callWithRefresh("POST", `${credentials.pageId}/messages`, {
    recipient: JSON.stringify({ id: recipient }),
    messaging_type: "RESPONSE",
    message: JSON.stringify({ text: body }),
  });
  if (!result.ok) return result;
  const messageId = typeof result.body.message_id === "string" ? result.body.message_id : "";
  return messageId === ""
    ? { ok: false, code: 0, message: "no_message_id_returned" }
    : { ok: true, messageId };
};

/**
 * The page id, for a caller that has to name the Page in a URL it builds (the
 * webhook's own log lines, the Messenger settings card). Never the token: this
 * returns `pageId` alone, and there is no function in this file that returns a
 * token.
 */
export const pageIdForDisplay = async (): Promise<string> => (await readPageCredentials()).pageId;
