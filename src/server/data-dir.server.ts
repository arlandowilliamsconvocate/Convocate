/**
 * Where Convocate keeps its data — one directory, resolved once, before serving.
 *
 * The problem this solves: the project directory is NOT a safe place for a live
 * database. A publish rebuilds the project from the team's working tree, so
 * `<project>/.data/` comes back as whatever the working tree held — i.e. the next
 * publish silently replaces everything a church has entered on the live site.
 * The fix is to let the data live somewhere the publish does not touch, chosen by
 * an environment variable, and to migrate the existing database into it the first
 * time the site boots with that variable set.
 *
 * Resolution, in this order:
 *
 *   1. `CONVOCATE_DATA_DIR` — the new single setting. The database, `uploads/` and
 *      `backups/` all sit under it.
 *   2. The per-path overrides that already existed, so tests and scripts keep
 *      working unchanged: `CONVOCATE_DB_PATH`, `CONVOCATE_UPLOADS_DIR`,
 *      `CONVOCATE_BACKUPS_DIR`. They apply only when `CONVOCATE_DATA_DIR` is NOT
 *      set — a set `CONVOCATE_DATA_DIR` wins outright and ignores them (with a
 *      warning), so one conference's files can never be split across two roots.
 *   3. Today's default: `<project>/.data/` (database, `uploads/`, `backups/`).
 *
 * Two safety rules that must never be relaxed:
 *
 *   - If the configured directory cannot be created or written, the site does
 *     NOT crash and does NOT serve nothing: it falls back to `<project>/.data/`
 *     and logs a loud error. A typo in a setting must never take the site down.
 *   - Migration only ever COPIES. The original `<project>/.data/convocate.db` is
 *     left exactly where it was, so a bad first boot cannot destroy the only copy.
 */
import { Database } from "bun:sqlite";
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SITE_MARKERS = ["site.json", "SITE.md"];
const FALLBACK_SITE_ROOT = "/home/team/shared/site";

