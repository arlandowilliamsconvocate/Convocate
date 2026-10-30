import type { ReactNode } from "react";

/**
 * A very small Markdown renderer — the subset the lead-magnet guides are written
 * in, and nothing else.
 *
 * Why not a library: the task these pages were built for says no dependency may
 * be added, and the guides are our own copy in a known format. So this renders
 * exactly what they use — `#`/`##`/`###` headings, paragraphs, `---` rules,
 * bullet and numbered lists, `- [ ]` checklist items, `>` blockquotes, pipe
 * tables with a `---` delimiter row, and inline `**bold**`, `*italic*`,
 * `` `code` `` and `[text](url)`.
 *
 * What it deliberately does NOT do: raw HTML (it would be rendered as text, so
 * a stray tag can never become markup), images, footnotes, or nested lists.
 * Text is returned as React nodes, so React escapes it on the way out.
 *
 * The content is our own published copy, never a reader's input. Even so, the
 * link target is checked before it becomes an `href`: only http(s) and
 * site-relative paths survive, so a `javascript:` link could not be published
 * by accident later.
 */

/* --------------------------------------------------------------- inline */

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

/** A link target we are willing to put in an `href`. Anything else is dropped. */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href.startsWith("/") || href.startsWith("#")) return href;
  if (/^https?:\/\//i.test(href)) return href;
  return null;
}

/** Bold, italic, code and links inside one line of text. */
export function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const token = match[0];
    const key = `${keyPrefix}-i${String(index++)}`;
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-ink">
          {inline(token.slice(2, -2), key)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-paper-deep px-1 py-0.5 text-[0.92em] text-ink">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      nodes.push(
        href === null ? (
          <span key={key}>{label}</span>
        ) : (
          <a
            key={key}
            href={href}
            className="font-medium text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
          >
            {inline(label, key)}
          </a>
        ),
      );
    } else {
      nodes.push(
        <em key={key} className="italic">
          {inline(token.slice(1, -1), key)}
        </em>,
      );
    }
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/* ---------------------------------------------------------------- blocks */

const isRule = (line: string): boolean => /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
const isHeading = (line: string): boolean => /^ {0,3}(#{1,6})\s+/.test(line);
const isBullet = (line: string): boolean => /^ {0,3}[-*]\s+/.test(line);
const isOrdered = (line: string): boolean => /^ {0,3}\d+[.)]\s+/.test(line);
const isQuote = (line: string): boolean => /^ {0,3}>\s?/.test(line);
const isTableRow = (line: string): boolean => /^ {0,3}\|.*\|\s*$/.test(line);
const isTableDelimiter = (line: string): boolean =>
  /^ {0,3}\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(line);

/** The cells of one pipe-table row, without the outer pipes. */
function cells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

const headingClass = (level: number): string =>
  level <= 2
    ? "mt-12 font-serif text-2xl leading-snug text-ink"
    : "mt-9 font-serif text-xl leading-snug text-ink";

const paragraphClass = "mt-4 text-base leading-relaxed text-ink-soft";

/**
 * Render a block of Markdown as React nodes.
 *
 * `skipFirstHeading` drops the document's own `# Title`: the page already has
 * its H1, taken from the approved opt-in copy, and two H1s on one page would be
 * a lie about the structure.
 */
