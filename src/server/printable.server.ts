import { createHmac, timingSafeEqual } from "node:crypto";
import type { LeadMagnetSlug } from "~/lib/lead-magnets";

/**
 * The unlock for a printable guide sheet: an opaque, signed cookie.
 *
 * **Why a cookie and not a session row.** The thing being remembered is "this
 * browser may open the one-page sheet for this guide", it has to survive a
 * reload of the print URL with no account and no JavaScript, and it is worth
 * nothing if it leaks. A signed value says exactly that and needs no table, no
 * cleanup and no read on every request: the server recomputes the signature and
 * answers from the value alone.
 *
 * **What it proves, honestly.** It proves that this browser once submitted a
 * valid email address for that guide. It does not prove the address is real and
 * it is not an identity: the sheet is public copy, and the gate is about
 * capture, not secrecy. The cookie holds no email address — the address lives in
 * `lead_signups` — so a stolen cookie leaks which guides a browser unlocked and
 * nothing about who they are.
 *
 * **The key** is derived, not stored: HMAC over a label using a secret this
 * deployment already has. Deriving it means the unlock needs nothing new from
 * the owner (no key to paste) and both environments compute the same value from
 * the same secret. If that secret is rotated the cookies stop verifying and a
 * reader simply submits their address again — no data is lost, because the
 * address is in the database, not in the cookie.
 */
const COOKIE_NAME = "convocate_printable";
/** Long enough that a sheet printed for next year's committee still opens. */
const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

const signingKey = (): Buffer => {
  const seed =
    process.env.CONVOCATE_PRINT_SECRET ??
    process.env.STRIPE_SECRET_KEY ??
    process.env.TURSO_AUTH_TOKEN ??
    process.env.DATABASE_URL ??
    "";
  return createHmac("sha256", seed).update("convocate printable unlock v1").digest();
};

const sign = (payload: string): string =>
  createHmac("sha256", signingKey()).update(payload).digest("base64url");

const safeEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * A value for the cookie: version, expiry, the guides it unlocks, and a
 * signature over all three. Guides are comma-separated and sorted, so the same
 * set always produces the same payload.
 */
export const encodePrintableUnlock = (
  guides: readonly LeadMagnetSlug[],
  nowMs: number,
): string => {
  const expiresAt = nowMs + MAX_AGE_SECONDS * 1000;
  const list = [...new Set(guides)].sort().join(",");
  const payload = `v1|${String(expiresAt)}|${list}`;
  return `${payload}|${sign(payload)}`;
};

/**
 * The guides this cookie value unlocks, or an empty list for anything that is
 * not a value we signed: a missing cookie, a tampered one, a truncated one, or
 * one that has expired. Every failure is the same answer — no unlock — because a
 * reader can do nothing useful with the difference and an attacker learns
 * nothing from it.
 */
export const decodePrintableUnlock = (
  value: string | undefined,
  nowMs: number,
): LeadMagnetSlug[] => {
  if (!value) return [];
  const parts = value.split("|");
  if (parts.length !== 4) return [];
  const [version, expiresRaw, list, signature] = parts;
  if (version !== "v1") return [];
  const payload = `${version}|${expiresRaw}|${list}`;
  if (!safeEqual(signature, sign(payload))) return [];
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return [];
  return list.split(",").filter((slug): slug is LeadMagnetSlug => slug !== "") as LeadMagnetSlug[];
};

/** The cookie's name, so the writer and the readers cannot drift apart. */
export const PRINTABLE_COOKIE = COOKIE_NAME;
export const PRINTABLE_COOKIE_MAX_AGE = MAX_AGE_SECONDS;
