/**
 * The Gemini client — the one place a model is named and the key is read.
 *
 * Server-only. Nothing here may be imported by a component: the key would end up
 * in the client bundle. `GEMINI_API_KEY` is read from `process.env` at call time
 * (never at module load), so a key that is missing — or that the owner rotates —
 * changes behavior on the next request without a restart.
 *
 * The model
 * ---------
 * `gemini-2.5-flash` now 404s for new users, and the API's own error recommends
 * `gemini-3.8-flash`. The model below is the one that answers today; changing it
 * is a one-line change to `GEMINI_MODEL` and nothing else.
 *
 * Honesty
 * -------
 * Nothing here throws and nothing here logs the key or Google's raw error text.
 * Every failure comes back as a typed result with a plain sentence a reader can
 * act on, so a quota that runs dry looks like "try again in a minute", never like
 * a broken page.
 */

/** The one line to change when the model moves. */
export const GEMINI_MODEL = "gemini-3-flash-preview";

/**
 * Models tried in order when the one above will not answer.
 *
 * Google's own capacity is not reliable: on the free tier we have seen
 * `gemini-3-flash-preview` return 429 (5 requests a minute) while
 * `gemini-3.8-flash` and `gemini-3.1-flash-lite` returned 503 "high demand" at
 * the same moment. Trying a second and third model turns a bad minute at Google
 * into a slow answer instead of a refusal. Every name here answered a request at
 * least once in testing; `gemini-2.5-flash` is deliberately absent — it 404s for
 * new users.
 */
export const GEMINI_FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.1-flash-lite"];

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Hard ceiling on one call. The server function's own budget is far larger. */
const TIMEOUT_MS = 25_000;

/** How long to wait before the one retry on a loaded primary model. */
const RETRY_DELAY_MS = 4_000;

/**
 * Ceiling on the whole attempt, across every model. Past this the assistant says
 * it is busy rather than holding the reader's page open.
 */
const TOTAL_BUDGET_MS = 45_000;

/** What a reader sees. Every sentence is true of the product as it is built. */
export const AI_NOT_CONFIGURED =
  "The assistant is not set up on this site yet. You can still email hello@mail.getconvocate.com and a person will answer.";
export const AI_QUOTA_EXHAUSTED =
  "The assistant has reached its limit for the moment — try again in a minute.";
export const AI_BUSY =
  "The assistant is busy right now — Google's model is not answering. Try again in a minute, or email hello@mail.getconvocate.com and a person will answer.";
export const AI_FAILED =
  "The assistant could not answer that just now. Try again in a minute, or email hello@mail.getconvocate.com.";

export type AiFailureReason = "quota" | "config" | "error";
export type AiResult =
  | { ok: true; text: string }
  | { ok: false; reason: AiFailureReason; message: string };

const apiKey = (): string => {
  const value = process.env.GEMINI_API_KEY;
  return typeof value === "string" ? value.trim() : "";
};

/** Whether a key is present at all — no call, no leak, just a yes or no. */
export const isAiConfigured = (): boolean => apiKey() !== "" || groqKeyPresent();

/**
 * The Groq key, read here rather than imported from `groq.ts`, so the two
 * provider modules never import each other at load time.
 */
const groqKeyPresent = (): boolean => {
  const value = process.env.GROQ_API_KEY;
  return typeof value === "string" && value.trim() !== "";
};


/**
 * Ask the assistant a question, trying providers in order.
 *
 * Groq first, because Google's free tier allows only 20 requests a day and
 * refused everything once that was spent. Gemini answers only if the Groq key is
 * missing or Groq refuses every model — a second road to the same answer, not a
 * second feature. Imported lazily inside the function so the two provider
 * modules cannot form a load-time cycle.
 */
export const askAi = async (
  systemInstruction: string,
  prompt: string,
  options?: { model?: string },
): Promise<AiResult> => {
  const { askGroq, isGroqConfigured: groqReady } = await import("./groq");
  if (groqReady()) {
    const groq = await askGroq(systemInstruction, prompt, options?.model);
    if (groq.ok) return groq;
    // A key problem at Groq is not worth trying Google for only if Google has no
    // key either — fall through and let Gemini answer if it can.
    const gemini = await askGemini(systemInstruction, prompt);
    if (gemini.ok) return gemini;
    // Report Groq's reason: it is the provider the reader is actually waiting on.
    return groq;
  }
  return askGemini(systemInstruction, prompt);
};


type CallResult = { ok: true; text: string } | { ok: false; status: number };

type GeminiPayload = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One POST, one answer. A timeout or a network fault is `status: 0`. */
const callOnce = async (url: string, body: string): Promise<CallResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: response.status };
    const payload = (await response.json()) as GeminiPayload;
    const text = (payload?.candidates?.[0]?.content?.parts ?? [])
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
    // An empty answer is a failure, not a success with nothing in it: the card
    // must not show a blank box and call it an answer.
    if (!text) return { ok: false, status: 204 };
    return { ok: true, text };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Ask the model one question.
 *
 * Tries `GEMINI_MODEL`, then each fallback model, and retries the primary once
 * after ~4 seconds when it is rate limited or overloaded. A 429 anywhere is
 * reported as a limit; only 503s are reported as Google being busy, because
 * those are different problems for the reader. A rejected key (400/401/403) is
 * a configuration problem and says so without repeating Google's wording.
 */
export const askGemini = async (
  systemInstruction: string,
  prompt: string,
): Promise<AiResult> => {
  const key = apiKey();
  if (!key) return { ok: false, reason: "config", message: AI_NOT_CONFIGURED };

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 700, temperature: 0.3 },
  });

  const started = Date.now();
  const models = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS];
  let sawRateLimit = false;
  let sawConfigRefusal = false;
  let lastStatus = 0;

  for (let index = 0; index < models.length; index += 1) {
    if (index > 0 && Date.now() - started > TOTAL_BUDGET_MS) break;
    const url = `${ENDPOINT}/${models[index]}:generateContent?key=${encodeURIComponent(key)}`;

    let attempt = await callOnce(url, body);
    // Only the primary model is retried: a second wait would spend the reader's
    // time on a model that is already the fallback.
    if (!attempt.ok && index === 0 && (attempt.status === 429 || attempt.status === 503)) {
      await sleep(RETRY_DELAY_MS);
      attempt = await callOnce(url, body);
    }

    if (attempt.ok) return { ok: true, text: attempt.text };

    lastStatus = attempt.status;
    if (attempt.status === 429) sawRateLimit = true;
    if (attempt.status === 400 || attempt.status === 401 || attempt.status === 403) {
      sawConfigRefusal = true;
      break;
    }
    if (attempt.status !== 429 && attempt.status !== 503) break;
  }

  if (sawRateLimit) return { ok: false, reason: "quota", message: AI_QUOTA_EXHAUSTED };
  if (sawConfigRefusal) return { ok: false, reason: "config", message: AI_NOT_CONFIGURED };
  if (lastStatus === 503 || lastStatus === 0) {
    return { ok: false, reason: "quota", message: AI_BUSY };
  }
  return { ok: false, reason: "error", message: AI_FAILED };
};
