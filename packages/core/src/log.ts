/**
 * A log a player can hand you, and the rule that decides how much is in it.
 *
 * WHY THIS IS IN `core` WHEN THE ENGINE NEVER CALLS IT. It is not a parity
 * module and nothing in the C corresponds to it - the honest reason is that
 * `core` is the only package both the renderer and the Electron main process
 * already depend on, and the alternative was two implementations of the same
 * format. This project has been bitten by that shape before: two copies of a
 * check, and only one of them learns. So it lives here, behind the `./log`
 * subpath rather than in the barrel, next to `./host` - which is the same kind
 * of thing, infrastructure the port needs and the original did not have.
 *
 * It does NO I/O and holds NO sinks of its own. Writing a line to a file is the
 * main process's job and drawing one on a terminal is the renderer's; this
 * module owns the level rule, the record, the ring, and the text - the four
 * things that have to be identical on both sides of the IPC boundary or a log
 * file becomes two interleaved formats.
 *
 * THE RING IS THE POINT, not the file. A player who hits a bug is asked for a
 * report, and the report is "the last N things that happened" - which has to
 * exist in memory already, because the interesting part is over by the time
 * anybody presses a key.
 */

/**
 * Four levels, and no `trace`.
 *
 * `debug` is already the level nobody ships; a fifth below it would only ever
 * be reached by editing a constant, which is what a comment is for.
 */
export type LogLevel = "error" | "warn" | "info" | "debug";

/** Most severe first. Index is the rank, so the order here IS the ordering. */
export const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug"];

/** 0 for `error`, 3 for `debug`. -1 for anything that is not a level. */
export function logLevelRank(level: string): number {
  return (LOG_LEVELS as readonly string[]).indexOf(level);
}

export function isLogLevel(v: unknown): v is LogLevel {
  return typeof v === "string" && logLevelRank(v) >= 0;
}

/** Would a log running at `active` record something logged at `of`? */
export function logLevelAllows(active: LogLevel, of: LogLevel): boolean {
  return logLevelRank(of) <= logLevelRank(active);
}

/**
 * How much this BUILD logs, decided by its own version rather than by a setting.
 *
 * A released build logs warnings and errors; a build somebody is testing logs
 * what it is doing as well. The two states are already written down in the
 * version string and nowhere else needs to agree:
 *
 *   `0.16.1-edge.2`  a per-commit build  -> info
 *   `0.16.0`         a 0.x pre-release   -> info
 *   `1.2.3`          a finished release  -> warn
 *
 * DELIBERATELY NOT THE UPDATE CHANNEL. The channel is a preference about which
 * builds to accept next, stored in localStorage and changeable at any time; a
 * player who installed a beta and then picked `stable` is still running the
 * beta, and the log should still say so. Asking the version means the answer
 * cannot drift from the thing it describes.
 *
 * While the project is 0.x this returns `info` for everything, which is correct
 * and temporary: `stable` selects nothing before 1.0.0 either. Both facts stop
 * being true on the same day, by themselves - see `defaultChannel`, which this
 * mirrors and which `update.test.ts` ties it to.
 */
export function defaultLogLevel(version: string): LogLevel {
  if (version.includes("-edge.")) return "info";
  return /^0\./u.test(version) ? "info" : "warn";
}

/**
 * One line of log, with its detail ALREADY rendered to text.
 *
 * Serialising at record time rather than at write time is what bounds the ring:
 * a record holds a string, not a reference to a live game object that will have
 * changed - or been mutated into a cycle - by the time anybody reads it. It also
 * means a report cannot be the thing that throws while somebody is filing a bug.
 */
export interface LogRecord {
  /** Epoch milliseconds. */
  readonly at: number;
  readonly level: LogLevel;
  /** Where it came from: `update`, `mods`, `save`. Short and stable. */
  readonly area: string;
  readonly msg: string;
  /** The extra detail, JSON-ish, or undefined when there was none. */
  readonly data?: string;
}

/** Somewhere a line goes. Given the record and the text, so it need not reformat. */
export type LogSink = (rec: LogRecord, line: string) => void;

/** How many records the ring holds before the oldest is dropped. */
export const LOG_RING_DEFAULT = 2000;

