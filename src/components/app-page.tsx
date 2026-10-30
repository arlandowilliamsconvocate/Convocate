import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrandLogo } from "./brand-logo";
import { APP_FRAME, Button, EYEBROW } from "./app-ui";

/**
 * The signed-in shell — the app's equivalent of `PublicPage`.
 *
 * Same paper as the public site: cream ground, 3.5% grain, the wordmark on the
 * left, uppercase navigation set small at open tracking, a hairline taupe rule
 * under the whole thing. What changes behind the sign wall is the navigation
 * (your conferences, your details, the owner's admin view) and the account
 * block on the right.
 *
 * The header is sticky because this is a tool: on a budget with forty lines the
 * way back to the conference list should not be forty lines away. The section
 * navigation of a conference sticks under it for the same reason.
 *
 * The shell paints `.app-surface`, which is where the cream ground and the
 * remapped legacy palette live (see app.css). Everything inside it — including
 * the older components that still say `bg-white` and `text-brand` — paints in
 * cream, taupe and terracotta. /admin, /example and the print sheets are outside
 * it and keep the palette they were built for.
 */

/** 11px uppercase at open tracking — the app's nav voice, as on the public site. */
const navItem =
  "inline-flex min-h-9 items-center text-[11px] uppercase tracking-[0.18em] transition-colors hover:text-charcoal [&.active]:text-terracotta-ink";

const navQuiet = `${navItem} text-charcoal-soft`;

export type WorkspaceUser = {
  name: string | null;
  email: string;
  isAdmin: boolean;
};

export function AppShell({
  user,
  signingOut,
  onSignOut,
  children,
}: {
  user: WorkspaceUser;
  signingOut: boolean;
  onSignOut: () => void;
  children: ReactNode;
}) {
  return (
    <div className="app-surface paper-grain min-h-screen bg-cream font-sans text-charcoal">
      {/* The first thing a keyboard reaches: straight past the header. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-charcoal focus:px-5 focus:py-3 focus:text-[11px] focus:uppercase focus:tracking-[0.18em] focus:text-cream"
      >
        Skip to content
      </a>
      <header className="print-hide sticky top-0 z-30 border-b border-taupe/70 bg-cream">
        <div className={APP_FRAME}>
          <div className="flex items-center justify-between gap-4 py-2.5">
            <Link
              to="/app"
              aria-label="Convocate — your conferences"
              className="flex min-w-0 items-center gap-3"
            >
              <BrandLogo />
              <span aria-hidden="true" className="hidden h-4 w-px bg-taupe lg:block" />
              <span className="hidden text-[10px] uppercase tracking-[0.22em] text-charcoal-soft lg:inline">
                Planning workspace
              </span>
            </Link>

            <nav aria-label="Workspace" className="hidden items-center gap-7 md:flex">
              <Link to="/app" activeOptions={{ exact: true }} className={navQuiet}>
                Conferences
              </Link>
              <Link to="/app/settings" className={navQuiet}>
                Your details
              </Link>
              {/* The owner's read-only admin view. Shown only to the owner's own
                  account (isAdminUser: users.is_admin = 1 AND the address in
                  ADMIN_ACCOUNT_EMAILS) — and hiding it is only a courtesy: /admin's
                  data is refused server-side for everyone else. */}
              {user.isAdmin ? (
                <Link to="/admin" className={navQuiet}>
                  Admin
                </Link>
              ) : null}
            </nav>

            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="max-w-[16rem] truncate text-[12.5px] text-charcoal">
                  {user.name || user.email}
                </p>
                <p className="max-w-[16rem] truncate text-[11px] text-charcoal-soft">{user.email}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="whitespace-nowrap"
                onClick={onSignOut}
                disabled={signingOut}
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </Button>
            </div>
          </div>

          {/* The same destinations on a phone, as a hairline row under the
              wordmark rather than behind a hamburger: every destination stays one
              tap away, and there is no script to fail. This is also why the
              Admin link can never go missing on mobile again. */}
          <nav
            aria-label="Workspace"
            className="flex flex-wrap items-center gap-x-5 border-t border-taupe/70 py-1 md:hidden"
          >
            <Link to="/app" activeOptions={{ exact: true }} className={navQuiet}>
              Conferences
            </Link>
            <Link to="/app/settings" className={navQuiet}>
              Your details
            </Link>
            {user.isAdmin ? (
              <Link to="/admin" className={navQuiet}>
                Admin
              </Link>
            ) : null}
          </nav>
        </div>
      </header>
      <main id="main">{children}</main>
    </div>
  );
}

/**
 * The page frame inside the shell: generous margins, one column, a hairline
 * above the content so the header reads as a fixed rule rather than a floating
 * bar.
 */
export function AppMain({ children }: { children: ReactNode }) {
  return <div className={`${APP_FRAME} pb-24 pt-8 sm:pt-10`}>{children}</div>;
}

/** The top of an app page: eyebrow, one Fraunces `h1`, the terracotta rule. */
export function AppPageHead({
  eyebrow,
  title,
  lede,
  meta,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div className="min-w-0 max-w-[62ch]">
        <p className={EYEBROW}>{eyebrow}</p>
        <h1 className="font-display mt-2.5 text-balance text-[clamp(1.7rem,3.2vw,2.4rem)] font-normal leading-[1.1] tracking-[-0.015em] text-charcoal">
          {title}
        </h1>
        <span aria-hidden="true" className="mt-4 block h-[2px] w-12 bg-terracotta" />
        {lede ? (
          <div className="mt-4 text-[15px] leading-[1.7] text-charcoal-soft">{lede}</div>
        ) : null}
        {meta ? (
          <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-charcoal-soft">{meta}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * The conference section navigation. Anchor links only — every section stays on
 * the one page, so nothing is hidden behind a tab and the budget calculator's
 * "open the budget" link still lands on the lines it just wrote.
 */
export function SectionNav({
  items,
}: {
  items: { id: string; label: string }[];
}) {
  return (
    <nav
      aria-label="Conference sections"
      className="print-hide sticky top-[3.6rem] z-20 -mx-5 border-y border-taupe/70 bg-cream/97 px-5 backdrop-blur-sm sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10"
    >
      <ul className="flex flex-wrap items-center gap-x-6 gap-y-0">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="inline-flex min-h-11 items-center text-[10.5px] uppercase tracking-[0.18em] text-charcoal-soft transition-colors hover:text-charcoal"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
