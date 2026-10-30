/**
 * "Where you stand" — the numbers behind the summary, in one place.
 *
 * This module is the whole of what the summary panel knows. It turns the rows a
 * conference already holds (budget lines, contracts, checklist items, places
 * registered) into one small, flat set of facts, and it does two more things
 * with that set:
 *
 *   1. it writes the compact numbers line the panel shows under the summary —
 *      "Budget $51,700 planned · 34% committed · 1 of 5 contracts signed" — so a
 *      reader can check the model's sentences against the figures they came
 *      from; and
 *   2. it checks a model's summary for figures that are not in the set
 *      (`ungroundedFigures`), so a sentence carrying an invented amount, count
 *      or percentage is thrown away rather than shown.
 *
 * It is pure and it is imported by both sides: the page uses it to paint the
 * numbers line before any model is asked, and the server uses it to build the
 * block the model is given. One implementation means the line a reader sees and
 * the figures the model was handed cannot drift apart.
 *
 * Nothing here invents anything. Every number is a sum, a count or a ratio of
 * rows that exist; a section with no rows produces no sentence and no segment.
 */
import { formatMoney, sumMoney } from "./money";
import type { BudgetItem, Contract, ContractStage, Money } from "./types";
import { CHECKLIST_TEMPLATE, CHECKLIST_PHASES, type ChecklistItem } from "./checklist";
/** The four sections a summary can be built from, plus the budget target. */
export type StandInput = {
  budgetItems: BudgetItem[];
  contracts: Contract[];
  checklistItems: ChecklistItem[];
  /** Places taken by registrations (sum of quantities), or 0. */
  attendeePlaces: number;
  /** The conference's own target, already withheld from a Viewer if it must be. */
  budgetTargetCents: Money;
  /**
   * True for the shared example, whose checklist is the unsaved template rather
   * than rows. It is counted the way the checklist panel counts it, so the
   * numbers line and the panel below it never disagree.
   */
  checklistIsTemplate?: boolean;
};
export type StandFacts = {
  /** False when there is nothing at all to summarize — the panel then says so. */
  hasData: boolean;
  budget: {
    /** False for a committee Viewer: the amounts were withheld before they got here. */
    moneyVisible: boolean;
    lines: number;
    plannedCents: Money;
    committedCents: Money;
    /** Planned minus committed — what is still unspent on paper. */
    uncommittedCents: Money;
    /** Whole percent, or null when it cannot be computed (no plan, or hidden). */
    committedPercent: number | null;
    targetCents: Money;
    /** Planned minus target: positive means the plan is over the target. */
    overTargetCents: Money;
  };
  contracts: {
    total: number;
    signed: number;
    unsigned: number;
    /** Paperwork state, counted from `contractStatus`. */
    notSent: number;
    sent: number;
    /** Pipeline stage counts, in the order the board shows them. */
    stages: Record<ContractStage, number>;
  };
  checklist: { total: number; done: number; open: number };
  attendees: { places: number };
};
/** The stage order the board uses, so the facts block reads the same way. */
const STAGE_ORDER: ContractStage[] = ["invited", "negotiating", "contracted", "booked"];
/** "1 line", "3 lines" — so a single-row conference does not read like a bug. */
const plural = (count: number, word: string): string =>
  `${String(count)} ${word}${count === 1 ? "" : "s"}`;
/** A percentage a reader can compare against the figures above it. */
const percentOf = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 100) : null;
/**
 * Build the facts for one conference.
 *
 * Every amount arrives already shaped by the server's money gate: an owner or
 * editor has numbers, a Viewer has `null`. `sumMoney` returns `null` when any
 * part was withheld, so a Viewer is never handed a partial total that could be
 * mistaken for the whole — and `moneyVisible` says so plainly, which is what
 * keeps the numbers line from printing "$0 planned" at a viewer.
 */
