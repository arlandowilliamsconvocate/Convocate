/**
 * The pre-event budget estimator — every number in one place.
 *
 * This file is the whole arithmetic of `/budget-calculator`: the planning
 * ranges, the inputs an organizer sets, and the pure function that turns one
 * into the other. It holds no React, no DOM and no I/O, so the same function can
 * be called by the page today and by a server-side save flow later.
 *
 * The figures are PLANNING ESTIMATES, not quotes. They are first-cut ranges for
 * a US event of 25–1000 people; they are deliberately wide, because a range that
 * is wrong in both directions is more honest than a single number that looks
 * precise. Nothing here is measured data, and nothing here should be presented
 * as industry statistics. Tune the ranges in this file only — the page reads
 * every number from here.
 */

import { BUDGET_CATEGORIES } from "./types";

/** A planning range in whole US dollars. `mid` is the average of the two ends. */
export type Range = { low: number; high: number };

const range = (low: number, high: number): Range => ({ low, high });

/** `mid` is never stored: one definition, in `midpoint()`. */
export const midpoint = (r: Range): number => (r.low + r.high) / 2;

// ---------------------------------------------------------------------------
// The inputs
// ---------------------------------------------------------------------------

export const CITY_SIZES = ["small", "mid", "metro"] as const;
export type CitySize = (typeof CITY_SIZES)[number];

export const SPEAKER_TIERS = ["local", "regional", "national", "headliner"] as const;
export type SpeakerTier = (typeof SPEAKER_TIERS)[number];

export const MEAL_LEVELS = ["none", "light", "full"] as const;
export type MealLevel = (typeof MEAL_LEVELS)[number];

export const AV_LEVELS = ["basic", "full"] as const;
export type AvLevel = (typeof AV_LEVELS)[number];

export const MARKETING_LEVELS = ["low", "standard", "aggressive"] as const;
export type MarketingLevel = (typeof MARKETING_LEVELS)[number];

/** Everything the estimator needs. Plain data, so it can be saved as JSON. */
export type BudgetInputs = {
  /** Expected attendance. */
  attendees: number;
  /** Event days that need a venue and catering. */
  days: number;
  citySize: CitySize;
  speakerTier: SpeakerTier;
  /** Paid speakers, all assumed at `speakerTier` in this first cut. */
  speakerCount: number;
  meals: MealLevel;
  av: AvLevel;
  marketing: MarketingLevel;
};

/** The bounds the page enforces on the two numeric inputs. */
export const ATTENDEE_MIN = 25;
export const ATTENDEE_MAX = 1000;
export const DAYS_MIN = 1;
export const DAYS_MAX = 3;
export const SPEAKER_COUNT_MIN = 0;
export const SPEAKER_COUNT_MAX = 6;

/**
 * The example event the page opens on, so a visitor can drag something and see
 * the total move before they have typed anything: 200 people, two days, a
 * mid-size city, two regional speakers, light refreshments, basic AV and
 * standard marketing.
 */
export const EXAMPLE_INPUTS: BudgetInputs = {
  attendees: 200,
  days: 2,
  citySize: "mid",
  speakerTier: "regional",
  speakerCount: 2,
  meals: "light",
  av: "basic",
  marketing: "standard",
};

// ---------------------------------------------------------------------------
// The ranges (USD) — tune these, not the page
// ---------------------------------------------------------------------------

/** Venue hire, per day. */
export const VENUE_PER_DAY: Record<CitySize, Range> = {
  small: range(400, 1200),
  mid: range(1000, 3000),
  metro: range(2500, 8000),
};

/** Food and drink, per attendee, for the whole event. */
export const CATERING_PER_PERSON: Record<MealLevel, Range> = {
  none: range(0, 0),
  light: range(6, 12),
  full: range(22, 45),
};

/** Sound, projection and staging, flat for the event. */
export const AV_FLAT: Record<AvLevel, Range> = {
  basic: range(400, 1200),
  full: range(2000, 6000),
};

/** Speaker fee, per speaker. */
export const SPEAKER_HONORARIUM: Record<SpeakerTier, Range> = {
  local: range(0, 400),
  regional: range(500, 2000),
  national: range(2500, 8000),
  headliner: range(10000, 40000),
};

