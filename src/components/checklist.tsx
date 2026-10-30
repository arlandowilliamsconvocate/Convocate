import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Button, Card, EmptyState, Input } from "~/components/ui";
import { SectionHead } from "~/components/app-ui";
import {
  CHECKLIST_LABEL_MAX,
  CHECKLIST_PHASE_NOTES,
  CHECKLIST_PHASE_TITLES,
  CHECKLIST_PHASES,
  checklistSummary,
  overallProgressText,
  progressText,
  type ChecklistItem,
  type ChecklistPhase,
} from "~/lib/checklist";
import { CHECKLIST_LOCKED_HINT } from "~/lib/plan";
import type { MemberRole } from "~/server/db.server";
import {
  addChecklistItemFn,
  deleteChecklistItemFn,
  moveChecklistItemFn,
  renameChecklistItemFn,
  setChecklistItemDoneFn,
} from "~/server/api";
import { describeRefusal } from "~/lib/refusal";

/** What the checklist read looks like once the server has shaped it. */
export type ChecklistView = {
  role: MemberRole;
  sample: boolean;
  canEdit: boolean;
  items: ChecklistItem[];
  progress: {
    pre: { done: number; total: number };
    post: { done: number; total: number };
    overall: { done: number; total: number };
  };
};

/** A refusal thrown by a server function, as a sentence. */
const refusalMessage = async (cause: unknown): Promise<string> => (await describeRefusal(cause)).message;

/** The day an item was ticked, in the reader's own calendar. */
const tickedOn = (ms: number): string =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * The pre- and post-conference checklist.
 *
 * Two columns — "Before the conference" and "After the conference" — with a
 * checkbox per item and a count over each. Nothing here invents a due date or a
 * colour that suggests one: an item is ticked or it is not, and the list says
 * how many of each.
 *
 * A Viewer reads the list and its progress and gets no control at all; the
 * server refuses every write for them anyway (`requireChecklistEditor`), so
 * this is presentation, not the gate. A locked conference shows the locked
 * panel and the server refuses the read itself with `upgrade_required` — the
 * rows are kept, never deleted.
 */
