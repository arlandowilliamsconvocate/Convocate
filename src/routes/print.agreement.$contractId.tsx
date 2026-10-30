import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  DocumentMark,
  Paper,
  PrintButton,
  PrintRefusal,
  PrintScreen,
  PrintToolbar,
  copyrightLine,
} from "~/components/print-sheet";
import { DRAFT_NOTICE, NO_SEND_NOTICE, SIGNATURE_IMAGE_MARKER, formatMoment } from "~/lib/agreement";
import { describeRefusal } from "~/lib/refusal";
import { getAgreementFn } from "~/server/api";

/**
 * `/print/agreement/:contractId` — the auto-generated engagement agreement.
 *
 * Built by `getAgreementFn` from the entry's own values, its conference, and the
 * optional terms the organizer saved on the card. It is a **draft**: everything
 * here either states a value from the entry or is a plain-language clause whose
 * specific prints as a blank line to complete by hand. The disclaimer is on the
 * page and in the document's own footer.
 *
 * Editable before printing, like the invitation letter: the text becomes editable
 * on screen (seeded from the merge) and prints as plain paper. Editing here does
 * **not** change the saved terms — the "Agreement terms" form on the conference
 * page is what persists, through `saveAgreementTermsFn`. There is no send button
 * and nothing claims to be signed or sent: Convocate has no inbox.
 *
 * Same authorization as the printed sheet and the letter: owner and editor only,
 * with the shared example readable by anyone who can already open it.
 */
export const Route = createFileRoute("/print/agreement/$contractId")({
  loader: async ({ params }) => {
    try {
      const agreement = await getAgreementFn({
        data: { contractId: Number(params.contractId) },
      });
      return { agreement, refusal: null };
    } catch (cause) {
      const refusal = await describeRefusal(cause);
      return { agreement: null, refusal };
    }
  },
  component: AgreementPage,
});

/**
 * The agreement body with the guest's DRAWN signature printed in place of the
 * marker line — above the line the typed name appears on.
 *
 * The picture is capped in height (about 64px at page scale) and keeps its own
 * proportions: `width: auto` with a max width, never stretched and never
 * cropped. If the marker is somehow missing, the body prints as it always did
 * rather than swallowing the text.
 */
function BodyWithDrawnSignature({ body, image }: { body: string; image: string }) {
  const at = body.indexOf(`\n${SIGNATURE_IMAGE_MARKER}`);
  if (at < 0) return <>{body}</>;
  const before = body.slice(0, at).replace(/\n+$/, "");
  const after = body
    .slice(at + SIGNATURE_IMAGE_MARKER.length + 1)
    .replace(/^\n+/, "");
  return (
    <>
      {before}
      {"\n"}
      <img
        src={image}
        alt="Drawn signature"
        data-drawn-signature
        className="my-1 block h-auto w-auto max-h-[64px] max-w-[280px] print:max-h-[64px]"
        style={{ maxHeight: "64px", maxWidth: "280px", height: "auto", width: "auto" }}
      />
      {"\n"}
      {after}
    </>
  );
}

function AgreementPage() {
  const { agreement, refusal } = Route.useLoaderData();
  const [copied, setCopied] = useState(false);
  if (!agreement) {
    return <PrintRefusal message={refusal?.message ?? ""} signedOut={refusal?.signedOut} />;
  }

  const bodyRef = useRef<HTMLDivElement | null>(null);

  const copyText = async () => {
    const text = bodyRef.current?.innerText ?? agreement.body;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <PrintScreen>
      <PrintToolbar
        backHref={`/app/conference/${String(agreement.conference.id)}`}
        backLabel="Back to the conference"
      >
        <span className="text-ink-soft">{DRAFT_NOTICE}</span>
        <button
          type="button"
          onClick={copyText}
          className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-paper-deep"
          title="Copy the document text, including any edits you have made below"
        >
          {copied ? "Copied" : "Copy text"}
        </button>
        <PrintButton label="Print / save as PDF" />
      </PrintToolbar>

      <p className="print-hide mx-auto mb-3 max-w-[820px] px-4 text-xs text-ink-soft">
        {DRAFT_NOTICE} {NO_SEND_NOTICE} Your edits below are for this print only — they do not change
        the saved terms. To change what the agreement is built from, use “Edit agreement terms” on
        the contract card.
        {agreement.signature
          ? " This agreement has already been accepted electronically: edits made here are not part of what the other party accepted, and the signature block still records the version they accepted."
          : ""}
      </p>

      <Paper>
        {/* The organizer's own mark, top-left — nothing at all when none is saved. */}
        <DocumentMark logo={agreement.logo} legalName={agreement.organizerLegalName} />
        <div className="mb-4 border-b border-black/15 pb-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-600">
            Draft agreement
          </p>
          <h1 className="mt-1 font-serif text-[19px] leading-snug text-black">{agreement.title}</h1>
          <p className="mt-1 text-[11px] text-neutral-700">{agreement.subtitle}</p>
        </div>
        {/*
          Editable on screen, plain paper on print — the same pattern as the
          invitation letter. `contentEditable` keeps the layout of a document
          (a textarea would print as a scrolled box), so the organizer can fix a
          name or fill a blank line before printing. Nothing typed here is saved.
        */}
        <div
          ref={bodyRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          aria-label="Draft agreement — editable"
          data-agreement-body
          className="whitespace-pre-wrap font-serif text-[12.5px] leading-relaxed text-black outline-none focus:bg-amber-50/40 print:focus:bg-transparent"
        >
          {/*
            With a drawn signature the body's marker line is replaced by the
            drawing itself; with none, the body is rendered as the one string it
            has always been, so the printed output does not change at all.
          */}
          {agreement.signature?.signatureImage ? (
            <BodyWithDrawnSignature
              body={agreement.body}
              image={agreement.signature.signatureImage}
            />
          ) : (
            agreement.body
          )}
        </div>
        <footer className="mt-8 border-t border-black/20 pt-2 text-[10px] text-neutral-600">
          <p>{DRAFT_NOTICE}</p>
          <p className="mt-1">
            Generated by Convocate on {agreement.printedOn} for {agreement.conference.name} ·{" "}
            {agreement.contract?.name ?? "this guest"}.{" "}
            {agreement.signature
              ? `Accepted electronically by ${agreement.signature.name} on ${formatMoment(agreement.signature.acceptedAt)}. The Organizer's own line is still to be signed.`
              : "Nothing has been sent or signed."}
          </p>
          <p className="mt-1 text-[9px] text-neutral-500">{copyrightLine()}</p>
        </footer>
      </Paper>
    </PrintScreen>
  );
}