/** Longest single message or detail string kept, in characters. */
export const LOG_FIELD_MAX = 2000;

/**
 * JSON, but it cannot throw and it cannot run away.
 *
 * Everything a caller might hand this is in scope: a cycle (a game object
 * pointing at the state that owns it), a BigInt (JSON.stringify throws on one),
 * a 40,000-element array, a function, an Error (whose message and stack are the
 * only interesting parts and neither is enumerable). A logger that throws while
 * describing a failure replaces the failure with its own.
 */
export function describeValue(v: unknown, depth = 4): string {
  const seen = new Set<unknown>();
  const walk = (x: unknown, left: number): unknown => {
    if (x === null || typeof x !== "object") {
      if (typeof x === "bigint") return `${x.toString()}n`;
      if (typeof x === "function") return `[function ${x.name || "anonymous"}]`;
      if (typeof x === "symbol") return x.toString();
      if (typeof x === "string" && x.length > LOG_FIELD_MAX) {
        return `${x.slice(0, LOG_FIELD_MAX)}...[${String(x.length)} chars]`;
      }
      return x;
    }
    if (seen.has(x)) return "[circular]";
    if (left <= 0) return "[...]";
    if (x instanceof Error) {
      /* name/message/stack are not enumerable, so the generic branch below
       * would render every Error as `{}` - which is the single most useless
       * thing a log can say about a failure. */
      const out: Record<string, unknown> = { name: x.name, message: x.message };
      if (typeof x.stack === "string") out["stack"] = x.stack.split("\n").slice(0, 8).join("\n");
      if (x.cause !== undefined) out["cause"] = walk(x.cause, left - 1);
      return out;
    }
    seen.add(x);
    try {
      if (Array.isArray(x)) {
        const head = x.slice(0, 50).map((e) => walk(e, left - 1));
        return x.length > 50 ? [...head, `...[${String(x.length)} items]`] : head;
      }
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
        out[k] = walk(val, left - 1);
      }
      return out;
    } finally {
      seen.delete(x);
    }
  };
  try {
    const text = JSON.stringify(walk(v, depth));
    if (text === undefined) return String(v);
    return text.length > LOG_FIELD_MAX ? `${text.slice(0, LOG_FIELD_MAX)}...` : text;
  } catch {
    /* Belt and braces: a getter that throws is reachable from Object.entries. */
    return "[undescribable]";
  }
}

/** `2026-08-02T13:06:09.123Z` - sortable, and the same in every timezone. */
function stamp(at: number): string {
  try {
    return new Date(at).toISOString();
  } catch {
    /* A NaN or out-of-range timestamp must not cost the line it is attached to. */
    return "????-??-??T??:??:??.???Z";
  }
}

/**
 * One line of the log file.
 *
 * Fixed-width level so the areas line up when a human reads a thousand of them,
 * and the detail after a ` | ` so the message can be found by eye without the
 * JSON in the way.
 */
export function formatLogLine(rec: LogRecord): string {
  const head = `${stamp(rec.at)} ${rec.level.toUpperCase().padEnd(5)} [${rec.area}] ${rec.msg}`;
  return rec.data === undefined ? head : `${head} | ${rec.data}`;
}

/**
 * A path with the user's home directory replaced by `~`.
 *
 * Called on the way into a REPORT, not on the way into the log file. The file
 * lives on their machine and is theirs; the report is the thing they send to a
 * stranger, and `C:\Users\firstname.lastname\...` is a real name in it. The
 * comparison is case-insensitive because Windows paths are, and it is a plain
 * substring so it catches the home directory wherever it appears in a line -
 * inside a stack trace, inside a JSON blob - not only at the start.
 */
