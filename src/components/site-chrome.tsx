import { Link } from "@tanstack/react-router";
import { BrandLogo } from "./brand-logo";

/**
 * The public shell: the header and footer shared by every page a visitor can
 * reach signed out — the landing page, /about, /pricing, /signin and /signup.
 *
 * Nothing here reads the session or the database. `signedIn` is passed in by a
 * page that already knows (only the landing page does, through its own
 * loader); /about, /pricing, /signin and /signup let it default to false, so
 * they render without any server work at all.
 *
 * The footer is mounted once, in `__root.tsx`, so every page carries it.
 */

/** The footer line, exactly as approved. */
export const FOOTER_LINE = "Convocate — a planning workspace for conferences and events.";

/** The public nav items, in order. One list, so the header and footer agree. */
export const PUBLIC_NAV = [
  { label: "Resources", to: "/resources" },
  { label: "About", to: "/about" },
  { label: "Pricing", to: "/pricing" },
] as const;

const quietLink =
  "rounded-lg px-1.5 py-1.5 font-medium text-ink-soft hover:bg-paper-deep hover:text-ink sm:px-3 sm:py-2 [&.active]:bg-brand-soft [&.active]:text-brand";

/** About · Pricing · Sign in · Create an account (or Open workspace when signed in). */
export function SiteNavLinks({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <nav aria-label="Site" className="flex flex-wrap items-center gap-0.5 text-[13px] sm:gap-2 sm:text-sm">
      {PUBLIC_NAV.map((item) => (
        <Link key={item.to} to={item.to} className={quietLink}>
          {item.label}
        </Link>
      ))}
      {signedIn ? (
        <Link
          to="/app"
          className="rounded-lg bg-brand px-3 py-1.5 font-medium text-white shadow-sm hover:bg-brand/90 sm:px-4 sm:py-2"
        >
          Open workspace
        </Link>
      ) : (
        <>
          <Link to="/signin" className={quietLink}>
            Sign in
          </Link>
          <Link
            to="/signup"
            className="rounded-lg bg-brand px-3 py-1.5 font-medium text-white shadow-sm hover:bg-brand/90 sm:px-4 sm:py-2"
          >
            Create account
          </Link>
        </>
      )}
    </nav>
  );
}

/** The public header: wordmark, then the nav. Same frame as the landing page. */
export function SiteHeader({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="border-b border-line/70">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-5">
        <Link to="/" className="flex items-baseline gap-2" aria-label="Convocate — home">
          <BrandLogo />
          <span className="hidden text-xs uppercase tracking-[0.18em] text-ink-soft sm:inline">
            Conference/Event planning
          </span>
        </Link>
        <SiteNavLinks signedIn={signedIn} />
      </div>
    </header>
  );
}

/**
 * The shared footer. Mounted once in `__root.tsx`, hidden when printing so it
 * never lands on a contract sheet or an invitation letter.
 */
export function SiteFooter() {
  return (
    <footer className="print-hide border-t border-line/70 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-ink-soft sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-serif text-brand">Convocate</span> — a planning workspace for
          conferences and events.
        </p>
        <nav aria-label="Footer" className="flex items-center gap-4">
          {PUBLIC_NAV.map((item) => (
            <Link key={item.to} to={item.to} className="font-medium hover:text-ink">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      {/*
        The copyright and trademark line. The year comes from the clock, so it
        can never go stale, and the mark is ™ — a claim that the name is in use,
        which is true. ® would claim a registration that has not been filed, so
        it appears nowhere on this site.
      */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-6 pb-6 text-xs text-ink-soft">
        <p>© {new Date().getFullYear()} Convocate™. All rights reserved.</p>
        {/* One privacy link and one terms link for the whole site, next to the copyright line. */}
        <Link to="/privacy" className="font-medium hover:text-ink">
          Privacy
        </Link>
        <Link to="/terms" className="font-medium hover:text-ink">
          Terms
        </Link>
      </div>
    </footer>
  );
}

/** The closing links at the foot of a public page: one primary, one quiet. */
export function SitePageActions({
  primary,
  secondary,
}: {
  primary: { label: string; to: string };
  secondary: { label: string; to: string };
}) {
  return (
    <div className="mt-12 flex flex-wrap items-center gap-3">
      <Link
        to={primary.to}
        className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand/90"
      >
        {primary.label}
      </Link>
      <Link
        to={secondary.to}
        className="rounded-lg border border-line bg-white px-5 py-2.5 text-sm font-medium text-ink shadow-sm hover:bg-paper-deep"
      >
        {secondary.label}
      </Link>
    </div>
  );
}
