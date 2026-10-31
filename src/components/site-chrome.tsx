import { Link } from "@tanstack/react-router";
import { BrandLogo } from "./brand-logo";

/**
 * The public shell: the header and footer shared by every page a visitor can
 * reach signed out — the landing page, /about, /pricing, /resources and the
 * sign-in and sign-up pages.
 *
 * Nothing here reads the session or the database. `signedIn` is passed in by a
 * page that already knows (only the landing page does, through its own
 * loader); the others let it default to false, so they render without any
 * server work at all.
 *
 * The look is a plain bar: the wordmark on the left, sentence-case links on the
 * right, and one account link. No tagline strip, no tracked all-caps, no
 * outlined button, no hairline under it — the bar is separated from the page by
 * the page's own space and tone, not by a rule.
 *
 * The footer is mounted once, in `__root.tsx`, so every page carries it.
 */

/** The footer line: the product, one sentence, no dash and no label. */
export const FOOTER_LINE = "Convocate is a planning workspace for conferences and events.";
/** The same sentence after the wordmark, which is set separately. */
const FOOTER_REST = "is a planning workspace for conferences and events.";

/** The public nav items, in order. One list, so the header and footer agree. */
export const PUBLIC_NAV = [
  { label: "Resources", to: "/resources" },
  { label: "About", to: "/about" },
  { label: "Pricing", to: "/pricing" },
] as const;

/** A nav link: sentence case, body size, no tracking. */
const navItem =
  "text-[17px] text-charcoal-soft transition-colors hover:text-charcoal [&.active]:text-charcoal";

/** The account link: plain text, one per screen. */
const accountLink = "text-[17px] text-terracotta-ink transition-colors hover:text-charcoal";

/**
 * Resources · About · Pricing, plus the account link. `onHome` adds the jump to
 * the how-it-works section, which only exists on the landing page.
 */
export function SiteNavLinks({
  signedIn = false,
  onHome = false,
}: {
  signedIn?: boolean;
  onHome?: boolean;
}) {
  return (
    <nav aria-label="Site" className="hidden items-center gap-8 md:flex">
      {onHome && (
        <a href="#how-it-works" className={navItem}>
          How it works
        </a>
      )}
      {PUBLIC_NAV.map((item) => (
        <Link key={item.to} to={item.to} className={navItem}>
          {item.label}
        </Link>
      ))}
      <Link to={signedIn ? "/app" : "/signin"} className={accountLink}>
        {signedIn ? "Open workspace" : "Sign in"}
      </Link>
    </nav>
  );
}

/**
 * The same navigation on a phone, as a second row under the wordmark rather
 * than behind a hamburger: every destination stays one tap away, and there is
 * no script to fail.
 */
function SiteNavLinksCompact({
  signedIn = false,
  onHome = false,
}: {
  signedIn?: boolean;
  onHome?: boolean;
}) {
  return (
    <nav aria-label="Site" className="flex flex-wrap items-center gap-x-6 gap-y-1 py-1 md:hidden">
      {onHome && (
        <a href="#how-it-works" className={navItem}>
          How it works
        </a>
      )}
      {PUBLIC_NAV.map((item) => (
        <Link key={item.to} to={item.to} className={navItem}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** The public header: wordmark, then the nav. Same frame as the landing page. */
export function SiteHeader({
  signedIn = false,
  onHome = false,
}: {
  signedIn?: boolean;
  onHome?: boolean;
}) {
  return (
    <header className="print-hide">
      <div className="mx-auto max-w-[74rem] px-6 lg:px-12">
        <div className="flex items-center justify-between gap-4 py-6">
          <Link to="/" aria-label="Convocate — home" className="flex items-center">
            <BrandLogo />
          </Link>
          <div className="flex items-center gap-6">
            <SiteNavLinks signedIn={signedIn} onHome={onHome} />
            {/* On a phone the nav moves to the row underneath; the account link
                stays beside the wordmark so it is always one tap away. */}
            <Link to={signedIn ? "/app" : "/signin"} className={`${accountLink} md:hidden`}>
              {signedIn ? "Workspace" : "Sign in"}
            </Link>
          </div>
        </div>
        <SiteNavLinksCompact signedIn={signedIn} onHome={onHome} />
      </div>
    </header>
  );
}

/**
 * The shared footer. Mounted once in `__root.tsx`, hidden when printing so it
 * never lands on a contract sheet or an invitation letter.
 *
 * A deeper cream band, so the foot of the page is a step in tone rather than a
 * line across it.
 */
export function SiteFooter() {
  return (
    <footer className="print-hide bg-cream-deep">
      <div className="mx-auto max-w-[74rem] px-6 py-14 lg:px-12">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="max-w-[42ch] text-[17px] leading-[1.6] text-charcoal-soft">
            <span className="font-display text-[20px] text-charcoal">Convocate</span>{" "}
            {FOOTER_REST}
          </p>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {PUBLIC_NAV.map((item) => (
              <Link key={item.to} to={item.to} className={navItem}>
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
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-[17px] text-charcoal-soft">
          <p>© {new Date().getFullYear()} Convocate™. All rights reserved.</p>
          <Link to="/privacy" className={navItem}>
            Privacy
          </Link>
          <Link to="/terms" className={navItem}>
            Terms
          </Link>
        </div>
      </div>
    </footer>
  );
}
