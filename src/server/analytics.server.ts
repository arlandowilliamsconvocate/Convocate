/**
 * The first-party visit counter — page views counted on the server, in our own
 * database.
 *
 * What it answers
 * ---------------
 * One question, and only one: did anyone arrive, and where did they land? Every
 * public marketing page the published site serves writes one row in `page_views`
 * (see SCHEMA_SQL in db.server.ts): which page, when, which HOST referred it, and
 * whether the request looked like a machine.
 *
 * What it deliberately does not have
 * ----------------------------------
 *   - **no IP address**, in no column and in no form derived from one — not even
 *     a hash. The address is never read by this file;
 *   - **no cookie**, set or read. The counter cannot follow anyone between pages
 *     or between days;
 *   - **no user-agent string**: the agent is looked at once, to decide `is_bot`,
 *     and is then dropped;
 *   - **no query string**, so an invitation token or an email address in a URL can
 *     never reach the table;
 *   - **no client-side JavaScript**: the row is written by the server that served
 *     the page, so a reader with JavaScript off is counted exactly like everyone
 *     else and nothing is sent to a third party.
 *
 * Bots
 * ----
 * Crawlers, link-preview fetchers and command-line clients are still recorded, but
 * with `is_bot = 1`, and every count the readout shows excludes them. The rows are
 * kept rather than dropped so the panel can show how much was filtered — which is
 * how we prove the human number is not inflated by crawlers.
 *
 * Which pages
 * -----------
 * `MARKETING_PATHS` is an allowlist, not a blocklist: only the public pages the
 * owner sells from are counted. App pages (`/app/...`), the print routes, the
 * signing and invitation links, sign-in/sign-up, `/admin` and every API route are
 * never counted — they are people using the product, not visitors arriving at it.
 *
 * Failure
 * -------
 * `recordPageView` never throws and is never awaited by the caller: a database
 * that cannot be reached must not slow down or fail a page. The first failure in
 * a process is logged once; after that the counter stays quiet so a broken
 * database cannot fill the log with one line per page.
 *
 * Retention
 * ---------
 * Raw rows older than 90 days are deleted; the check runs at most once per UTC
 * day per process, and a failed prune is logged, never thrown.
 */
import { getDb } from "./db.server";

/**
 * The day this counting started — the deploy that first shipped the table.
 *
 * It is a constant, not the earliest row, because the honest answer to "since
 * when?" is "since the code went live", not "since someone happened to visit".
 * Nothing before this date was recorded and nothing can be recovered: there is no
 * backfill, and the readout says so.
 */
export const ANALYTICS_SINCE = "2026-10-21";

/** Raw rows are kept this long, then deleted. */
export const ANALYTICS_RETENTION_DAYS = 90;

const DAY_MS = 86_400_000;

/**
 * The public pages that are counted. `/resources/` covers every guide, including
 * ones written after this line, so a new guide is counted the day it ships.
 */
export const MARKETING_PATHS: readonly string[] = [
  "/",
  "/resources",
  "/resources/",
  "/about",
  "/pricing",
  "/example",
  "/privacy",
];

/** A request from one of these is a machine, not a reader. */
const BOT_PATTERN =
  /bot\b|bot\/|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegram|discord|skype|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|statuscake|monitor|scrapy|python-requests|python-urllib|aiohttp|httpx|curl\/|wget\/|libwww|okhttp|go-http-client|java\/|node-fetch|axios\/|undici|postman|insomnia|ahrefs|semrush|mj12|dotbot|petalbot|yandex|baidu|seznam|applebot|gptbot|claudebot|ccbot|perplexity/i;

/** `2026-10-21` in UTC — the bucket every row and every query uses. */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The day `daysAgo` days before `ms`, as a day string. */
const dayOffset = (ms: number, daysAgo: number): string => utcDay(ms - daysAgo * DAY_MS);

/** A user agent that names a crawler, a script or a headless browser is a bot. */
export const isBotUserAgent = (userAgent: string): boolean => {
  const ua = userAgent.trim();
  // No user agent at all: a script, not a reader. Every browser sends one.
  if (ua === "") return true;
  return BOT_PATTERN.test(ua);
};

