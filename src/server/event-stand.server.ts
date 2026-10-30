/**
 * "Where you stand" — the data side of the status summary. **Server only.**
 *
 * The panel on the conference page is the only thing that calls this. It does
 * three things, in this order:
 *
 *  1. **Reads the conference's own rows**, through the same helpers the page
 *     already uses (`listBudgetItems`, `listContracts`, `listChecklistItems`,
 *     `registrationHeadcount`), so the summary is about exactly what the panels
 *     below it show — and so a committee Viewer's withheld amounts stay withheld
 *     (the shaping helpers null every figure before it reaches this module, and
 *     `sumMoney` then refuses to total a partial set).
 *  2. **Builds the facts** with `buildStandFacts` (`src/lib/stand.ts`) — counts,
 *     dollars, percentages and stage labels, and nothing else. No name, note,
 *     email address or contract text ever enters the object.
 *  3. **Asks the model for three to five sentences about those facts**, and only
 *     when there is something to summarize. A conference with no budget line, no
 *     contract, no checklist item and nobody registered is answered without a
 *     call: `STAND_EMPTY_MESSAGE` and the model is never asked.
 *
 * A model that cannot be reached is not an error here. The facts are still
 * returned, `summary` is `null`, and the panel shows the numbers line alone —
 * which is true, and is the whole of what a reader needs.
 *
 * **The cache.** A summary is reused for ten minutes while the figures it was
 * written from have not changed. The key includes a fingerprint of the facts, so
 * the first budget line a organizer adds or the first checklist item they tick
 * invalidates it — a stale paragraph about yesterday's numbers is worse than no
 * paragraph. It is in memory only, per server process: it is a cost guard, not a
 * store, and nothing about it survives a restart.
 */
import {
  getConference,
  isSampleConference,
  listBudgetItems,
  listChecklistItems,
  listContracts,
  registrationHeadcount,
  roleForConference,
} from "./db.server";
import { summarizeEventStand } from "./ai";
import {
  STAND_EMPTY_MESSAGE,
  buildStandFacts,
  standNumbersLine,
  type StandFacts,
} from "../lib/stand";
/** How long a summary may be reused while the figures under it are unchanged. */
const CACHE_TTL_MS = 10 * 60 * 1000;
/** A guard on the map, not a product limit: one entry per event, a handful of events. */
const CACHE_MAX = 200;
type CacheEntry = { fingerprint: string; summary: string; at: number };
const cache = new Map<number, CacheEntry>();
/** The facts, as one string — equal figures give an equal key, and nothing else does. */
const fingerprintOf = (facts: StandFacts): string => JSON.stringify(facts);
/**
 * What the panel receives.
 *
 * `summaryState` says which of three things happened, and the panel renders each
 * one differently: `ok` shows the paragraph, `empty` shows the empty sentence
 * and no model was called, and `unavailable` shows the numbers line with nothing
 * else — no error, no retry prompt, no apology. A reader who came for their
 * figures still has them.
 */
export type EventStand = {
  ok: true;
  facts: StandFacts;
  /** The compact line under the summary: "Budget $51,700 planned · 34% committed · …" */
  numbersLine: string;
  summary: string | null;
  summaryState: "ok" | "empty" | "unavailable";
  /** Shown in place of a summary when there is nothing on the conference yet. */
  emptyMessage: string;
  /** True when the summary was served from the ten-minute cache. */
  cached: boolean;
};
/**
 * Everything the "Where you stand" panel needs, for one reader and one event.
 *
 * Returns `null` when the caller is not a member of the conference — the caller
 * turns that into the same refusal a missing conference gets, so a stranger
 * cannot learn that a conference exists by asking for its summary.
 */
export const eventStandFor = async (
  userId: number,
  conferenceId: number,
): Promise<EventStand | null> => {
  const role = await roleForConference(userId, conferenceId);
  if (!role) return null;
  const conference = await getConference(userId, conferenceId);
  if (!conference) return null;
  // The checklist panel counts the shared example's unsaved template rather than
  // its (empty) rows, so the summary counts it the same way — otherwise the line
  // would say "0 of 0" above a panel showing twenty open items.
  const sample = conference.isSample || (await isSampleConference(conferenceId));
  const facts = buildStandFacts({
    budgetItems: await listBudgetItems(conferenceId, role),
    contracts: await listContracts(conferenceId, role),
    checklistItems: await listChecklistItems(conferenceId),
    attendeePlaces: await registrationHeadcount(conferenceId),
    budgetTargetCents: conference.budgetTargetCents,
    checklistIsTemplate: sample,
  });
  const numbersLine = standNumbersLine(facts);
  // Nothing on the conference: no model call, and none is needed.
  if (!facts.hasData) {
    return {
      ok: true,
      facts,
      numbersLine,
      summary: null,
      summaryState: "empty",
      emptyMessage: STAND_EMPTY_MESSAGE,
      cached: false,
    };
  }
  const fingerprint = fingerprintOf(facts);
  const hit = cache.get(conferenceId);
  if (hit && hit.fingerprint === fingerprint && Date.now() - hit.at < CACHE_TTL_MS) {
    return {
      ok: true,
      facts,
      numbersLine,
      summary: hit.summary,
      summaryState: "ok",
      emptyMessage: STAND_EMPTY_MESSAGE,
      cached: true,
    };
  }
  const result = await summarizeEventStand(facts);
  if (!result.ok) {
    // A failed attempt is not cached: the next reader may get a working model.
    return {
      ok: true,
      facts,
      numbersLine,
      summary: null,
      summaryState: "unavailable",
      emptyMessage: STAND_EMPTY_MESSAGE,
      cached: false,
    };
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as number);
  cache.set(conferenceId, { fingerprint, summary: result.summary, at: Date.now() });
  return {
    ok: true,
    facts,
    numbersLine,
    summary: result.summary,
    summaryState: "ok",
    emptyMessage: STAND_EMPTY_MESSAGE,
    cached: false,
  };
};
