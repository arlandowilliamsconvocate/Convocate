import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "~/components/site-chrome";
import { Button, Card, Select, labelClass } from "~/components/ui";
import {
  ATTENDEE_MAX,
  ATTENDEE_MIN,
  DAYS_MAX,
  DAYS_MIN,
  EXAMPLE_INPUTS,
  SPEAKER_COUNT_MAX,
  SPEAKER_COUNT_MIN,
  estimateEvent,
  formatDollars,
  formatRange,
  type AvLevel,
  type BudgetInputs,
  type CitySize,
  type MarketingLevel,
  type MealLevel,
  type SpeakerTier,
} from "~/lib/budget-estimate";
import { UPGRADE_PRICE } from "~/lib/plan";
import { budgetSaveAccessFn, saveEstimateAsBudgetFn, type BudgetSaveAccess } from "~/server/api";

/**
 * `/budget-calculator` — the free, public estimator.
 *
 * A visitor drags or picks eight things about their event and watches a low–mid–
 * high range and a runway recompute. It opens on the example event's numbers,
 * so it is playable before anything is typed.
 *
 * The estimate itself is client-side: React state plus `estimateEvent` from
 * `~/lib/budget-estimate`. No email field, and nothing is saved until someone
 * who can actually save asks for it.
 *
 * **The save/gate slice (2026-10-25).** The handoff at the foot of the page
 * answers one question — can this visitor turn the estimate into a tracked
 * budget? — and `budgetSaveAccessFn` answers it on the server, not here:
 *
 *   signed out, or signed in with no conference      → the handoff is a link to
 *                                                      `/pricing`, as it always
 *                                                      was. Nothing is asked for,
 *                                                      nothing is saved.
 *   signed in, their conference still on the free plan → the same link, and one
 *                                                      sentence naming the
 *                                                      conference and the plan.
 *   signed in, a conference they can edit that is
 *   unlocked ($199 paid, or an admin's own)          → a save button. The
 *                                                      browser sends the eight
 *                                                      inputs; the server
 *                                                      recomputes the estimate and
 *                                                      writes the lines.
 *
 * The page never decides who may save: it renders what the server said, and the
 * save itself is refused server-side with the same gate every other unlock
 * feature uses (`requireEditor`). A forged request gains nothing.
 *
 * The wording is deliberately plain and neutral: these are planning estimates
 * for any event, and the page says so twice — once at the top of the output and
 * once under the numbers. No figure here is presented as measured data.
 */
export const Route = createFileRoute("/budget-calculator")({
  head: () => ({
    meta: [
      { title: "Event budget calculator — Convocate" },
      {
        name: "description",
        content:
          "A free planning estimator for conferences and events: set attendance, days, city size, speakers, catering, AV and marketing, and see a low–mid–high budget range plus how much to have committed at 120, 90, 60 and 30 days out.",
      },
    ],
  }),
  component: BudgetCalculator,
});

const eyebrow = "text-xs font-semibold uppercase tracking-[0.18em]";

/** The one filled button on the handoff, whichever state it is in. */
const primaryAction =
  "inline-flex items-center justify-center rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand/90";

/** `25 Oct 2026` — when an estimate was last saved. */
const savedDate = (stamp: number): string =>
  new Date(stamp).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

const CITY_OPTIONS: { value: CitySize; label: string }[] = [
  { value: "small", label: "Small town" },
  { value: "mid", label: "Mid-size city" },
  { value: "metro", label: "Major metro" },
];

const TIER_OPTIONS: { value: SpeakerTier; label: string }[] = [
  { value: "local", label: "Local" },
  { value: "regional", label: "Regional" },
  { value: "national", label: "National" },
  { value: "headliner", label: "Headliner" },
];

const MEAL_OPTIONS: { value: MealLevel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "light", label: "Light refreshments" },
  { value: "full", label: "Full meals" },
];

const AV_OPTIONS: { value: AvLevel; label: string }[] = [
  { value: "basic", label: "Basic (projector and mic)" },
  { value: "full", label: "Full (stage, lighting, video)" },
];

const MARKETING_OPTIONS: { value: MarketingLevel; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "standard", label: "Standard" },
  { value: "aggressive", label: "Aggressive" },
];

/** A labelled slider: the value is shown beside the label and moves with it. */
function SliderField({
  id,
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
        <output htmlFor={id} className="font-serif text-lg leading-none text-ink">
          {display}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full cursor-pointer accent-brand"
      />
      <p className="mt-1 text-xs leading-relaxed text-ink-soft/80">{hint}</p>
    </div>
  );
}

