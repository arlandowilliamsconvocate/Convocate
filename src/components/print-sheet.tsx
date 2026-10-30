/**
 * The printable contract sheet, the "print all" board, and the refusal page —
 * white paper, no app chrome, no color.
 *
 * These components are shared by `/print/contract/:id`, `/print/conference/:id`
 * and `/print/letter/:id`. They render only what the server handed them: the
 * data comes from a server function that has already checked the caller is an
 * owner or an editor (or is opening the shared example), so a Viewer's browser
 * never receives a sheet with an amount on it.
 *
 * Print is driven by `@media print` in `src/styles/app.css` plus the `print:`
 * utilities here: the toolbar disappears, page margins come from `@page`, and
 * every `.print-sheet` starts a new page.
 */
import type { ReactNode } from "react";
import { formatBytes } from "~/lib/documents";
import { formatDate, formatDateRange, formatMoneyOrHidden } from "~/lib/money";
import { contractStatusLabel, contractTotalCents, kindLabel, type Contract } from "~/lib/types";

/** One document as a sheet shows it: a name, a size, who attached it and when. */
export type PrintDocument = {
  id: number;
  filename: string;
  mime: string;
  sizeBytes: number;
  uploadedByName: string;
  createdAt: number;
};

export type PrintConference = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  venue: string;
  expectedAttendance: number;
};

export type PrintContract = Contract & { documents: PrintDocument[] };

/** A sheet with no app navigation. Screen: a gray desk with white paper. */
export function PrintScreen({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-neutral-200/70 py-6 print:bg-white print:py-0">{children}</div>;
}

/**
 * The one control on a print page. It prints nothing about itself: the toolbar is
 * hidden in print output, so the paper carries the contract and nothing else.
 */
export function PrintToolbar({
  backHref,
  backLabel,
  children,
}: {
  backHref: string;
  backLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="print-hide sticky top-0 z-10 mb-6 border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-[820px] flex-wrap items-center justify-between gap-2">
        <a href={backHref} className="text-sm text-ink-soft hover:text-ink">
          ← {backLabel}
        </a>
        <div className="flex flex-wrap items-center gap-2 text-sm">{children}</div>
      </div>
    </div>
  );
}

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined") window.print();
      }}
      className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand/90"
    >
      {label}
    </button>
  );
}

/** One sheet of paper. Each one starts a new printed page. */
export function Paper({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`print-sheet mx-auto mb-6 w-full max-w-[820px] bg-white px-10 py-9 text-[13px] leading-relaxed text-black shadow-sm ring-1 ring-black/5 print:mb-0 print:max-w-none print:px-0 print:py-0 print:shadow-none print:ring-0 ${className}`}
    >
      {children}
    </section>
  );
}

/**
 * What a person sees when the server refused them. It carries no conference data
 * at all — not a name, not an amount — because the refusal is decided before any
 * data is read.
 */
export function PrintRefusal({ message, signedOut }: { message: string; signedOut?: boolean }) {
  return (
    <PrintScreen>
      <Paper>
        <p className="font-serif text-xl">This page is not available</p>
        <p className="mt-3 max-w-prose">{message}</p>
        <p className="mt-6 text-xs text-neutral-600">
          {signedOut ? (
            <a href="/signin" className="underline">
              Sign in
            </a>
          ) : (
            <a href="/app" className="underline">
              Back to your conferences
            </a>
          )}
        </p>
      </Paper>
    </PrintScreen>
  );
}

/**
 * The copyright and trademark line, for the foot of a document.
 *
 * The year comes from the clock, so it can never go stale. The mark is ™, which
 * claims use of the name — never ®, which would claim a registration nobody has
 * filed. Small and quiet on purpose: it sits inside a sheet's existing footer, so
 * it can never push a document onto an extra page.
 */
export const copyrightLine = (): string =>
  `© ${String(new Date().getFullYear())} Convocate™. All rights reserved.`;

/**
 * The organizer's own mark, at the top-left of a document: their logo at most
 * 48px tall with its width following its own proportions (never stretched, never
 * cropped), and the organization's legal name beside it when one is set.
 *
 * With no logo saved it renders NOTHING — not a placeholder, not a blank frame —
 * so a document prints exactly as it did before logos existed. The data URL comes
 * from the server function that already authorized the reader; there is no
 * address here for the image and no second check to keep in step.
 */
