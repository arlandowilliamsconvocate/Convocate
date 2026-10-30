/**
 * `/api/logo` — the signed-in organizer's own logo, uploaded, read back and
 * removed. Three verbs, one account: the account always comes from the session
 * cookie and never from the request.
 *
 * **Why a route and not a server function.** The bytes travel as the request body
 * itself, raw. A server function carries its arguments as JSON, and a body of a
 * few hundred KB is not something that path survives; a logo may be up to 1 MB.
 * Sending the file as the body means the image is never base64-bloated on the way
 * in and never has to fit in a JSON string.
 *
 * **Nothing here trusts the caller.** The type is decided from the file's magic
 * bytes (`lib/logo.ts`), never from the filename or the content type the browser
 * sent; the size is capped at 1 MB; and every refusal is a plain sentence with a
 * real status code, so the settings page can show it as written.
 *
 * **No public address.** There is no `/api/logo/<user id>`: a request carries no
 * identifier at all, so one account cannot even name another account's mark, let
 * alone read it. A signed-out request is refused, and an account with no logo
 * saved gets a 404 — the same answer either way, and neither one reveals whether
 * anybody else has a logo.
 */
import { createFileRoute } from "@tanstack/react-router";
import { MAX_LOGO_BYTES, logoRefusal, sniffLogoMime } from "~/lib/logo";
import { userFromRequest } from "~/server/auth.server";
import { deleteOrganizerLogo, getOrganizerLogo, saveOrganizerLogo } from "~/server/db.server";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const refuse = (code: string, error: string, status = 400): Response =>
  json({ ok: false, code, error }, status);

/**
 * A browser sends `Sec-Fetch-Site` on every request it makes. A same-origin one
 * says "same-origin"; a page on another site says "cross-site". Non-browser
 * clients (curl, a script) send nothing at all, and the session cookie is
 * `SameSite=Lax`, so a cross-site form post cannot carry it in the first place —
 * this check closes the remaining door rather than being the only lock.
 */
const crossSite = (request: Request): boolean => {
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin" && site !== "none";
};

/** Read the body, refusing the moment it passes the cap instead of buffering it. */
const readCapped = async (
  request: Request,
): Promise<{ bytes: Uint8Array; truncated: boolean } | { tooLarge: number }> => {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_LOGO_BYTES) {
    return { tooLarge: declared };
  }
  if (!request.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_LOGO_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { tooLarge: total };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  // A body that arrives shorter than it was announced was cut off in transit.
  // Saying so is the difference between "your file is bad" and "the upload was
  // cut off" — and the second one is the truth.
  const truncated = Number.isFinite(declared) && declared > 0 && total < declared;
  return { bytes, truncated };
};

export const Route = createFileRoute("/api/logo")({
  server: {
    handlers: {
      /** The caller's own logo, as the image itself. 404 when none is saved. */
      GET: async ({ request }) => {
        const user = await userFromRequest(request);
        if (!user) return refuse("not_signed_in", "Sign in to your account to open this.", 401);
        const logo = await getOrganizerLogo(user.id);
        if (!logo) return refuse("no_logo", "No logo has been saved on this account.", 404);
        return new Response(logo.bytes, {
          status: 200,
          headers: {
            "content-type": logo.mime,
            "content-length": String(logo.bytes.length),
            // Private and uncacheable: this is one account's own image, reached
            // through its own session, and it must never sit in a shared cache.
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
            "content-disposition": "inline",
          },
        });
      },

      /** Save (or replace) the caller's own logo. The body IS the image. */
      POST: async ({ request }) => {
        if (crossSite(request)) {
          return refuse("cross_site", "That request did not come from Convocate.", 403);
        }
        const user = await userFromRequest(request);
        if (!user) return refuse("not_signed_in", "Sign in to your account to save a logo.", 401);
        const read = await readCapped(request);
        if ("tooLarge" in read) {
          return refuse(
            "file_too_large",
            `That image is larger than 1 MB, so nothing was saved. A logo may be up to 1 MB — please save a smaller copy.`,
            413,
          );
        }
        if (read.truncated) {
          return refuse(
            "upload_cut_off",
            "The upload was cut off before the whole image arrived, so nothing was saved. Please try again, and if it keeps happening use a smaller image.",
            400,
          );
        }
        const refusal = logoRefusal(read.bytes);
        if (refusal) return refuse("unsupported_type", refusal, 415);
        const mime = sniffLogoMime(read.bytes);
        if (!mime) return refuse("unsupported_type", logoRefusal(read.bytes) ?? "That file was refused.", 415);
        await saveOrganizerLogo(user.id, mime, read.bytes);
        return json({ ok: true, mime, sizeBytes: read.bytes.length });
      },

      /** Remove the caller's own logo. Removing one that is not there is fine. */
      DELETE: async ({ request }) => {
        if (crossSite(request)) {
          return refuse("cross_site", "That request did not come from Convocate.", 403);
        }
        const user = await userFromRequest(request);
        if (!user) return refuse("not_signed_in", "Sign in to your account to remove a logo.", 401);
        await deleteOrganizerLogo(user.id);
        return json({ ok: true });
      },
    },
  },
});
