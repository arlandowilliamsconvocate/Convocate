/**
 * The one database client for the whole app.
 *
 * Everything that reads or writes a row goes through the `Db` facade this module
 * returns, which is a thin async skin over `@libsql/client`. There is no other
 * driver: local development and the live site run the same SQL through the same
 * client, so a statement that works here works there.
 *
 * Where the data lives is decided in exactly one place (see `chooseTarget`):
 *
 *   TURSO_DATABASE_URL + TURSO_AUTH_TOKEN set → that remote libSQL database.
 *     This is the live target. The live host keeps no disk between deploys, so a
 *     remote database is the only place a church's data survives a publish.
 *
 *   neither set → a local libSQL *file* at the path `data-dir.server.ts` already
 *     resolves (CONVOCATE_DATA_DIR / CONVOCATE_DB_PATH / <project>/.data). This
 *     is for local development and tests, and it behaves exactly like the old
 *     file database did — the same schema, the same rows, one client.
 *
 * One `[convocate]` line at boot says which target was chosen. It never prints
 * the auth token, only whether one is present.
 *
 * Failure is never fatal. A client call that cannot reach the target throws a
 * `DatabaseUnavailableError` within `CONVOCATE_DB_TIMEOUT_MS` (default 5s), logs
 * one `[convocate] ERROR` line and leaves the process running: read paths render
 * their normal "could not load" state and writes fail with a clear message.
 */
import {
  createClient,
  type Client,
  type InValue,
  type ResultSet,
  type Row,
  type Transaction,
} from "@libsql/client";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { dataLayout } from "./data-dir.server";

/** A value that can be bound to `?` in a statement. */
export type SqlValue = InValue;

/** What `run()` hands back — the same shape `bun:sqlite` gave, so callers are unchanged. */
export type RunResult = { changes: number; lastInsertRowid: number };

export type Statement<T = Row, A extends SqlValue[] = SqlValue[]> = {
  /** The first row, or null. */
  get(...args: A): Promise<T | null>;
  /** Every row. */
  all(...args: A): Promise<T[]>;
  /** Execute and report what changed (INSERT/UPDATE/DELETE). */
  run(...args: A): Promise<RunResult>;
};

/** One statement plus its arguments — what `Db.batch` takes. */
export type BatchStatement = { sql: string; args?: SqlValue[] };

export type Db = {
  /** Prepare-and-run in one step, the way `bun:sqlite`'s `db.query(sql)` read. */
  query<T = Row, A extends SqlValue[] = SqlValue[]>(sql: string): Statement<T, A>;
  /** Several statements at once (DDL, PRAGMAs). */
  exec(sql: string): Promise<void>;
  /** One statement, keeping the raw result set (rowsAffected, lastInsertRowid). */
  execute(sql: string, args?: SqlValue[]): Promise<ResultSet>;
  /**
   * Many parameterized statements in order, in one round trip.
   *
   * On a transaction handle this is part of that transaction — a batch that fails
   * takes the whole transaction with it. Outside a transaction the client runs
   * the batch in its own implicit transaction.
   */
  batch(statements: BatchStatement[]): Promise<RunResult[]>;
  /**
   * Runs `fn` inside a real write transaction. The callback is handed a `Db`
   * bound to that transaction: every statement it makes on that object commits
   * or rolls back together. Anything thrown rolls the whole thing back.
   */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
};

/** Thrown when the target cannot be reached (or does not answer in time). */
export class DatabaseUnavailableError extends Error {
  readonly code = "database_unavailable";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DatabaseUnavailableError";
  }
}

export const isDatabaseUnavailable = (cause: unknown): cause is DatabaseUnavailableError =>
  cause instanceof DatabaseUnavailableError;

export type DbTarget =
  | { kind: "remote"; url: string; describe: string }
  | { kind: "file"; url: string; path: string; describe: string };

const envText = (name: string): string => {
  const value = process.env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
};

/** How long one statement may take before it is treated as unreachable. */
export const DB_TIMEOUT_MS = (() => {
  const raw = Number(envText("CONVOCATE_DB_TIMEOUT_MS"));
  return Number.isFinite(raw) && raw >= 250 ? Math.trunc(raw) : 5000;
})();

/** The remote database name without credentials — safe to log. */
const describeRemote = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    // Not a URL we can parse: say nothing about it at all rather than risk
    // printing something with a token inside.
    return "(unparseable remote url)";
  }
};