/** The project checkout: the directory holding `site.json`. */
const findSiteRoot = (): string => {
  const starts = [process.cwd(), import.meta.dir];
  for (const start of starts) {
    let dir = start;
    for (let hop = 0; hop < 8; hop += 1) {
      if (SITE_MARKERS.some((marker) => existsSync(join(dir, marker)))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return existsSync(FALLBACK_SITE_ROOT) ? FALLBACK_SITE_ROOT : process.cwd();
};

const SITE_ROOT = findSiteRoot();
export const siteRoot = (): string => SITE_ROOT;

/** Today's default root — inside the project, so it is lost on every publish. */
export const DEFAULT_DATA_DIR = join(SITE_ROOT, ".data");
const DEFAULT_DB_PATH = join(DEFAULT_DATA_DIR, "convocate.db");
const DEFAULT_UPLOADS_DIR = join(DEFAULT_DATA_DIR, "uploads");

const envText = (name: string): string => {
  const value = process.env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
};

export const DATA_DIR_ENV = "CONVOCATE_DATA_DIR";
export const DB_PATH_ENV = "CONVOCATE_DB_PATH";
export const UPLOADS_DIR_ENV = "CONVOCATE_UPLOADS_DIR";
export const BACKUPS_DIR_ENV = "CONVOCATE_BACKUPS_DIR";

export type DataLayout = {
  /** The root everything else sits under. */
  dataDir: string;
  dbPath: string;
  uploadsDir: string;
  backupsDir: string;
  /** 'data_dir' = CONVOCATE_DATA_DIR, 'per_path' = a CONVOCATE_*_PATH override, 'default' = <project>/.data. */
  source: "data_dir" | "per_path" | "default";
  /** The directory the environment asked for, before any fallback. */
  requestedDir: string | null;
  /** Set when the requested directory was unusable and we served from `.data` instead. */
  fallbackFrom: string | null;
  fallbackReason: string | null;
  /** True when this boot copied `.data` into the configured directory. */
  migrated: boolean;
  migratedFrom: string | null;
};

const layoutFor = (requested: string | null): Omit<
  DataLayout,
  "migrated" | "migratedFrom" | "fallbackFrom" | "fallbackReason"
> => {
  const dbOverride = envText(DB_PATH_ENV);
  const uploadsOverride = envText(UPLOADS_DIR_ENV);
  const backupsOverride = envText(BACKUPS_DIR_ENV);
  if (requested) {
    // CONVOCATE_DATA_DIR wins outright: when it is set, the database, uploads and
    // snapshots all sit under it and a leftover per-path override is IGNORED, not
    // merged. Merging would split one conference's files across two roots — the
    // database in one place, the attachments it points at in another — which is
    // exactly the kind of half-moved state this setting exists to prevent.
    const ignored = [
      dbOverride ? DB_PATH_ENV : "",
      uploadsOverride ? UPLOADS_DIR_ENV : "",
      backupsOverride ? BACKUPS_DIR_ENV : "",
    ].filter(Boolean);
    if (ignored.length > 0) {
      console.warn(
        `[convocate] WARNING: ${ignored.join(", ")} ignored because ${DATA_DIR_ENV}=${requested} ` +
          `is set. Everything lives under ${requested}; remove the per-path setting(s).`,
      );
    }
    return {
      dataDir: requested,
      dbPath: join(requested, "convocate.db"),
      uploadsDir: join(requested, "uploads"),
      backupsDir: join(requested, "backups"),
      source: "data_dir",
      requestedDir: requested,
    };
  }
  // Unchanged from before CONVOCATE_DATA_DIR existed: uploads and backups sit
  // beside the database, so a CONVOCATE_DB_PATH on its own still keeps its own
  // uploads and snapshots next to it.
  const dbPath = dbOverride || DEFAULT_DB_PATH;
  const base = dirname(dbPath);
  return {
    dataDir: base,
    dbPath,
    uploadsDir: uploadsOverride || join(base, "uploads"),
    backupsDir: backupsOverride || join(base, "backups"),
    source: dbOverride || uploadsOverride || backupsOverride ? "per_path" : "default",
    requestedDir: null,
  };
};

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Create the directory and prove we can write in it. Returns `null` when it is
 * usable, or the reason it is not. Both halves matter: a directory can exist and
 * be read-only (a mounted volume), and `mkdirSync` would then succeed happily.
 */
const writabilityError = (dir: string): string | null => {
  const probe = join(dir, `.convocate-write-test-${String(process.pid)}-${String(Date.now())}`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, "ok");
    rmSync(probe, { force: true });
    return null;
  } catch (cause) {
    try {
      rmSync(probe, { force: true });
    } catch {
      // Nothing to clean up if the first write never landed.
    }
    return reasonOf(cause);
  }
};

/** fsync one path — a file before it is renamed, a directory after. Best effort. */
const fsyncPath = (path: string): void => {
  let fd = -1;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch {
    // Some filesystems refuse fsync on a directory; the rename is still atomic.
  } finally {
    if (fd >= 0) closeSync(fd);
  }
};

/**
 * A consistent copy of the database into `target`, atomically.
 *
 * `VACUUM INTO` (not a byte copy) because the live file is in WAL mode: recent
 * commits sit in `convocate.db-wal`, and copying the `.db` alone would silently
 * lose them. SQLite writes the whole database — WAL folded in — to a temp file
 * from one read transaction; we fsync it and rename it into place, so a reader
 * either sees no file or the complete one. The source is only ever read.
 */
const copyDatabaseInto = (source: string, target: string, temp: string): number => {
  try {
    const reader = new Database(source, { readonly: true });
    try {
      reader.exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);
    } finally {
      reader.close();
    }
  } catch (cause) {
    // Last resort: copy the file and its WAL beside it. WAL mode will replay it
    // on first open, so the committed rows still arrive.
    rmSync(temp, { force: true });
    try {
      copyFileSync(source, temp);
      if (existsSync(`${source}-wal`)) copyFileSync(`${source}-wal`, `${temp}-wal`);
    } catch (copyCause) {
      throw new Error(
        `could not copy ${source} (vacuum: ${reasonOf(cause)}; copy: ${reasonOf(copyCause)})`,
      );
    }
  }
  fsyncPath(temp);
  renameSync(temp, target);
  fsyncPath(dirname(target));
  return statSync(target).size;
};

/**
 * Resolve the data directory, migrate `.data` into it once, and record the
 * result. Runs at import, before the database is opened for the first request.
 */
const prepare = (): DataLayout => {
  const requested = envText(DATA_DIR_ENV);
  const target = requested ? resolve(requested) : null;
  let layout = { ...layoutFor(target) };
  let fallbackFrom: string | null = null;
  let fallbackReason: string | null = null;

  if (requested) {
    const problem = writabilityError(layout.dataDir);
    if (problem) {
      // A bad setting must never take the site down. Serve from the default and
      // shout about it, so the misconfiguration is impossible to miss in the log.
      console.error(
        `[convocate] ERROR: ${DATA_DIR_ENV}=${layout.dataDir} is not usable (${problem}). ` +
          `FALLING BACK to ${DEFAULT_DATA_DIR} — data written now will NOT survive a publish. ` +
          `Fix the setting and restart.`,
      );
      fallbackFrom = layout.dataDir;
      fallbackReason = problem;
      layout = { ...layoutFor(null) };
    }
  }

  let migrated = false;
  let migratedFrom: string | null = null;
  const sameAsDefault = resolve(layout.dbPath) === resolve(DEFAULT_DB_PATH);
  if (!sameAsDefault && !existsSync(layout.dbPath) && existsSync(DEFAULT_DB_PATH)) {
    // First boot with a configured directory: bring the existing database over
    // once. The source is left untouched — a failed boot must not cost the only copy.
    try {
      mkdirSync(dirname(layout.dbPath), { recursive: true });
      mkdirSync(layout.uploadsDir, { recursive: true });
      mkdirSync(layout.backupsDir, { recursive: true });
      const temp = join(dirname(layout.dbPath), `.migrate-${String(Date.now())}.db`);
      const bytes = copyDatabaseInto(DEFAULT_DB_PATH, layout.dbPath, temp);
      let uploadFiles = 0;
      if (existsSync(DEFAULT_UPLOADS_DIR)) {
        cpSync(DEFAULT_UPLOADS_DIR, layout.uploadsDir, {
          recursive: true,
          force: false,
          errorOnExist: false,
        });
        uploadFiles = countFiles(DEFAULT_UPLOADS_DIR);
      }
      migrated = true;
      migratedFrom = DEFAULT_DATA_DIR;
      console.log(
        `[convocate] data dir migrated: copied ${String(bytes)} bytes of database and ` +
          `${String(uploadFiles)} attachment file(s) from ${DEFAULT_DATA_DIR} to ${layout.dataDir} ` +
          `(source kept in place)`,
      );
    } catch (cause) {
      // Serving on a half-migrated directory is worse than not migrating: fall
      // back to the original data, loudly, exactly like an unusable setting.
      console.error(
        `[convocate] ERROR: could not migrate ${DEFAULT_DATA_DIR} into ${layout.dataDir}: ` +
          `${reasonOf(cause)}. FALLING BACK to ${DEFAULT_DATA_DIR}; nothing was deleted.`,
      );
      fallbackFrom = layout.dataDir;
      fallbackReason = `migration failed: ${reasonOf(cause)}`;
      layout = { ...layoutFor(null) };
    }
  }

  if (!requested && layout.source === "default") {
    // Nothing configured: this is the state that loses data on the next publish.
    // Say so on every boot rather than once, because every publish restarts us.
    console.warn(
      `[convocate] WARNING: data directory is ${layout.dataDir}, inside the project. ` +
        `A publish replaces the project directory, so anything an organizer enters live ` +
        `is lost unless ${DATA_DIR_ENV} points outside it.`,
    );
  } else if (requested && !fallbackFrom) {
    console.log(
      `[convocate] data directory: ${layout.dataDir} (database ${layout.dbPath}) via ${DATA_DIR_ENV}`,
    );
  }

  return {
    ...layout,
    source: requested && !fallbackFrom ? "data_dir" : layout.source,
    requestedDir: requested ? resolve(requested) : null,
    fallbackFrom,
    fallbackReason,
    migrated,
    migratedFrom,
  };
};

const countFiles = (dir: string): number => {
  let total = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) total += countFiles(join(dir, entry.name));
      else total += 1;
    }
  } catch {
    return total;
  }
  return total;
};

