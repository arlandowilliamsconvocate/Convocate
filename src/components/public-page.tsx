import type { ReactNode } from "react";
import { SiteHeader } from "./site-chrome";

/**
 * The editorial frame the public pages are art-directed in.
 *
 * The landing page established the language (cream ground, 3.5% paper grain,
 * Fraunces headings in regular weight, a hairline taupe rule, one muted
 * terracotta accent used as a short underline and as small caps labels, and no
 * filled button anywhere). This module carries the same pieces to every other
 * page a visitor can reach signed out — /pricing, /about, /resources, /terms,
 * /privacy, the auth screens and the not-found page — so the site reads as one
 * document rather than a new front door on an old house.
 *
 * It is deliberately a *copy* of the landing page's local helpers rather than a
 * refactor of them: the landing page is live and approved, and nothing here is
 * allowed to reach into it.
 *
 * Contrast: terracotta as a *rule or an accent* is `--color-terracotta`
 * (#B4643F, 4.1:1 on cream — fine for a 2px rule, an icon or a border, not for
 * a sentence). Terracotta as *text* is always `text-terracotta-ink` (#8A4A2A,
 * 6.5:1 on cream). Body copy is charcoal-soft #5E564E on cream, 6.4:1.
 */

/** The page frame: cream paper, grain, the shared header, one `<main>`. */
export function PublicPage({
  signedIn = false,
  children,
}: {
  signedIn?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="paper-grain min-h-screen bg-cream font-sans text-charcoal">
      {/* The first thing a keyboard reaches: straight past the header. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-charcoal focus:px-5 focus:py-3 focus:text-[11px] focus:uppercase focus:tracking-[0.18em] focus:text-cream"
      >
        Skip to content
      </a>
      <SiteHeader signedIn={signedIn} />
      <main id="main">{children}</main>
    </div>
  );
}

/** The site's content measure. 78rem, the same frame the landing page uses. */
export const FRAME = "mx-auto max-w-[78rem] px-6 lg:px-10";

/** 11px, uppercase, open tracking — the small caps label. */
export const EYEBROW = "text-[11px] uppercase tracking-[0.26em] text-terracotta-ink";

/** Body copy: Instrument Sans at a 62–66 character measure, 1.78 line-height. */
export const BODY = "text-[16.5px] leading-[1.78] text-charcoal-soft";

/** The short terracotta rule under a headline. 2px, decorative, aria-hidden. */
export function Rule({
  centered = true,
  className = "",
}: {
  centered?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`block h-[2px] w-14 bg-terracotta ${centered ? "mx-auto" : ""} ${className}`}
    />
  );
}

/**
 * The top of a page: a small caps eyebrow, one Fraunces `h1` in regular weight,
 * the terracotta rule, and a lede at the site's measure. Centred, like every
 * section opening on the landing page.
 */
export function PageHead({
  eyebrow,
  title,
  lede,
  meta,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  /** A small line under the lede — e.g. "Last updated October 24, 2026". */
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="px-6 pb-14 pt-16 text-center md:pb-20 md:pt-24 lg:px-10">
      <div className="mx-auto max-w-[78rem]">
        <p className={EYEBROW}>{eyebrow}</p>
        <h1 className="font-display mx-auto mt-5 max-w-[26ch] text-balance text-[clamp(1.95rem,4.2vw,3.2rem)] font-normal leading-[1.1] tracking-[-0.015em] text-charcoal">
          {title}
        </h1>
        <Rule className="mt-7" />
        {lede && (
          <div className={`mx-auto mt-7 max-w-[62ch] ${BODY}`}>{lede}</div>
        )}
        {meta && (
          <p className="mt-6 text-[11px] uppercase tracking-[0.2em] text-charcoal-soft">{meta}</p>
        )}
        {children}
      </div>
    </header>
  );
}

/**
 * A section opening inside a page: centred Fraunces `h2` in regular weight, the
 * terracotta rule, and an optional deck line. Same rhythm as the landing page's
 * sections, one step smaller so it never competes with the `h1`.
 */
export function SectionHead({
  id,
  eyebrow,
  title,
  lede,
  measure = "58ch",
}: {
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  measure?: string;
}) {
  return (
    <div className="text-center">
      {eyebrow && <p className={EYEBROW}>{eyebrow}</p>}
      <h2
        id={id}
        className={`font-display mx-auto max-w-[26ch] text-balance text-[clamp(1.55rem,2.9vw,2.25rem)] font-normal leading-[1.16] tracking-[-0.01em] text-charcoal ${
          eyebrow ? "mt-5" : ""
        }`}
      >
        {title}
      </h2>
      <Rule className="mt-6" />
      {lede && (
        <p className={`mx-auto mt-6 text-[16px] leading-[1.78] text-charcoal-soft`} style={{ maxWidth: measure }}>
          {lede}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The only kind of button on the public pages: a 1px outlined rule, a
 * transparent fill, 11px uppercase letters at open tracking, and a 48px
 * minimum height so it is a comfortable tap target on a phone.
 */
export const actionPrimary =
  "inline-flex min-h-12 items-center justify-center border border-charcoal px-7 text-[11px] uppercase tracking-[0.18em] text-charcoal transition-colors hover:bg-charcoal hover:text-cream disabled:cursor-not-allowed disabled:opacity-55";

export const actionSecondary =
  "inline-flex min-h-12 items-center justify-center border border-taupe px-7 text-[11px] uppercase tracking-[0.18em] text-charcoal-soft transition-colors hover:border-charcoal hover:text-charcoal disabled:cursor-not-allowed disabled:opacity-55";

/** An inline link inside running copy: terracotta ink, hairline underline. */
export const linkInline =
  "text-terracotta-ink underline decoration-terracotta/40 underline-offset-4 transition-colors hover:decoration-terracotta-ink";

/** A hairline-separated row — the list style that replaces a boxed card. */
export const hairlineRow = "border-t border-taupe/80";

/** The small terracotta dash used as a bullet marker in a hairline list. */
export function Dash({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-[0.72em] h-[1px] w-3 shrink-0 bg-terracotta ${className}`}
    />
  );
}