/** Travel, lodging and per diem, per speaker. */
export const SPEAKER_TRAVEL: Record<SpeakerTier, Range> = {
  local: range(0, 0),
  regional: range(200, 600),
  national: range(500, 1500),
  headliner: range(1000, 4000),
};

/** Printed programs, badges, signs and handouts, per attendee. */
export const MATERIALS_PER_PERSON: Range = range(3, 8);

/** Promotion, flat for the event. */
export const MARKETING_FLAT: Record<MarketingLevel, Range> = {
  low: range(250, 750),
  standard: range(750, 2500),
  aggressive: range(2500, 7500),
};

/** Contingency added on top of the subtotal: 10% at the low end, 20% at the high. */
export const CONTINGENCY = { low: 0.1, high: 0.2 } as const;

/**
 * The runway: the share of the total an organizer should have committed or
 * raised by each point before the event. This is a rule of thumb and the page
 * labels it as advice, not as data.
 */
export const RUNWAY_MILESTONES = [
  { days: 120, share: 0.25 },
  { days: 90, share: 0.5 },
  { days: 60, share: 0.75 },
  { days: 30, share: 0.95 },
] as const;

// ---------------------------------------------------------------------------
// The computation
// ---------------------------------------------------------------------------

export type LineItem = { key: string; label: string; low: number; high: number };

export type RunwayRow = { days: number; share: number; low: number; high: number };

export type BudgetEstimate = {
  /** One row per cost line, in the order the page shows them. */
  lines: LineItem[];
  /** The lines added up, before contingency. */
  subtotal: { low: number; high: number };
  /** After contingency, rounded to the nearest $100. */
  total: { low: number; mid: number; high: number };
  /** Four milestones, each a dollar range rounded to the nearest $100. */
  runway: RunwayRow[];
};

/** Round to the nearest $100 — a planning range should not look precise. */
export const roundToHundred = (dollars: number): number => Math.round(dollars / 100) * 100;

/** Keep an input inside the bounds the page offers. */
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Turn a set of inputs into a low–mid–high estimate and a runway.
 *
 * Every line is `unit range × quantity`; the lines are summed, then contingency
 * is applied to the sum (10% on the low end, 20% on the high end). Nothing is
 * compounded per line, so the printed lines always add up to the subtotal.
 */
export function estimateEvent(inputs: BudgetInputs): BudgetEstimate {
  const attendees = clamp(Math.round(inputs.attendees), ATTENDEE_MIN, ATTENDEE_MAX);
  const days = clamp(Math.round(inputs.days), DAYS_MIN, DAYS_MAX);
  const speakerCount = clamp(Math.round(inputs.speakerCount), SPEAKER_COUNT_MIN, SPEAKER_COUNT_MAX);

  const venue = VENUE_PER_DAY[inputs.citySize];
  const catering = CATERING_PER_PERSON[inputs.meals];
  const av = AV_FLAT[inputs.av];
  const honorarium = SPEAKER_HONORARIUM[inputs.speakerTier];
  const travel = SPEAKER_TRAVEL[inputs.speakerTier];
  const materials = MATERIALS_PER_PERSON;
  const marketing = MARKETING_FLAT[inputs.marketing];

  const lines: LineItem[] = [
    {
      key: "venue",
      label: days === 1 ? "Venue (1 day)" : `Venue (${days} days)`,
      low: venue.low * days,
      high: venue.high * days,
    },
    {
      key: "catering",
      label: inputs.meals === "none" ? "Catering (none)" : "Catering",
      low: catering.low * attendees,
      high: catering.high * attendees,
    },
    {
      key: "speakers",
      label:
        speakerCount === 0
          ? "Speakers (none)"
          : speakerCount === 1
            ? "Speakers (1)"
            : `Speakers (${speakerCount})`,
      low: (honorarium.low + travel.low) * speakerCount,
      high: (honorarium.high + travel.high) * speakerCount,
    },
    { key: "av", label: "AV", low: av.low, high: av.high },
    { key: "materials", label: "Materials", low: materials.low * attendees, high: materials.high * attendees },
    { key: "marketing", label: "Marketing", low: marketing.low, high: marketing.high },
  ];

  const subtotalLow = lines.reduce((sum, line) => sum + line.low, 0);
  const subtotalHigh = lines.reduce((sum, line) => sum + line.high, 0);

  const totalLow = roundToHundred(subtotalLow * (1 + CONTINGENCY.low));
  const totalHigh = roundToHundred(subtotalHigh * (1 + CONTINGENCY.high));
  const totalMid = roundToHundred((totalLow + totalHigh) / 2);

  const runway: RunwayRow[] = RUNWAY_MILESTONES.map((milestone) => ({
    days: milestone.days,
    share: milestone.share,
    low: roundToHundred(totalLow * milestone.share),
    high: roundToHundred(totalHigh * milestone.share),
  }));

  return {
    lines,
    subtotal: { low: subtotalLow, high: subtotalHigh },
    total: { low: totalLow, mid: totalMid, high: totalHigh },
    runway,
  };
}

