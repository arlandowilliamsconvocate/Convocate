import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AuthShell } from "~/components/auth-shell";
import { PublicField, PublicInput, errorClass, formNoteClass } from "~/components/public-form";
import { actionPrimary, linkInline } from "~/components/public-page";
import { resetPasswordFn } from "~/server/api";

/** The same rule the server enforces; the server is still the one that decides. */
const MIN_PASSWORD_LENGTH = 8;

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token.slice(0, 200) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Choose a new password — Convocate" },
      // The token is in the address bar of this one page. `no-referrer` keeps it
      // out of the Referer header of anything this page links to or loads from
      // somewhere else — a reset link must not travel to a third party.
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: ResetPassword,
});

type Stage = "form" | "done" | "invalid";

/**
 * Choose a new password with a link from the reset email.
 *
 * Three states, and nothing else:
 *   form    — a token is in the address bar and has not been spent here yet
 *   done    — the password was changed; the token is gone from the address bar
 *   invalid — no token, or the server said it is expired, used or superseded
 *
 * Validation happens twice on purpose: inline as the person types (so a typo is
 * caught before a request), and on the server when the form is submitted (which
 * is the one that decides). A password the server refuses does not spend the
 * link, so a short password is retryable with the same email still open.
 */
function ResetPassword() {
  const { token } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [stage, setStage] = useState<Stage>(token ? "form" : "invalid");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** What is wrong with what has been typed so far, or `null`. */
  const localProblem = (): string | null => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters.`;
    }
    if (password !== confirm) return "The two passwords do not match.";
    return null;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = localProblem();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await resetPasswordFn({ data: { token: token ?? "", password } });
      if (!result.ok) {
        if (result.code === "invalid_token") {
          setStage("invalid");
          setError(result.error);
          return;
        }
        setError(result.error);
        return;
      }
      // The token has done its job: take it out of the address bar so it is not
      // in the history, in a screenshot, or in a URL someone copies onward.
      // `window.history.state` is handed back untouched so the router's own
      // history entry keeps working.
      window.history.replaceState(window.history.state, "", "/reset-password");
      setPassword("");
      setConfirm("");
      setStage("done");
    } catch {
      setError("The password could not be changed. Try again, or ask for a new link.");
    } finally {
      setBusy(false);
    }
  };

  if (stage === "done") {
    return (
      <AuthShell
        title="Your password has been changed"
        subtitle="Every other device that was signed in to this account has been signed out."
        footer={
          <Link to="/signin" search={{ redirect: undefined }} className={linkInline}>
            Go to sign in
          </Link>
        }
      >
        <p className="text-[16px] leading-[1.75] text-charcoal">
          Use your new password the next time you sign in. The link in the email has been used and
          will not work again.
        </p>
        <Link
          to="/signin"
          className={`${actionPrimary} mt-5 w-full`}
        >
          Sign in
        </Link>
      </AuthShell>
    );
  }

  if (stage === "invalid") {
    return (
      <AuthShell
        title="This link cannot be used"
        subtitle="Nothing has been changed. Your current password still works."
        footer={
          <Link to="/signin" search={{ redirect: undefined }} className={linkInline}>
            Back to sign in
          </Link>
        }
      >
        <p className="text-[16px] leading-[1.75] text-charcoal">
          {error ??
            "This password reset link is no longer valid. It may have expired, already been used, or been replaced by a newer link."}
        </p>
        <Link
          to="/forgot-password"
          className={`${actionPrimary} mt-5 w-full`}
        >
          Request a new link
        </Link>
        <p className={`${formNoteClass} mt-6 border-t border-taupe/70 pt-6`}>
          Only the newest link works, and each one expires 60 minutes after it was asked for.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Pick something you have not used here before, at least 8 characters long."
      footer={
        <Link to="/signin" search={{ redirect: undefined }} className={linkInline}>
          Back to sign in
        </Link>
      }
    >
      {/*
        `referrerPolicy` is a real HTML attribute on <form>, but React's types
        for it sit behind an experimental flag, so it is passed as a plain
        attribute. The <meta name="referrer"> in this route's head is the one
        browsers honor for the whole document; this is the belt to that braces.
      */}
      <form
        onSubmit={submit}
        className="space-y-6"
        {...({ referrerPolicy: "no-referrer" } as Record<string, string>)}
      >
        <PublicField label="New password" hint="At least 8 characters.">
          <PublicInput
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            placeholder="••••••••"
          />
        </PublicField>
        <PublicField label="Confirm new password">
          <PublicInput
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setError(null);
            }}
            placeholder="••••••••"
          />
        </PublicField>
        {confirm !== "" && password !== confirm ? (
          <p className={formNoteClass}>The two passwords do not match yet.</p>
        ) : null}
        {error ? (
          <p className={errorClass} role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={`${actionPrimary} w-full`}>
          {busy ? "Saving…" : "Save new password"}
        </button>
      </form>
    </AuthShell>
  );
}
