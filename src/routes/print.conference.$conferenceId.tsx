import { createFileRoute } from "@tanstack/react-router";
import {
  BoardSheets,
  PrintButton,
  PrintRefusal,
  PrintScreen,
  PrintToolbar,
} from "~/components/print-sheet";
import { describeRefusal } from "~/lib/refusal";
import { getBoardSheetFn } from "~/server/api";

/**
 * `/print/conference/:conferenceId` — the whole contracts board, printed.
 *
 * A summary sheet first, then one page per guest, supplier and venue, with a page
 * break between them (`@media print` in `app.css`). The board is sorted by the
 * same stages the committee works in on screen, so the paper stack matches the
 * columns.
 *
 * Same authorization as a single sheet: decided by `getBoardSheetFn` on the
 * server, owner and editor only (the shared example prints for anyone who can
 * open it). Nothing here writes.
 */
export const Route = createFileRoute("/print/conference/$conferenceId")({
  loader: async ({ params }) => {
    try {
      const board = await getBoardSheetFn({
        data: { conferenceId: Number(params.conferenceId) },
      });
      return { board, refusal: null };
    } catch (cause) {
      const refusal = await describeRefusal(cause);
      return { board: null, refusal };
    }
  },
  component: BoardSheetPage,
});

function BoardSheetPage() {
  const { board, refusal } = Route.useLoaderData();
  if (!board) {
    return <PrintRefusal message={refusal?.message ?? ""} signedOut={refusal?.signedOut} />;
  }
  return (
    <PrintScreen>
      <PrintToolbar
        backHref={`/app/conference/${String(board.conference.id)}`}
        backLabel="Back to the conference"
      >
        <PrintButton label="Print all" />
      </PrintToolbar>
      <BoardSheets
        conference={board.conference}
        contracts={board.contracts}
        printedOn={board.printedOn}
        printedBy={board.printedBy}
        logo={board.logo}
        legalName={board.organizerLegalName}
      />
    </PrintScreen>
  );
}