// ---------------------------------------------------------------------------
// The inputs, checked — one definition for the page and for the server
// ---------------------------------------------------------------------------

const oneOf = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  allowed.find((option) => option === value) ?? fallback;

const wholeNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(Math.round(n), min, max);
};

/**
 * Read whatever arrived as the estimator's inputs and return a set the
 * arithmetic accepts: unknown choices fall back to the example event's, and the
 * two numbers are rounded and held inside the bounds the page offers.
 *
 * The save flow runs this on the server before it computes anything, so a
 * forged request cannot store an attendance of -5 or a city size that is not a
 * city size. `estimateEvent` clamps as well; this only decides what a missing or
 * nonsense field means.
 */
export function normalizeBudgetInputs(raw: unknown): BudgetInputs {
  const data = (raw ?? {}) as Partial<Record<keyof BudgetInputs, unknown>>;
  return {
    attendees: wholeNumber(data.attendees, EXAMPLE_INPUTS.attendees, ATTENDEE_MIN, ATTENDEE_MAX),
    days: wholeNumber(data.days, EXAMPLE_INPUTS.days, DAYS_MIN, DAYS_MAX),
    citySize: oneOf(CITY_SIZES, data.citySize, EXAMPLE_INPUTS.citySize),
    speakerTier: oneOf(SPEAKER_TIERS, data.speakerTier, EXAMPLE_INPUTS.speakerTier),
    speakerCount: wholeNumber(
      data.speakerCount,
      EXAMPLE_INPUTS.speakerCount,
      SPEAKER_COUNT_MIN,
      SPEAKER_COUNT_MAX,
    ),
    meals: oneOf(MEAL_LEVELS, data.meals, EXAMPLE_INPUTS.meals),
    av: oneOf(AV_LEVELS, data.av, EXAMPLE_INPUTS.av),
    marketing: oneOf(MARKETING_LEVELS, data.marketing, EXAMPLE_INPUTS.marketing),
  };
}

// ---------------------------------------------------------------------------
// Turning an estimate into tracked budget lines — the $199 save
// ---------------------------------------------------------------------------

/**
 * The six cost lines plus contingency, by the key the estimator gives them.
 * Kept as a list so a line's stored identity can be built from it and checked.
 */
export const ESTIMATE_LINE_KEYS = [
  "venue",
  "catering",
  "speakers",
  "av",
  "materials",
  "marketing",
  "contingency",
] as const;

export type EstimateLineKey = (typeof ESTIMATE_LINE_KEYS)[number];

/**
 * Which of the workspace's own budget categories each estimate line lands in
 * (`BUDGET_CATEGORIES` in `lib/types.ts`). The estimator does not invent a
 * second vocabulary: a saved line sits where every hand-entered line sits, so
 * the category rollups and the over-budget flag keep working across both.
 *
 * Three lines land in "Other" — materials, promotion and contingency — because
 * the workspace has no category for them. That is the honest answer rather
 * than widening a list every other page reads.
 */
