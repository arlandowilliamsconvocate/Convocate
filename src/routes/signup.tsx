import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Field, Input } from "~/components/ui";
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
            className="font-medium text-brand underline"
          >
            Sign in
          </Link>
          {" · "}
          <Link to="/forgot-password" className="font-medium text-brand underline">
            Forgot your password?
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name">
          <Input
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Grace Okafor"
          />
        </Field>
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
        <Field label="Password" hint="At least 8 characters.">
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Creating account…" : "Create account"}
        </Button>
        <p className="text-center text-xs leading-relaxed text-ink-soft">
          By creating an account you agree to our{" "}
          <Link to="/privacy" className="font-medium text-brand underline">
            Privacy Policy
          </Link>
          .
        </p>
      </form>

      {/* Nobody has to sign up to find out what this is: the worked example is
          one click from here, needs no account, and shows the whole thing. */}
      <p className="mt-5 border-t border-line pt-4 text-center text-xs leading-relaxed text-ink-soft">
        Not ready to start?{" "}
        <Link to="/example" className="font-medium text-brand underline">
          See a worked example
        </Link>{" "}
        — a full conference with invented figures. No account needed.
      </p>
    </AuthShell>
  );
}
