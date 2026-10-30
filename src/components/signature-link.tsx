import { useEffect, useState } from "react";
import { Button } from "~/components/ui";
import { formatMoment } from "~/lib/agreement";
import { describeRefusal } from "~/lib/refusal";
import {
  createSignatureRequestFn,
  getSignatureRequestFn,
  revokeSignatureRequestFn,
} from "~/server/api";

/** One signing link, as the organizer sees it. */
type Request = {
  token: string;
  path: string;
  createdAt: number;
  expiresAt: number | null;
  acceptedAt: number | null;
  signedName: string;
  state: "waiting" | "signed" | "expired" | "revoked";
};

const STATE_LABEL: Record<Request["state"], string> = {
  waiting: "Waiting for them to sign",
  signed: "Signed",
  expired: "Expired",
  revoked: "Revoked",
};

/**
 * The signing link for one contract card.
 *
 * Closed by default and loads only when opened, like the agreement terms form —
 * a committee of volunteers does not need another panel open on every card. The
 * server refuses a Viewer, the shared example and a free-plan conference, so this
 * is offered only where the card already knows editing is allowed.
 *
 * **Nothing is emailed.** The organizer copies the link and sends it themselves;
 * the panel says so, because a button called "create signing link" would
 * otherwise imply the other party had been told.
 */
export function SignatureLinkPanel({
  contractId,
  guestName,
}: {
  contractId: number;
  guestName: string;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<Request | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const load = async () => {
    if (loaded || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await getSignatureRequestFn({ data: { contractId } });
      setRequest(result.request as Request | null);
      setLoaded(true);
    } catch (cause) {
      const refusal = await describeRefusal(cause);
      setError(refusal.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void load();
  };

  const run = async (action: "create" | "revoke") => {
    setBusy(true);
    setError(null);
    try {
      const result =
        action === "create"
          ? await createSignatureRequestFn({ data: { contractId } })
          : await revokeSignatureRequestFn({ data: { contractId } });
      setRequest(result.request as Request | null);
      setLoaded(true);
    } catch (cause) {
      const refusal = await describeRefusal(cause);
      setError(refusal.message);
    } finally {
      setBusy(false);
    }
  };

  const link = request && origin ? `${origin}${request.path}` : "";

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={toggle}
        className="rounded-md px-1.5 py-1 text-xs font-medium text-brand underline decoration-brand/40 hover:bg-brand-soft"
        aria-expanded={open}
      >
        {open ? "Hide signing link" : "Signing link"}
      </button>
      {open ? (
        <div className="mt-2 rounded-lg border border-line bg-paper-deep/40 px-3 py-3 text-xs text-ink-soft">
          <p className="text-ink">
            Let {guestName} accept the agreement electronically — a typed name, a tick and a
            timestamp, recorded against the version of the text they were shown. It is not a
            notarized or regulated signature, and the agreement says so.
          </p>
          <p className="mt-1.5">
            Nothing is emailed from Convocate. Copy the link and send it to {guestName} yourself.
          </p>

          {error ? (
            <p role="alert" className="mt-2 rounded bg-[#8A2F22]/[0.06] px-2 py-1.5 text-red-800">
              {error}
            </p>
          ) : null}

          {request ? (
            <div className="mt-2 space-y-1.5">
              <p className="font-medium text-ink">
                {STATE_LABEL[request.state]}
                {request.state === "signed" && request.acceptedAt
                  ? ` — ${request.signedName} on ${formatMoment(request.acceptedAt)}`
                  : ""}
              </p>
              {request.state === "waiting" && link ? (
                <div className="flex flex-wrap items-center gap-2">
                  <code className="max-w-full break-all rounded bg-white px-2 py-1 text-[11px] text-ink ring-1 ring-line">
                    {link}
                  </code>
                  <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => void copy()}>
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                </div>
              ) : null}
              {request.state === "waiting" ? (
                <p>
                  Usable until{" "}
                  {request.expiresAt ? formatMoment(request.expiresAt) : "further notice"}. Creating a
                  new link revokes this one.
                </p>
              ) : null}
              {request.state === "signed" ? (
                <p>
                  The agreement&rsquo;s signature block now prints the typed name and the moment it was
                  accepted.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                {request.state === "waiting" ? (
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    disabled={busy}
                    onClick={() => void run("revoke")}
                  >
                    Revoke this link
                  </Button>
                ) : null}
                {request.state !== "signed" ? (
                  <Button
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    disabled={busy}
                    onClick={() => void run("create")}
                  >
                    {request.state === "waiting" ? "Replace with a new link" : "Create a signing link"}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <Button
                variant="secondary"
                className="px-2 py-1 text-xs"
                disabled={busy || !loaded}
                onClick={() => void run("create")}
              >
                {busy ? "Creating…" : "Create a signing link"}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