/**
 * Which database this process talks to, in the order the owner set out:
 * credentials first, then the local file the data-dir resolution computed.
 *
 * Half a configuration is treated as a mistake, not as "remote": a URL with no
 * token (or a token with no URL) would fail on the first query, so we say so
 * loudly at boot and serve from the local file — the site stays up and the log
 * says exactly what to fix.
 */
const chooseTarget = (): DbTarget => {
  const url = envText("TURSO_DATABASE_URL");
  const token = envText("TURSO_AUTH_TOKEN");
  if (url && token) {
    return { kind: "remote", url, describe: `${describeRemote(url)} (TURSO_DATABASE_URL)` };
  }
  if (url || token) {
    const missing = url ? "TURSO_AUTH_TOKEN" : "TURSO_DATABASE_URL";
    console.error(
      `[convocate] ERROR: ${url ? "TURSO_DATABASE_URL is set" : "TURSO_AUTH_TOKEN is set"} but ${missing} is not, ` +
        `so the remote database is NOT in use. Serving the local file database instead. Set both and restart.`,
    );
  }
  const layout = dataLayout();
  const path = layout.dbPath;
  return { kind: "file", url: `file:${path}`, path, describe: `${path} (local file, no TURSO_DATABASE_URL)` };
};

const TARGET: DbTarget = chooseTarget();

console.log(
  TARGET.kind === "remote"
    ? `[convocate] database: remote libSQL ${TARGET.describe} (auth token: present)`
    : `[convocate] database: ${TARGET.describe}`,
);

export const databaseTarget = (): DbTarget => TARGET;

let clientInstance: Client | null = null;

/** The underlying client, created once. Cheap: it does not connect until used. */
export const dbClient = (): Client => {
  if (clientInstance) return clientInstance;
  if (TARGET.kind === "file") {
    // The local directory has to exist before the client opens the file.
    mkdirSync(dirname(TARGET.path), { recursive: true });
    clientInstance = createClient({ url: TARGET.url });
  } else {
    clientInstance = createClient({ url: TARGET.url, authToken: envText("TURSO_AUTH_TOKEN") });
  }
  return clientInstance;
};

/* --------------------------------------------------------------- health */

export type DatabaseHealth = {
  target: DbTarget["kind"];
  ok: boolean;
  lastError: string | null;
  lastErrorAt: number | null;
  lastOkAt: number | null;
};

const health: DatabaseHealth = {
  target: TARGET.kind,
  ok: true,
  lastError: null,
  lastErrorAt: null,
  lastOkAt: null,
};

/** What the last statement did — used by diagnostics and the storage probe. */
export const databaseHealth = (): DatabaseHealth => ({ ...health });

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);

// Errors that mean "the database is not there", as opposed to "this statement is
// wrong". Only the first kind is rewritten into a friendly message; a UNIQUE
// violation or a bad column must reach the caller exactly as SQLite reported it.
const looksLikeConnectionFailure = (cause: unknown): boolean => {
  const text = reasonOf(cause).toLowerCase();
  return (
    text.includes("fetch failed") ||
    text.includes("econnrefused") ||
    text.includes("enotfound") ||
    text.includes("etimedout") ||
    text.includes("network") ||
    text.includes("unable to connect") ||
    text.includes("url_invalid") ||
    text.includes("url_http") ||
    text.includes("not authorized") ||
    text.includes("unauthorized") ||
    text.includes("auth token") ||
    text.includes("401") ||
    text.includes("database_unavailable") ||
    text.includes("timed out")
  );
};

const friendly = (detail: string): string =>
  `The database is not reachable right now, so nothing was saved (${detail}). ` +
  `This is a problem on our side, not with what you entered — try again in a moment.`;

const markFailure = (cause: unknown): void => {
  health.ok = false;
  health.lastError = reasonOf(cause);
  health.lastErrorAt = Date.now();
  console.error(`[convocate] ERROR: database call failed — ${reasonOf(cause)}`);
};

const markOk = (): void => {
  health.ok = true;
  health.lastOkAt = Date.now();
};

