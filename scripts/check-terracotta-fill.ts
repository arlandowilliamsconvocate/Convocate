/**
 * Guard: the decorative terracotta may never sit behind a text label.
 *
 * `--color-terracotta` (#b4643f) is 4.07:1 on cream. That clears WCAG's 3:1
 * bar for a non-text graphic — a rule, a bar, a dot, the focus ring — and
 * misses the 4.5:1 bar for text. The palette is pinned, so the fix is not to
 * darken the accent; it is to keep the accent off any surface that carries a
 * label and paint those with `--color-action` (#8a4a2a, 6.36:1) instead.
 *
 * A comment saying so rots the first time someone copies a class name. This
 * runs in `bun run build`, so a solid `bg-terracotta` on an element with text
 * fails the build instead of shipping.
 *
 * A `bg-terracotta` is accepted when the JSX tag that paints it is decorative:
 *   - the tag carries `aria-hidden="true"` (an accent rule beside a heading), or
 *   - the tag is self-closing (`<span ... />`), so no children — and therefore
 *     no text — can sit on top of it.
 * The check reads the whole opening tag, not the line, because a long className
 * in this codebase wraps across lines.
 *
 * A translucent wash (`bg-terracotta/[0.07]`) is not the same colour once
 * composited, and is measured by `scripts/contrast-audit.ts` instead.
 *
 * Run: `bun scripts/check-terracotta-fill.ts` (exit 1 on a violation).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

/** `bg-terracotta` but not `bg-terracotta-ink`, `bg-terracotta/[0.07]` or `bg-[...]`. */
const SOLID = /(?<![\w-])bg-terracotta(?![\w\-/[])/g;
/** A CSS rule painting the decorative accent as a background. */
const CSS_FILL = /background(-color)?\s*:[^;]*var\(--color-terracotta\)/;

type Hit = {
  file: string;
  line: number;
  className: string;
  decorative: boolean;
  why: string;
};

/** The whole opening tag that contains `at`, or "" if it is not inside JSX. */
function tagAt(source: string, at: number): string {
  let start = -1;
  for (let i = at; i >= 0; i--) {
    if (source[i] === ">") return ""; // we are past a tag boundary: not in a tag
    if (source[i] === "<" && /[A-Za-z]/.test(source[i + 1] ?? "")) {
      start = i;
      break;
    }
  }
  if (start < 0) return "";
  const end = source.indexOf(">", at);
  return end < 0 ? "" : source.slice(start, end + 1);
}

const hits: Hit[] = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  const source = readFileSync(file, "utf8");

  if (file.endsWith(".css")) {
    source.split("\n").forEach((text, i) => {
      if (CSS_FILL.test(text)) {
        hits.push({ file: rel, line: i + 1, className: text.trim(), decorative: false, why: "CSS background" });
      }
    });
    continue;
  }

  for (const match of source.matchAll(SOLID)) {
    const at = match.index ?? 0;
    const tag = tagAt(source, at);
    const ariaHidden = /aria-hidden=("|')?true/.test(tag);
    const selfClosing = tag.trimEnd().endsWith("/>");
    hits.push({
      file: rel,
      line: source.slice(0, at).split("\n").length,
      className: (source.slice(at, at + 60).split("\n")[0] ?? "").trim(),
      decorative: Boolean(tag) && (ariaHidden || selfClosing),
      why: !tag
        ? "CARRIES TEXT (not a JSX tag — check by hand)"
        : ariaHidden
          ? 'aria-hidden="true"'
          : selfClosing
            ? "self-closing, no children"
            : "CARRIES TEXT",
    });
  }
}

const violations = hits.filter((h) => !h.decorative);

console.log(`\nSolid \`bg-terracotta\` occurrences: ${hits.length}`);
for (const h of hits) {
  console.log(`  ${h.decorative ? "ok  " : "FAIL"}  ${h.file}:${h.line}  (${h.why})`);
}

if (violations.length > 0) {
  console.error(
    [
      "",
      "FAIL: a solid `bg-terracotta` is painted on an element that can carry text.",
      "  #b4643f is 4.07:1 on cream — below the 4.5:1 AA floor for a label.",
      "  Paint the fill with `bg-action` (#8a4a2a, 6.36:1) and its label with",
      "  `text-on-action`. Use `bg-terracotta` only on a decorative element:",
      '  add aria-hidden="true" or make it self-closing with no children.',
      "",
    ].join("\n"),
  );
  for (const v of violations) console.error(`  ${v.file}:${v.line}\n    ${v.className}\n`);
  process.exit(1);
}

console.log("OK — every solid terracotta fill is decorative.\n");
