/**
 * The renderer's log: one instance, its level chosen by the build, its lines on
 * their way to a file the player can send you.
 *
 * core/log.ts owns the level rule, the ring and the text. This module owns the
 * two things that are specific to running inside a page: WHICH sinks exist, and
 * how a line crosses to the main process without costing a frame.
 *
 * THE LEVEL IS THE BUILD'S, NOT THE CHANNEL'S. `defaultLogLevel` reads the
 * version string, so a released build logs warnings and a tester's build logs
 * what it is doing - and a player who installed a beta and then switched their
 * update channel to `stable` still gets the beta's logging, because they are
 * still running the beta. See defaultLogLevel's comment for why that distinction
 * is worth the sentence.
 *
 * THE OVERRIDE IS DELIBERATELY NOT IN THE OPTIONS SCREEN. Options are game
 * options - upstream's, mirrored - and a logging verbosity row there would be
 * the first entry in that list that is not about the game. It lives on the
 * report screen instead, which is the one place somebody is already trying to
 * tell us what went wrong, and is where they would be sent to turn it up.
 */

import { createLog, defaultLogLevel, isLogLevel } from "@rpgm-tools/neo-angband-core/log";
import type { Log, LogLevel, LogRecord } from "@rpgm-tools/neo-angband-core/log";
import { ENGINE_VERSION } from "@rpgm-tools/neo-angband-core";

/** Where an override is remembered between launches. */
export const LOG_LEVEL_KEY = "neo-angband:log-level";

/** The query parameter that beats everything, for a one-off diagnosis. */
export const LOG_LEVEL_PARAM = "log";

/**
 * The batch interval. Mirrors LOG_FLUSH_MS in the desktop package.
 *
 * Stated twice rather than shared because the renderer cannot import from the
 * desktop package - that dependency runs the wrong way, and preload.ts's comment
 * says why. `logging.test.ts` pins the number so the two cannot drift silently.
 */
export const LOG_FLUSH_MS = 250;

/**
 * The level this launch runs at, in priority order.
 *
 * A URL parameter beats a stored preference beats the build's own default. The
 * parameter is first because it is the thing somebody is told to do over a
 * support conversation ("add ?log=debug to the address"), and it must work on a
 * machine whose stored preference says otherwise.
 */
export function chooseLevel(args: {
  version: string;
  param?: string | null | undefined;
  stored?: string | null | undefined;
}): LogLevel {
  if (isLogLevel(args.param)) return args.param;
  if (isLogLevel(args.stored)) return args.stored;
  return defaultLogLevel(args.version);
}

