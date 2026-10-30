import type { ComponentProps, ReactNode } from "react";

/**
 * The public form controls — sign in, create account, reset password.
 *
 * These exist instead of the app's `~/components/ui` Field/Input/Button on
 * purpose. The app interior (workspace, budget, contracts, admin) keeps the
 * original product styling and is not part of this pass, so the editorial look
 * lives here rather than in a shared primitive that would repaint every screen
 * behind the sign-in wall.
 *
 * The field names, validation, error strings and submit behaviour all stay in
 * the route files exactly as they were; this module is only the skin.
 */

/**
 * A cream field with a 1px taupe border, charcoal text and a terracotta focus
 * treatment. The global `:focus-visible` rule in app.css paints the 2px
 * terracotta ring outside the border; the border itself darkens on `:focus` so
 * the field is obvious while the caret is in it, before anything is typed.
 * 16px text keeps iOS from zooming the page on focus.
 */
export const fieldClass =
  "w-full border border-taupe bg-cream px-4 py-3 text-[16px] leading-normal text-charcoal outline-none transition-colors placeholder:text-charcoal-soft focus:border-terracotta focus:ring-2 focus:ring-terracotta/25";

/** The small caps label that sits above a field. */
export const fieldLabelClass =
  "block text-[11px] uppercase tracking-[0.18em] text-charcoal";

/** The hint under a field, and the quiet inline note above an error. */
export const fieldHintClass = "mt-2 block text-[13px] leading-relaxed text-charcoal-soft";

/**
 * An error. Not a red pill: a 2px rule down the left of the sentence, in a
 * darker red than the terracotta so it cannot be mistaken for an accent. The
 * words are the route's own error string, unchanged.
 */
export const errorClass =
  "border-l-2 border-[#8A2F22] py-1 pl-3 text-[14.5px] leading-relaxed text-[#8A2F22]";

/** The quiet note under the submit button — small print, still 4.5:1. */
export const formNoteClass = "text-[13.5px] leading-relaxed text-charcoal-soft";

export function PublicField({
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
      <span className="mt-2 block">{children}</span>
      {hint ? <span className={fieldHintClass}>{hint}</span> : null}
    </label>
  );
}

/** `ComponentProps<"input">` so a caller can still pass a ref through. */
export function PublicInput(props: ComponentProps<"input">) {
  return <input {...props} className={`${fieldClass} ${props.className ?? ""}`} />;
}