export function renderMarkdown(source: string, skipFirstHeading = true): ReactNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let droppedHeading = !skipFirstHeading;
  let i = 0;
  const key = (): string => `b${String(blocks.length)}`;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (isRule(line)) {
      blocks.push(<hr key={key()} className="mt-10 border-line" />);
      i += 1;
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      i += 1;
      if (level === 1 && !droppedHeading) {
        droppedHeading = true;
        continue;
      }
      const Tag = (level <= 2 ? "h2" : "h3") as "h2" | "h3";
      blocks.push(
        <Tag key={key()} className={headingClass(level)}>
          {inline(text, key())}
        </Tag>,
      );
      continue;
    }

    // A pipe table: a header row, a `---` delimiter row, then body rows.
    if (isTableRow(line) && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        body.push(cells(lines[i]));
        i += 1;
      }
      const tableKey = key();
      /**
       * A column that is empty in every row is a fill-in column — the notes and
       * worksheet tables in the guides are written that way. Left to itself an
       * auto-width table gives such a column the minimum width it can, so a reader
       * who prints the page gets a sliver to write in. The blank columns together
       * are given half the table (split evenly if there is more than one), which
       * is what the author meant by leaving them blank, and leaves the rest for
       * the labels. An inline width is used rather than a class because the share
       * depends on how many columns are blank.
       */
      const blankColumn = head.map((_, column) =>
        body.every((row) => (row[column] ?? "").trim() === ""),
      );
      const blankCount = blankColumn.filter(Boolean).length;
      const labelledCount = head.length - blankCount;
      const columnStyle = (column: number): { width?: string } => {
        if (blankColumn[column] !== true || labelledCount === 0) return {};
        return { width: `${String(Math.floor(50 / blankCount))}%` };
      };
      blocks.push(
        <div key={tableKey} className="mt-6 overflow-x-auto rounded-lg border border-line">
          <table
            className="w-full min-w-[36rem] border-collapse text-left text-sm"
            data-fill-in={blankCount > 0 ? "" : undefined}
          >
            <thead className="bg-paper-deep/70">
              <tr>
                {head.map((cell, column) => (
                  <th
                    key={`${tableKey}-h${String(column)}`}
                    scope="col"
                    style={columnStyle(column)}
                    className="border-b border-line px-3 py-2 align-bottom font-semibold text-ink"
                  >
                    {inline(cell, `${tableKey}-h${String(column)}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={`${tableKey}-r${String(rowIndex)}`} className="align-top">
                  {head.map((_, column) => (
                    <td
                      key={`${tableKey}-r${String(rowIndex)}c${String(column)}`}
                      style={columnStyle(column)}
                      className="border-b border-line/70 px-3 py-2 text-ink-soft last:border-r-0"
                    >
                      {inline(row[column] ?? "", `${tableKey}-r${String(rowIndex)}c${String(column)}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // A blockquote: strip the markers, then render what is inside as blocks of
    // its own, so the numbered list in the venue email keeps its numbers.
    if (isQuote(line)) {
      const quoted: string[] = [];
      while (i < lines.length && isQuote(lines[i])) {
        quoted.push(lines[i].replace(/^ {0,3}>\s?/, ""));
        i += 1;
      }
      const quoteKey = key();
      blocks.push(
        <blockquote
          key={quoteKey}
          className="mt-6 rounded-r-lg border-l-2 border-brand/40 bg-paper-deep/40 px-5 py-1"
        >
          {renderMarkdown(quoted.join("\n"), false)}
        </blockquote>,
      );
      continue;
    }

    if (isBullet(line)) {
      const items: string[] = [];
      while (i < lines.length && isBullet(lines[i])) {
        items.push(lines[i].replace(/^ {0,3}[-*]\s+/, ""));
        i += 1;
      }
      const listKey = key();
      blocks.push(
        <ul key={listKey} className="mt-4 space-y-2 pl-1 text-base leading-relaxed text-ink-soft">
          {items.map((item, itemIndex) => {
            const itemKey = `${listKey}-l${String(itemIndex)}`;
            const check = /^\[( |x|X)\]\s*(.*)$/.exec(item);
            if (check) {
              return (
                <li key={itemKey} className="flex gap-2.5">
                  <span aria-hidden="true" className="mt-[0.35em] shrink-0 text-ink-soft/70">
                    {check[1].trim() === "" ? "□" : "☑"}
                  </span>
                  <span>{inline(check[2], itemKey)}</span>
                </li>
              );
            }
            return (
              <li key={itemKey} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-brand/50" />
                <span>{inline(item, itemKey)}</span>
              </li>
            );
          })}
        </ul>,
      );
      continue;
    }

    if (isOrdered(line)) {
      const items: string[] = [];
      while (i < lines.length && isOrdered(lines[i])) {
        items.push(lines[i].replace(/^ {0,3}\d+[.)]\s+/, ""));
        i += 1;
      }
      const listKey = key();
      blocks.push(
        <ol key={listKey} className="mt-4 list-decimal space-y-2 pl-6 text-base leading-relaxed text-ink-soft">
          {items.map((item, itemIndex) => (
            <li key={`${listKey}-o${String(itemIndex)}`}>
              {inline(item, `${listKey}-o${String(itemIndex)}`)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // A paragraph: consecutive non-blank lines that are not any other block.
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isRule(lines[i]) &&
      !isHeading(lines[i]) &&
      !isBullet(lines[i]) &&
      !isOrdered(lines[i]) &&
      !isQuote(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    // A single line wrapped in asterisks is the guides' aside line (a note in
    // italics), so it keeps that shape instead of becoming a paragraph of prose.
    const joined = paragraph.join(" ");
    const aside = /^\*([^*].*)\*$/.exec(joined);
    if (aside && paragraph.length === 1) {
      blocks.push(
        <p key={key()} className="mt-5 text-sm italic leading-relaxed text-ink-soft">
          {inline(aside[1], key())}
        </p>,
      );
      continue;
    }
    blocks.push(
      <p key={key()} className={paragraphClass}>
        {inline(joined, key())}
      </p>,
    );
  }

  return blocks;
}