/** The layout this process is using. Resolved once, at import. */
const LAYOUT: DataLayout = prepare();
export const dataLayout = (): DataLayout => LAYOUT;
export const dataDir = (): string => LAYOUT.dataDir;
export const isDataDirOutsideProject = (): boolean =>
  !resolve(LAYOUT.dataDir).startsWith(`${resolve(SITE_ROOT)}/`);

/* ---------------------------------------------------------- storage probe */
/**
 * Locations the live site may or may not be able to persist files in. Used only
 * by `storageProbeFn` (admin-token gated, no UI): write a small timestamped file
 * into each, publish, then read back which files are still there. A directory
 * that still holds an earlier run's probe after a publish is somewhere the
 * platform keeps between deploys.
 *
 * Extend by adding a line here — nothing else reads this list.
 */
export type ProbeCandidate = {
  label: string;
  path: string;
  /** The control: inside the project, so it is expected to vanish on a publish. */
  control?: boolean;
};

export const PROBE_CANDIDATES: readonly ProbeCandidate[] = [
  // A sibling of the project directory. The admin-token mirror file already
  // lives here and has survived every publish so far, which makes this the most
  // promising candidate of the lot.
  { label: "project-parent", path: join(dirname(SITE_ROOT), "convocate-probe") },
  { label: "var-lib", path: "/var/lib/convocate-probe" },
  { label: "var", path: "/var/convocate-probe" },
  { label: "opt", path: "/opt/convocate-probe" },
  { label: "home-team", path: "/home/team/convocate-probe" },
  { label: "srv", path: "/srv/convocate-probe" },
  { label: "tmp", path: join(tmpdir(), "convocate-probe") },
  // The control: inside the project, so this one is expected to vanish.
  { label: "project-control", path: join(SITE_ROOT, "convocate-probe"), control: true },
];