/** Normalise a pathname for storage: no query, no fragment, no trailing slash, capped. */
export const normalizePath = (pathname: string): string => {
  let path = pathname.split("?")[0].split("#")[0];
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path.slice(0, 300);
};

/** Is this one of the public pages we count? Allowlist, see MARKETING_PATHS. */
export const isMarketingPath = (pathname: string): boolean => {
  const path = normalizePath(pathname);
  if (path.startsWith("/resources/")) return true; // every guide
  return MARKETING_PATHS.includes(path) || MARKETING_PATHS.includes(`${path}/`);
};

/** Should this request be logged at all? A GET for a public marketing page only. */
export const shouldCountView = (method: string, pathname: string): boolean =>
  method.toUpperCase() === "GET" && isMarketingPath(pathname);

/**
 * Is this the address we serve our own working copy on?
 *
 * The team's own preview loads must not be counted as visitors: they would put a
 * colleague's refresh in the owner's numbers. The live addresses — the domain and
 * the published `.ctonew.app` host — are counted normally.
 */
export const isCountedHost = (host: string | null): boolean => {
  const name = (host ?? "").toLowerCase().trim();
  if (name === "") return true;
  const bare = name.replace(/:\d+$/, "");
  if (bare.startsWith("localhost") || bare.startsWith("127.0.0.1") || bare.startsWith("[::1]")) {
    return false;
  }
  return !bare.endsWith("-dev.ctonew.app");
};

/** Hosts that are this site itself — a referrer from one of them is not a referrer. */
const OWN_HOSTS = new Set([
  "getconvocate.com",
  "www.getconvocate.com",
  "0adff9037c31e73ab219d6323a636ebb.ctonew.app",
  "0adff9037c31e73ab219d6323a636ebb-dev.ctonew.app",
]);

/** `#self` for our own pages, the bare host otherwise, and `""` for direct traffic. */
export const referrerHost = (referer: string | null): string => {
  if (!referer) return "";
  let host: string;
  try {
    host = new URL(referer).host.toLowerCase();
  } catch {
    return "";
  }
  if (!host) return "";
  const bare = host.replace(/^www\./, "");
  if (OWN_HOSTS.has(host) || OWN_HOSTS.has(bare)) return "#self";
  return bare;
};

/* ----------------------------------------------------------------- writes */

let lastPrunedDay = "";
let failureLogged = false;

/**
 * One line for the first failure in this process, then silence.
 *
 * A counter must never be able to flood a log, and a page must never wait on it.
 * The message names the failure once, which is enough to notice it; the readout
 * keeps working the moment the database answers again.
 */
const reportFailureOnce = (cause: unknown): void => {
  if (failureLogged) return;
  failureLogged = true;
  console.error(
    "[convocate] page views: the counter could not write; pages are unaffected and this is logged once",
    cause,
  );
};

/** Delete raw rows past retention. Once per UTC day per process; never throws. */
const pruneIfDue = async (now: number): Promise<void> => {
  const today = utcDay(now);
  if (lastPrunedDay === today) return;
  lastPrunedDay = today;
  try {
    await getDb()
      .query<unknown, [number]>(`DELETE FROM page_views WHERE created_at < ?`)
      .run(now - ANALYTICS_RETENTION_DAYS * DAY_MS);
  } catch (cause) {
    lastPrunedDay = "";
    reportFailureOnce(cause);
  }
};

export type PageViewInput = {
  method: string;
  pathname: string;
  headers: Headers;
};

/**
 * Record one page view. The promise NEVER rejects: analytics must never break,
 * slow or fail a page. Callers fire and forget (`void recordPageView(...)`).
 *
 * Nothing that arrives in `headers` is stored except the reduced referrer host
 * and the yes/no of `is_bot` — see the top of this file.
 */
