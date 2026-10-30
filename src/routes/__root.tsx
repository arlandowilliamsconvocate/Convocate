import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { NotFoundPage } from "~/components/not-found";
import { SiteFooter } from "~/components/site-chrome";
import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Convocate — Planning workspace for conferences and events" },
      {
        name: "description",
        content:
          "Convocate keeps the budget, the venue, the guest speakers and the contract in one place, so your events team stops chasing spreadsheets.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", sizes: "64x64", href: "/favicon-64.png" },
      { rel: "apple-touch-icon", sizes: "512x512", href: "/favicon-512.png" },
    ],
  }),
  // One definition, in components/not-found.tsx: `/admin` shows the same page to
  // anyone who is not an admin, so the two can never drift apart.
  notFoundComponent: () => <NotFoundPage />,
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
      {/* The one shared footer: the product line, plus the links to About and
          Pricing. Hidden in print, so it never reaches a contract sheet or an
          invitation letter. */}
      <SiteFooter />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