/** localStorage, or null where a browser refuses it outright. */
function levelStore(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function storedLevel(): string | null {
  try {
    return levelStore()?.getItem(LOG_LEVEL_KEY) ?? null;
  } catch {
    return null;
  }
}

function paramLevel(): string | null {
  try {
    return new URLSearchParams(window.location.search).get(LOG_LEVEL_PARAM);
  } catch {
    return null;
  }
}

/**
 * The one log the renderer uses.
 *
 * Created at module load, before anything can want to write to it, and with the
 * level already right - a log that starts at a default and is corrected later
 * has lost exactly the boot-time records that explain a boot-time failure.
 */
export const log: Log = createLog({
  level: chooseLevel({
    version: ENGINE_VERSION,
    param: typeof window === "undefined" ? null : paramLevel(),
    stored: typeof window === "undefined" ? null : storedLevel(),
  }),
});

/** Change the level and remember it. Takes effect on the next record. */
export function setLogLevel(level: LogLevel): void {
  log.setLevel(level);
  try {
    levelStore()?.setItem(LOG_LEVEL_KEY, level);
  } catch {
    /* The preference is lost, the level still changed for this session. */
  }
}

/**
 * Print to the browser console at the matching severity.
 *
 * Kept even on a released build, because devtools is where a technical player
 * looks first and an empty console there reads as "the game is not logging".
 * `console.debug` rather than `console.log` for debug: Chromium files it under
 * Verbose, which is hidden by default, which is the correct default for it.
 */
export function consoleSink(rec: LogRecord, line: string): void {
  /* eslint-disable no-console -- this IS the console sink; the rule exists to
   * send every other caller through here. */
  if (rec.level === "error") console.error(line);
  else if (rec.level === "warn") console.warn(line);
  else if (rec.level === "info") console.info(line);
  else console.debug(line);
  /* eslint-enable no-console */
}

/** The half of the preload bridge this module needs. */
export interface LogBridge {
  log(lines: readonly string[]): void;
}

/**
 * Find the log bridge, and DO NOT confuse it with the host bridge.
 *
 * The same lookup as `updaterBridge`, and for the same reason: the preload
 * exposes two globals and this one is on `neoDesktop`. Reading it off
 * `detectDesktopBridge()` - which returns `neoHostFs` - is how the updater spent
 * its first build wired to an object that has never had the method on it, with
 * sixty tests and a typecheck passing over the top of it.
 */
export function logBridge(scope: unknown = globalThis): LogBridge | null {
  if (scope === null || typeof scope !== "object") return null;
  const desktop = (scope as Record<string, unknown>)["neoDesktop"];
  if (desktop === null || typeof desktop !== "object") return null;
  const fn = (desktop as Record<string, unknown>)["log"];
  return typeof fn === "function" ? (desktop as LogBridge) : null;
}

/** What a batching sink needs from the outside world, so a test can supply it. */
export interface FileSinkDeps {
  readonly bridge: LogBridge;
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly flushMs?: number;
}

export interface FileSink {
  readonly sink: (rec: LogRecord, line: string) => void;
  /** Send whatever is held, now. Called on the way out of the page. */
  flush(): void;
}

/**
 * Hold lines briefly, then send them as one message.
 *
 * A quarter of a second is roughly one player action, so anything the game says
 * about a keypress is on disk before the next one - while a burst (mod loading
 * names forty files) crosses the boundary once instead of forty times.
 *
 * The timer is started by the FIRST line of a batch and not restarted by the
 * others. A debounce would be the natural-looking choice and is wrong here: a
 * game logging steadily every 200ms would never reach a quiet moment, so the
 * batch would grow without ever being sent, and the lines nobody has yet would
 * be exactly the ones describing what it was doing when it stopped.
 */
export function createFileSink(deps: FileSinkDeps): FileSink {
  const held: string[] = [];
  let timer: unknown = null;
  const flush = (): void => {
    if (timer !== null) {
      deps.clearTimeout(timer);
      timer = null;
    }
    if (held.length === 0) return;
    const batch = held.splice(0);
    try {
      deps.bridge.log(batch);
    } catch {
      /* A closed IPC channel during shutdown. The lines are gone; the game is
       * not, and that is the trade this whole module is written around. */
    }
  };
  return {
    flush,
    sink: (_rec, line) => {
      held.push(line);
      timer ??= deps.setTimeout(flush, deps.flushMs ?? LOG_FLUSH_MS);
    },
  };
}

/**
 * Attach the sinks this shell has, and answer how to flush them.
 *
 * Called once at boot. On the web there is no file, so the ring and the console
 * are the whole of it and the report is a download instead - see report.ts.
 */
export function installLogSinks(scope: unknown = globalThis): () => void {
  log.addSink(consoleSink);
  const bridge = logBridge(scope);
  if (!bridge) return () => undefined;

  const file = createFileSink({
    bridge,
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => {
      globalThis.clearTimeout(h as ReturnType<typeof setTimeout>);
    },
  });
  log.addSink(file.sink);

  /*
   * Flush on the way out, on the events that actually fire.
   *
   * `beforeunload` alone is not enough and never was: a page killed by the OS,
   * or backgrounded on mobile and then discarded, never sees it. `pagehide` and
   * a hidden `visibilitychange` are the two the platform guarantees, and the
   * session that ends that way is precisely the one whose last lines matter.
   */
  const onOut = (): void => {
    file.flush();
  };
  try {
    window.addEventListener("pagehide", onOut);
    window.addEventListener("beforeunload", onOut);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") onOut();
    });
  } catch {
    /* No window (a test, a worker). The manual flush below still works. */
  }
  return onOut;
}