const PROBE_FILE = /^convocate-probe-[0-9TZ:.-]+\.txt$/;

export type ProbeResult = {
  label: string;
  path: string;
  control: boolean;
  /** Files written by any earlier run that are still on disk. */
  kept: { name: string; bytes: number; modifiedAt: number; writtenAt: number | null }[];
  ok: boolean;
  error?: string;
};

const probeStamp = (ms: number): string => new Date(ms).toISOString().replace(/[:]/g, "-");

/** Write one timestamped probe file into each candidate; report successes and failures. */
export const probeWrite = (): { at: number; results: ProbeResult[] } => {
  const at = Date.now();
  const name = `convocate-probe-${probeStamp(at)}.txt`;
  const body = JSON.stringify({
    at,
    iso: new Date(at).toISOString(),
    pid: process.pid,
    host: hostname(),
    dataDir: LAYOUT.dataDir,
    siteRoot: SITE_ROOT,
  });
  const results = PROBE_CANDIDATES.map((candidate): ProbeResult => {
    const base: ProbeResult = {
      label: candidate.label,
      path: candidate.path,
      control: candidate.control === true,
      kept: probeKept(candidate.path),
      ok: false,
    };
    try {
      mkdirSync(candidate.path, { recursive: true });
      const file = join(candidate.path, name);
      writeFileSync(file, `${body}\n`);
      // Prove the bytes really landed where we think, not just that write() returned.
      const check = readFileSync(file, "utf8");
      if (!check.includes(`"pid":${String(process.pid)}`)) throw new Error("readback mismatch");
      return { ...base, ok: true };
    } catch (cause) {
      return { ...base, error: reasonOf(cause) };
    }
  });
  return { at, results };
};

/** For each candidate, which earlier probe files are still present. */
export const probeRead = (): { at: number; results: ProbeResult[] } => {
  const at = Date.now();
  return {
    at,
    results: PROBE_CANDIDATES.map(
      (candidate): ProbeResult => ({
        label: candidate.label,
        path: candidate.path,
        control: candidate.control === true,
        kept: probeKept(candidate.path),
        ok: existsSync(candidate.path),
        ...(existsSync(candidate.path) ? {} : { error: "directory does not exist" }),
      }),
    ),
  };
};

const probeKept = (dir: string): ProbeResult["kept"] => {
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => PROBE_FILE.test(name));
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const path = join(dir, name);
      let bytes = 0;
      let modifiedAt = 0;
      let writtenAt: number | null = null;
      try {
        const info = statSync(path);
        bytes = info.size;
        modifiedAt = Math.trunc(info.mtimeMs);
        const parsed = JSON.parse(readFileSync(path, "utf8")) as { at?: unknown };
        writtenAt = Number.isFinite(Number(parsed.at)) ? Number(parsed.at) : null;
      } catch {
        // A truncated or unreadable file still counts as present — that is the
        // interesting fact.
      }
      return { name, bytes, modifiedAt, writtenAt };
    })
    .sort((a, b) => (b.writtenAt ?? b.modifiedAt) - (a.writtenAt ?? a.modifiedAt));
};

/** One call for either action; the server function is a thin token gate around this. */
export const runStorageProbe = (
  action: "write" | "read",
): {
  action: "write" | "read";
  at: number;
  dataDir: string;
  siteRoot: string;
  dataDirOutsideProject: boolean;
  results: ProbeResult[];
} => {
  const run = action === "write" ? probeWrite() : probeRead();
  return {
    action,
    at: run.at,
    dataDir: LAYOUT.dataDir,
    siteRoot: SITE_ROOT,
    dataDirOutsideProject: isDataDirOutsideProject(),
    results: run.results,
  };
};
