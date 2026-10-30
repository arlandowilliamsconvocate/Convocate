/**
 * `/api/meta/messenger` — Meta's Messenger webhook for the Convocate Page.
 *
 * Two jobs on one URL, which is how Meta's dashboard works:
 *
 *   - **GET** is the handshake. Meta calls it once, when a person presses
 *     "Verify and save" in the app dashboard, with `hub.mode=subscribe`,
 *     `hub.verify_token=<the token saved in Secrets>` and `hub.challenge=<a
 *     string>`. The answer must be the challenge **raw**, as `text/plain`, with
 *     no JSON wrapper and no trailing newline — Meta compares bytes.
 *   - **POST** is every delivery afterwards. Meta signs the raw body with the
 *     app secret; the signature is checked before anything is parsed or stored.
 *
 * Why a route and not a server function: Meta signs **the exact request body**,
 * and a server function would receive it as a parsed argument and re-serialise
 * it, which is not the same bytes. The handler passes the untouched body to
 * `messenger.server.ts`, which verifies and stores.
 *
 * Nothing here reads the database or the Page token itself; that all lives in
 * `messenger.server.ts`. The `messenger-api.ts` import below is deliberate: it
 * is what puts the reply server functions in the server bundle.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handleMessengerRequest } from "~/server/messenger.server";
// Registers the owner-only reply server functions (`sendMessengerReplyFn`,
// `draftMessengerReplyFn`, `listMessengerMessagesFn`) in the server bundle. They
// have no page of their own yet; this is what makes them callable at all.
import "~/server/messenger-api";

export const Route = createFileRoute("/api/meta/messenger")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const answer = await handleMessengerRequest(request);
        return new Response(answer.body, {
          status: answer.status,
          headers: {
            "content-type": answer.contentType,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      },

      POST: async ({ request }) => {
        const answer = await handleMessengerRequest(request);
        return new Response(answer.body, {
          status: answer.status,
          headers: {
            "content-type": answer.contentType,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      },
    },
  },
});
