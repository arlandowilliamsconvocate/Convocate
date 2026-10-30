import { createFileRoute } from "@tanstack/react-router";
import {
  DocumentMark,
  Paper,
  PrintButton,
  PrintRefusal,
  PrintScreen,
  PrintToolbar,
  copyrightLine,
} from "~/components/print-sheet";
import { describeRefusal } from "~/lib/refusal";
import { getInvitationLetterFn } from "~/server/api";

/**
 * `/print/letter/:contractId` — the speaker invitation letter.
 *
 * Built by `getInvitationLetterFn` from the conference and the entry: the
 * conference's name, dates and venue, a neutral salutation, the part they are
 * invited to take (the entry's own role/session line), the fee, honorarium and
 * travel amounts exactly as the entry states them, and a line for the organizer to
 * sign. Nothing here is denominational unless it is literally in the name on the
 * entry, and nothing is promised that the entry does not say.
 *
 * The letter is **editable before printing** (the text becomes editable on
 * screen, seeded from the merged template) and it is printed through the same
 * print CSS as a contract sheet. There is no send button and nothing claims to
 * have been sent: this business has no inbox, so the organizer prints it, or
 * copies it into their own email.
 *
 * Same authorization as the printed sheet: owner and editor only.
 */
export const Route = createFileRoute("/print/letter/$contractId")({
  loader: async ({ params }) => {
    try {
      const letter = await getInvitationLetterFn({
        data: { contractId: Number(params.contractId) },
      });
      return { letter, refusal: null };
    } catch (cause) {
      const refusal = await describeRefusal(cause);
      return { letter: null, refusal };
    }
  },
  component: LetterPage,
});

function LetterPage() {
  const { letter, refusal } = Route.useLoaderData();
  if (!letter) {
    return <PrintRefusal message={refusal?.message ?? ""} signedOut={refusal?.signedOut} />;
  }
  return (
    <PrintScreen>
      <PrintToolbar
        backHref={`/app/conference/${String(letter.conference.id)}`}
        backLabel="Back to the conference"
      >
        <span className="text-ink-soft">
          Editable draft — edit the text below, then print. Convocate does not send email.
        </span>
        <PrintButton label="Print letter" />
      </PrintToolbar>
      <Paper>
        {/* The organizer's own mark, top-left — nothing at all when none is saved. */}
        <DocumentMark logo={letter.logo} legalName={letter.organizerLegalName} />
        <p className="mb-6 border-b border-black/15 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-600 print:border-0">
          {letter.subject}
        </p>
        {/*
          Editable on screen, plain text on paper. `contentEditable` keeps the
          layout of a letter (a textarea would print as a scrolled box) and lets
          the organizer fix a name or a line before printing.
        */}
        <div
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          aria-label="Invitation letter — editable"
          className="whitespace-pre-wrap font-serif text-[13.5px] leading-relaxed text-black outline-none focus:bg-amber-50/40 print:focus:bg-transparent"
        >
          {letter.body}
        </div>
        <p className="mt-8 border-t border-black/20 pt-2 text-[9px] text-neutral-500">
          {copyrightLine()}
        </p>
      </Paper>
    </PrintScreen>
  );
}