export const buildStandFacts = (input: StandInput): StandFacts => {
  const plannedCents = sumMoney(input.budgetItems.map((item) => item.plannedCents));
  const committedCents = sumMoney(input.budgetItems.map((item) => item.committedCents));
  const targetCents = input.budgetTargetCents;
  const uncommittedCents =
    plannedCents === null || committedCents === null ? null : plannedCents - committedCents;
  const overTargetCents =
    plannedCents === null || targetCents === null ? null : plannedCents - targetCents;
  const contracts = input.contracts;
  const signed = contracts.filter((contract) => contract.contractStatus === "signed").length;
  const stages = STAGE_ORDER.reduce<Record<ContractStage, number>>(
    (counts, stage) => {
      counts[stage] = contracts.filter((contract) => contract.stage === stage).length;
      return counts;
    },
    { invited: 0, negotiating: 0, contracted: 0, booked: 0 },
  );
  // The example's checklist is a template it never saved; counting its rows
  // would say "0 of 0" under a panel showing twenty unticked items.
  const checklistTotal = input.checklistIsTemplate
    ? CHECKLIST_PHASES.reduce((sum, phase) => sum + CHECKLIST_TEMPLATE[phase].length, 0)
    : input.checklistItems.length;
  const checklistDone = input.checklistIsTemplate
    ? 0
    : input.checklistItems.filter((item) => item.doneAt !== null).length;
  const places = Math.max(0, Math.trunc(input.attendeePlaces));
  const hasData =
    input.budgetItems.length > 0 || contracts.length > 0 || checklistTotal > 0 || places > 0;
  return {
    hasData,
    budget: {
      moneyVisible: plannedCents !== null,
      lines: input.budgetItems.length,
      plannedCents,
      committedCents,
      uncommittedCents,
      committedPercent:
        plannedCents === null || committedCents === null
          ? null
          : percentOf(committedCents, plannedCents),
      targetCents,
      overTargetCents,
    },
    contracts: {
      total: contracts.length,
      signed,
      unsigned: contracts.length - signed,
      notSent: contracts.filter((contract) => contract.contractStatus === "not_sent").length,
      sent: contracts.filter((contract) => contract.contractStatus === "sent").length,
      stages,
    },
    checklist: { total: checklistTotal, done: checklistDone, open: checklistTotal - checklistDone },
    attendees: { places },
  };
};
/** Shown instead of a summary when a conference has nothing on it yet. */
export const STAND_EMPTY_MESSAGE =
  "Nothing to summarize yet — add a budget line or checklist item";
/**
 * The compact line under the summary: what the sentences were written from.
 *
 * It is built from the same facts the model is given, and it names every figure
 * the model is allowed to use. A reader who does not trust the paragraph can
 * check it here in one glance, which is the whole reason the line exists.
 */
export const standNumbersLine = (facts: StandFacts): string => {
  const segments: string[] = [];
  const budget = facts.budget;
  if (budget.lines > 0) {
    if (budget.moneyVisible && budget.plannedCents !== null) {
      let segment = `Budget ${formatMoney(budget.plannedCents)} planned`;
      if (budget.committedPercent !== null) {
        segment += ` · ${String(budget.committedPercent)}% committed`;
      }
      segments.push(segment);
    } else {
      // A Viewer is told the line count, which is not money, and that the
      // amounts exist but are not theirs to see.
      segments.push(`Budget ${plural(budget.lines, "line")} · amounts hidden`);
    }
  }
  const contracts = facts.contracts;
  if (contracts.total > 0) {
    segments.push(`${String(contracts.signed)} of ${String(contracts.total)} contracts signed`);
  }
  if (facts.checklist.total > 0) {
    segments.push(
      `checklist ${String(facts.checklist.done)} of ${String(facts.checklist.total)} done`,
    );
  }
  if (facts.attendees.places > 0) {
    segments.push(`${String(facts.attendees.places)} registered`);
  }
  return segments.join(" · ");
};
/**
 * The block the model is given. Labels and figures only — no names, no notes, no
 * email addresses, no contract text. A summary cannot leak what it never saw.
 *
 * A section with nothing in it is left out entirely rather than written as
 * "0": a line saying "0 contracts" invites a sentence about contracts on a
 * conference that has none, and the prompt tells the model not to discuss what
 * is absent.
 */
