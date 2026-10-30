import { Link, createFileRoute } from "@tanstack/react-router";
import { Card } from "~/components/ui";
import {
  PAYMENT_COMPLETE_BODY,
  PAYMENT_COMPLETE_PAID_AT_LEAST,
  PAYMENT_COMPLETE_TITLE,
  REFUND_HOW_TO_ASK,
  REFUND_PROMISE,
  UPGRADE_PRICE,
} from "~/lib/plan";

/**
 * Where the Stripe payment link sends an organizer when a payment completes.
 *
 * Public on purpose — Stripe's after-completion redirect is a plain browser GET
 * with no Convocate session attached. It is a receipt notice and nothing else:
 * it unlocks nothing, it cannot see the payment, and it does not claim the
 * amount was checked, because it cannot check it. The conference opens only when
 * the payment has been confirmed against the payment account.
 */
export const Route = createFileRoute("/payment-complete")({
  component: PaymentComplete,
});

function PaymentComplete() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line/70">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="font-serif text-xl font-semibold tracking-tight text-brand">
              Convocate
            </span>
            <span className="hidden text-xs uppercase tracking-[0.18em] text-ink-soft sm:inline">
              Conference/Event planning
            </span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-6 py-14">
        <Card className="p-7">
          <h1 className="font-serif text-2xl text-ink">{PAYMENT_COMPLETE_TITLE}</h1>
          {PAYMENT_COMPLETE_BODY.map((paragraph) => (
            <p key={paragraph.slice(0, 32)} className="mt-3 text-sm leading-relaxed text-ink-soft">
              {paragraph}
            </p>
          ))}
          <p className="mt-4 text-xs text-ink-soft">{PAYMENT_COMPLETE_PAID_AT_LEAST}</p>
          {/* Reached accidentally (the address is public, so it can be typed or
              followed from a link): say plainly that nothing happened. */}
          <p className="mt-2 text-xs text-ink-soft">
            Arrived here by accident? Then nothing has been charged — this page only reports a
            payment, it never takes one.
          </p>
          {/* The same promise the paywall showed before the card was charged, and
              how to claim it — the receipt from the payment is the only route we
              have, so it is the one named. */}
          <div className="mt-5 rounded-lg border border-line bg-paper-deep/50 px-4 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              If it isn&rsquo;t right — full refund within 48 hours
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink">{REFUND_PROMISE}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">{REFUND_HOW_TO_ASK}</p>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              to="/app"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand/90"
            >
              Back to your conferences
            </Link>
            <Link to="/signin" search={{ redirect: undefined }} className="text-sm font-medium text-brand underline">
              Sign in to your account
            </Link>
          </div>

          <p className="mt-6 border-t border-line/70 pt-4 text-xs text-ink-soft">
            The {UPGRADE_PRICE} payment is for one conference. It is not a subscription, and
            nothing is charged again from this page.
          </p>
        </Card>
      </main>
    </div>
  );
}
