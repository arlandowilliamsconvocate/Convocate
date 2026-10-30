import { useEffect, useRef, useState } from "react";
import { Button, Input } from "~/components/ui";
import { askHelpFn } from "~/server/api";

/** The server's own limits, repeated only so the box can be honest about them. */
const QUESTION_MAX = 1_000;

const EMPTY_PROMPT = 'Type a question first — for example, "What does the $199 unlock include?"';

/** One id, so the circular button can point `aria-controls` at the panel. */
const PANEL_ID = "ask-about-convocate-panel";

/**
 * "Ask about Convocate" — the one visible agent in slice 1.
 *
 * It answers questions about how the product works, from a fixed set of help
 * topics on the server. It cannot see this organizer's events, and it cannot
 * change anything: the answer is text in a panel, nothing more.
 *
 * The owner asked for it to be a circular button in the corner that opens a
 * pop-up rather than a card sitting in the middle of the dashboard (2026-10-22),
 * so it is mounted once in the signed-in shell (`src/routes/app.tsx`) and is
 * nowhere else: no public page, no print page, no signing page. It never opens
 * by itself.
 *
 * What is inside is unchanged: a plain form calling `askHelpFn`. Every refusal —
 * too long, over the hourly limit, the assistant busy, the model's quota spent,
 * an off-topic decline — arrives as a sentence from the server and is printed
 * where the answer would have gone.
 */
export function HelpAssistant() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Close and hand the keyboard back to the circular button. */
  const closeAndReturnFocus = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  // While the panel is open: focus the textbox, close on Escape, and close on a
  // click outside. No focus trap and no body scroll lock — the page underneath
  // stays usable, which is the point of a corner pop-up.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    // `mousedown` rather than `click`: a click that starts inside the panel and
    // ends outside it must not count as "outside".
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      // Close, but leave the keyboard where the organizer just put it — the
      // button click they made outside is the thing they were reaching for.
      setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) {
      setAnswer(null);
      setProblem(EMPTY_PROMPT);
      return;
    }
    if (trimmed.length > QUESTION_MAX) {
      setAnswer(null);
      setProblem("That question is too long — keep it under 1,000 characters and ask again.");
      return;
    }
    setBusy(true);
    setAnswer(null);
    setProblem(null);
    try {
      const result = await askHelpFn({ data: { question: trimmed } });
      if (result.ok) {
        setAnswer(result.answer);
        setQuestion("");
      } else {
        setProblem(result.message);
      }
    } catch {
      // A refused session or a dropped request: still a sentence, never a crash.
      setProblem(
        "The assistant could not answer that just now. Try again in a minute, or email hello@mail.getconvocate.com.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* The panel sits above the button, bottom-right. Kept mounted while closed
          (display:none) so `aria-controls` always resolves and a question and its
          answer survive closing and reopening on the same page. */}
      <div
        ref={panelRef}
        id={PANEL_ID}
        role="dialog"
        aria-label="Ask about Convocate"
        className={`${
          open ? "flex" : "hidden"
        } print-hide fixed bottom-[calc(env(safe-area-inset-bottom,0px)+5.25rem)] right-[calc(env(safe-area-inset-right,0px)+1rem)] z-50 max-h-[75vh] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl ring-1 ring-black/5`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line/70 bg-paper-deep/40 px-4 py-3">
          <div>
            <h2 className="font-serif text-base leading-tight text-ink">Ask about Convocate</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              The budget, contracts, agreements, checklists and registration.
            </p>
          </div>
          <button
            type="button"
            onClick={closeAndReturnFocus}
            aria-label="Close the assistant"
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-paper-deep hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4" fill="none">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3">
          <form onSubmit={ask} className="flex items-end gap-2">
            <label className="flex-1">
              <span className="sr-only">Your question about Convocate</span>
              <Input
                ref={inputRef}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Does the free plan include contracts?"
                maxLength={QUESTION_MAX}
                disabled={busy}
              />
            </label>
            <Button type="submit" disabled={busy} className="whitespace-nowrap">
              {busy ? "Asking…" : "Ask"}
            </Button>
          </form>

          <div aria-live="polite">
            {answer ? (
              <div className="mt-3 rounded-lg border border-line/70 bg-paper-deep/40 px-3 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Answer</p>
                <p className="mt-1 whitespace-pre-line text-sm text-ink">{answer}</p>
              </div>
            ) : null}

            {problem ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
                {problem}
              </p>
            ) : null}
          </div>

          <p className="mt-3 text-xs text-ink-soft">
            Answers come from Convocate&rsquo;s own help topics. It cannot see your events or change
            anything in your account. For anything about your account, email{" "}
            <a className="underline hover:text-ink" href="mailto:hello@mail.getconvocate.com">
              hello@mail.getconvocate.com
            </a>
            .
          </p>
        </div>
      </div>

      {/* The circular button: navy ink on a gold disc, the emblem's own accent. */}
      <button
        ref={buttonRef}
        type="button"
        aria-label="Ask about Convocate"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="print-hide group fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] right-[calc(env(safe-area-inset-right,0px)+1rem)] z-50 flex h-14 w-14 items-center justify-center rounded-full bg-brass text-white shadow-lg ring-1 ring-brand/20 transition hover:bg-brass/90 hover:shadow-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/40"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none">
          <path
            d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </>
  );
}
