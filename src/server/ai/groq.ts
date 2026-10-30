/**
 * The Groq client — the assistant's first choice of provider.
 *
 * Why Groq: Google's free tier answered, then refused everything after 20
 * requests in a day (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`), which
 * cannot serve a product. Groq's free tier is far more generous and its API is
 * OpenAI-shaped, so the same question can be asked with a much smaller chance of
 * hitting a wall. Gemini stays wired underneath as the second option; see
 * `askAi` in `provider.ts`.
 *
 * Server-only, exactly like the Gemini client: `GROQ_API_KEY` is read from
 * `process.env` at call time and never reaches a component.
 *
 * The `user-agent` header is not decoration. Groq sits behind a filter that
 * answers a bare scripted request with HTTP 403 (error code 1010), which would
 * look like a bad key in our logs and like a broken assistant to a reader.
 */

import type { AiResult } from "./provider";
import { AI_BUSY, AI_FAILED, AI_NOT_CONFIGURED, AI_QUOTA_EXHAUSTED } from "./provider";

/** The model that answered in testing: fast, and good enough for help text. */
export const GROQ_MODEL = "openai/gpt-oss-120b";

/**
 * Tried in order if the model above is rate limited or unavailable. Both were
 * listed by Groq's own `/models` endpoint for this key.
 */
export const GROQ_FALLBACK_MODELS = ["qwen/qwen3.8-27b", "openai/gpt-oss-20b"];

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const TIMEOUT_MS = 25_000;
const RETRY_DELAY_MS = 3_000;
const TOTAL_BUDGET_MS = 45_000;

/** A plain, stable identifier. See the note at the top of the file. */
const USER_AGENT = "Convocate/1.0 (+https://www.getconvocate.com)";

const apiKey = (): string => {
  const value = process.env.GROQ_API_KEY;
  return typeof value === "string" ? value.trim() : "";
};

export const isGroqConfigured = (): boolean => apiKey() !== "";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type GroqPayload = {
  choices?: Array<{ message?: { content?: string } }>;
};

type CallResult = { ok: true; text: string } | { ok: false; status: number };

const callOnce = async (url: string, key: string, body: string): Promise<CallResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "user-agent": USER_AGENT,
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: response.status };
    const payload = (await response.json()) as GroqPayload;
    const text = (payload?.choices?.[0]?.message?.content ?? "").trim();
    // An empty answer is a failure, not an answer: the card must not print a
    // blank box and call it done.
    if (!text) return { ok: false, status: 204 };
    return { ok: true, text };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Ask Groq one question.
 *
 * A 429 means we used our allowance; 5xx (or no response) means Groq is having a
 * bad minute. They are reported differently because they ask different things of
 * the reader. A 401 is a key problem and says so without repeating their wording.
 */
export const askGroq = async (
  systemInstruction: string,
  prompt: string,
  /** A model named by a setting rather than by this file; tried first. */
  preferredModel?: string,
): Promise<AiResult> => {
  const key = apiKey();
  if (!key) return { ok: false, reason: "config", message: AI_NOT_CONFIGURED };

  const started = Date.now();
  const preferred = (preferredModel ?? "").trim();
  const models = [
    ...(preferred !== "" ? [preferred] : []),
    ...[GROQ_MODEL, ...GROQ_FALLBACK_MODELS].filter((name) => name !== preferred),
  ];
  let sawRateLimit = false;
  let sawKeyRefusal = false;
  let lastStatus = 0;

  for (let index = 0; index < models.length; index += 1) {
    if (index > 0 && Date.now() - started > TOTAL_BUDGET_MS) break;

    const body = JSON.stringify({
      model: models[index],
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: prompt },
      ],
      max_tokens: 700,
      temperature: 0.3,
    });

    let attempt = await callOnce(ENDPOINT, key, body);
    if (!attempt.ok && index === 0 && (attempt.status === 429 || attempt.status >= 500 || attempt.status === 0)) {
      await sleep(RETRY_DELAY_MS);
      attempt = await callOnce(ENDPOINT, key, body);
    }

    if (attempt.ok) return { ok: true, text: attempt.text };

    lastStatus = attempt.status;
    if (attempt.status === 429) sawRateLimit = true;
    if (attempt.status === 401) {
      sawKeyRefusal = true;
      break;
    }
    if (attempt.status !== 429 && attempt.status < 500) break;
  }

  if (sawRateLimit) return { ok: false, reason: "quota", message: AI_QUOTA_EXHAUSTED };
  if (sawKeyRefusal) return { ok: false, reason: "config", message: AI_NOT_CONFIGURED };
  if (lastStatus >= 500 || lastStatus === 0) {
    return { ok: false, reason: "quota", message: AI_BUSY };
  }
  return { ok: false, reason: "error", message: AI_FAILED };
};