export function DocumentMark({
  logo,
  legalName,
}: {
  logo?: string | null;
  legalName?: string;
}) {
  if (!logo) return null;
  const name = (legalName ?? "").trim();
  return (
    <div className="mb-3 flex items-center gap-3" data-document-mark>
      <img
        src={logo}
        alt={name ? `${name} logo` : "Organization logo"}
        data-document-logo
        style={{ maxHeight: "48px", maxWidth: "240px", height: "auto", width: "auto" }}
      />
      {name ? (
        <span className="text-[12px] font-medium leading-tight text-black">{name}</span>
      ) : null}
    </div>
  );
}

const amountRows = (contract: PrintContract): { label: string; cents: number | null }[] => {
  const rows: { label: string; cents: number | null }[] = [
    { label: contract.kind === "venue" ? "Rental fee" : "Fee", cents: contract.feeCents },
    { label: "Honorarium", cents: contract.honorariumCents },
    { label: "Travel", cents: contract.travelCents },
    { label: "Equipment / rental", cents: contract.equipmentCents },
  ];
  if (contract.kind === "venue") {
    rows.push({ label: "Deposit (part of the rental fee)", cents: contract.depositCents });
  }
  return rows;
};

function SheetHeading({
  conference,
  subtitle,
  logo,
  legalName,
}: {
  conference: PrintConference;
  subtitle: string;
  logo?: string | null;
  legalName?: string;
}) {
  return (
    <header className="border-b border-black/25 pb-4">
      <DocumentMark logo={logo} legalName={legalName} />
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-600">
        {subtitle}
      </p>
      <h1 className="mt-1 font-serif text-2xl leading-tight text-black">{conference.name}</h1>
      <p className="mt-1 text-[12px] text-neutral-700">
        {formatDateRange(conference.startDate, conference.endDate)}
        {conference.venue ? ` · ${conference.venue}` : ""}
      </p>
    </header>
  );
}

function SheetFooter({
  printedOn,
  printedBy,
  right,
}: {
  printedOn: string;
  printedBy: string;
  right?: string;
}) {
  return (
    <footer className="mt-8 border-t border-black/20 pt-2 text-[10px] text-neutral-600">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          Printed {formatDate(printedOn)} by {printedBy}
        </span>
        <span>Convocate{right ? ` · ${right}` : ""}</span>
      </div>
      <p className="mt-1 text-[9px] text-neutral-500">{copyrightLine()}</p>
    </footer>
  );
}