/** Race a client call against the timeout, so a dead target cannot hang a request. */
const withTimeout = async <T>(work: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new DatabaseUnavailableError(
              friendly(`no answer within ${String(Math.round(DB_TIMEOUT_MS / 1000))}s from ${label}`),
            ),
          );
        }, DB_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const guarded = async <T>(label: string, work: () => Promise<T>): Promise<T> => {
  try {
    const result = await withTimeout(work(), label);
    markOk();
    return result;
  } catch (cause) {
    markFailure(cause);
    if (cause instanceof DatabaseUnavailableError) throw cause;
    if (looksLikeConnectionFailure(cause)) {
      throw new DatabaseUnavailableError(friendly(reasonOf(cause)), { cause });
    }
    throw cause;
  }
};

/* ------------------------------------------------------------- the facade */

type Executor = (sql: string, args?: SqlValue[]) => Promise<ResultSet>;

const runResult = (rs: ResultSet): RunResult => ({
  changes: Number(rs.rowsAffected ?? 0),
  lastInsertRowid: Number(rs.lastInsertRowid ?? 0),
});

/** One statement executor, dressed up in the bun-like surface the code already used. */
const makeDb = (
  execute: Executor,
  exec: (sql: string) => Promise<void>,
  batchStatements: (statements: BatchStatement[]) => Promise<ResultSet[]>,
  label: string,
): Db => {
  const facade: Db = {
    query<T = Row, A extends SqlValue[] = SqlValue[]>(sql: string): Statement<T, A> {
      return {
        get: async (...args: A) => {
          const rs = await execute(sql, args);
          return (rs.rows[0] as unknown as T) ?? null;
        },
        all: async (...args: A) => {
          const rs = await execute(sql, args);
          return rs.rows as unknown as T[];
        },
        run: async (...args: A) => runResult(await execute(sql, args)),
      };
    },
    exec,
    execute: (sql, args) => execute(sql, args),
    batch: async (statements) => (await batchStatements(statements)).map(runResult),
    transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return runTransaction(fn, label);
    },
  };
  return facade;
};

/**
 * A callback transaction over the client's interactive transactions.
 *
 * The callback gets its own `Db`, and every statement it makes on that object is
 * inside the transaction. A throw rolls the whole thing back; success commits and
 * the callback's value is returned.
 */
const runTransaction = async <T>(fn: (tx: Db) => Promise<T>, label: string): Promise<T> => {
  const tx: Transaction = await guarded(`${label} — begin transaction`, () =>
    dbClient().transaction("write"),
  );
  const txDb = makeDb(
    (sql, args) => tx.execute({ sql, args: args ?? [], rowMode: "object" }),
    async (sql) => {
      await tx.executeMultiple(sql);
    },
    (statements) =>
      tx.batch(statements.map((statement) => ({ sql: statement.sql, args: statement.args ?? [] }))),
    `${label} (in transaction)`,
  );
  try {
    const value = await fn(txDb);
    await tx.commit();
    return value;
  } catch (cause) {
    try {
      await tx.rollback();
    } catch {
      /* the transaction is already gone; the original error is the one to report */
    }
    throw cause;
  } finally {
    try {
      tx.close();
    } catch {
      /* closing twice is not an error we care about */
    }
  }
};

/**
 * Statements outside a transaction. `form` is passed because the facade's
 * transaction() has to route to the same client.
 */
const rootExecute: Executor = (sql, args) =>
  guarded("query", () => dbClient().execute({ sql, args: args ?? [], rowMode: "object" }));

const rootExec = (sql: string): Promise<void> =>
  guarded("exec", () => dbClient().executeMultiple(sql));

const rootBatchStatements = (statements: BatchStatement[]): Promise<ResultSet[]> =>
  guarded("batch", () =>
    dbClient().batch(statements.map((statement) => ({ sql: statement.sql, args: statement.args ?? [] }))),
  );

const ROOT = makeDb(rootExecute, rootExec, rootBatchStatements, "query");

/* ------------------------------------------------------------- boot hook */

/**
 * The schema has to exist before the first statement runs, and creating it is
 * async now. `db.server.ts` registers one boot function here (create the tables,
 * run the column migrations, import an existing local file into an empty remote,
 * seed the example). Every statement the app makes waits for it.
 *
 * A failed boot does not poison the process: the promise is cleared, so the next
 * request tries again — and if the database comes back, the site recovers on its
 * own without a restart.
 */
let bootHook: (() => Promise<void>) | null = null;
let bootPromise: Promise<void> | null = null;
let booted = false;

export const registerBootHook = (fn: () => Promise<void>): void => {
  bootHook = fn;
};