/** A labelled native select — one control per line, same shape as the sliders. */
function SelectField<T extends string>({
  id,
  label,
  hint,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-1.5"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft/80">{hint}</p>
    </div>
  );
}

/** One of the three headline figures. */
function Figure({ label, amount, accent = false }: { label: string; amount: number; accent?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-3 ${accent ? "border-brand/30 bg-brand-soft" : "border-line bg-paper-deep/50"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-1 font-serif text-xl leading-none text-ink">{formatDollars(amount)}</p>
    </div>
  );
}

function BudgetCalculator() {
  const [inputs, setInputs] = useState<BudgetInputs>(EXAMPLE_INPUTS);

  // Recomputed on every change — the whole estimate is cheap arithmetic.
  const estimate = useMemo(() => estimateEvent(inputs), [inputs]);

  const set = <K extends keyof BudgetInputs>(key: K, value: BudgetInputs[K]) =>
    setInputs((current) => ({ ...current, [key]: value }));

  const isExample = (Object.keys(EXAMPLE_INPUTS) as (keyof BudgetInputs)[]).every(
    (key) => inputs[key] === EXAMPLE_INPUTS[key],
  );

  // Who is looking, asked of the server once on the client. `null` means the
  // question has not been answered (or could not be): the handoff then shows the
  // pricing link, which is the safe answer for a stranger.
  const [access, setAccess] = useState<BudgetSaveAccess | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The inputs that were saved, so a slider moved afterwards says "save again"
  // rather than claiming the numbers on screen are the numbers in the budget.
  const [savedFor, setSavedFor] = useState<BudgetInputs | null>(null);
  const [saved, setSaved] = useState<{
    conferenceId: number;
    conferenceName: string;
    created: number;
    updated: number;
  } | null>(null);

  useEffect(() => {
    let live = true;
    budgetSaveAccessFn()
      .then((result) => {
        if (!live) return;
        setAccess(result);
        setTargetId(result.conferences[0]?.id ?? null);
      })
      .catch((cause: unknown) => {
        // A page that cannot ask is a page for a stranger: keep the gate.
        console.error("budgetSaveAccessFn", cause);
      });
    return () => {
      live = false;
    };
  }, []);

  const save = async () => {
    if (targetId === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveEstimateAsBudgetFn({
        data: { conferenceId: targetId, inputs },
      });
      setSaved({
        conferenceId: result.conferenceId,
        conferenceName: result.conferenceName,
        created: result.created,
        updated: result.updated,
      });
      setSavedFor(inputs);
    } catch (cause) {
      console.error("saveEstimateAsBudgetFn", cause);
      setSaveError(
        "That save was refused, so nothing changed. Reload this page and check you are still signed in to a conference you can edit.",
      );
    } finally {
      setSaving(false);
    }
  };

  const targetName =
    access?.conferences.find((conference) => conference.id === targetId)?.name ?? "";

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 pb-16 pt-14 sm:pt-20">
        <div className="max-w-3xl">
          <p className={`${eyebrow} text-brass`}>Free tool</p>
          <h1 className="mt-3 text-4xl leading-[1.1] text-ink sm:text-5xl">
            What will your event cost?
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-ink-soft">
            Set the size and shape of the event and watch a budget range and a countdown to the
            date update as you go. It starts on a worked example — change anything and it follows
            you.
          </p>
        </div>

        <div className="mt-10 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
          {/* ---- The inputs ---- */}
          <Card className="p-6 sm:p-7">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-xl text-ink">The event</h2>
              <button
                type="button"
                onClick={() => setInputs(EXAMPLE_INPUTS)}
                className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-soft shadow-sm hover:bg-paper-deep hover:text-ink"
              >
                Reset to the example
              </button>
            </div>

            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <SliderField
                id="attendees"
                label="Attendees"
                hint="Expected attendance across the whole event."
                value={inputs.attendees}
                min={ATTENDEE_MIN}
                max={ATTENDEE_MAX}
                step={5}
                display={String(inputs.attendees)}
                onChange={(value) => set("attendees", value)}
              />
              <SliderField
                id="days"
                label="Days"
                hint="Days that need a venue and food."
                value={inputs.days}
                min={DAYS_MIN}
                max={DAYS_MAX}
                display={inputs.days === 1 ? "1 day" : `${inputs.days} days`}
                onChange={(value) => set("days", value)}
              />
              <SelectField
                id="city-size"
                label="City size"
                hint="Venue rates rise with the market."
                value={inputs.citySize}
                options={CITY_OPTIONS}
                onChange={(value) => set("citySize", value)}
              />
              <SliderField
                id="speakers"
                label="Paid speakers"
                hint="All counted at the same tier for now."
                value={inputs.speakerCount}
                min={SPEAKER_COUNT_MIN}
                max={SPEAKER_COUNT_MAX}
                display={String(inputs.speakerCount)}
                onChange={(value) => set("speakerCount", value)}
              />
              <SelectField
                id="speaker-tier"
                label="Speaker tier"
                hint="Fee plus travel, per speaker."
                value={inputs.speakerTier}
                options={TIER_OPTIONS}
                onChange={(value) => set("speakerTier", value)}
              />
              <SelectField
                id="meals"
                label="Meals"
                hint="Food and drink, per attendee."
                value={inputs.meals}
                options={MEAL_OPTIONS}
                onChange={(value) => set("meals", value)}
              />
              <SelectField
                id="av"
                label="AV"
                hint="Sound, projection and staging."
                value={inputs.av}
                options={AV_OPTIONS}
                onChange={(value) => set("av", value)}
              />
              <SelectField
                id="marketing"
                label="Marketing"
                hint="Promotion for the event."
                value={inputs.marketing}
                options={MARKETING_OPTIONS}
                onChange={(value) => set("marketing", value)}
              />
            </div>

            <p className="mt-6 rounded-lg bg-paper-deep/60 px-4 py-3 text-xs leading-relaxed text-ink-soft">
              Every figure on this page is a planning estimate, not a quote. The ranges are wide on
              purpose — real venue, catering and speaker prices depend on your city, your dates and
              who you book. Nothing you enter is saved or sent anywhere.
            </p>
          </Card>

          {/* ---- The output ---- */}
          <div className="space-y-6 lg:sticky lg:top-6">
            <Card className="overflow-hidden">
              <div className="border-b border-line bg-brand px-6 py-5 text-white">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
                  Estimated total
                </p>
                <p className="mt-2 font-serif text-3xl leading-none">
                  ~{formatRange(estimate.total.low, estimate.total.high)}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-white/75">
                  Planning estimate, not a quote — get real quotes before you commit.
                </p>
              </div>

              <div className="px-6 py-5">
                <div className="grid grid-cols-3 gap-2">
                  <Figure label="Low" amount={estimate.total.low} />
                  <Figure label="Mid" amount={estimate.total.mid} accent />
                  <Figure label="High" amount={estimate.total.high} />
                </div>

                <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-ink-soft">
                  The runway
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                  A rule of thumb for how much to have committed or raised by each point before the
                  event — advice, not a measurement.
                </p>
                <ul className="mt-3 divide-y divide-line">
                  {estimate.runway.map((row) => (
                    <li key={row.days} className="flex items-baseline justify-between gap-3 py-2">
                      <span className="text-sm text-ink">
                        {row.days} days out
                        <span className="ml-2 text-xs text-ink-soft">
                          {Math.round(row.share * 100)}%
                        </span>
                      </span>
                      <span className="font-serif text-sm text-ink">
                        {formatRange(row.low, row.high)}
                      </span>
                    </li>
                  ))}
                </ul>

                <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-ink-soft">
                  Where it goes
                </h3>
                <ul className="mt-3 divide-y divide-line">
                  {estimate.lines.map((line) => (
                    <li key={line.key} className="flex items-baseline justify-between gap-3 py-2">
                      <span className="text-sm text-ink-soft">{line.label}</span>
                      <span className="text-sm text-ink">
                        {line.low === 0 && line.high === 0 ? "—" : formatRange(line.low, line.high)}
                      </span>
                    </li>
                  ))}
                  <li className="flex items-baseline justify-between gap-3 py-2">
                    <span className="text-sm text-ink-soft">Contingency (10–20%)</span>
                    <span className="text-sm text-ink">
                      {formatRange(
                        estimate.total.low - estimate.subtotal.low,
                        estimate.total.high - estimate.subtotal.high,
                      )}
                    </span>
                  </li>
                </ul>
              </div>
            </Card>

            {/* The free-to-paid handoff: the gate for a stranger, a save for a
                paid organizer, and the same gate with one more sentence for a
                conference that is still on the free plan. */}
            <section
              aria-labelledby="own-event"
              className="rounded-xl border border-brass/50 bg-white p-5 shadow-sm ring-1 ring-brass/20"
            >
              <p className={`${eyebrow} text-brass`}>
                {isExample ? "You are on the example event" : "Your numbers, not yet saved"}
              </p>
              <h2 id="own-event" className="mt-2 text-lg text-ink">
                Turn this estimate into a tracked budget
              </h2>

              {access?.signedIn && access.canSave ? (
                saved && savedFor === inputs ? (
                  <>
                    <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                      Saved to &ldquo;{saved.conferenceName}&rdquo;
                      {saved.created > 0
                        ? ` — ${String(saved.created)} budget line${saved.created === 1 ? "" : "s"} added`
                        : ""}
                      {saved.created > 0 && saved.updated > 0 ? " and " : ""}
                      {saved.updated > 0 ? `${String(saved.updated)} updated` : ""}. Each planned
                      figure is the middle of its range, nothing is committed, and every line&rsquo;s
                      note carries the range it came from and the day it was saved.
                    </p>
                    <Link
                      to="/app/conference/$conferenceId"
                      params={{ conferenceId: String(saved.conferenceId) }}
                      hash="budget"
                      className={`mt-4 ${primaryAction}`}
                    >
                      Open the budget
                    </Link>
                    <p className="mt-3 text-xs leading-relaxed text-ink-soft">
                      Move a slider and save again to update those same lines — it will not add a
                      second copy of them, and it will not touch a line you typed yourself.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                      Save these numbers as budget lines on{" "}
                      <span className="font-medium text-ink">{targetName}</span>, where you can edit
                      them, mark what is committed, and see the total against the target. Planned is
                      the middle of each range; nothing is marked committed; every line&rsquo;s note
                      keeps the range it came from.
                    </p>
                    {access.conferences.length > 1 ? (
                      <div className="mt-4">
                        <label htmlFor="save-target" className={labelClass}>
                          Save into
                        </label>
                        <Select
                          id="save-target"
                          value={String(targetId ?? "")}
                          onChange={(event) => setTargetId(Number(event.target.value))}
                          className="mt-1.5"
                        >
                          {access.conferences.map((conference) => (
                            <option key={conference.id} value={String(conference.id)}>
                              {conference.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                    ) : null}
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <Button onClick={save} disabled={saving || targetId === null}>
                        {saving ? "Saving…" : "Save as a tracked budget"}
                      </Button>
                      <span className="text-xs text-ink-soft">
                        Nothing is charged here — this conference is already unlocked.
                      </span>
                    </div>
                    {saveError ? (
                      <p role="alert" className="mt-3 text-xs leading-relaxed text-red-700">
                        {saveError}
                      </p>
                    ) : null}
                    {access.lastSaved && !saved ? (
                      <p className="mt-3 text-xs leading-relaxed text-ink-soft">
                        An estimate was last saved to &ldquo;{access.lastSaved.conferenceName}
                        &rdquo; on {savedDate(access.lastSaved.savedAt)}.
                      </p>
                    ) : null}
                    <p className="mt-3 text-xs leading-relaxed text-ink-soft">
                      Every figure stays a planning estimate. None of it is a quote and none of it
                      came from a supplier.
                    </p>
                  </>
                )
              ) : access?.signedIn && access.locked ? (
                <>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    Your conference &ldquo;{access.locked.name}&rdquo; is on the free plan, which
                    includes one budget line — this estimate is seven. The {UPGRADE_PRICE} unlock
                    removes the limit on that conference, and this page can then save the estimate
                    straight into it.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Link to="/pricing" className={primaryAction}>
                      What the {UPGRADE_PRICE} opens
                    </Link>
                    <Link
                      to="/app/conference/$conferenceId"
                      params={{ conferenceId: String(access.locked.id) }}
                      className="text-sm font-medium text-ink-soft underline decoration-line underline-offset-4 hover:text-ink"
                    >
                      Open {access.locked.name}
                    </Link>
                  </div>
                </>
              ) : access?.signedIn ? (
                <>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    You have no conference yet. The free plan includes one — create it, and the{" "}
                    {UPGRADE_PRICE} unlock opens unlimited budget lines on it, so an estimate like
                    this one can be saved as a tracked budget.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Link to="/pricing" className={primaryAction}>
                      What the {UPGRADE_PRICE} opens
                    </Link>
                    <Link
                      to="/app"
                      className="text-sm font-medium text-ink-soft underline decoration-line underline-offset-4 hover:text-ink"
                    >
                      Create your conference
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    This page is the free estimate. Running it on your own event, saving it, and
                    turning it into a budget with lines you track and contracts you sign is what the{" "}
                    {UPGRADE_PRICE} plan opens.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Link to="/pricing" className={primaryAction}>
                      Estimate your own event — {UPGRADE_PRICE}
                    </Link>
                    {access?.signedIn === false ? (
                      <Link
                        to="/signin"
                        search={{ redirect: "/budget-calculator" }}
                        className="text-sm font-medium text-ink-soft underline decoration-line underline-offset-4 hover:text-ink"
                      >
                        Sign in
                      </Link>
                    ) : null}
                  </div>
                </>
              )}
            </section>
          </div>
        </div>

      </main>
    </div>
  );
}
