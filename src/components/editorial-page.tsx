import type { ReactNode } from "react";

/**
 * The landing page's language, as the pieces `/about` and `/pricing` share.
 *
 * The homepage (`src/routes/index.tsx`) is the reference: four type sizes,
 * sections separated by a step in tone rather than by a rule, one filled
 * surface per screen, and sentence-case headings with no eyebrow label above
 * them. Those four rules are the whole design, and they are copied here rather
 * than reached into from the landing page, so a change to the landing page can
 * never break a public page and the other way round.
 *
 * The four sizes, and nothing else:
 *   62 hero (`HERO`), 40 section (`SECTION`), 20 lede (`LEDE`), 17 body
 *   (`BODY`). At 390px the same clamps render 34 / 28 / 20 / 17, and no size on
 *   either page falls below 17.
 *
 * The one filled surface is `ACTION`, painted `bg-action` (#8a4a2a, 6.36:1
 * against `text-on-action`) — never the decorative `--color-terracotta`, which
 * `scripts/check-terracotta-fill.ts` fails the build over. Every other action on
 * these pages is a sentence-case text link (`LINK`), never a 1px outlined box.
 */

/** The site frame: 74rem, the same measure the landing page and header use. */
export const PAGE_FRAME = "mx-auto max-w-[74rem] px-6 lg:px-12";

/** 62px at 1440, 34px at 390 — the one h1 on each page, and the $199 figure. */
export const HERO = "text-[clamp(2.125rem,4.35vw,3.875rem)] leading-[1.05] tracking-[-0.02em]";
/** 40px at 1440, 28px at 390 — every h2, and the free plan's figure. */
export const SECTION = "text-[clamp(1.75rem,2.8vw,2.5rem)] leading-[1.1] tracking-[-0.015em]";
/** 20px — the sentence under a heading, and the way in to a section. */
export const LEDE = "text-[20px] leading-[1.5]";
/** 17px — body. Nothing on either page is smaller. */
export const BODY = "text-[17px] leading-[1.65]";

/** The one filled surface on a screen. */
export const ACTION =
  "inline-flex items-center justify-center bg-action px-8 py-5 text-[17px] font-semibold text-on-action transition-colors hover:bg-action-strong";

/** A sentence-case text link, which is what every second action is. */
export const LINK =
  "text-terracotta-ink underline decoration-terracotta/40 underline-offset-4 transition-colors hover:decoration-terracotta-ink";

/** The tone a band is painted in. Adjacent bands never share one. */
export type Tone = "cream" | "deep" | "charcoal";

const bandTone: Record<Tone, string> = {
  cream: "py-20 md:py-24",
  deep: "bg-cream-deep py-20 md:py-24",
  charcoal: "bg-charcoal py-20 md:py-24",
};

/**
 * The top of a page: one h1 in Fraunces, left-aligned, and the sentence that
 * says what the page is for. No eyebrow, no rule, no centred opening — the
 * header above it and the first band below it do the separating.
 */
export function PageOpening({ title, lede }: { title: string; lede?: ReactNode }) {
  return (
    <section className="pb-14 pt-4 md:pb-20 md:pt-8">
      <div className={PAGE_FRAME}>
        <h1
          className={`font-display font-medium text-charcoal ${HERO}`}
          style={{ maxWidth: "20ch" }}
        >
          {title}
        </h1>
        {lede && (
          <p className={`mt-6 max-w-[56ch] ${LEDE} text-charcoal-soft`}>{lede}</p>
        )}
      </div>
    </section>
  );
}

/**
 * A section of a page: one h2, an optional sentence under it, then whatever the
 * section holds. `tone` is how it separates itself from the band above it —
 * cream, deeper cream, or charcoal — never a border.
 */
export function Band({
  id,
  title,
  lede,
  children,
  tone = "cream",
  measure = "52ch",
}: {
  id: string;
  title: string;
  lede?: ReactNode;
  children?: ReactNode;
  tone?: Tone;
  /** The measure the lede is set to, in ch. */
  measure?: string;
}) {
  const dark = tone === "charcoal";
  return (
    <section aria-labelledby={id} className={bandTone[tone]}>
      <div className={PAGE_FRAME}>
        <h2
          id={id}
          className={`font-display font-medium ${dark ? "text-cream" : "text-charcoal"} ${SECTION}`}
        >
          {title}
        </h2>
        {lede && (
          <p
            className={`mt-5 ${LEDE} ${dark ? "text-cream/85" : "text-charcoal-soft"}`}
            style={{ maxWidth: measure }}
          >
            {lede}
          </p>
        )}
        {children}
      </div>
    </section>
  );
}
