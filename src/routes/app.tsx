import { Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AppMain, AppShell } from "~/components/app-page";
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

/**
 * The signed-in layout.
 *
 * Everything visual lives in `AppShell` (cream paper, grain, the sticky header,
 * the skip link and the one `<main>`); this file keeps only the session and the
 * sign-out behaviour it always had. The help assistant is mounted here rather
 * than per route so there is exactly one of it, and it is absent from every
 * public, signing and print page because none of them render this shell.
 */
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
    <>
      <AppShell user={user} signingOut={signingOut} onSignOut={signOut}>
        <AppMain>
          <Outlet />
        </AppMain>
        <HelpAssistant />
      </AppShell>
    </>
  );
}
