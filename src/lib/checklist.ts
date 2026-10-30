/**
 * The pre- and post-conference checklist: the two phases, the default list, and
 * the shape of one item.
 *
 * Kept free of any server import so the panel (client bundle) and the seeding
 * code (server) read the SAME labels. The default list is a fixed template in
 * code, written onto a conference once, the first time an organizer opens its
 * checklist — see `seedChecklistOnce` in `src/server/db.server.ts`.
 *
 * Wording is neutral and American English: this is for any conference or event
 * organizer, not one tradition. Nothing here invents a due date or a deadline:
 * an item is either done or not, and the list says so plainly.
 */
export type ChecklistPhase = "pre" | "post";

/** The two phases, in the order the panel shows them. */
export const CHECKLIST_PHASES: ChecklistPhase[] = ["pre", "post"];

/** The heading over each phase's column. */
export const CHECKLIST_PHASE_TITLES: Record<ChecklistPhase, string> = {
  pre: "Before the conference",
  post: "After the conference",
};

/** One line under each heading, so the two columns are not bare. */
export const CHECKLIST_PHASE_NOTES: Record<ChecklistPhase, string> = {
  pre: "What has to happen between now and the day itself.",
  post: "What still has to happen once the last guest has gone home.",
};

/**
 * The default list, written once per conference from these exact labels.
 * Order matters: it is the order the organizer sees on the first open.
 */
export const CHECKLIST_TEMPLATE: Record<ChecklistPhase, string[]> = {
  pre: [
    "Venue booked",
    "Contracts signed",
    "Deposits paid",
    "Speaker travel and room booked",
    "Registration opened and announced",
    "Run-of-show written",
    "Equipment and backline confirmed",
    "Volunteers briefed",
    "Insurance and certificates in hand",
  ],
  post: [
    "Final invoices received",
    "Balances paid",
    "Refunds settled",
    "Thank-you notes sent",
    "Final attendance recorded",
    "Budget actuals closed",
    "Documents archived",
  ],
};

/**
 * The name of the one-time marker that says this conference's default list has
 * been written (kept in `schema_migrations`, suffixed with the conference id).
 * It is what makes "seed once, never again" true even for an organizer who
 * removes every item on the list.
 */
export const CHECKLIST_SEED_MARKER = "checklist_seeded_v1";

/** A label is one short line. The cap is generous and stops a pasted paragraph. */
export const CHECKLIST_LABEL_MAX = 160;
/** How many items one conference may hold in total — a guard, not a product limit. */
export const CHECKLIST_ITEMS_MAX = 200;

/** One item, as the panel receives it. `doneBy` is the name of who ticked it. */
export type ChecklistItem = {
  id: number;
  conferenceId: number;
  phase: ChecklistPhase;
  label: string;
  position: number;
  /** The moment it was ticked, or `null` while it is open. */
  doneAt: number | null;
  /** Who ticked it, or `""` while it is open. */
  doneBy: string;
};

/** "6 of 9 done" — the line under a phase heading. */
export const progressText = (done: number, total: number): string =>
  `${String(done)} of ${String(total)} done`;

/** The same count for the whole list. */
export const overallProgressText = (done: number, total: number): string =>
  `${String(done)} of ${String(total)} done overall`;

/**
 * A plain, honest sentence about where the list stands. No due dates, no
 * deadline, no colour that implies one: nothing here knows when the day is.
 */
export const checklistSummary = (done: number, total: number): string => {
  if (total === 0) return "No items on the list yet.";
  if (done === total) return "Every item on the list is ticked.";
  if (done === 0) return "Nothing is ticked yet.";
  return `${String(total - done)} item${total - done === 1 ? "" : "s"} still open.`;
};