export function elideHome(text: string, home: string | undefined): string {
  const h = (home ?? "").replace(/[\\/]+$/u, "");
  if (h.length < 4) return text;
  /*
   * THREE SPELLINGS OF THE SAME PATH, and the third is the one that matters.
   *
   * A path reaches the log through `describeValue`, which JSON-encodes it - so
   * on Windows it arrives with its backslashes DOUBLED, and neither of the two
   * obvious forms matches a character of it. Checking only the raw and URL forms
   * left every path this project actually logs untouched. It was caught by a
   * test that used a realistic log line rather than a hand-written path, which
   * is the only reason it was caught at all.
   */
  const forms = [
    /* `{"path":"C:\\Users\\name\\..."}` - what describeValue produces. */
    h.replace(/\\/gu, "\\\\"),
    /* Raw, as node:path produces it. */
    h,
    /* A file:// URL in a stack trace, often in the same line as the above. */
    h.replace(/\\/gu, "/"),
  ];
  let out = text;
  /* Longest first, so the doubled form is taken before the single one can eat
   * its leading segment and leave the rest looking like an unrelated path. */
  for (const form of [...new Set(forms)].sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(form.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu");
    out = out.replace(pattern, "~");
  }
  return out;
}

export interface LogOptions {
  /** Starting level. Callers pass `defaultLogLevel(ENGINE_VERSION)`. */
  readonly level: LogLevel;
  /** Records held in memory. */
  readonly capacity?: number;
  /** Injected so a test can assert a timestamp instead of tolerating one. */
  readonly now?: () => number;
}

/** What the rest of the app holds. */
export interface Log {
  readonly level: LogLevel;
  setLevel(level: LogLevel): void;
  error(area: string, msg: string, data?: unknown): void;
  warn(area: string, msg: string, data?: unknown): void;
  info(area: string, msg: string, data?: unknown): void;
  debug(area: string, msg: string, data?: unknown): void;
  /** Add a destination. Returns the function that removes it again. */
  addSink(sink: LogSink): () => void;
  /** The ring, oldest first. */
  recent(limit?: number): LogRecord[];
  /**
   * How many records the ring has thrown away.
   *
   * Reported on a report rather than kept quiet: "the last 2000 lines" and "the
   * whole session" look identical in a text file, and the difference is whether
   * the thing you are looking for could still be above the top.
   */
  dropped(): number;
}

export function createLog(opts: LogOptions): Log {
  const capacity = Math.max(1, opts.capacity ?? LOG_RING_DEFAULT);
  const now = opts.now ?? ((): number => Date.now());
  const ring: (LogRecord | undefined)[] = new Array<LogRecord | undefined>(capacity);
  let head = 0;
  let count = 0;
  let lost = 0;
  let level = opts.level;
  const sinks = new Set<LogSink>();

  const write = (lvl: LogLevel, area: string, msg: string, data: unknown): void => {
    if (!logLevelAllows(level, lvl)) return;
    const rec: LogRecord = {
      at: now(),
      level: lvl,
      area,
      msg: msg.length > LOG_FIELD_MAX ? `${msg.slice(0, LOG_FIELD_MAX)}...` : msg,
      ...(data === undefined ? {} : { data: describeValue(data) }),
    };
    if (count === capacity) lost++;
    ring[head] = rec;
    head = (head + 1) % capacity;
    if (count < capacity) count++;
    const line = formatLogLine(rec);
    for (const sink of sinks) {
      try {
        sink(rec, line);
      } catch {
        /* A sink that throws - a full disk, a closed IPC channel - must not
         * take down the code that was only trying to say what it was doing,
         * and must not stop the OTHER sinks from getting the line. */
      }
    }
  };

  return {
    get level(): LogLevel {
      return level;
    },
    setLevel(next: LogLevel): void {
      level = next;
    },
    error: (a, m, d?) => {
      write("error", a, m, d);
    },
    warn: (a, m, d?) => {
      write("warn", a, m, d);
    },
    info: (a, m, d?) => {
      write("info", a, m, d);
    },
    debug: (a, m, d?) => {
      write("debug", a, m, d);
    },
    addSink(sink: LogSink): () => void {
      sinks.add(sink);
      return () => {
        sinks.delete(sink);
      };
    },
    recent(limit?: number): LogRecord[] {
      const want = Math.max(0, Math.min(limit ?? count, count));
      const out: LogRecord[] = [];
      for (let i = count - want; i < count; i++) {
        const rec = ring[(head - count + i + capacity * 2) % capacity];
        if (rec) out.push(rec);
      }
      return out;
    },
    dropped(): number {
      return lost;
    },
  };
}
