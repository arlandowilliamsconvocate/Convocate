/** Money helpers. Storage is always integer cents; the UI speaks whole units. */

/**
 * Shown in place of every figure a committee Viewer is not given. The server
 * withholds money from viewers entirely (see `moneyVisibleTo` in db.server.ts),
 * so `null` here means "withheld", never "missing" — the placeholder says so.
 */
export const HIDDEN_MONEY = "Hidden";

/** Longer copy for the summary tiles, where there is room to explain. */
export const HIDDEN_MONEY_NOTE = "Hidden from view-only access";

export const formatMoney = (cents: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(cents) % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

/** A figure, or the placeholder when the server withheld it from this reader. */
export const formatMoneyOrHidden = (cents: number | null | undefined): string =>
  cents === null || cents === undefined ? HIDDEN_MONEY : formatMoney(cents);

/**
 * Sum of amounts that may have been withheld. `null` if any reader-visible
 * input is withheld, so a viewer cannot infer a total from the parts — and a
 * partial total is never shown as if it were the whole.
 */
export const sumMoney = (amounts: (number | null | undefined)[]): number | null =>
  amounts.some((amount) => amount === null || amount === undefined)
    ? null
    : amounts.reduce<number>((sum, amount) => sum + (amount || 0), 0);

/** Parses a human-entered amount ("1,200", "1200.50") into integer cents. */
export const toCents = (value: string): number => {
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
};

/**
 * A strict parse of a typed amount, for the forms that must never guess.
 *
 * `toCents` above is deliberately forgiving and turns anything it cannot read
 * into 0 — fine for a value that already came out of the database, wrong for a
 * figure someone just typed: "twelve thousand" would silently become a budget
 * of nothing. This returns either whole cents or the reason it refused, so the
 * form can say which field is wrong and the server can refuse the same value.
 *
 * Accepted: empty (means 0), "45000", "45,000", "45000.50", "45000." — a leading
 * currency symbol is allowed because people paste it. Anything else — letters,
 * a second decimal point, a negative, more precision than cents — is refused.
 */
export const parseMoneyInput = (
  value: string,
): { cents: number } | { error: string } => {
  const raw = value.trim().replace(/^[$£€]\s?/, "").replace(/,/g, "");
  if (raw === "") return { cents: 0 };
  if (!/^\d+(\.\d{0,2})?$/.test(raw)) {
    return {
      error: "Enter an amount in numbers only, to two decimals at most — for example 45000 or 12000.50.",
    };
  }
  const cents = Math.round(Number.parseFloat(raw) * 100);
  if (!Number.isSafeInteger(cents)) return { error: "That amount is too large to store." };
  return { cents };
};

/**
 * Cents back to an editable whole-unit string ("12000" from 1200000). A
 * withheld amount (null) becomes an empty field: only editors open these forms,
 * and they always receive numbers.
 */
export const toUnitsInput = (cents: number | null | undefined): string => {
  if (cents === null || cents === undefined) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
};

export const formatDate = (iso: string): string => {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export const formatDateRange = (start: string, end: string): string => {
  if (!start && !end) return "Dates not set";
  if (start && !end) return formatDate(start);
  if (!start && end) return formatDate(end);
  if (start === end) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
};
