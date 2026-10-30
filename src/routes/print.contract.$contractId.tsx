import { createFileRoute } from "@tanstack/react-router";
import {
  ContractSheet,
  PrintButton,
  PrintRefusal,
  PrintScreen,
  PrintToolbar,
} from "~/components/print-sheet";
import { describeRefusal } from "~/lib/refusal";
import { getContractSheetFn } from "~/server/api";

/**
 * `/print/contract/:contractId` — one contract on one sheet of paper.
 *
 * Deliberately **outside the `/app` layout**: a printed contract carries no
 * navigation, no sign-out button and no colored cards, and the surest way to
 * keep the app's chrome off the paper is for the page never to have it.
 *
 * Owner and editor only (the shared example prints for anyone who can open it) —
 * and that check happens on the server, in `getContractSheetFn`, not here. This
 * loader only decides what to draw with what it was given; a Viewer's request is
 * refused before any amount is read, so nothing to hide ever reaches this page.
 *
 * Nothing on this route writes.
 */
export const Route = createFileRoute("/print/contract/$contractId")({
  loader: async ({ params }) => {
    try {
      const sheet = await getContractSheetFn({
        data: { contractId: Number(params.contractId) },
      });
      return { sheet, refusal: null };
    } catch (cause) {
      const refusal = await describeRefusal(cause);
      return { sheet: null, refusal };
    }
  },
  component: ContractSheetPage,
});

function ContractSheetPage() {
  const { sheet, refusal } = Route.useLoaderData();
  if (!sheet) {
    return <PrintRefusal message={refusal?.message ?? ""} signedOut={refusal?.signedOut} />;
  }
  return (
    <PrintScreen>
      <PrintToolbar
        backHref={`/app/conference/${String(sheet.conference.id)}`}
        backLabel="Back to the conference"
      >
        <PrintButton />
      </PrintToolbar>
      <ContractSheet
        conference={sheet.conference}
        contract={sheet.contract}
        printedOn={sheet.printedOn}
        printedBy={sheet.printedBy}
        logo={sheet.logo}
        legalName={sheet.organizerLegalName}
      />
    </PrintScreen>
  );
}
