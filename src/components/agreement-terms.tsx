import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Button, Field, Input, Textarea } from "~/components/ui";
import {
  DRAFT_NOTICE,
  EMPTY_AGREEMENT_TERMS,
  OPTIONAL_CLAUSES,
  detailLabel,
  type AgreementTerms,
} from "~/lib/agreement";
import { describeRefusal } from "~/lib/refusal";
import type { ContractKind } from "~/lib/types";
import { getAgreementTermsFn, saveAgreementTermsFn } from "~/server/api";

/**
 * The caption above the detail box, per kind — what kind-specific block the
 * agreement will carry for this entry.
 */
const KIND_BLOCK_NOTE: Record<ContractKind, string> = {
  speaker: "The agreement adds a speaker block: sessions and titles, Q&A time, biography and photo deadline, book table.",
  musician: "The agreement adds a performance block: set length, rehearsal and soundcheck, named band members, backline, setlist approval.",
  singer: "The agreement adds a performance block: set length, rehearsal and soundcheck, named band members, backline, setlist approval.",
  band: "The agreement adds a performance block: set length, rehearsal and soundcheck, named band members, backline, setlist approval.",
  backline: "The agreement adds an equipment block: items with quantities, delivery and collection windows, damage responsibility, substitute equipment, power.",
  venue: "The agreement adds a venue block: rental dates and hours, rooms and capacity, access and keys, cleaning, damage, catering and AV.",
  other: "No kind-specific block is added for this kind — the core agreement and your own terms still apply.",
};

/**
 * The optional agreement terms on one contract card.
 *
 * Closed by default (it is a lot of fields for a volunteer committee), loads the
 * saved terms only when opened, and saves through `saveAgreementTermsFn` — the
 * server refuses a Viewer, the shared example and a free-plan conference, so the
 * form is shown only where the card already knows editing is allowed.
 *
 * Every field is optional. A field left blank is not a gap in the document: the
 * agreement prints a blank line for the organizer to complete by hand.
 */
