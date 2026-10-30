import { Link, createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { SiteHeader } from "~/components/site-chrome";
import { Button, Card } from "~/components/ui";
import { getUnsubscribeStatusFn, unsubscribeLeadMagnetFn } from "~/server/api";

/**
 * /unsubscribe?token=… — the way out of the planning-notes list.
 *
 * The consent line on every guide page promises "you can leave any time with one
 * click", so this page has to work for someone who has no account, no password
 * and possibly no memory of Convocate: the token in the link is the whole of the
 * authorization, and the page asks for nothing else.
 *
 * It does not unsubscribe on page load. A link in an email can be fetched by a
 * scanner, a preview or a mail client's link checker before a person ever reads
 * it, and a GET that silently unsubscribed would take people off the list who
 * never clicked anything. So the page states what it will do and offers one
 * button — that button is the click the promise is about.
 *
 * Nothing is deleted. The row keeps its history and gains `unsubscribed_at`, and
 * the same link keeps working, so an old message's link cannot become an error.
 */
type UnsubscribeSearch = { token: string };

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: (search: Record<string, unknown>): UnsubscribeSearch => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  head: () => ({
    meta: [
      { title: "Unsubscribe — Convocate" },
      { name: "robots", content: "noindex" },
      {
        name: "description",
        content: "Leave the Convocate planning notes list. One click, and nothing else changes.",
      },
    ],
  }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => ({
    status: await getUnsubscribeStatusFn({ data: { token: deps.token } }),
  }),
  component: Unsubscribe,
});

function Unsubscribe() {
  const { status } = Route.useLoaderData();
  const { token } = Route.useSearch();
  const [done, setDone] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [already, setAlready] = useState(false);

  if (!status.ok) {
    return (
      <Shell>
        <Card className="p-7">
          <h1 className="font-serif text-2xl text-ink">That link is not one we issued</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            The unsubscribe link has a token in it, and this one does not match anything on our
            list. It may have been cut short by an email program that wrapped the line. If you want
            to be taken off, write to{" "}
            <a
              href="mailto:hello@mail.getconvocate.com"
              className="font-medium text-brand underline"
            >
              hello@mail.getconvocate.com
            </a>{" "}
            and we will do it by hand.
          </p>
          <p className="mt-5 text-sm">
            <Link to="/resources" className="font-medium text-brand underline">
              Back to the guides
            </Link>
          </p>
        </Card>
      </Shell>
    );
  }

  if (done === "done" || status.unsubscribed) {
    return (
      <Shell>
        <Card className="p-7">
          <h1 className="font-serif text-2xl text-ink">
            {already || status.unsubscribed ? "You are already off the list" : "You are off the list"}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            {already || status.unsubscribed
              ? "This address was unsubscribed earlier, so there is nothing left to do. Nothing further will be sent."
              : "That is done. This address will not receive planning notes, and nothing else about it has changed."}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            The free guides stay free: the conference budget template and the conference day
            timeline can be read by anyone without an address, and printing either one asks for an
            email. The other guides are part of the $199 plan.
          </p>
          <p className="mt-5 text-sm">
            <Link to="/resources" className="font-medium text-brand underline">
              Back to the guides
            </Link>
          </p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card className="p-7">
        <h1 className="font-serif text-2xl text-ink">Unsubscribe from the planning notes</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          This address asked for a printable guide, and with it the occasional planning note. One
          click takes it off the list. The guide itself is not affected — the page you were reading
          stays where it is.
        </p>
        {error === null ? null : (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        <div className="mt-5">
          <Button
            type="button"
            disabled={done === "busy"}
            className="px-5 py-2.5 font-semibold"
            onClick={async () => {
              setDone("busy");
              setError(null);
              try {
                const result = await unsubscribeLeadMagnetFn({ data: { token } });
                if (!result.ok) {
                  setError(result.error);
                  setDone("idle");
                  return;
                }
                setAlready(result.alreadyUnsubscribed);
                setDone("done");
              } catch {
                setError("We could not reach the list just now. Please try again in a moment.");
                setDone("idle");
              }
            }}
          >
            {done === "busy" ? "Unsubscribing…" : "Unsubscribe this address"}
          </Button>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-ink-soft">
          Nothing else happens: no confirmation email is sent, and no other setting changes.
        </p>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 pb-20 pt-14 sm:pt-20">
        <div className="max-w-xl">{children}</div>
      </main>
    </div>
  );
}
