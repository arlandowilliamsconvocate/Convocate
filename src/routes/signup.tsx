import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { PublicField, PublicInput, errorClass, formNoteClass } from "~/components/public-form";
import { actionPrimary, linkInline } from "~/components/public-page";
import { AuthShell } from "~/components/auth-shell";
import { getSessionUser, signUpFn } from "~/server/api";
import { safeRedirect } from "./signin";

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeRedirect(search.redirect),
  }),
  beforeLoad: async ({ search }) => {
    const user = await getSessionUser();
    if (user) throw redirect({ href: search.redirect ?? "/app" });
  },
  component: SignUp,
});

function SignUp() {
  const router = useRouter();
  const { redirect: redirectTo } = Route.useSearch();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signUpFn({ data: { name, email, password } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await router.invalidate();
      if (redirectTo) {
        // An invite link sent us here: go back so it can finish the join.
        window.location.assign(redirectTo);
        return;
      }
      await router.navigate({ to: "/app" });
    } catch {
      setError("Something went wrong creating your account. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle={
        redirectTo
          ? "One minute to set up, then we will open the conference you were invited to."
          : "One workspace for your conference budget, venue and guest speakers."
      }
      footer={
        <>
          Already have an account?{" "}
          <Link
            to="/signin"
            search={redirectTo ? { redirect: redirectTo } : {}}
            className={linkInline}
          >
            Sign in
          </Link>
          {" · "}
          <Link to="/forgot-password" className={linkInline}>
            Forgot your password?
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-6">
        <PublicField label="Your name">
          <PublicInput
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Grace Okafor"
          />
        </PublicField>
        <PublicField label="Email">
          <PublicInput
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourorganization.org"
          />
        </PublicField>
        <PublicField label="Password" hint="At least 8 characters.">
          <PublicInput
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </PublicField>
        {error ? (
          <p className={errorClass} role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={`${actionPrimary} w-full`}>
          {busy ? "Creating account…" : "Create account"}
        </button>
        <p className={formNoteClass}>
          By creating an account you agree to our{" "}
          <Link to="/privacy" className={linkInline}>
            Privacy Policy
          </Link>
          .
        </p>
      </form>

      {/* Nobody has to sign up to find out what this is: the worked example is
          one click from here, needs no account, and shows the whole thing. */}
      <p className={`${formNoteClass} mt-8 border-t border-taupe/70 pt-6`}>
        Not ready to start?{" "}
        <Link to="/example" className={linkInline}>
          See a worked example
        </Link>{" "}
        — a full conference with invented figures. No account needed.
      </p>
    </AuthShell>
  );
}