export const ESTIMATE_CATEGORIES: Record<EstimateLineKey, (typeof BUDGET_CATEGORIES)[number]> = {
  venue: "Venue",
  catering: "Hospitality",
  speakers: "Speaker fees",
  av: "Production",
  materials: "Other",
  marketing: "Other",
  contingency: "Other",
};

/** One row the save writes into `budget_items`. */
export type EstimateBudgetLine = {
  key: EstimateLineKey;
  /**
   * The row's identity on a re-save, stored in `budget_items.source` as
   * `calculator:<key>`. It is how a second save updates the line the first save
   * made instead of adding a duplicate beside it.
   */
  source: string;
  category: string;
  label: string;
  /** The single figure tracked in the workspace — see `budgetLinesFromEstimate`. */
  plannedCents: number;
  /** The range that figure came from, kept for the note and for any screen. */
  lowCents: number;
  highCents: number;
  notes: string;
};

const isoDay = (stamp: number): string => new Date(stamp).toISOString().slice(0, 10);

/**
 * The mapping from an estimate to real budget lines.
 *
 * **planned = the middle of the line's range**, because "planned" is what the
 * organizer expects to spend and the middle is the one figure that is not
 * biased towards hoping it is cheap or assuming the worst. **committed = 0**,
 * because nothing is committed: these are planning figures, and the workspace's
 * committed column is for money that is actually agreed.
 *
 * The contingency line's planned figure is the remainder of the estimate's own
 * mid total, not its own midpoint, so the seven planned figures add up to
 * exactly the number the organizer saw on the calculator. Without that, the
 * rounding to the nearest $100 in `estimateEvent` would leave the saved budget a
 * few dollars off the estimate that produced it.
 *
 * Every note says the figure is a planning estimate, carries the range it came
 * from and the day it was saved — so a line read in the workspace six weeks
 * later still says where it came from and what it is not.
 */
export function budgetLinesFromEstimate(
  estimate: BudgetEstimate,
  savedAt: number = Date.now(),
): EstimateBudgetLine[] {
  const ranges: { key: EstimateLineKey; label: string; low: number; high: number }[] = [
    ...estimate.lines.map((line) => ({
      key: line.key as EstimateLineKey,
      label: line.label,
      low: line.low,
      high: line.high,
    })),
    {
      key: "contingency",
      label: "Contingency (10–20%)",
      low: estimate.total.low - estimate.subtotal.low,
      high: estimate.total.high - estimate.subtotal.high,
    },
  ];

  // Whole dollars in, whole cents out — the database stores cents and a planning
  // figure has no business carrying a fraction of one.
  const plannedCents = ranges.map((line) =>
    line.key === "contingency" ? 0 : Math.round(midpoint({ low: line.low, high: line.high })) * 100,
  );
  const named = ranges.reduce((sum, line, index) => (line.key === "contingency" ? sum : sum + plannedCents[index]), 0);
  const contingencyIndex = ranges.findIndex((line) => line.key === "contingency");
  const remainder = estimate.total.mid * 100 - named;
  plannedCents[contingencyIndex] =
    remainder > 0
      ? remainder
      : Math.round(
          midpoint({
            low: ranges[contingencyIndex].low,
            high: ranges[contingencyIndex].high,
          }),
        ) * 100;

  const day = isoDay(savedAt);
  return ranges.map((line, index) => ({
    key: line.key,
    source: `calculator:${line.key}`,
    category: ESTIMATE_CATEGORIES[line.key],
    label: line.label,
    plannedCents: plannedCents[index],
    lowCents: line.low * 100,
    highCents: line.high * 100,
    notes: `${formatRange(line.low, line.high)} — a planning estimate from the budget calculator, saved ${day}. Not a quote: replace it with real quotes as they arrive.`,
  }));
}

// ---------------------------------------------------------------------------
// Formatting — one definition, so the page and any future save flow agree
// ---------------------------------------------------------------------------

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** `$18,400` — whole dollars, no cents. */
export const formatDollars = (amount: number): string => dollars.format(amount);

/** `$18,400–22,700` — a range, with the currency mark shown once. */
export const formatRange = (low: number, high: number): string =>
  low === high ? formatDollars(low) : `${formatDollars(low)}–${formatDollars(high).replace("$", "")}`;
