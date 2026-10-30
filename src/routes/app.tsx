import { Link, Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "~/components/ui";
import { HelpAssistant } from "~/components/help-assistant";
import { getSessionUser, signOutFn } from "~/server/api";

export const Route = createFileRoute("/app")({
  beforeLoad: async () => {
    const user = await getSessionUser();
    if (!user) throw redirect({ to: "/signin" });
    return { user };
  },
  component: AppLayout,
});

function AppLayout() {
  const router = useRouter();
  const { user } = Route.useRouteContext();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    await signOutFn();
    await router.invalidate();
    await router.navigate({ to: "/" });
    setSigningOut(false);
  };

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line/70 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-6">
            <Link to="/app" className="font-serif text-xl font-semibold tracking-tight text-brand">
              Convocate
            </Link>
            <nav className="flex flex-wrap items-center gap-1 text-sm text-ink-soft">
              <Link
                to="/app"
                activeOptions={{ exact: true }}
                className="rounded-md px-2 py-1 hover:bg-paper-deep hover:text-ink [&.active]:bg-brand-soft [&.active]:text-brand"
              >
                Conferences
              </Link>
              {/* The organizer's own details — a plain link in the same wrapping
                  row as "Conferences", so it is on screen at 390px wide too. It
                  sits here rather than behind an `sm:` breakpoint on purpose: a
                  hidden-on-mobile nav is how the Admin link went missing once. */}
              <Link
                to="/app/settings"
                className="rounded-md px-2 py-1 hover:bg-paper-deep hover:text-ink [&.active]:bg-brand-soft [&.active]:text-brand"
              >
                Your details
              </Link>
              {/* The owner's read-only admin view. Shown only to the owner's own
                  account (isAdminUser: users.is_admin = 1 AND the address in
                  ADMIN_ACCOUNT_EMAILS) — and hiding it is only a courtesy: /admin's
                  data is refused server-side for everyone else. */}
              {user.isAdmin ? (
                <Link
                  to="/admin"
                  className="rounded-md px-2 py-1 hover:bg-paper-deep hover:text-ink [&.active]:bg-brand-soft [&.active]:text-brand"
                >
                  Admin
                </Link>
              ) : null}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-ink">{user.name || user.email}</p>
              <p className="text-xs text-ink-soft">{user.email}</p>
            </div>
            <Button variant="secondary" className="whitespace-nowrap" onClick={signOut} disabled={signingOut}>
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10 pb-24">
        <Outlet />
      </main>
      {/* The help assistant — one circular button, bottom-right, on every
          signed-in page. Mounted here rather than per route so there is exactly
          one of it; it is absent from every public, signing and print page
          because none of them render this shell. */}
      <HelpAssistant />
    </div>
  );
}