const ensureBoot = (): Promise<void> => {
  if (booted || !bootHook) return Promise.resolve();
  if (!bootPromise) {
    bootPromise = (async () => {
      await bootHook!();
      booted = true;
    })().catch((cause) => {
      bootPromise = null;
      throw cause;
    });
  }
  return bootPromise;
};

/** The facade every statement outside a boot step uses: schema guaranteed. */
export const getDb = (): Db => withBoot(ROOT);

/** The facade boot steps use themselves (creating the schema must not wait for it). */
export const rawDb = (): Db => ROOT;

/**
 * The same facade, but wrapped so the first statement of the process waits for
 * the schema. Once booted the wrapper is a pass-through.
 */
const withBoot = (db: Db): Db => {
  const wait = <T>(fn: () => Promise<T>): (() => Promise<T>) => async () => {
    await ensureBoot();
    return fn();
  };
  return {
    query<T = Row, A extends SqlValue[] = SqlValue[]>(sql: string): Statement<T, A> {
      const stmt = db.query<T, A>(sql);
      return {
        get: (...args: A) => wait(() => stmt.get(...args))(),
        all: (...args: A) => wait(() => stmt.all(...args))(),
        run: (...args: A) => wait(() => stmt.run(...args))(),
      };
    },
    exec: (sql: string) => wait(() => db.exec(sql))(),
    execute: (sql, args) => wait(() => db.execute(sql, args))(),
    batch: (statements) => wait(() => db.batch(statements))(),
    transaction: <T>(fn: (tx: Db) => Promise<T>) =>
      wait(() => db.transaction(async (tx) => fn(withBootlessTx(tx))))(),
  };
};

/** Inside a transaction the schema is already there: no boot hook to wait for. */
const withBootlessTx = (tx: Db): Db => tx;

/** True once the schema step has completed for this process. */
export const isBooted = (): boolean => booted;

/**
 * Wait until the schema step has finished.
 *
 * `getDb()` already waits; this is for the few paths that deliberately use
 * `rawDb()` (boot itself, and the admin token it prepares) and then need the
 * tables to exist before they run a statement.
 */
export const ensureSchema = (): Promise<void> => ensureBoot();

/* ------------------------------------------------- one-time local import */

/**
 * Tables whose rows a live remote database owns: the import leaves the remote's
 * own values (the admin token that the site and the backup job already use) and
 * only fills in keys the remote does not have yet.
 */
const REMOTE_OWNS_ROWS = new Set(["app_settings"]);

/** One foreign key the source schema declares: `from` in this table → `to` in `target`. */
type ForeignKey = { id: number; from: string; target: string; to: string };

/** A row that could not be copied because the row it points at does not exist. */
export type SkippedRow = {
  table: string;
  id: string | null;
  column: string;
  value: string;
  targetTable: string;
  targetColumn: string;
};

export type ImportReport = {
  ran: boolean;
  reason: string;
  source: string;
  tables: { table: string; rows: number }[];
  totalRows: number;
  /** Rows the local file holds whose foreign-key target is missing — never copied, always logged. */
  skipped: SkippedRow[];
};

/** Group `PRAGMA foreign_key_list` rows so a composite key is checked as one key. */
const groupForeignKeys = (rows: ForeignKey[]): ForeignKey[][] => {
  const groups = new Map<number, ForeignKey[]>();
  for (const row of rows) {
    const group = groups.get(row.id);
    if (group) group.push(row);
    else groups.set(row.id, [row]);
  }
  return [...groups.values()];
};

/**
 * Copy an existing local file database into an EMPTY remote one, once.
 *
 * Why: the day the live site is switched from its file database to Turso, the
 * only copy of the real data is `<project>/.data/convocate.db`, and the remote
 * database starts empty. This runs only when all three hold:
 *
 *   1. the target is remote (never touch a local file target),
 *   2. the remote has no users at all (a non-empty remote is never written to —
 *      that is what makes a second boot a no-op), and
 *   3. a local file database exists with at least one user in it.
 *
 * The local file is opened read-only and is never modified or deleted — it stays
 * the fallback copy until the owner decides otherwise. Every table is copied
 * inside one remote transaction with its ids intact, and each table's row count
 * is logged so the import can be checked against the source by eye.
 */
