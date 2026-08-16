/**
 * The log file's three promises: it is named so it sorts, it deletes only its
 * own, and it never takes the game down with it.
 *
 * The pruning tests use a real directory. A mocked fs would let the prune assert
 * "we asked to delete these names", which is not the question - the question is
 * what is left in the folder afterwards, and that includes the file the player
 * put there.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  filesToPrune,
  LOG_KEEP,
  LOG_MAX_BYTES,
  logFileName,
  logStamp,
  openLogFile,
  REPORT_KEEP,
  reportFileName,
  writeReportFile,
} from "./log-file.js";

const made: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neo-log-"));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const AT = new Date(2026, 7, 2, 13, 6, 9);

describe("names", () => {
  it("stamps local time in a form that sorts chronologically", () => {
    expect(logStamp(AT)).toBe("20260802-130609");
    expect(logStamp(new Date(2026, 0, 1, 0, 0, 0))).toBe("20260101-000000");
  });

  it("puts the pid on the log, because a relaunch shares the second", () => {
    /* The updater's swap script starts the new copy the moment the old one
     * exits, so two processes stamping the same second is the NORMAL case for
     * the one session anybody most wants to read. */
    expect(logFileName(AT, 4820)).toBe("neo-angband-20260802-130609-4820.log");
    expect(logFileName(AT, 4820)).not.toBe(logFileName(AT, 4821));
  });

  it("names a report without a pid, since a player made it", () => {
    expect(reportFileName(AT)).toBe("report-20260802-130609.txt");
  });
});

describe("pruning", () => {
  /* The date is fixed and the TIME counts up, so the helper keeps producing the
   * eight digits the name pattern requires however many are asked for. */
  const logs = (n: number): string[] =>
    Array.from(
      { length: n },
      (_, i) => `neo-angband-20260802-${String(i).padStart(6, "0")}-1.log`,
    );

  it("keeps the newest and drops the rest", () => {
    expect(filesToPrune(logs(5), 3)).toEqual(logs(5).slice(0, 2));
  });

  it("drops nothing when there is room", () => {
    expect(filesToPrune(logs(3), 3)).toEqual([]);
    expect(filesToPrune(logs(2), 3)).toEqual([]);
  });

  it("counts logs and reports separately", () => {
    /* Ten launches in an afternoon must not evict the report somebody wrote
     * yesterday - that report is the only file here anybody chose to make. */
    const names = [...logs(5), "report-20260801-000000.txt", "report-20260802-000000.txt"];
    expect(filesToPrune(names, 2, 2)).toEqual(logs(5).slice(0, 3));
  });

  it("touches nothing it did not name", () => {
    /* The logs folder is somewhere a player will eventually put a screenshot or
     * a copy they wanted to keep. A prune that deleted whatever was oldest would
     * be the program throwing away files it did not create. */
    const foreign = [
      "notes.txt",
      "neo-angband.log",
      "neo-angband-20260802-130609.log",
      "report.txt",
      "REPORT-20260802-130609.TXT",
    ];
    expect(filesToPrune([...foreign, ...logs(20)], 0, 0)).toEqual(logs(20).sort());
  });

  it("settles at exactly LOG_KEEP files across many launches", () => {
    /* The off-by-one that nobody notices: pruning to LOG_KEEP and then writing a
     * new file settles one over, forever. */
    const dir = tmpDir();
    for (let i = 0; i < LOG_KEEP + 6; i++) {
      const f = openLogFile(dir, new Date(2026, 0, 1, 0, 0, i), 100 + i);
      f.append(["a line"]);
    }
    expect(fs.readdirSync(dir)).toHaveLength(LOG_KEEP);
  });
});

describe("writing", () => {
  it("appends the lines it is given, one per line, and counts the bytes", () => {
    const dir = tmpDir();
    const f = openLogFile(dir, AT, 7);
    f.append(["one", "two"]);
    f.append(["three"]);
    expect(fs.readFileSync(f.path, "utf8")).toBe("one\ntwo\nthree\n");
    expect(f.written()).toBe(14);
  });

  it("stops at the cap and says that it did", () => {
    const dir = tmpDir();
    const f = openLogFile(dir, AT, 7);
    f.append([`x`.repeat(LOG_MAX_BYTES + 1)]);
    f.append(["never reached"]);
    const text = fs.readFileSync(f.path, "utf8");
    expect(text).toBe(`[log stopped: this session passed ${String(LOG_MAX_BYTES)} bytes]\n`);
    expect(text).not.toContain("never reached");
  });

  it("measures the cap in bytes, not characters", () => {
    /* A cap in the wrong unit is a cap that does not hold: three-byte characters
     * would let a session write three times the limit. */
    const dir = tmpDir();
    const f = openLogFile(dir, AT, 7);
    f.append(["中".repeat(LOG_MAX_BYTES / 2)]);
    expect(fs.readFileSync(f.path, "utf8")).toContain("log stopped");
  });

  it("is inert rather than fatal when the folder cannot be made", () => {
    /* This module exists to explain other failures. It must never be one. */
    const dir = tmpDir();
    const blocked = path.join(dir, "a-file", "logs");
    fs.writeFileSync(path.join(dir, "a-file"), "");
    const f = openLogFile(blocked, AT, 7);
    expect(() => {
      f.append(["nothing to write this to"]);
    }).not.toThrow();
    expect(fs.existsSync(f.path)).toBe(false);
  });

  it("appends nothing for an empty batch, so an idle game writes no bytes", () => {
    const dir = tmpDir();
    const f = openLogFile(dir, AT, 7);
    f.append([]);
    expect(fs.existsSync(f.path)).toBe(false);
    expect(f.written()).toBe(0);
  });
});

describe("reports", () => {
  it("writes the text and answers where it went", () => {
    const dir = tmpDir();
    const p = writeReportFile(dir, "the report", AT);
    expect(p).toBe(path.join(dir, "report-20260802-130609.txt"));
    expect(fs.readFileSync(p, "utf8")).toBe("the report");
  });

  it("throws when it cannot write, because this one was asked for", () => {
    /* Unlike a log line. "Saved" with nothing saved is worse than an error. */
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "a-file"), "");
    expect(() => writeReportFile(path.join(dir, "a-file", "logs"), "x", AT)).toThrow();
  });

  it("never prunes the report it just wrote", () => {
    const dir = tmpDir();
    for (let i = 0; i < REPORT_KEEP + 3; i++) {
      const p = writeReportFile(dir, "r", new Date(2026, 0, 1, 0, 0, i));
      expect(fs.existsSync(p)).toBe(true);
    }
    expect(fs.readdirSync(dir)).toHaveLength(REPORT_KEEP);
  });
});
