import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { PublicField, PublicInput, errorClass, formNoteClass } from "~/components/public-form";
import { actionPrimary, linkInline } from "~/components/public-page";
import { AuthShell } from "~/components/auth-shell";
import { getSessionUser, signInFn } from "~/server/api";

/** Only allow same-site paths, so a crafted ?redirect= cannot bounce off-site. */
export const safeRedirect = (value: unknown): string | undefined =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value.slice(0, 300)
    : undefined;

export const Route = createFileRoute("/signin")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: safeRedirect(search.redirect),
  }),
  beforeLoad: async ({ search }) => {
    const user = await getSessionUser();
    if (user) throw redirect({ href: search.redirect ?? "/app" });
  },
  component: SignIn,
});

function SignIn() {
  const router = useRouter();
  const { redirect: redirectTo } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signInFn({ data: { email, password } });
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
      setError("Something went wrong signing you in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle={
        redirectTo
          ? "Sign in and we will finish opening the invite for you."
          : "Pick up where your conference team left off."
      }
      footer={
        <>
          New to Convocate?{" "}
          <Link
            to="/signup"
            search={redirectTo ? { redirect: redirectTo } : {}}
            className={linkInline}
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-6">
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
        <PublicField label="Password">
          <PublicInput
            type="password"
            autoComplete="current-password"
            required
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
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className={formNoteClass}>
          <Link to="/forgot-password" className={linkInline}>
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
