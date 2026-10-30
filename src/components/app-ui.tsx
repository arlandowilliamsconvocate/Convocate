import type {
  ButtonHTMLAttributes,
  ComponentProps,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/**
 * The editorial controls for the signed-in product.
 *
 * The public pages (`~/components/public-page`, `~/components/public-form`)
 * established the language: cream paper with a 3.5% grain, Fraunces headings in
 * regular weight, a hairline taupe rule, 11px uppercase labels at open tracking,
 * and one muted terracotta accent. This module is that language, sized for a
 * working tool rather than a marketing page.
 *
 * **Why a second module instead of restyling `~/components/ui`.** `ui.tsx` is
 * shared with `/admin`, `/example`, the public registration and signing pages
 * and the print views, none of which are part of this pass. Restyling it would
 * have repainted all of them. The app interior imports from here instead; every
 * export below takes the same props as its `ui.tsx` twin, so the call sites
 * change by an import line and nothing else.
 *
 * **Density.** The marketing pages can afford 48px of padding around every
 * button. A budget with forty lines cannot. Section-level controls are 48px
 * tall; controls that live inside a data row or a board card are 44px square-ish
 * (Apple's HIG minimum, and comfortably over WCAG 2.5.8's 24px), so a forty-line
 * budget stays about two screens instead of four. Nothing interactive is under
 * 44px in either direction.
 *
 * **Contrast.** Body text is charcoal-soft `#5E564E` on cream `#FBF7F0`
 * (6.4:1). Terracotta as a rule or a 2px accent is `#B4643F` (4.1:1 — fine for a
 * border, never for a sentence); terracotta as *text* is always
 * `text-terracotta-ink` `#8A4A2A` (6.5:1). Sage text is `#55654F` (6.3:1).
 * Errors use the same `#8A2F22` rule-and-text treatment as the public forms, so
 * an error never looks like the terracotta accent.
 */

/* -------------------------------------------------------------------------- */
/* Type                                                                       */
/* -------------------------------------------------------------------------- */

/** The app's content frame. A little narrower than the marketing pages. */
export const APP_FRAME = "mx-auto w-full max-w-[76rem] px-5 sm:px-8 lg:px-10";

/** 10.5px, uppercase, open tracking — the small caps label. */
export const EYEBROW = "text-[10.5px] uppercase tracking-[0.24em] text-terracotta-ink";

/** The quiet meta line under a title: dates, venue, attendance. */
export const META = "text-[11px] uppercase tracking-[0.16em] text-charcoal-soft";

/** Running copy inside the app. 15px, 1.7 — denser than a marketing lede. */
export const LEDE = "text-[15px] leading-[1.7] text-charcoal-soft";

/** A hairline row — the list style that replaces a boxed card. */
export const hairline = "border-t border-taupe/70";

/* -------------------------------------------------------------------------- */
/* Form controls                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A cream field with a 1px taupe border. 16px text keeps iOS from zooming the
 * page when a field is focused; the global `:focus-visible` rule in app.css
 * paints the 2px terracotta ring outside the border, and the border itself
 * darkens on focus so the active field is obvious before anything is typed.
 */
export const fieldClass =
  "w-full border border-taupe bg-cream px-3 py-2 text-[16px] leading-normal text-charcoal outline-none transition-colors placeholder:text-charcoal-soft/70 focus:border-terracotta focus:ring-2 focus:ring-terracotta/20 disabled:opacity-60";

export const fieldLabelClass = "block text-[10.5px] uppercase tracking-[0.18em] text-charcoal";

export const fieldHintClass = "mt-1.5 block text-[12.5px] leading-relaxed text-charcoal-soft";

/**
 * An error: a 2px rule down the left of the sentence, in the darker red the
 * public forms use. It is deliberately not a filled red box and not the
 * terracotta accent, so a refusal cannot be mistaken for decoration.
 */
export const errorClass =
  "border-l-2 border-[#8A2F22] py-0.5 pl-2.5 text-[13px] leading-relaxed text-[#8A2F22]";

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className={fieldLabelClass}>{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {hint ? <span className={fieldHintClass}>{hint}</span> : null}
    </label>
  );
}

/** `ComponentProps<"input">` so a caller can still pass a ref through. */
export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={`${fieldClass} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${fieldClass} ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${fieldClass} ${props.className ?? ""}`} />;
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "md" | "sm";

/**
 * The outlined action: a 1px rule, a transparent fill, uppercase letters at open
 * tracking. There is no filled button in this language — the only fill is the
 * charcoal that appears on hover.
 *
 * `size="sm"` is for controls inside a data row or a board card: 44px tall, 12px
 * letters, tighter padding. It exists as a prop rather than as a `className`
 * override because two Tailwind padding utilities on one element resolve by
 * stylesheet order, not by the order they were written.
 */
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "border-charcoal text-charcoal hover:bg-charcoal hover:text-cream",
  secondary: "border-taupe text-charcoal-soft hover:border-charcoal hover:text-charcoal",
  ghost: "border-transparent text-charcoal-soft hover:text-charcoal",
  danger: "border-transparent text-[#8A2F22] hover:underline underline-offset-4",
};

