/**
 * WCAG 2.x contrast audit for the Convocate palette.
 *
 * Run: `bun scripts/contrast-audit.ts` (exit 1 if any *painted* text pair fails AA).
 *
 * Why this file exists: the palette is pinned by the owner, and the one thing
 * that has to stay true as components are added is that a label on a filled
 * surface clears 4.5:1. A ratio in a comment rots; this computes it.
 *
 * The maths is WCAG 2.1 / 2.2 §1.4.3 and §1.4.11:
 *   - relative luminance uses the sRGB linearisation (channel <= 0.03928 ?
 *     c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4),
 *   - ratio = (Llight + 0.05) / (Ldark + 0.05),
 *   - normal text needs 4.5:1, large text (>= 24px regular / >= 18.66px bold)
 *     3:1, non-text graphics need 3:1.
 *
 * Alpha is composited first, because Tailwind's `bg-brand/90` and
 * `bg-terracotta/[0.07]` are *not* their base colour: 90% of #8a4a2a over cream
 * is a visibly lighter fill than #8a4a2a, and the ratio has to be computed
 * against what actually lands on screen.
 *
 * A case marked `reference: true` is a pair the design rules out (the light
 * terracotta behind a label). It is printed and measured so the number is on
 * the record, and `scripts/check-terracotta-fill.ts` is what stops it shipping.
 */

type RGB = { r: number; g: number; b: number };

const TOKENS: Record<string, string> = {
  cream: "#fbf7f0",
  "cream-deep": "#f5eee2",
  charcoal: "#2b2724",
  "charcoal-soft": "#5e564e",
  taupe: "#ded3c4",
  terracotta: "#b4643f",
  "terracotta-ink": "#8a4a2a",
  sage: "#7f8f79",
  "sage-ink": "#55654f",
  white: "#ffffff",
  // The fill family added for this fix (src/styles/app.css).
  action: "#8a4a2a",
  "action-strong": "#6f3a20",
  "action-busy": "#9a5530",
  "on-action": "#fbf7f0",
  // The original product palette, still what /admin, /example and the print
  // sheets paint with — those routes sit outside `.app-surface`.
  brand: "#1e3a5f",
  paper: "#faf8f4",
};

