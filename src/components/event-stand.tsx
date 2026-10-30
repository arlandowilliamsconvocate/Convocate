import { useEffect, useRef, useState } from "react";
import { getEventStandSummaryFn } from "~/server/api";
import { STAND_EMPTY_MESSAGE, standNumbersLine, type StandFacts } from "~/lib/stand";
/**
 * **Where you stand** — a plain summary of the event, and the figures behind it.
 *
 * The panel is built around one rule: nothing it shows may look like magic. The
 * paragraph is three to five sentences about this conference's own budget,
 * contracts and checklist; directly under it is the compact line of numbers the
 * sentences were written from, so a reader can check the words against the
 * figures in one glance. Under that, one small line says where the paragraph
 * came from and that it is a summary, not advice.
 *
 * **Why the summary arrives after the page.** The figures are already on the
 * page — the budget, the board and the checklist are rendered around this panel
 * — so the numbers line paints immediately, computed from the loader's own data
 * by the same function the server uses. The paragraph needs a model call, so it
 * is asked for in an effect and fills in when it lands. A workspace that will
 * not open until a provider answers is a workspace that is down when the
 * provider is.
 *
 * **The three states, and what each one shows:**
 *
 *  - *nothing on the event yet* — the empty sentence, and no model call is made
 *    at all (the server is never asked, and it would not call one either);
 *  - *the model could not be reached, or wrote a figure it was not given* — the
 *    numbers line alone. No error, no retry button, no apology: the organizer's
 *    own figures are still true and still here;
 *  - *a summary* — the paragraph, the numbers, and the provenance line.
 *
 * The panel is a read. It changes nothing, it saves nothing, and every figure in
 * it comes from rows the organizer already has.
 */
export function EventStandPanel({
  conferenceId,
  facts,
}: {
  conferenceId: number;
  /** The loader's figures, already shaped for this reader's role. */
  facts: StandFacts;
}) {
  const [stand, setStand] = useState<Awaited<ReturnType<typeof getEventStandSummaryFn>> | null>(
    null,
  );
  const [busy, setBusy] = useState(facts.hasData);
  // One request per mount. The effect below runs once for a conference; this ref
  // keeps a re-render (or React's development double-invoke) from spending a
  // second model call on the same panel.
  const asked = useRef(false);
  useEffect(() => {
    if (!facts.hasData) {
      setBusy(false);
      return;
    }
    if (asked.current) return;
    asked.current = true;
    let live = true;
    getEventStandSummaryFn({ data: { conferenceId } })
      .then((result) => {
        if (live) setStand(result);
      })
      // A refusal or a network fault is not shown: the numbers line stays, which
      // is the failure state this panel was built to have.
      .catch(() => undefined)
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [conferenceId, facts.hasData]);
  // The server's own facts win once they arrive — it reads the rows itself, and
  // it is what the summary was written from. Until then the loader's figures.
  const shown = stand?.facts ?? facts;
  const numbersLine = stand?.numbersLine ?? standNumbersLine(facts);
  const summary = stand?.summaryState === "ok" ? stand.summary : null;
  return (
    <section className="border border-taupe/70 bg-cream px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-[10.5px] uppercase tracking-[0.18em] text-terracotta-ink">
          Where you stand
        </h2>
        <span aria-hidden="true" className="h-[1px] flex-1 bg-taupe/70" />
      </div>
      {shown.hasData ? (
        <div className="mt-3 space-y-2.5">
          {summary ? (
            <p className="max-w-[68ch] text-[14.5px] leading-[1.7] text-charcoal">{summary}</p>
          ) : busy ? (
            <p className="text-[13.5px] text-charcoal-soft" aria-live="polite">
              Reading your figures…
            </p>
          ) : null}
          {/* The numbers the paragraph was written from, in tabular numerals so a
              reader can check one against the other at a glance. */}
          <p className="text-[13.5px] leading-relaxed tabular-nums text-charcoal">{numbersLine}</p>
          {summary ? (
            <p className="text-[11.5px] leading-relaxed text-charcoal-soft">
              Written by Convocate&rsquo;s assistant from these figures only — a summary of what is
              recorded here, not advice.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-[13.5px] leading-relaxed text-charcoal-soft">{STAND_EMPTY_MESSAGE}</p>
      )}
    </section>
  );
}