const buttonSizes: Record<ButtonSize, string> = {
  md: "min-h-12 px-5 text-[11px] tracking-[0.16em]",
  sm: "min-h-11 px-3 text-[10.5px] tracking-[0.12em]",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 border uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
    />
  );
}

/** A link that is styled as an action but navigates (print sheets, letters). */
export const actionLink =
  "inline-flex min-h-11 items-center border border-taupe px-3 text-[10.5px] uppercase tracking-[0.12em] text-charcoal-soft transition-colors hover:border-charcoal hover:text-charcoal";

/** An inline link inside running copy: terracotta ink, hairline underline. */
export const linkInline =
  "text-terracotta-ink underline decoration-terracotta/40 underline-offset-4 transition-colors hover:decoration-terracotta-ink";

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A panel. Not a floating card: a hairline taupe rectangle on the cream, with no
 * shadow and no radius, the same way the public pages separate one block from
 * the next. `as` keeps the semantics the caller needs (a section, a list item).
 */
export function Panel({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "li" | "form";
}) {
  return (
    <Tag className={`border border-taupe/70 bg-cream ${className}`}>{children}</Tag>
  );
}

/**
 * The top of a section inside a page: a small caps eyebrow, one Fraunces `h2` in
 * regular weight, the short terracotta rule, an optional lede, and an optional
 * row of actions on the right.
 *
 * `level` lets a section sit under the page `h1` (2) or inside another section
 * (3) without skipping a level.
 */
export function SectionHead({
  id,
  eyebrow,
  title,
  lede,
  actions,
  level = 2,
}: {
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-[62ch]">
        {eyebrow ? <p className={EYEBROW}>{eyebrow}</p> : null}
        <Heading
          id={id}
          className={`font-display font-normal leading-[1.15] text-charcoal ${
            level === 2 ? "text-[clamp(1.25rem,2vw,1.6rem)]" : "text-[1.1rem]"
          } ${eyebrow ? "mt-2" : ""}`}
        >
          {title}
        </Heading>
        <span aria-hidden="true" className="mt-3 block h-[2px] w-10 bg-terracotta" />
        {lede ? <div className={`mt-3 ${LEDE}`}>{lede}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * One figure in the strip at the top of a conference: a small caps label, the
 * amount in tabular numerals, and a quiet hint. Over-budget is terracotta ink —
 * a state to notice, not a red alarm.
 */
export function Figure({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "over" | "muted";
}) {
  const valueTone =
    tone === "over" ? "text-terracotta-ink" : tone === "muted" ? "text-charcoal-soft" : "text-charcoal";
  return (
    <div className="border-t border-taupe pt-3">
      <p className="text-[10.5px] uppercase tracking-[0.18em] text-charcoal-soft">{label}</p>
      <p className={`mt-1.5 font-display text-[1.35rem] leading-none tabular-nums ${valueTone}`}>
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-[11.5px] leading-snug text-charcoal-soft">{hint}</p> : null}
    </div>
  );
}

/**
 * A status chip: a small caps label in a hairline box. Sage means settled
 * (signed, paid), terracotta ink means in flight (sent, negotiating), taupe means
 * nothing has happened yet. Colour is never the only signal — the word is
 * always there.
 */
export type ChipTone = "settled" | "flight" | "quiet" | "attention";

const chipTones: Record<ChipTone, string> = {
  settled: "border-sage/60 bg-sage/10 text-sage-ink",
  flight: "border-terracotta/50 bg-terracotta/[0.07] text-terracotta-ink",
  quiet: "border-taupe text-charcoal-soft",
  attention: "border-charcoal/40 bg-cream-deep text-charcoal",
};

export function Chip({
  children,
  tone = "quiet",
  title,
  className = "",
}: {
  children: ReactNode;
  tone?: ChipTone;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] whitespace-nowrap ${chipTones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** The empty state: a hairline block, a Fraunces line, a sentence, an action. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="border border-taupe/70 px-6 py-10 text-center">
      <p className="font-display text-[1.15rem] text-charcoal">{title}</p>
      <p className="mx-auto mt-2 max-w-[54ch] text-[14px] leading-relaxed text-charcoal-soft">{body}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                     */
/* -------------------------------------------------------------------------- */

/** The header row of a dense table: small caps, quiet, on the cream. */
export const thClass =
  "border-b border-taupe px-3 py-2 text-left text-[10px] font-normal uppercase tracking-[0.18em] text-charcoal-soft";

/** A body cell. Rows are separated by a hairline, never by a box. */
export const tdClass = "px-3 py-2.5 align-top text-[13.5px] leading-snug text-charcoal";

/** A money cell: right-aligned, tabular, never wrapped. */
export const moneyCell = "px-3 py-2.5 text-right align-top text-[13.5px] tabular-nums whitespace-nowrap";
