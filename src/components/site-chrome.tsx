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
 *
 * The look is the warm editorial one the homepage is art-directed in: a cream
 * ground with no colour block, the wordmark on the left, uppercase navigation
 * set small with open letter-spacing, and quiet outlined actions on the right.
 * The header background is deliberately not painted — it inherits whatever the
 * page sits on — so it reads the same over cream and over the older paper
 * ground the product pages still use.
 */

/** The footer line, exactly as approved. */
export const FOOTER_LINE = "Convocate — a planning workspace for conferences and events.";

/** The public nav items, in order. One list, so the header and footer agree. */
export const PUBLIC_NAV = [
  { label: "Resources", to: "/resources" },
  { label: "About", to: "/about" },
  { label: "Pricing", to: "/pricing" },
] as const;

/** Small caps: 11px, uppercase, open tracking — the reference's nav voice. */
const navItem =
  "inline-flex min-h-9 items-center uppercase tracking-[0.18em] text-[11px] transition-colors hover:text-charcoal [&.active]:text-terracotta-ink";

const navQuiet = `${navItem} text-charcoal-soft`;

/** An outlined action: a 1px rule, transparent fill, generous padding. */
const outlinedAction =
  "inline-flex min-h-11 items-center justify-center border border-charcoal px-5 text-[11px] uppercase tracking-[0.16em] text-charcoal transition-colors hover:bg-charcoal hover:text-cream";

const outlinedActionQuiet =
  "inline-flex min-h-11 items-center justify-center border border-taupe px-5 text-[11px] uppercase tracking-[0.16em] text-charcoal-soft transition-colors hover:border-charcoal hover:text-charcoal";

/** About · Pricing · Sign in · Create an account (or Open workspace when signed in). */
export function SiteNavLinks({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <nav aria-label="Site" className="hidden items-center gap-7 md:flex">
      {PUBLIC_NAV.map((item) => (
        <Link key={item.to} to={item.to} className={navQuiet}>
          {item.label}
        </Link>
      ))}
      <span aria-hidden="true" className="h-4 w-px bg-taupe" />
      {signedIn ? (
        <Link to="/app" className={outlinedAction}>
          Open workspace
        </Link>
      ) : (
        <>
          <Link to="/signin" className={navQuiet}>
            Sign in
          </Link>
          <Link to="/signup" className={outlinedAction}>
            Create account
          </Link>
        </>
      )}
    </nav>
  );
}

/**
 * The same navigation on a phone, as a second rule under the wordmark rather
 * than behind a hamburger: every destination stays one tap away, and there is
 * no script to fail.
 */
function SiteNavLinksCompact({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <nav
      aria-label="Site"
      className="flex flex-wrap items-center gap-x-4 border-t border-taupe/70 py-1 text-[10px] md:hidden"
    >
      {PUBLIC_NAV.map((item) => (
        <Link key={item.to} to={item.to} className={navQuiet}>
          {item.label}
        </Link>
      ))}
      {signedIn ? (
        <Link to="/app" className={`${navQuiet} ml-auto`}>
          Workspace
        </Link>
      ) : (
        <span className="ml-auto flex items-center gap-x-4">
          <Link to="/signin" className={navQuiet}>
            Sign in
          </Link>
          <Link to="/signup" className={`${navQuiet} text-terracotta-ink sm:hidden`}>
            Create account
          </Link>
        </span>
      )}
    </nav>
  );
}

/** The public header: wordmark, then the nav. Same frame as the landing page. */
export function SiteHeader({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <header className="print-hide">
      <div className="mx-auto max-w-[78rem] px-6 lg:px-10">
        <div className="flex items-center justify-between gap-4 py-4 md:py-6">
          <Link
            to="/"
            aria-label="Convocate — home"
            className="flex items-center gap-4"
          >
            <BrandLogo />
            <span aria-hidden="true" className="hidden h-4 w-px bg-taupe lg:block" />
            <span className="hidden uppercase tracking-[0.22em] text-charcoal-soft lg:inline text-[10px]">
              Conference/Event planning
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <SiteNavLinks signedIn={signedIn} />
            {/* The compact row below needs the account action up here too, so on a
                phone the primary action is beside the wordmark. */}
            {/* Below 640 the outlined action would collide with the wordmark, so
                it moves into the hairline row underneath instead. */}
            <div className="hidden items-center gap-3 sm:flex md:hidden">
              <Link to={signedIn ? "/app" : "/signup"} className={`${outlinedAction} px-4`}>
                {signedIn ? "Workspace" : "Create account"}
              </Link>
            </div>
          </div>
        </div>
        <SiteNavLinksCompact signedIn={signedIn} />
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
    <footer className="print-hide border-t border-taupe/70">
      <div className="mx-auto max-w-[78rem] px-6 lg:px-10">
        <div className="flex flex-col gap-4 py-10 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="font-display text-[15px] text-charcoal">
            <span className="font-display text-lg">Convocate</span>{" "}
            <span className="text-charcoal-soft">— a planning workspace for conferences and events.</span>
          </p>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {PUBLIC_NAV.map((item) => (
              <Link key={item.to} to={item.to} className={navQuiet}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      {/*
        The copyright and trademark line. The year comes from the clock, so it
        can never go stale, and the mark is ™ — a claim that the name is in use,
        which is true. ® would claim a registration that has not been filed, so
        it appears nowhere on this site.
      */}
      <div className="mx-auto flex max-w-[78rem] flex-wrap items-center gap-x-5 gap-y-1 border-t border-taupe/50 px-6 py-5 text-[11px] uppercase tracking-[0.14em] text-charcoal-soft lg:px-10">
        <p>© {new Date().getFullYear()} Convocate™. All rights reserved.</p>
        {/* One privacy link and one terms link for the whole site, next to the copyright line. */}
        <Link to="/privacy" className={`${navItem} text-charcoal-soft`}>
          Privacy
        </Link>
        <Link to="/terms" className={`${navItem} text-charcoal-soft`}>
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
      <Link to={primary.to} className={outlinedAction}>
        {primary.label}
      </Link>
      <Link to={secondary.to} className={outlinedActionQuiet}>
        {secondary.label}
      </Link>
    </div>
  );
}