export function ChecklistSection({
  conferenceId,
  checklist,
  locked,
}: {
  conferenceId: number;
  /** `null` when the server refused the read (a locked conference does). */
  checklist: ChecklistView | null;
  locked: boolean;
}) {
  if (locked || !checklist) {
    return (
      <section id="checklist" className="scroll-mt-32 space-y-4">
        <SectionHead
          title="Checklist"
          lede="What has to happen before the conference and what has to happen after it, in one list the committee can tick off."
        />
        <EmptyState
          title={locked ? "The checklist comes with the unlock" : "The checklist is not available here"}
          body={CHECKLIST_LOCKED_HINT}
          action={
            locked ? (
              <span className="text-sm text-ink-soft">Use the unlock panel at the top of this page.</span>
            ) : undefined
          }
        />
      </section>
    );
  }

  const { items, canEdit, progress, sample } = checklist;

  return (
    <section id="checklist" className="scroll-mt-32 space-y-4">
      <SectionHead
        title="Checklist"
        lede="What still has to happen before the conference, and what still has to happen after it. No item carries a due date — it is either done or it is not."
        actions={
          <p className="text-[13px] tabular-nums text-charcoal">
            {overallProgressText(progress.overall.done, progress.overall.total)}
          </p>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {CHECKLIST_PHASES.map((phase) => (
          <PhaseColumn
            key={phase}
            conferenceId={conferenceId}
            phase={phase}
            items={items.filter((item) => item.phase === phase)}
            done={progress[phase].done}
            total={progress[phase].total}
            canEdit={canEdit}
          />
        ))}
      </div>

      <p className="text-xs text-ink-soft">
        {checklistSummary(progress.overall.done, progress.overall.total)}
        {sample ? " The example's checklist is a preview: nothing on it can be changed." : ""}
      </p>
    </section>
  );
}

/** One phase: its heading, its count, its items, and the add form. */
function PhaseColumn({
  conferenceId,
  phase,
  items,
  done,
  total,
  canEdit,
}: {
  conferenceId: number;
  phase: ChecklistPhase;
  items: ChecklistItem[];
  done: number;
  total: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  /** The item a request is in flight for (0 for the add form), so one control at a time is busy. */
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; label: string } | null>(null);

  /**
   * Run one write, then re-read the whole section from the loader. Every action
   * is safe to repeat on the server, and the button is disabled while its
   * request is in flight, so a double click cannot send two.
   */
  const act = async (key: number, work: () => Promise<void>) => {
    if (busy !== null) return;
    setBusy(key);
    setError(null);
    try {
      await work();
      await router.invalidate();
    } catch (cause) {
      setError(await refusalMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const toggle = (item: ChecklistItem) =>
    act(item.id, async () => {
      await setChecklistItemDoneFn({
        data: { conferenceId, itemId: item.id, done: item.doneAt === null },
      });
    });

  const move = (item: ChecklistItem, direction: "up" | "down") =>
    act(item.id, async () => {
      await moveChecklistItemFn({ data: { conferenceId, itemId: item.id, direction } });
    });

  const remove = (item: ChecklistItem) =>
    act(item.id, async () => {
      await deleteChecklistItemFn({ data: { conferenceId, itemId: item.id } });
    });

  const rename = (item: ChecklistItem) => {
    const next = renaming && renaming.id === item.id ? renaming.label.trim() : "";
    if (!next) return;
    return act(item.id, async () => {
      const result = await renameChecklistItemFn({
        data: { conferenceId, itemId: item.id, label: next },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRenaming(null);
    });
  };

  const add = () => {
    const next = label.trim();
    if (!next) return;
    return act(0, async () => {
      const result = await addChecklistItemFn({ data: { conferenceId, phase, label: next } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLabel("");
    });
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">
          {CHECKLIST_PHASE_TITLES[phase]}
        </h3>
        <p className="text-xs text-ink-soft">{progressText(done, total)}</p>
      </div>
      <p className="mt-1 text-sm text-ink-soft">{CHECKLIST_PHASE_NOTES[phase]}</p>

      {items.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-paper-deep/40 px-3 py-4 text-sm text-ink-soft">
          Nothing on this list yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {items.map((item, index) => {
            const isBusy = busy === item.id;
            return (
              <li key={item.id} className="flex items-start gap-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brand focus:ring-2 focus:ring-brand/20"
                  checked={item.doneAt !== null}
                  disabled={!canEdit || busy !== null}
                  aria-label={item.label}
                  onChange={() => {
                    void toggle(item);
                  }}
                />
                <div className="min-w-0 flex-1">
                  {renaming && renaming.id === item.id ? (
                    <form
                      className="flex flex-wrap items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void rename(item);
                      }}
                    >
                      <Input
                        autoFocus
                        value={renaming.label}
                        maxLength={CHECKLIST_LABEL_MAX}
                        disabled={isBusy}
                        onChange={(event) => {
                          setRenaming({ id: item.id, label: event.target.value });
                        }}
                        className="max-w-xs"
                        aria-label="New name for this item"
                      />
                      <Button type="submit" variant="secondary" disabled={isBusy}>
                        Save
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <p
                      className={
                        item.doneAt !== null
                          ? "text-sm text-ink-soft line-through"
                          : "text-sm text-ink"
                      }
                    >
                      {item.label}
                    </p>
                  )}
                  {item.doneAt !== null ? (
                    <p className="mt-0.5 text-xs text-ink-soft/80">
                      Ticked{item.doneBy ? ` by ${item.doneBy}` : ""} on {tickedOn(item.doneAt)}
                    </p>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="rounded px-1.5 py-1 text-xs text-ink-soft hover:bg-paper-deep hover:text-ink disabled:opacity-40"
                      disabled={index === 0 || busy !== null}
                      aria-label={`Move ${item.label} up`}
                      title="Move up"
                      onClick={() => {
                        void move(item, "up");
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="rounded px-1.5 py-1 text-xs text-ink-soft hover:bg-paper-deep hover:text-ink disabled:opacity-40"
                      disabled={index === items.length - 1 || busy !== null}
                      aria-label={`Move ${item.label} down`}
                      title="Move down"
                      onClick={() => {
                        void move(item, "down");
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="rounded px-1.5 py-1 text-xs text-ink-soft hover:bg-paper-deep hover:text-ink disabled:opacity-40"
                      disabled={busy !== null}
                      onClick={() => {
                        setRenaming({ id: item.id, label: item.label });
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="rounded px-1.5 py-1 text-xs text-[#8A2F22] hover:bg-[#8A2F22]/[0.06] disabled:opacity-40"
                      disabled={busy !== null}
                      aria-label={`Remove ${item.label}`}
                      onClick={() => {
                        void remove(item);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit ? (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Input
            value={label}
            maxLength={CHECKLIST_LABEL_MAX}
            placeholder={`Add an item to “${CHECKLIST_PHASE_TITLES[phase].toLowerCase()}”`}
            disabled={busy !== null}
            aria-label={`New item for ${CHECKLIST_PHASE_TITLES[phase].toLowerCase()}`}
            onChange={(event) => {
              setLabel(event.target.value);
            }}
            className="max-w-sm"
          />
          <Button type="submit" variant="secondary" disabled={busy !== null || label.trim() === ""}>
            Add item
          </Button>
        </form>
      ) : null}

      {error ? <p className="mt-2 text-sm text-[#8A2F22]">{error}</p> : null}
    </Card>
  );
}