export const standFactsBlock = (facts: StandFacts): string => {
  const lines: string[] = [];
  const budget = facts.budget;
  if (budget.lines > 0) {
    if (budget.moneyVisible && budget.plannedCents !== null) {
      const parts = [
        plural(budget.lines, "budget line"),
        `${formatMoney(budget.plannedCents)} planned`,
        `${formatMoney(budget.committedCents ?? 0)} committed`,
      ];
      if (budget.committedPercent !== null) {
        parts.push(`${String(budget.committedPercent)}% of the plan committed`);
      }
      if (budget.uncommittedCents !== null) {
        parts.push(`${formatMoney(budget.uncommittedCents)} planned but not committed`);
      }
      if (budget.targetCents !== null && budget.targetCents > 0) {
        parts.push(`${formatMoney(budget.targetCents)} budget target`);
        if (budget.overTargetCents !== null && budget.overTargetCents > 0) {
          parts.push(`${formatMoney(budget.overTargetCents)} over that target`);
        } else if (budget.overTargetCents !== null && budget.overTargetCents < 0) {
          parts.push(`${formatMoney(-budget.overTargetCents)} under that target`);
        }
      }
      lines.push(`Budget: ${parts.join("; ")}.`);
    } else {
      // No amounts at all: the reader is a Viewer, and the model is not told
      // figures the reader cannot see either.
      lines.push(
        `Budget: ${plural(budget.lines, "budget line")}. The amounts are hidden from this reader.`,
      );
    }
  }
  const contracts = facts.contracts;
  if (contracts.total > 0) {
    const parts = [
      plural(contracts.total, "contract entry"),
      `${String(contracts.signed)} signed`,
      `${String(contracts.unsigned)} not signed`,
      `${String(contracts.sent)} sent and awaiting signature`,
      `${String(contracts.notSent)} not sent yet`,
    ];
    lines.push(`Contracts: ${parts.join("; ")}.`);
    const stageParts = STAGE_ORDER.filter((stage) => contracts.stages[stage] > 0).map(
      (stage) => `${String(contracts.stages[stage])} ${stage}`,
    );
    if (stageParts.length > 0) lines.push(`Contract stages: ${stageParts.join("; ")}.`);
  }
  if (facts.checklist.total > 0) {
    lines.push(
      `Checklist: ${plural(facts.checklist.total, "item")}; ${String(
        facts.checklist.done,
      )} done; ${String(facts.checklist.open)} open.`,
    );
  }
  if (facts.attendees.places > 0) {
    lines.push(`Registration: ${String(facts.attendees.places)} places taken.`);
  }
  return lines.join("\n");
};
/**
 * Every number a summary is allowed to contain.
 *
 * Dollars are the unit the model is given (`$51,700`, never cents), so a figure
 * it writes is compared in dollars. Percentages, counts and place counts are
 * compared as they are written.
 */
export const standAllowedNumbers = (facts: StandFacts): number[] => {
  const dollars = (cents: Money): number[] => (cents === null ? [] : [cents / 100]);
  const values = [
    facts.budget.lines,
    facts.budget.committedPercent,
    facts.contracts.total,
    facts.contracts.signed,
    facts.contracts.unsigned,
    facts.contracts.sent,
    facts.contracts.notSent,
    ...STAGE_ORDER.map((stage) => facts.contracts.stages[stage]),
    facts.checklist.total,
    facts.checklist.done,
    facts.checklist.open,
    facts.attendees.places,
    ...dollars(facts.budget.plannedCents),
    ...dollars(facts.budget.committedCents),
    ...dollars(facts.budget.uncommittedCents),
    ...dollars(facts.budget.targetCents),
    ...dollars(facts.budget.overTargetCents === null ? null : Math.abs(facts.budget.overTargetCents)),
  ].filter((value): value is number => value !== null && Number.isFinite(value));
  return [...new Set(values.map((value) => Math.round(value * 100) / 100))];
};
/** Number words a model reaches for instead of digits, 0–20 and the tens. */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
/**
 * The figures in `text` that are not in `allowed`.
 *
 * This is the guard that keeps the promise "the summary only restates your
 * numbers" true even when the model has a bad minute: a sentence carrying an
 * amount, count or percentage that was not in the block it was given is not
 * shown at all. It is deliberately simple — digits (with `$`, `,` and a `k`
 * suffix understood) and the plain number words — because the failure it has to
 * catch is a confident invented figure, not a spelling.
 */
export const ungroundedFigures = (text: string, allowed: number[]): string[] => {
  const permitted = new Set(allowed.map((value) => Math.round(value * 100) / 100));
  const found: string[] = [];
  // Digits: "51,700", "$51,700", "22k", "34%", "1 of 5".
  const digitPattern = /\d[\d,]*(?:\.\d+)?\s*([kK])?/g;
  for (const match of text.matchAll(digitPattern)) {
    const raw = match[0].trim();
    const thousands = match[1] !== undefined;
    const value = Number.parseFloat(raw.replace(/[,\s]/g, "").replace(/[kK]$/, ""));
    if (!Number.isFinite(value)) continue;
    const scaled = thousands ? value * 1_000 : value;
    if (!permitted.has(Math.round(scaled * 100) / 100)) found.push(raw);
  }
  // Words: "two of five contracts signed".
  //
  // "one" and "zero" are left alone: they are ordinary English ("no one has
  // signed", "one of the organizers") far more often than they are a count, and
  // dropping a true summary over a pronoun is worse than missing a small
  // spelled-out figure — the numbers line underneath carries the real counts
  // either way. Every other word-number is specific enough to check.
  const wordPattern = /\b([a-z]+)\b/gi;
  for (const match of text.matchAll(wordPattern)) {
    const word = match[1].toLowerCase();
    const value = NUMBER_WORDS[word];
    if (value === undefined || value < 2) continue;
    if (!permitted.has(value)) found.push(word);
  }
  return found;
};
