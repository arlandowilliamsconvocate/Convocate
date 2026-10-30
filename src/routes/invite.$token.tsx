import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AuthShell } from "~/components/auth-shell";
import { Button } from "~/components/ui";
import { acceptInviteFn, getInviteFn } from "~/server/api";

export const Route = createFileRoute("/invite/$token")({
  loader: async ({ params }) => ({
    invite: await getInviteFn({ data: { token: params.token } }),
  }),
  component: InvitePage,
});

const roleWords = (role: string) =>
  role === "editor"
    ? "an Editor — you can build the budget and work the contracts board"
    : "a Viewer — you can read everything but change nothing";

function InvitePage() {
  const { invite } = Route.useLoaderData();
  const router = useRouter();
  const [state, setState] = useState<"idle" | "joining" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  const valid = invite.valid;

  useEffect(() => {
    // Opening a valid link while signed in joins straight away and lands on the
    // conference. Re-opening the same link later is harmless: joining again
    // keeps whatever role you already hold.
    if (!valid || !invite.signedIn || attempted.current) return;
    attempted.current = true;
    setState("joining");
    void (async () => {
      try {
        const result = await acceptInviteFn({ data: { token: invite.token } });
        if (!result.ok) {
          setError(result.error);
          setState("failed");
          return;
        }
        await router.invalidate();
        await router.navigate({
          to: "/app/conference/$conferenceId",
          params: { conferenceId: String(result.conferenceId) },
        });
      } catch {
        setError("We could not add you to that conference. Try opening the link again.");
        setState("failed");
      }
    })();
  }, [valid, invite, router]);

  if (!valid) {
    const reason = invite.reason;
    return (
      <AuthShell
        title="This invite is no longer valid"
        subtitle="Nothing has been changed. Ask the conference owner for a new link."
        footer={
          <Link to="/app" className="font-medium text-brand underline">
            Go to your conferences
          </Link>
        }
      >
        <p className="text-sm text-ink">
          {reason === "revoked"
            ? "The conference owner revoked this invite link, so it no longer opens anything."
            : reason === "expired"
              ? "Invite links expire 30 days after they are created."
              : "This link does not match an invite — it may have been copied incompletely, or the conference may have been deleted."}
        </p>
        <p className="mt-3 text-sm text-ink-soft">
          If you are signed in, your own conferences are still there.
        </p>
      </AuthShell>
    );
  }

  const conferencePath = `/app/conference/${String(invite.conferenceId)}`;

  if (!invite.signedIn) {
    const here = `/invite/${invite.token}`;
    const back = encodeURIComponent(here);
    return (
      <AuthShell
        title={`You are invited to ${invite.conferenceName}`}
        subtitle="Sign in, or create an account, and you will be taken straight into the conference."
        footer={
          <>
            The link was shared with you by hand — Convocate cannot send email yet.
          </>
        }
      >
        <p className="text-sm text-ink">
          This link makes you {roleWords(invite.role)} of{" "}
          <span className="font-medium">{invite.conferenceName}</span>.
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          Use the same account you already work in, or start a new one — either way you will land
          on the conference as soon as you sign in.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <a href={`/signin?redirect=${back}`} className="flex-1">
            <Button className="w-full">Sign in</Button>
          </a>
          <a href={`/signup?redirect=${back}`} className="flex-1">
            <Button variant="secondary" className="w-full">
              Create an account
            </Button>
          </a>
        </div>
      </AuthShell>
    );
  }

  if (state === "failed") {
    return (
      <AuthShell
        title="We could not add you to this conference"
        subtitle={`The invite for ${invite.conferenceName} could not be used just now.`}
        footer={
          <a href={conferencePath} className="font-medium text-brand underline">
            Try opening the conference
          </a>
        }
      >
        <p className="text-sm text-ink">{error}</p>
        <p className="mt-3 text-sm text-ink-soft">
          Ask the conference owner to send a fresh invite link.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Joining ${invite.conferenceName}`}
      subtitle={`Adding you as ${invite.role === "editor" ? "an Editor" : "a Viewer"}…`}
      footer={<>One moment — we are opening the conference for you.</>}
    >
      <p className="text-sm text-ink-soft">
        {invite.currentRole
          ? "You already have access; we are keeping the higher of the two roles."
          : "If this takes more than a few seconds, reload the page."}
      </p>
    </AuthShell>
  );
}