export function AgreementTermsEditor({
  contractId,
  kind,
  name,
}: {
  contractId: number;
  kind: ContractKind;
  name: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [terms, setTerms] = useState<AgreementTerms>(EMPTY_AGREEMENT_TERMS);

  const load = async () => {
    if (loaded || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getAgreementTermsFn({ data: { contractId } });
      setTerms(result.terms ?? terms);
      setLoaded(true);
    } catch (cause) {
      const refusal = await describeRefusal(cause);
      setError(refusal.message);
    } finally {
      setLoading(false);
    }
  };

  const setText = (key: keyof AgreementTerms) => (event: { target: { value: string } }) =>
    setTerms((prev) => ({ ...prev, [key]: event.target.value }));

  const toggleClause = (key: string) =>
    setTerms((prev) => ({
      ...prev,
      clauses: prev.clauses.includes(key)
        ? prev.clauses.filter((entry) => entry !== key)
        : [...prev.clauses, key],
    }));

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      // The handler returns the saved terms, or throws a refusal Response; the
      // union below keeps both shapes honest at the call site.
      const result = (await saveAgreementTermsFn({ data: { contractId, ...terms } })) as
        | { ok: true; terms: AgreementTerms }
        | { ok: false; error?: string };
      if (!result.ok) {
        setError(result.error || "Those terms were not saved.");
        return;
      }
      setTerms(result.terms ?? terms);
      setNotice("Saved. The agreement is built from these terms from now on.");
      await router.invalidate();
    } catch (cause) {
      const refusal = await describeRefusal(cause);
      setError(refusal.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <details
      className="mt-2.5 rounded border border-line/80 bg-paper-deep/40 px-2 py-1.5"
      onToggle={(event) => {
        setOpen((event.currentTarget as HTMLDetailsElement).open);
        if ((event.currentTarget as HTMLDetailsElement).open) void load();
      }}
    >
      <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
        Agreement terms {loaded ? "" : "(optional)"}
      </summary>
      <p className="mt-1 text-[11px] text-ink-soft">
        Fill in whatever you and {name} have agreed. Blank fields print as blank
        lines to complete by hand — nothing here is invented. {DRAFT_NOTICE}
      </p>
      <p className="mt-1 text-[11px] text-ink-soft">{KIND_BLOCK_NOTE[kind]}</p>

      {loading ? <p className="mt-2 text-[11px] text-ink-soft">Loading the saved terms…</p> : null}
      {!open && !loaded ? null : (
        <div className="mt-2 space-y-2">
          <Field label="What is provided">
            <Textarea
              rows={3}
              value={terms.engagement}
              onChange={setText("engagement")}
              placeholder="Three sessions on Friday and Saturday, 45 minutes each, plus a closing Q&A"
            />
          </Field>
          <Field label="Schedule — arrival, set-up, times, finish">
            <Textarea
              rows={3}
              value={terms.schedule}
              onChange={setText("schedule")}
              placeholder={"Arrive Thu 18:00 · Soundcheck Fri 09:00 · Sessions Fri 19:30, Sat 10:00 · Finish Sat 12:30"}
            />
          </Field>
          <Field label={detailLabel(kind)}>
            <Textarea
              rows={4}
              value={terms.detail}
              onChange={setText("detail")}
              placeholder="One line or item per row"
            />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Balance due date">
              <Input type="date" value={terms.balanceDue} onChange={setText("balanceDue")} />
            </Field>
            <Field label="Cancellation notice (days)">
              <Input
                inputMode="numeric"
                value={terms.cancellationNoticeDays ? String(terms.cancellationNoticeDays) : ""}
                onChange={(event) =>
                  setTerms((prev) => ({
                    ...prev,
                    cancellationNoticeDays: Math.max(0, Math.round(Number(event.target.value) || 0)),
                  }))
                }
                placeholder="28"
              />
            </Field>
          </div>
          <Field label="How payment is made">
            <Textarea
              rows={2}
              value={terms.paymentNote}
              onChange={setText("paymentNote")}
              placeholder="Bank transfer to the conference account; details on the invoice"
            />
          </Field>
          <Field label="Inclusions — travel, accommodation, meals, local transport (with any caps)">
            <Textarea
              rows={3}
              value={terms.inclusions}
              onChange={setText("inclusions")}
              placeholder="Two nights' accommodation up to $180 a night, meals on site, airport transfers"
            />
          </Field>
          <Field label="What happens to the deposit on cancellation">
            <Textarea
              rows={2}
              value={terms.cancellationDeposit}
              onChange={setText("cancellationDeposit")}
              placeholder="Deposit is returned if canceled more than 28 days out; otherwise kept"
            />
          </Field>
          <Field label="Governing law — country or state, and its courts">
            <Input
              value={terms.governingLaw}
              onChange={setText("governingLaw")}
              placeholder="Leave blank if you have not decided — it prints a blank line"
            />
          </Field>
          <Field label="Your own clauses">
            <Textarea
              rows={3}
              value={terms.additionalTerms}
              onChange={setText("additionalTerms")}
              placeholder="Any clause your organization always uses — printed as written"
            />
          </Field>

          <div className="rounded border border-line/80 bg-white p-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
              Optional clauses — off by default
            </p>
            <ul className="mt-1 space-y-1">
              {OPTIONAL_CLAUSES.map((clause) => (
                <li key={clause.key}>
                  <label className="flex cursor-pointer items-start gap-1.5 text-[11px] text-ink">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={terms.clauses.includes(clause.key)}
                      onChange={() => toggleClause(clause.key)}
                    />
                    <span>
                      {clause.label}
                      <span className="ml-1 text-ink-soft">— {clause.hint}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          {error ? (
            <p className="rounded bg-[#8A2F22]/[0.06] px-2 py-1 text-[11px] text-[#8A2F22] ring-1 ring-[#8A2F22]/25">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="rounded bg-sage/10 px-2 py-1 text-[11px] text-sage-ink ring-1 ring-sage/30">
              {notice}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" className="px-2 py-1 text-xs" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save these terms"}
            </Button>
            <span className="text-[11px] text-ink-soft">
              Saving changes only the agreement text — the fee, stage and contract status on the
              card stay as they are.
            </span>
          </div>
        </div>
      )}
    </details>
  );
}
