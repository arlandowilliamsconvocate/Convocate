import { useState } from "react";

/**
 * The one place the Convocate logo lives.
 *
 * The owner's logo file is not here yet, so the product ships as a text
 * wordmark (the serif "Convocate"). When the file arrives:
 *
 *   1. put it at  public/logo.svg   (any of svg / png / webp — the public
 *      folder does not exist yet; create it and the file inside it; Vite
 *      serves it at /logo.svg)
 *   2. set LOGO_SRC below to "/logo.svg"
 *
 * That is the whole change: every header that shows the product name renders
 * this component, so the wordmark is replaced everywhere at once. Nothing else
 * needs editing, and no page has a placeholder image box in the meantime.
 *
 * If LOGO_SRC is set but the file is missing or fails to load, the component
 * falls back to the wordmark rather than showing a broken image.
 */
export const LOGO_SRC: string | null = "/logo.svg";

/** The product name, in text. Used as the wordmark and as the image's alt text. */
export const WORDMARK = "Convocate";

/**
 * The product name in the header: the logo image when one is configured, the
 * wordmark otherwise. Sized to the current wordmark (h-7) so swapping it in
 * does not move the header around.
 */
export function BrandLogo() {
  const [failed, setFailed] = useState(false);

  if (LOGO_SRC !== null && !failed) {
    return (
      <img
        src={LOGO_SRC}
        alt={WORDMARK}
        className="h-9 w-auto"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className="font-serif text-xl font-semibold tracking-tight text-brand">{WORDMARK}</span>
  );
}
