/**
 * Shared copy and helpers for attached contract documents, used by the contract
 * card and by the printed sheets, so the card and the paper say the same thing
 * about the same file.
 *
 * The limits are *also* stated here for the hint under the upload control; the
 * numbers the server enforces live in `db.server.ts` (`MAX_DOCUMENT_BYTES`,
 * `MAX_CONFERENCE_UPLOAD_BYTES`) — this file never decides anything, it only
 * explains what the server will do.
 */
export const MAX_DOCUMENT_MB = 10;
export const MAX_CONFERENCE_UPLOAD_MB = 100;

/** What the file picker offers: the three types the server accepts. */
export const DOCUMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

export const DOCUMENT_HELP = `A signed contract or a scan of it — PDF, PNG or JPG, up to ${String(MAX_DOCUMENT_MB)} MB. The conference can hold up to ${String(MAX_CONFERENCE_UPLOAD_MB)} MB of attached files.`;

/** Human-readable size, e.g. "412 KB". */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 102.4) / 10)} KB`;
  return `${String(Math.round(bytes / (1024 * 102.4)) / 10)} MB`;
};

/** The mime type the server expects for a picked file, from its extension. */
export const mimeForFilename = (filename: string): string => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "";
};