/** MD5 of a file in one pass — used to prove the import never wrote its source. */
const md5OfFile = async (path: string): Promise<string> => {
  const hash = createHash("md5");
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve());
  });
  return hash.digest("hex");
};

/**
 * Copy the source database (and any write-ahead log beside it) into a scratch
 * directory, returning the copy's path.
 *
 * The import opens the COPY, never the source: libSQL opens a `file:` database
 * read-write and may checkpoint its journal while it is open, which changes bytes
 * in the one file we must not touch. Copying first makes "the import only read
 * it" true by construction rather than by inspection.
 */
const snapshotSource = (source: string, into: string): string => {
  const copy = join(into, basename(source));
  copyFileSync(source, copy);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(`${source}${suffix}`)) copyFileSync(`${source}${suffix}`, `${copy}${suffix}`);
  }
  return copy;
};

/**
 * Copy an existing local file database into an EMPTY remote one, once.
 *
 * Why: the day the live site is switched from its file database to Turso, the
 * only copy of the real data is `<project>/.data/convocate.db`, and the remote
 * database starts empty. This runs only when all three hold:
 *
 *   1. the target is remote (never touch a local file target),
 *   2. the remote has no users at all (a non-empty remote is never written to —
 *      that is what makes a second boot a no-op), and
 *   3. a local file database exists with at least one user in it.
 *
 * The source file is never opened directly: it is copied to a scratch directory
 * first and the copy is what gets read, so its bytes cannot change. Every table
 * is copied inside ONE remote transaction with its ids intact, inserts go out as
 * batches per table, and before that transaction commits each table's remote row
 * count is compared with the local count — a mismatch throws, which rolls the
 * whole transaction back and leaves the remote exactly as it was.
 */
