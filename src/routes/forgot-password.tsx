import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AuthShell } from "~/components/auth-shell";
import { Button, Field, Input } from "~/components/ui";
import { requestPasswordResetFn } from "~/server/api";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset your password — Convocate" }] }),
  component: ForgotPassword,
});

/**
 * "Forgot your password?" — ask for a link, and show one answer.
 *
 * The page never learns anything the server does not say: whatever happened on
 * the server, `requestPasswordResetFn` returns the same sentence, and this page
 * prints it. That is the whole point — a page that says "no account with that
 * address" is a page that lists who has an account.
 */
function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await requestPasswordResetFn({ data: { email } });
      setAnswer(result.message);
    } catch {
      // A failed request is not an answer about the address — it is a failed
      // request. Saying so is not a giveaway; it is the truth.
      setError("The request did not go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (answer) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="One more step, and you are back in."
        footer={
          <Link to="/signin" search={{ redirect: undefined }} className="font-medium text-brand underline">
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm leading-relaxed text-ink">{answer}</p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          Nothing has changed yet — your current password still works until you open the link and
          choose a new one.
        </p>
        <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-ink-soft">
          Nothing arrived? Wait a minute, check the spam folder, and then ask for another link. Only
          the newest link works.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email you signed up with and we will send you a link to choose a new password."
      footer={
        <>
          Remembered it?{" "}
          <Link to="/signin" search={{ redirect: undefined }} className="font-medium text-brand underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourorganization.org"
          />
        </Field>
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Sending…" : "Send me a reset link"}
        </Button>
        <p className="text-center text-xs leading-relaxed text-ink-soft">
          The link works once and expires in 60 minutes.
        </p>
      </form>
    </AuthShell>
  );
}
