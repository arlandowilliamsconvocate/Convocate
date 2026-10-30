/**
 * What may be saved as an organization's logo — decided in one place.
 *
 * Two rules, and both are decided on the SERVER from the file's own bytes:
 *
 *  - **PNG or JPEG, and nothing else.** The test is the file's magic bytes, never
 *    the filename and never the content type the browser claimed, because both of
 *    those are the caller's word. SVG is refused on purpose: an SVG is a document
 *    that can carry script, and this image is rendered on the organizer's own
 *    pages and inside their printed documents.
 *  - **At most 1 MB.** A logo is a small mark, not a photograph, and it is stored
 *    in the database (so it travels with the database backup) — which means every
 *    byte is a byte in every dump.
 *
 * The same module is used by the upload route and by anything that re-checks a
 * stored image, so the two can never drift apart.
 */

/** The most one logo may weigh: 1 MB. */
export const MAX_LOGO_BYTES = 1024 * 1024;

export type LogoMime = "image/png" | "image/jpeg";

/** The PNG signature: 89 50 4E 47 0D 0A 1A 0A. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** What a file of these bytes is, or null when it is neither PNG nor JPEG. */
export const sniffLogoMime = (bytes: Uint8Array): LogoMime | null => {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return "image/png";
  }
  // JPEG starts with FF D8 FF (the third byte is the start of the first marker).
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
};

/** A short, plain name for what the file actually is — used in the refusal. */
export const describeRefusedLogo = (bytes: Uint8Array): string => {
  const head = Array.from(bytes.slice(0, 16))
    .map((byte) => String.fromCharCode(byte))
    .join("")
    .trim()
    .toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "an SVG";
  if (head.startsWith("gif8")) return "a GIF";
  if (head.startsWith("riff")) return "a WebP or other RIFF file";
  if (head.startsWith("%pdf")) return "a PDF";
  return "not a PNG or a JPEG";
};

/** "960 KB" — for a message a person reads, never for a stored value. */
export const describeLogoBytes = (bytes: number): string => {
  if (bytes < 1024) return `${String(bytes)} bytes`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : String(Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

/**
 * Why a file may not be saved, as one sentence a person can act on — or null when
 * it may be. Nothing here is decided from the filename or a claimed type.
 */
export const logoRefusal = (bytes: Uint8Array): string | null => {
  if (bytes.length === 0) {
    return "That file was empty, so nothing was saved.";
  }
  if (bytes.length > MAX_LOGO_BYTES) {
    return `That image is ${describeLogoBytes(bytes.length)}. A logo may be up to 1 MB — please save a smaller copy. Nothing was saved.`;
  }
  if (sniffLogoMime(bytes) === null) {
    return `That file is ${describeRefusedLogo(bytes)}. A logo may be a PNG or a JPEG image. SVG is not accepted, because an SVG can carry script. Nothing was saved.`;
  }
  return null;
};
