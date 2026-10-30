/**
 * Refresh the Convocate Facebook Page's stored credentials — run by hand, on the
 * machine, never from the browser.
 *
 * Why this exists: `facebook.server.ts` keeps the page id, the page token and
 * the long-lived user token in the live database, and it re-mints the page token
 * by itself whenever Meta answers code 190. That self-repair has one limit — a
 * long-lived user token lasts about 60 days. When it lapses, somebody has to put
 * a fresh one in, and this is the only supported way to do it: it takes the
 * token from the environment, exchanges it for the 60-day form when the app id
 * and secret are present, reads the Page back from Meta, and writes all four
 * values into the database.
 *
 * How to run (the values live in Settings -> Secrets, which the shell exports):
 *
 *   cd /home/team/shared/site
 *   . /etc/profile.d/cto-env-vars.sh
 *   bun scripts/facebook-credentials.ts
 *
 * It reads `META_USER_TOKEN` or `META_PAGE_TOKEN` (either name works — the owner
 * has used both), plus `META_APP_ID` and `META_APP_SECRET` when they are set,
 * and `META_PAGE_ID` to choose a Page when the account runs more than one.
 *
 * It prints ids, names and lengths only. It never prints a token, and it writes
 * nothing to disk.
 */
import { savePageCredentials, readPageCredentials } from "../src/server/facebook.server";

const GRAPH = "https://graph.facebook.com/v21.0";

const env = (name: string): string => (process.env[name] ?? "").trim();

const incoming = env("META_USER_TOKEN") || env("META_PAGE_TOKEN");
if (incoming === "") {
  console.error("No META_USER_TOKEN or META_PAGE_TOKEN in the environment. Nothing changed.");
  process.exit(1);
}

const appId = env("META_APP_ID");
const appSecret = env("META_APP_SECRET");

/** Short-lived tokens can post now but die within hours; exchange when we can. */
let userToken = incoming;
if (appId !== "" && appSecret !== "") {
  const url =
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&fb_exchange_token=${encodeURIComponent(incoming)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = (await response.json()) as { access_token?: string; expires_in?: number; error?: { code?: number } };
  if (typeof body.access_token !== "string") {
    console.error(`Exchange refused (HTTP ${String(response.status)}, code ${String(body.error?.code ?? "?")}). Nothing changed.`);
    process.exit(1);
  }
  userToken = body.access_token;
  const days = typeof body.expires_in === "number" ? Math.round(body.expires_in / 86_400) : null;
  console.log(`Exchanged for a long-lived user token${days === null ? "" : ` (${String(days)} days)`}.`);
} else {
  console.log("No META_APP_ID/META_APP_SECRET — using the token as given (it may be short-lived).");
}

const accountsResponse = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=100`, {
  headers: { Authorization: `Bearer ${userToken}` },
  signal: AbortSignal.timeout(20_000),
});
const accounts = (await accountsResponse.json()) as {
  data?: { id: string; name: string; access_token?: string }[];
  error?: { code?: number; message?: string };
};
if (accounts.error) {
  console.error(`Meta refused the token (code ${String(accounts.error.code)}): ${accounts.error.message ?? ""}`);
  process.exit(1);
}

const wanted = env("META_PAGE_ID");
const pages = (accounts.data ?? []).filter((page) => typeof page.access_token === "string" && page.access_token !== "");
const page = wanted === "" ? pages[0] : pages.find((candidate) => candidate.id === wanted);
if (!page?.access_token) {
  console.error(
    `No Page token returned. Pages seen: ${pages.map((p) => `${p.id} ${p.name}`).join(", ") || "none"}. Nothing changed.`,
  );
  process.exit(1);
}

await savePageCredentials({
  pageId: page.id,
  pageName: page.name,
  pageToken: page.access_token,
  userToken,
});

const stored = await readPageCredentials();
console.log(
  `Stored: page ${stored.pageId} "${stored.pageName}", page token ${String(stored.pageToken.length)} chars, ` +
    `user token ${String(stored.userToken.length)} chars.`,
);