export const recordPageView = async (view: PageViewInput): Promise<void> => {
  try {
    if (!shouldCountView(view.method, view.pathname)) return;
    const host = view.headers.get("host") ?? view.headers.get("x-forwarded-host");
    if (!isCountedHost(host)) return;
    const now = Date.now();
    await getDb()
      .query<unknown, [number, string, string, string, number]>(
        `INSERT INTO page_views (created_at, day, path, referrer_host, is_bot)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        now,
        utcDay(now),
        normalizePath(view.pathname),
        referrerHost(view.headers.get("referer")),
        isBotUserAgent(view.headers.get("user-agent") ?? "") ? 1 : 0,
      );
    await pruneIfDue(now);
  } catch (cause) {
    reportFailureOnce(cause);
  }
};

/* ---------------------------------------------------------------- reading */

export type PageRow = { path: string; d7: number; d30: number };
export type ReferrerRow = { host: string; d7: number; d30: number };

export type TrafficReport = {
  /** The day counting began (a constant — see ANALYTICS_SINCE). */
  since: string;
  /** The earliest day that actually has a row, or null when nothing is recorded yet. */
  firstRecordedDay: string | null;
  /** Human views — `is_bot = 0` only. */
  views: { today: number; d7: number; d30: number; all: number };
  /** Machine views, recorded and then excluded from every number above. */
  bots: { d7: number; d30: number; all: number };
  /** One row per page, busiest over 30 days first. */
  pages: PageRow[];
  /** Referring hosts over 30 days; `""` is direct traffic, `#self` our own pages. */
  referrers: ReferrerRow[];
  /** How long raw rows are kept (the readout states the rule). */
  retentionDays: number;
};

/** Everything `/admin/traffic` shows. SELECTs only. */
export const trafficReport = async (): Promise<TrafficReport> => {
  const db = getDb();
  const now = Date.now();
  const today = utcDay(now);
  const day7 = dayOffset(now, 6);
  const day30 = dayOffset(now, 29);

  const count = async (sql: string, args: string[] = []): Promise<number> =>
    Number((await db.query<{ c: number }, string[]>(sql).get(...args))?.c ?? 0);

  const human = `is_bot = 0`;
  const machine = `is_bot = 1`;

  const [
    viewsToday,
    views7,
    views30,
    viewsAll,
    bots7,
    bots30,
    botsAll,
    firstRow,
    pageRows,
    referrerRows,
  ] = await Promise.all([
    count(`SELECT COUNT(*) AS c FROM page_views WHERE ${human} AND day >= ?`, [today]),
    count(`SELECT COUNT(*) AS c FROM page_views WHERE ${human} AND day >= ?`, [day7]),
    count(`SELECT COUNT(*) AS c FROM page_views WHERE ${human} AND day >= ?`, [day30]),
    count(`SELECT COUNT(*) AS c FROM page_views WHERE ${human}`),
    count(`SELECT COUNT(*) AS c FROM page_views WHERE ${machine} AND day >= ?`, [day7]),
    count(`SELECT COUNT(*) AS c FROM page_views WHERE ${machine} AND day >= ?`, [day30]),
    count(`SELECT COUNT(*) AS c FROM page_views WHERE ${machine}`),
    db.query<{ day: string | null }, []>(`SELECT MIN(day) AS day FROM page_views`).get(),
    db
      .query<{ path: string; d7: number; d30: number }, [string, string]>(
        `SELECT path,
                SUM(CASE WHEN day >= ? THEN 1 ELSE 0 END) AS d7,
                COUNT(*) AS d30
           FROM page_views WHERE ${human} AND day >= ?
          GROUP BY path ORDER BY d30 DESC, path ASC LIMIT 40`,
      )
      .all(day7, day30),
    db
      .query<{ host: string; d7: number; d30: number }, [string, string]>(
        `SELECT referrer_host AS host,
                SUM(CASE WHEN day >= ? THEN 1 ELSE 0 END) AS d7,
                COUNT(*) AS d30
           FROM page_views WHERE ${human} AND day >= ?
          GROUP BY referrer_host ORDER BY d30 DESC, host ASC LIMIT 15`,
      )
      .all(day7, day30),
  ]);

  return {
    since: ANALYTICS_SINCE,
    firstRecordedDay: firstRow?.day ?? null,
    views: { today: viewsToday, d7: views7, d30: views30, all: viewsAll },
    bots: { d7: bots7, d30: bots30, all: botsAll },
    pages: pageRows.map((row) => ({
      path: row.path,
      d7: Number(row.d7 ?? 0),
      d30: Number(row.d30 ?? 0),
    })),
    referrers: referrerRows.map((row) => ({
      host: row.host,
      d7: Number(row.d7 ?? 0),
      d30: Number(row.d30 ?? 0),
    })),
    retentionDays: ANALYTICS_RETENTION_DAYS,
  };
};
