/**
 * Turning a refused server-function call into a sentence a person can read.
 *
 * The print routes call a server function in their loader. When the server
 * refuses — not signed in, a Viewer, a stranger, a missing conference — it throws
 * a `Response` with a 403/404 and a JSON body. During SSR that `Response` arrives
 * here as-is; in the browser the client transport may hand back the parsed body
 * instead, so both shapes are read. Whatever arrives, the page shows the server's
 * own words and no conference data, because none was ever sent.
 */
export type RefusalInfo = { message: string; signedOut: boolean; status: number };

const FALLBACK: RefusalInfo = {
  message:
    "Convocate could not open this page for your account. Sign in again, and if it still refuses, ask the conference owner for access.",
  signedOut: false,
  status: 403,
};

const asBody = (value: unknown): { error?: unknown; code?: unknown } | null =>
  value && typeof value === "object" ? (value as { error?: unknown; code?: unknown }) : null;

export const describeRefusal = async (cause: unknown): Promise<RefusalInfo> => {
  try {
    const maybeResponse =
      cause instanceof Response
        ? cause
        : asBody(cause) && (cause as { response?: unknown }).response instanceof Response
          ? ((cause as { response: Response }).response)
          : null;
    if (maybeResponse) {
      const status = maybeResponse.status || FALLBACK.status;
      const body = asBody(await maybeResponse.clone().json());
      const message = typeof body?.error === "string" ? body.error : FALLBACK.message;
      return { message, signedOut: body?.code === "not_signed_in", status };
    }
    // The client transport rethrows an object carrying the parsed body.
    for (const candidate of [asBody(cause), asBody((cause as { data?: unknown })?.data)]) {
      if (candidate && typeof candidate.error === "string") {
        const status = Number((cause as { status?: unknown })?.status) || FALLBACK.status;
        return { message: candidate.error, signedOut: candidate.code === "not_signed_in", status };
      }
    }
  } catch {
    // A body that is not JSON is not worth failing the page over.
  }
  return FALLBACK;
};