export const importLocalDatabaseIfEmpty = async (
  remote: Db,
  localPath: string,
): Promise<ImportReport> => {
  const none: ImportReport = {
    ran: false,
    reason: "",
    source: localPath,
    tables: [],
    totalRows: 0,
    skipped: [],
  };
  if (TARGET.kind !== "remote") {
    return { ...none, reason: "target is a local file database — nothing to import" };
  }
  if (!existsSync(localPath)) {
    return { ...none, reason: `no local database at ${localPath}` };
  }
  // Guard first and cheaply: a remote with any user in it is never written to,
  // which is what makes a second boot a no-op (no copy, no read, no write).
  const existing = await remote.execute("SELECT COUNT(*) AS n FROM users");
  const remoteUsers = Number((existing.rows[0] as { n?: unknown }).n ?? 0);
  if (remoteUsers > 0) {
    return { ...none, reason: `remote already has ${String(remoteUsers)} user(s) — not importing` };
  }
  const sourceMd5 = await md5OfFile(localPath);
  const scratch = mkdtempSync(join(tmpdir(), "convocate-import-"));
  const copyPath = snapshotSource(localPath, scratch);
  const local = createClient({ url: `file:${copyPath}`, intMode: "number" });
  try {
    const localUsersResult = await local.execute("SELECT COUNT(*) AS n FROM users");
    const localUsers = Number((localUsersResult.rows[0] as { n?: unknown }).n ?? 0);
    if (localUsers === 0) {
      return { ...none, reason: "the local database has no users — nothing to import" };
    }

    // Which tables exist locally, parents before children so foreign keys (when
    // they are enforced) are satisfied at every step.
    const order = [
      "schema_migrations",
      "app_settings",
      "users",
      "sessions",
      "conferences",
      "conference_members",
      "conference_invites",
      "budget_items",
      "contracts",
      "contract_documents",
      "conference_payments",
      "backup_log",
    ];
    const listed = await local.execute(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    );
    const present = new Set(listed.rows.map((row) => String((row as { name: unknown }).name)));
    // A table the remote schema does not have cannot be copied into it. The local
    // file still carries tables an old build created and a migration retired —
    // `speakers`, whose rows were widened into `contracts` — so those are
    // reported and skipped rather than failing the whole import.
    const remoteTables = await remote.execute(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    );
    const onRemote = new Set(remoteTables.rows.map((row) => String((row as { name: unknown }).name)));
    const localOrder = [
      ...order.filter((name) => present.has(name)),
      ...[...present].filter((name) => !order.includes(name)).sort(),
    ];
    for (const name of localOrder.filter((name) => !onRemote.has(name))) {
      console.log(
        `[convocate] import: skipping ${name} — the local file has this table but the remote schema does not (retired table)`,
      );
    }
    const tables = localOrder.filter((name) => onRemote.has(name));

    console.log(
      `[convocate] importing ${String(localUsers)} user(s) from the local database ${localPath} into the empty remote database ` +
        `(source md5 ${sourceMd5}, read through the snapshot ${copyPath})`,
    );

    // The local file is the source of truth for this one-time cutover, with one
    // exception: a row whose parent record is already gone (the file keeps rows a
    // deleted conference orphaned) is unreachable in the app and cannot be copied
    // into a database that enforces foreign keys — so it is skipped and logged,
    // never silently dropped and never allowed to fail the whole import.
    await remote.execute("PRAGMA foreign_keys = OFF");
    const copied: { table: string; rows: number }[] = [];
    const skipped: SkippedRow[] = [];
    let totalRows = 0;

    // Foreign keys declared by the SOURCE schema, read from the snapshot, plus a
    // cache of each target column's values. These sets are what decide whether a
    // row can be copied: a row whose parent is missing from the local file is
    // unreachable in the app and would abort the whole copy, so it is left behind
    // (loudly) instead of being allowed to sink the import.
    const foreignKeysOf = async (table: string): Promise<ForeignKey[]> => {
      const listed = await local.execute(`PRAGMA foreign_key_list("${table}")`);
      return listed.rows.map((row) => {
        const fields = row as Record<string, unknown>;
        return {
          id: Number(fields.id ?? 0),
          from: String(fields.from),
          target: String(fields.table),
          to: String(fields.to ?? "id"),
        };
      });
    };
    const targetValues = new Map<string, Set<string>>();
    const valuesInColumn = async (table: string, column: string): Promise<Set<string>> => {
      const key = `${table}.${column}`;
      const cached = targetValues.get(key);
      if (cached) return cached;
      const rs = await local.execute(`SELECT "${column}" AS v FROM "${table}"`);
      const values = new Set(rs.rows.map((row) => String((row as unknown as { v: unknown }).v)));
      targetValues.set(key, values);
      return values;
    };

    await remote.transaction(async (tx) => {
      // Hold foreign-key checks until commit if this target honors SQLite's
      // `defer_foreign_keys`. It is read straight back: a target that ignores the
      // pragma says so in the log, and the per-row check below is what actually
      // keeps the copy honest either way.
      await tx.execute("PRAGMA defer_foreign_keys = ON");
      const deferProbe = await tx.execute("PRAGMA defer_foreign_keys");
      const deferValue = String(Object.values((deferProbe.rows[0] ?? {}) as Record<string, unknown>)[0] ?? "");
      console.log(
        deferValue === "1"
          ? "[convocate] import: PRAGMA defer_foreign_keys=ON is honored — foreign-key checks deferred to commit"
          : `[convocate] import: PRAGMA defer_foreign_keys=ON was NOT honored by this target (reads back "${deferValue}") — relying on the per-row foreign-key check`,
      );

      for (const table of tables) {
        const columnsResult = await local.execute(`PRAGMA table_info(${table})`);
        const columns = columnsResult.rows.map((row) => String((row as unknown as { name: unknown }).name));
        if (columns.length === 0) continue;
        const rowsResult = await local.execute(
          `SELECT ${columns.map((c) => `"${c}"`).join(", ")} FROM ${table}`,
        );
        const rows = rowsResult.rows as Record<string, SqlValue>[];

        // Every foreign key this table declares on a target the local file has,
        // resolved against the local snapshot before the rows are touched.
        const keys: { group: ForeignKey[]; values: Set<string>[] }[] = [];
        for (const group of groupForeignKeys(await foreignKeysOf(table))) {
          if (!group.every((fk) => present.has(fk.target))) continue;
          keys.push({
            group,
            values: await Promise.all(group.map((fk) => valuesInColumn(fk.target, fk.to))),
          });
        }
        const kept: Record<string, SqlValue>[] = [];
        for (const row of rows) {
          let broken: SkippedRow | null = null;
          for (const { group, values } of keys) {
            // A NULL in any column means "no reference", exactly as SQLite reads it.
            if (group.some((fk) => row[fk.from] === null || row[fk.from] === undefined)) continue;
            const missing = group.findIndex((fk, index) => !values[index].has(String(row[fk.from])));
            if (missing !== -1) {
              const fk = group[missing];
              broken = {
                table,
                id: row.id === undefined || row.id === null ? null : String(row.id),
                column: fk.from,
                value: String(row[fk.from]),
                targetTable: fk.target,
                targetColumn: fk.to,
              };
              break;
            }
          }
          if (broken) {
            skipped.push(broken);
            console.log(
              `[convocate] import: SKIPPED ${broken.table} row id=${broken.id ?? "(no id)"} — ` +
                `${broken.column}=${broken.value} has no row in ${broken.targetTable}(${broken.targetColumn}). ` +
                `The row exists in the local file and is unreachable in the app, so it was not copied.`,
            );
            continue;
          }
          kept.push(row);
        }
        if (rows.length > 0 && kept.length < rows.length) {
          console.log(
            `[convocate] import: ${table} — ${String(kept.length)} of ${String(rows.length)} row(s) copied, ` +
              `${String(rows.length - kept.length)} skipped for a missing foreign-key target`,
          );
        }
        // The remote is the empty side, so its rows for this table make way for
        // the local ones and the remote ends up exactly as the local file is.
        // `app_settings` is the exception: the live database's own settings (its
        // admin token) stay, and a local row is added only when its key is free.
        const remoteOwnsRows = REMOTE_OWNS_ROWS.has(table);
        if (!remoteOwnsRows) await tx.execute(`DELETE FROM ${table}`);
        if (kept.length === 0) {
          copied.push({ table, rows: 0 });
          continue;
        }
        const quoted = columns.map((c) => `"${c}"`).join(", ");
        const sql =
          `INSERT ${remoteOwnsRows ? "OR IGNORE " : ""}INTO ${table} (${quoted}) ` +
          `VALUES (${columns.map(() => "?").join(", ")})`;
        // Batches of 500 keep the statement list (and the remote round trip) sane.
        for (let i = 0; i < kept.length; i += 500) {
          const chunk = kept.slice(i, i + 500);
          await tx.batch(
            chunk.map((row) => ({
              sql,
              args: columns.map((column) => row[column] ?? null),
            })),
          );
        }
        copied.push({ table, rows: kept.length });
        totalRows += kept.length;
        console.log(`[convocate] imported ${table}: ${String(kept.length)} row(s)`);
      }

      // Check every table against the source before committing. A shortfall
      // throws here, the transaction rolls back, and the remote keeps its old
      // (empty) state — never a half-populated one.
      const mismatches: string[] = [];
      for (const { table, rows } of copied) {
        const counted = await tx.execute(`SELECT COUNT(*) AS n FROM ${table}`);
        const seen = Number((counted.rows[0] as { n?: unknown }).n ?? -1);
        if (seen !== rows) mismatches.push(`${table}: local ${String(rows)}, imported ${String(seen)}`);
      }
      if (mismatches.length > 0) {
        throw new Error(`imported row counts do not match the local database (${mismatches.join("; ")})`);
      }
      console.log(
        `[convocate] import verified before commit: all ${String(copied.length)} table(s) hold exactly the row counts copied ` +
          `(the local counts less any row listed as SKIPPED above)`,
      );
    });
    await remote.execute("PRAGMA foreign_keys = ON");
    if (skipped.length > 0) {
      console.log(
        `[convocate] import: ${String(skipped.length)} unreachable row(s) left behind — ` +
          skipped.map((s) => `${s.table}#${s.id ?? "?"} (${s.column}=${s.value} → ${s.targetTable})`).join(", "),
      );
    }
    console.log(
      `[convocate] import complete: ${String(copied.length)} table(s), ${String(totalRows)} row(s) total, ` +
        `${String(skipped.length)} row(s) skipped. The local database was left untouched at ${localPath}`,
    );
    return { ran: true, reason: "imported", source: localPath, tables: copied, totalRows, skipped };
  } finally {
    local.close();
    try {
      const afterMd5 = await md5OfFile(localPath);
      console.log(
        afterMd5 === sourceMd5
          ? `[convocate] import source check: ${localPath} md5 ${sourceMd5} before and after — unchanged, it was only read`
          : `[convocate] ERROR: the import source ${localPath} changed while importing (md5 ${sourceMd5} → ${afterMd5})`,
      );
    } catch (cause) {
      console.error(`[convocate] ERROR: could not re-read the import source ${localPath}`, cause);
    }
    rmSync(scratch, { recursive: true, force: true });
  }
};

export { dataLayout };