function hex(value: string): RGB {
  const v = value.trim().replace(/^#/, "");
  const full =
    v.length === 3
      ? v
          .split("")
          .map((c) => c + c)
          .join("")
      : v;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${value}`);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** `fg` at `alpha` painted over an opaque `bg` — what the eye actually sees. */
function over(fg: string, alpha: number, bg: string): RGB {
  const f = hex(fg);
  const b = hex(bg);
  return {
    r: f.r * alpha + b.r * (1 - alpha),
    g: f.g * alpha + b.g * (1 - alpha),
    b: f.b * alpha + b.b * (1 - alpha),
  };
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(c: RGB): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

function ratio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const hexOf = (v: RGB) =>
  "#" +
  [v.r, v.g, v.b]
    .map((n) => Math.round(n).toString(16).padStart(2, "0"))
    .join("");

/**
 * One audited pair. `kind` decides the threshold:
 *   "text"    — normal-size text, needs 4.5:1
 *   "text-lg" — >= 24px regular or >= 18.66px bold, needs 3:1
 *   "graphic" — a rule, a dot, an icon, a focus ring: non-text, needs 3:1
 * `bgAlpha` composites the background over `backdrop` first.
 */
type Case = {
  name: string;
  /** Where in the codebase this pair is painted. */
  where: string;
  fg: string;
  fgAlpha?: number;
  bg: string;
  bgAlpha?: number;
  backdrop?: string;
  kind: "text" | "text-lg" | "graphic";
  /** A pair the design rules out: measured and printed, never counted. */
  reference?: boolean;
  /** A non-text mark that carries no meaning on its own: measured, not counted. */
  decorative?: boolean;
  /** What was done about it. */
  verdict: string;
};

const CASES: Case[] = [
  /* ---- the reference pair: what the fill token exists to prevent -------- */
  {
    name: "cream on the decorative terracotta as a fill",
    where: "--color-cream text on --color-terracotta — no call site paints this",
    fg: TOKENS.cream,
    bg: TOKENS.terracotta,
    kind: "text",
    reference: true,
    verdict: "FAILS AA (4.07 < 4.5) — the failure this fix is about; 0 call sites, guard enforces",
  },

  /* ---- filled action surfaces inside the app --------------------------- */
  {
    name: "action label on the action fill, at rest",
    where: "bg-action / bg-brand inside .app-surface (ui.tsx Button, checklist, people, settings)",
    fg: TOKENS["on-action"],
    bg: TOKENS.action,
    kind: "text",
    verdict: "PASS — unchanged",
  },
  {
    name: "action label on the action fill, hover (hover:bg-brand/90 over cream)",
    where: "ui.tsx Button primary, people.tsx, app.settings.tsx",
    fg: TOKENS["on-action"],
    bg: TOKENS.action,
    bgAlpha: 0.9,
    backdrop: TOKENS.cream,
    kind: "text",
    verdict: "PASS 5.10 — a 90% fill is lighter than its base but still clears AA; left alone",
  },
  {
    name: "action label on the busy fill (was bg-brand/60 = 2.72:1)",
    where: "app.settings.tsx logo upload, 'Working…'",
    fg: TOKENS["on-action"],
    bg: TOKENS["action-busy"],
    kind: "text",
    verdict: "CHANGED — bg-brand/60 over cream measured 2.72:1; now a solid #9a5530",
  },
  {
    name: "the old busy fill, for the record (bg-brand/60 over cream)",
    where: "app.settings.tsx before this fix",
    fg: TOKENS["on-action"],
    bg: TOKENS.action,
    bgAlpha: 0.6,
    backdrop: TOKENS.cream,
    kind: "text",
    reference: true,
    verdict: "FAILED AA (2.72 < 4.5) — this was the one real failure reachable in the app",
  },

  /* ---- the same buttons outside the app shell (navy, untouched) -------- */
  {
    name: "white on the navy brand fill (outside .app-surface)",
    where: "ui.tsx Button on /example, /admin, /budget-calculator, print sheets, payment-complete",
    fg: TOKENS.white,
    bg: TOKENS.brand,
    kind: "text",
    verdict: "PASS — untouched",
  },

  /* ---- the four chip tones: 10px uppercase labels ---------------------- */
  {
    name: "flight chip: terracotta ink on a 7% terracotta wash",
    where: "app-ui.tsx chipTones.flight",
    fg: TOKENS["terracotta-ink"],
    bg: TOKENS.terracotta,
    bgAlpha: 0.07,
    backdrop: TOKENS.cream,
    kind: "text",
    verdict: "PASS — a 7% wash barely moves the ground; left alone",
  },
  {
    name: "settled chip: sage ink on a 10% sage wash",
    where: "app-ui.tsx chipTones.settled",
    fg: TOKENS["sage-ink"],
    bg: TOKENS.sage,
    bgAlpha: 0.1,
    backdrop: TOKENS.cream,
    kind: "text",
    verdict: "PASS — untouched",
  },
  {
    name: "quiet chip: charcoal-soft on cream",
    where: "app-ui.tsx chipTones.quiet",
    fg: TOKENS["charcoal-soft"],
    bg: TOKENS.cream,
    kind: "text",
    verdict: "PASS — untouched",
  },
  {
    name: "attention chip: charcoal on deep cream",
    where: "app-ui.tsx chipTones.attention",
    fg: TOKENS.charcoal,
    bg: TOKENS["cream-deep"],
    kind: "text",
    verdict: "PASS — untouched",
  },
  {
    name: "help panel note: terracotta ink on a 6% terracotta wash",
    where: "help-assistant.tsx:180",
    fg: TOKENS["terracotta-ink"],
    bg: TOKENS.terracotta,
    bgAlpha: 0.06,
    backdrop: TOKENS.cream,
    kind: "text",
    verdict: "PASS — left alone",
  },
  {
    name: "registration badge: terracotta ink on an 8% terracotta wash",
    where: "registration.tsx:834",
    fg: TOKENS["terracotta-ink"],
    bg: TOKENS.terracotta,
    bgAlpha: 0.08,
    backdrop: TOKENS.cream,
    kind: "text",
    verdict: "PASS — left alone",
  },

  /* ---- decorative terracotta: rules, bars, dots, rings ----------------- */
  {
    name: "terracotta accent rule on cream",
    where: "16 aria-hidden 1-2px rules/bars (bg-terracotta, no text over them)",
    fg: TOKENS.terracotta,
    bg: TOKENS.cream,
    kind: "graphic",
    verdict: "DECORATIVE — 4.07 clears the 3:1 non-text bar; left alone",
  },
  {
    name: "terracotta focus ring on cream",
    where: "app.css :focus-visible outline",
    fg: TOKENS.terracotta,
    bg: TOKENS.cream,
    kind: "graphic",
    verdict: "GRAPHIC — left alone",
  },
  {
    name: "terracotta focus ring on the charcoal band",
    where: "app.css :focus-visible outline, index.tsx dark band",
    fg: TOKENS.terracotta,
    bg: TOKENS.charcoal,
    kind: "graphic",
    verdict: "GRAPHIC — left alone",
  },
  {
    name: "list bullet marker at 70% terracotta",
    where: "privacy.tsx / terms.tsx marker:text-terracotta/70",
    fg: TOKENS.terracotta,
    fgAlpha: 0.7,
    bg: TOKENS.cream,
    kind: "graphic",
    decorative: true,
    verdict: "DECORATIVE — a bullet is not required to understand the list; left alone",
  },
];

const threshold = (kind: Case["kind"]) => (kind === "text" ? 4.5 : 3);

let failed = 0;
console.log("\nConvocate — WCAG contrast audit (scripts/contrast-audit.ts)");
console.log("=".repeat(100));

for (const c of CASES) {
  const bg = c.bgAlpha !== undefined ? over(c.bg, c.bgAlpha, c.backdrop ?? TOKENS.cream) : hex(c.bg);
  const fg = c.fgAlpha !== undefined ? over(c.fg, c.fgAlpha, hexOf(bg)) : hex(c.fg);
  const r = Math.round(ratio(fg, bg) * 100) / 100;
  const need = threshold(c.kind);
  const pass = r >= need;
  if (!pass && !c.reference && !c.decorative) failed += 1;
  const tag = c.decorative
    ? pass
      ? "DECO ok"
      : "DECO low"
    : c.reference
      ? pass
        ? "REF ok"
        : "REF fail"
      : pass
        ? "PASS"
        : "FAIL";
  console.log(`\n${tag}  ${r.toFixed(2)}:1  (needs ${need}:1, ${c.kind})`);
  console.log(`  pair : ${hexOf(fg)} on ${hexOf(bg)}`);
  console.log(`  what : ${c.name}`);
  console.log(`  where: ${c.where}`);
  console.log(`  done : ${c.verdict}`);
}

console.log("\n" + "=".repeat(100));
console.log(`painted text pairs failing AA: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
