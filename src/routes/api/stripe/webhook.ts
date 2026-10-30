/**
 * `POST /api/stripe/webhook` — Stripe tells Convocate that an attendee's card was
 * charged, whether or not their browser ever came back.
 *
 * Why a route and not a server function: Stripe signs **the raw request body**,
 * and a server function would have to receive it as a parsed argument and
 * re-serialise it, which is not the same bytes. This handler hands the untouched
 * body to `stripe-webhook.server.ts`, which verifies the signature over exactly
 * what arrived.
 *
 * There is nothing to sign in for and nothing to authorise: the caller is Stripe,
 * and the `Stripe-Signature` header is the only credential. A delivery that does
 * not carry a valid one is refused before any row is read or written.
 *
 * Status codes are Stripe's instructions, not a reader's:
 *   - **200** — dealt with, or nothing here is ours. Stripe stops.
 *   - **400** — this body is not trustworthy. Nothing changed; do not retry.
 *   - **500** — we could not deal with it. Please send it again.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handleStripeWebhookRequest } from "~/server/stripe-webhook.server";

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const result = await handleStripeWebhookRequest(request);
        return json(result.body, result.status);
      },

      /**
       * Stripe only ever POSTs here. Answering a GET with a plain 405 keeps the
       * path from looking like a page to a crawler, and says nothing else.
       */
      GET: async () => json({ ok: false, error: "method_not_allowed" }, 405),
    },
  },
});
