/**
 * The log on disk: one file per launch, in the game folder, pruned to the last few.
 *
 * WHY A FILE AT ALL, when the ring in core/log.ts already holds the session. The
 * ring dies with the process, and the sessions worth reading are the ones that
 * ended badly - a crash, a hang, a swap that did not come back. A player cannot
 * be asked to reproduce a bug with devtools open; they can be asked to send a
 * folder.
 *
 * ONE FILE PER LAUNCH rather than one rolling file, because the unit anybody
 * reasons about is "the time it went wrong". Splitting a session across a
 * rollover would mean the interesting part is routinely half in each of two
 * files, and joining them is a job for whoever is already confused.
 *
 * WHERE: `<data base>/logs`. That is the same folder the saves are in, which for
 * the default folder install is beside the executable - so "send me your logs
 * folder" needs no explanation of where the game keeps things. It is NOT
 * Electron's `app.getPath("logs")`, which is Chromium's own and lives under the
 * user profile even for a portable copy.
 *
 * The pure decisions - what a file is called, which ones to delete, when to stop
 * writing - are functions here so they can be tested without a disk. Only
 * `openLogFile` touches one.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** The directory, under the resolved data base. */
export const LOG_DIRNAME = "logs";

/** How many past launches are kept. */
export const LOG_KEEP = 10;

/** How many written reports are kept. Higher: a report is deliberate. */
export const REPORT_KEEP = 20;

/**
 * The point at which one session has written enough.
 *
 * A cap rather than a rollover: eight megabytes of one session's log is a
 * runaway, and the useful response is to say so and stop, not to keep filling
 * somebody's disk in tidier pieces. The last line written says what happened, so
 * a truncated log never reads as a session that simply ended.
 */
export const LOG_MAX_BYTES = 8 * 1024 * 1024;

/** `20260802-130609`, which sorts the same way it happened. */
export function logStamp(at: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return (
    `${String(at.getFullYear()).padStart(4, "0")}${p2(at.getMonth() + 1)}${p2(at.getDate())}` +
    `-${p2(at.getHours())}${p2(at.getMinutes())}${p2(at.getSeconds())}`
  );
}

/**
 * `neo-angband-20260802-130609-4820.log`.
 *
 * The pid is on the end because two launches CAN share a second, and the case
 * that does it is not exotic: the updater relaunches the game the moment the
 * swap finishes, so the outgoing and incoming processes routinely stamp the same
 * second. Two processes appending to one file interleaves their lines.
 */
export function logFileName(at: Date, pid: number): string {
  return `neo-angband-${logStamp(at)}-${String(pid)}.log`;
}

/** `report-20260802-130609.txt`, written when somebody files one. */
export function reportFileName(at: Date): string {
  return `report-${logStamp(at)}.txt`;
}

const LOG_RE = /^neo-angband-\d{8}-\d{6}-\d+\.log$/u;
const REPORT_RE = /^report-\d{8}-\d{6}\.txt$/u;

/**
 * Which files to delete, given everything in the directory.
 *
 * Matches OUR names and nothing else. The logs folder is somewhere a player will
 * eventually put something - a screenshot, a note, a copy they wanted to keep -
 * and a prune that deleted whatever was oldest would be a program throwing away
 * files it did not create.
 *
 * Logs and reports are counted separately: a burst of ten launches must not
 * evict the report somebody wrote yesterday.
 */
export function filesToPrune(
  names: readonly string[],
  keepLogs = LOG_KEEP,
  keepReports = REPORT_KEEP,
): string[] {
  const pick = (re: RegExp, keep: number): string[] => {
    const mine = names.filter((n) => re.test(n)).sort();
    return keep >= mine.length ? [] : mine.slice(0, mine.length - Math.max(0, keep));
  };
  return [...pick(LOG_RE, keepLogs), ...pick(REPORT_RE, keepReports)];
}

/** The session's log, once it is open. */
export interface LogFile {
  /** Absolute path, so the report screen can tell the player where to look. */
  readonly path: string;
  /** Append lines. Never throws: a log that takes the app down is worse than none. */
  append(lines: readonly string[]): void;
  /** Bytes written this session. */
  written(): number;
}

/**
 * A log file that cannot be the thing that breaks the game.
 *
 * Every failure here is swallowed, and that is a deliberate asymmetry rather
 * than laziness: this module exists to explain OTHER failures. A read-only
 * folder, a full disk or a locked file must cost the log and nothing else, so
 * `openLogFile` answers a working object that writes nowhere rather than
 * throwing at startup.
 */
export function openLogFile(dir: string, at: Date, pid: number): LogFile {
  const file = path.join(dir, logFileName(at, pid));
  let bytes = 0;
  let dead = false;

  try {
    fs.mkdirSync(dir, { recursive: true });
    /* KEEP MINUS ONE, because this launch is about to add the file that makes up
     * the difference. Pruning to LOG_KEEP here and then writing a new file
     * settles at LOG_KEEP + 1 forever - off by one in the direction nobody
     * notices, which is why it is worth the sentence. */
    for (const name of filesToPrune(fs.readdirSync(dir), LOG_KEEP - 1)) {
      try {
        fs.rmSync(path.join(dir, name), { force: true });
      } catch {
        /* One undeletable old log is not worth failing the new one over. */
      }
    }
  } catch {
    dead = true;
  }

  return {
    path: file,
    written: () => bytes,
    append(lines: readonly string[]): void {
      if (dead || lines.length === 0) return;
      let text = `${lines.join("\n")}\n`;
      /* Bytes, not characters. A log full of item names is ASCII and the two
       * agree; a log full of a player's own text is not, and a cap measured in
       * the wrong unit is a cap that does not hold. */
      if (bytes + Buffer.byteLength(text) > LOG_MAX_BYTES) {
        /* Say why it stops. A log that simply ends looks like a session that
         * simply ended, which is exactly the wrong conclusion to invite from a
         * file somebody is reading to find out why the game vanished. */
        text = `[log stopped: this session passed ${String(LOG_MAX_BYTES)} bytes]\n`;
        dead = true;
      }
      try {
        fs.appendFileSync(file, text, "utf8");
        bytes += Buffer.byteLength(text);
      } catch {
        /* The disk filled, or the folder went away with a USB stick in it. */
        dead = true;
      }
    },
  };
}

/**
 * Write a report beside the logs and answer where it went.
 *
 * Returns the path so the screen can show it: a report the player cannot find is
 * a report nobody receives. Throws rather than swallowing, because unlike a log
 * line this one was ASKED for, and "saved" with nothing saved is a worse outcome
 * than an error message.
 */
export function writeReportFile(dir: string, text: string, at: Date): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, reportFileName(at));
  fs.writeFileSync(file, text, "utf8");
  try {
    for (const name of filesToPrune(fs.readdirSync(dir))) {
      if (path.join(dir, name) === file) continue;
      fs.rmSync(path.join(dir, name), { force: true });
    }
  } catch {
    /* Pruning is housekeeping; the report is already safely on disk. */
  }
  return file;
}