/** One contract on one sheet: who, what stage, what state, what money, what files. */
export function ContractSheet({
  conference,
  contract,
  printedOn,
  printedBy,
  heading = "Contract sheet",
  logo,
  legalName,
}: {
  conference: PrintConference;
  contract: PrintContract;
  printedOn: string;
  printedBy: string;
  heading?: string;
  logo?: string | null;
  legalName?: string;
}) {
  return (
    <Paper>
      <SheetHeading conference={conference} subtitle={heading} logo={logo} legalName={legalName} />

      <div className="mt-5">
        <h2 className="font-serif text-lg text-black">{contract.name}</h2>
        <p className="mt-0.5 text-[12px] text-neutral-700">
          {kindLabel(contract.kind)} · {contract.stage.replace(/^\w/, (c) => c.toUpperCase())} · Contract{" "}
          {contractStatusLabel(contract.contractStatus).toLowerCase()}
          {contract.contractDate ? ` (${formatDate(contract.contractDate)})` : ""}
        </p>
        {contract.topic ? <p className="mt-2 text-[12px]">Role / session: {contract.topic}</p> : null}
        {contract.contactEmail ? (
          <p className="mt-1 text-[12px]">Contact: {contract.contactEmail}</p>
        ) : null}
      </div>

      <table className="mt-5 w-full border-collapse text-[12px]">
        <tbody>
          {amountRows(contract).map((row) => (
            <tr key={row.label} className="border-b border-black/10">
              <th scope="row" className="py-1.5 pr-4 text-left font-normal text-neutral-700">
                {row.label}
              </th>
              <td className="py-1.5 text-right tabular-nums">{formatMoneyOrHidden(row.cents)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-2 pr-4 text-left font-semibold">
              Total
            </th>
            <td className="py-2 text-right font-semibold tabular-nums">
              {formatMoneyOrHidden(contractTotalCents(contract))}
            </td>
          </tr>
        </tbody>
      </table>

      {contract.contractNote ? (
        <div className="mt-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-600">
            Note
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[12px]">{contract.contractNote}</p>
        </div>
      ) : null}

      <div className="mt-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-600">
          Attached documents
        </p>
        {contract.documents.length === 0 ? (
          <p className="mt-1 text-[12px] text-neutral-700">No documents attached to this entry.</p>
        ) : (
          <ul className="mt-1 space-y-0.5 text-[12px]">
            {contract.documents.map((document) => (
              <li key={document.id}>
                {document.filename}{" "}
                <span className="text-neutral-600">
                  ({formatBytes(document.sizeBytes)}, attached{" "}
                  {formatDate(new Date(document.createdAt).toISOString().slice(0, 10))}
                  {document.uploadedByName ? ` by ${document.uploadedByName}` : ""})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <SheetFooter printedOn={printedOn} printedBy={printedBy} right={kindLabel(contract.kind)} />
    </Paper>
  );
}

/**
 * The whole board: a summary sheet, then one sheet per contract, ordered by the
 * board's own stages (invited → negotiating → contracted → booked) so the printed
 * stack matches the columns the committee has been working in.
 */
export function BoardSheets({
  conference,
  contracts,
  printedOn,
  printedBy,
  logo,
  legalName,
}: {
  conference: PrintConference;
  contracts: PrintContract[];
  printedOn: string;
  printedBy: string;
  logo?: string | null;
  legalName?: string;
}) {
  const order = ["invited", "negotiating", "contracted", "booked"];
  const sorted = [...contracts].sort(
    (a, b) => order.indexOf(a.stage) - order.indexOf(b.stage) || a.id - b.id,
  );
  const stageCount = (stage: string) => contracts.filter((c) => c.stage === stage).length;
  const signed = contracts.filter((c) => c.contractStatus === "signed").length;

  return (
    <div>
      <Paper>
        <SheetHeading
          conference={conference}
          subtitle="Contracts board — print all"
          logo={logo}
          legalName={legalName}
        />
        <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-1 text-[12px] sm:grid-cols-4">
          {order.map((stage) => (
            <p key={stage}>
              <span className="text-neutral-600">{stage.replace(/^\w/, (c) => c.toUpperCase())}: </span>
              {stageCount(stage)}
            </p>
          ))}
          <p>
            <span className="text-neutral-600">Signed: </span>
            {signed} of {contracts.length}
          </p>
        </div>
        {sorted.length === 0 ? (
          <p className="mt-5 text-[12px]">No guests, suppliers or venue on this board yet.</p>
        ) : (
          <ul className="mt-5 space-y-1 text-[12px]">
            {sorted.map((contract, index) => (
              <li key={contract.id} className="flex justify-between gap-4 border-b border-black/10 py-1">
                <span>
                  {index + 1}. {contract.name}{" "}
                  <span className="text-neutral-600">
                    — {kindLabel(contract.kind)}, {contract.stage}, contract{" "}
                    {contractStatusLabel(contract.contractStatus).toLowerCase()}
                  </span>
                </span>
                <span className="tabular-nums">{formatMoneyOrHidden(contractTotalCents(contract))}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[11px] text-neutral-700">
          One page per guest, supplier and venue follows.
        </p>
        <SheetFooter printedOn={printedOn} printedBy={printedBy} right={`${String(contracts.length)} entries`} />
      </Paper>

      {sorted.map((contract) => (
        <ContractSheet
          key={contract.id}
          conference={conference}
          contract={contract}
          printedOn={printedOn}
          printedBy={printedBy}
          heading={`Contracts board · ${kindLabel(contract.kind)}`}
          logo={logo}
          legalName={legalName}
        />
      ))}
    </div>
  );
}
