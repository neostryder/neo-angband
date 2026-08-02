/**
 * The log's four jobs: decide the level from the build, keep the last N records,
 * describe anything without throwing, and render a line a human can scan.
 *
 * The describeValue cases are not hypothetical. Every one of them is something
 * this codebase would hand a logger on a bad day - a game object that points at
 * the state owning it, an Error whose interesting fields are not enumerable, a
 * pack array with forty thousand entries in it.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createLog,
  defaultLogLevel,
  describeValue,
  elideHome,
  formatLogLine,
  isLogLevel,
  LOG_FIELD_MAX,
  LOG_LEVELS,
  logLevelAllows,
  logLevelRank,
} from "./log.js";
import type { LogRecord } from "./log.js";

describe("levels", () => {
  it("orders most severe first, so the index is the rank", () => {
    expect(LOG_LEVELS).toEqual(["error", "warn", "info", "debug"]);
    expect(logLevelRank("error")).toBe(0);
    expect(logLevelRank("debug")).toBe(3);
    expect(logLevelRank("shout")).toBe(-1);
  });

  it("lets through everything at or above the active level", () => {
    expect(logLevelAllows("warn", "error")).toBe(true);
    expect(logLevelAllows("warn", "warn")).toBe(true);
    expect(logLevelAllows("warn", "info")).toBe(false);
    expect(logLevelAllows("debug", "debug")).toBe(true);
  });

  it("recognises its own level names and nothing else", () => {
    expect(isLogLevel("info")).toBe(true);
    expect(isLogLevel("INFO")).toBe(false);
    expect(isLogLevel(3)).toBe(false);
    expect(isLogLevel(null)).toBe(false);
  });
});

describe("how much a build logs", () => {
  it("is verbose for anything that is not a finished release", () => {
    expect(defaultLogLevel("0.16.0")).toBe("info");
    expect(defaultLogLevel("0.16.1-edge.2")).toBe("info");
    expect(defaultLogLevel("0.99.0")).toBe("info");
  });

  it("is quiet for a released 1.x, and gets there without anyone editing it", () => {
    expect(defaultLogLevel("1.0.0")).toBe("warn");
    expect(defaultLogLevel("2.3.4")).toBe("warn");
  });

  it("stays verbose for a per-commit build of a released line", () => {
    /* `1.0.1-edge.3` is a 1.x number and it is still a build off master that
     * nobody has tested. The edge check has to come FIRST, and this is the case
     * that fails if somebody reorders the two conditions - which reads harmless,
     * because every version today is 0.x and both branches agree. */
    expect(defaultLogLevel("1.0.1-edge.3")).toBe("info");
  });
});

describe("the ring", () => {
  const at = (n: number) => vi.fn(() => n);

  it("keeps records in order and hands them back oldest first", () => {
    const log = createLog({ level: "info", now: at(1000) });
    log.info("a", "one");
    log.info("a", "two");
    log.warn("b", "three");
    expect(log.recent().map((r) => r.msg)).toEqual(["one", "two", "three"]);
    expect(log.recent(2).map((r) => r.msg)).toEqual(["two", "three"]);
    expect(log.dropped()).toBe(0);
  });

  it("drops the oldest when full, and says how many it dropped", () => {
    /* "the last 2000 lines" and "the whole session" are the same text file. The
     * count is the only thing that says whether what you are looking for could
     * still be above the top. */
    const log = createLog({ level: "info", capacity: 3, now: at(1) });
    for (const m of ["a", "b", "c", "d", "e"]) log.info("x", m);
    expect(log.recent().map((r) => r.msg)).toEqual(["c", "d", "e"]);
    expect(log.dropped()).toBe(2);
  });

  it("does not record what the level excludes, rather than recording and hiding it", () => {
    /* A ring that stored everything and filtered on the way out would put debug
     * detail into a report from a released build - the exact thing the level is
     * there to keep out. */
    const log = createLog({ level: "warn", now: at(1) });
    log.error("x", "kept");
    log.warn("x", "kept");
    log.info("x", "dropped");
    log.debug("x", "dropped");
    expect(log.recent().map((r) => r.msg)).toEqual(["kept", "kept"]);
  });

  it("changes level at runtime without losing what is already in it", () => {
    const log = createLog({ level: "warn", now: at(1) });
    log.info("x", "before");
    log.warn("x", "kept");
    log.setLevel("debug");
    log.info("x", "after");
    expect(log.level).toBe("debug");
    expect(log.recent().map((r) => r.msg)).toEqual(["kept", "after"]);
  });

  it("survives a capacity of one, and of nonsense", () => {
    const one = createLog({ level: "info", capacity: 1, now: at(1) });
    one.info("x", "a");
    one.info("x", "b");
    expect(one.recent().map((r) => r.msg)).toEqual(["b"]);
    const zero = createLog({ level: "info", capacity: 0, now: at(1) });
    zero.info("x", "a");
    expect(zero.recent()).toHaveLength(1);
  });
});

describe("sinks", () => {
  it("gets the record and the rendered line, and can be removed", () => {
    const log = createLog({ level: "info", now: () => 0 });
    const seen: string[] = [];
    const stop = log.addSink((_rec, line) => seen.push(line));
    log.info("area", "hello");
    stop();
    log.info("area", "unseen");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("[area] hello");
  });

  it("a sink that throws costs its own line and nothing else", () => {
    /* The file sink CAN throw - a full disk, a closed IPC channel - and it is
     * usually throwing while something else is already going wrong. Losing the
     * other sinks there would lose the evidence about the original failure. */
    const log = createLog({ level: "info", now: () => 0 });
    const seen: string[] = [];
    log.addSink(() => {
      throw new Error("disk full");
    });
    log.addSink((rec) => seen.push(rec.msg));
    expect(() => log.warn("x", "still logged")).not.toThrow();
    expect(seen).toEqual(["still logged"]);
    expect(log.recent()).toHaveLength(1);
  });
});

describe("describing a value without throwing", () => {
  it("renders an Error's name, message and stack rather than {}", () => {
    /* None of the three is enumerable, so the obvious object branch renders
     * every Error as an empty object - the single least useful thing a log can
     * say about a failure. */
    const err = new TypeError("bad thing");
    const text = describeValue(err);
    expect(text).toContain("TypeError");
    expect(text).toContain("bad thing");
    expect(text).toContain("stack");
  });

  it("follows an error cause", () => {
    const text = describeValue(new Error("outer", { cause: new Error("inner") }));
    expect(text).toContain("inner");
  });

  it("marks a cycle instead of recursing into it", () => {
    const a: Record<string, unknown> = { name: "a" };
    a["self"] = a;
    expect(describeValue(a)).toContain("[circular]");
  });

  it("lets the same object appear twice when it is not a cycle", () => {
    /* A seen-set that is never cleaned marks the SECOND sibling reference as
     * circular, which is a lie about the data. */
    const shared = { n: 1 };
    expect(describeValue({ a: shared, b: shared })).toBe('{"a":{"n":1},"b":{"n":1}}');
  });

  it("handles the values JSON.stringify refuses or drops", () => {
    expect(describeValue(10n)).toBe('"10n"');
    expect(describeValue(function named() {})).toContain("[function named]");
    expect(describeValue(Symbol("s"))).toContain("Symbol(s)");
  });

  it("caps depth, array length and string length", () => {
    let deep: unknown = "bottom";
    for (let i = 0; i < 12; i++) deep = { down: deep };
    expect(describeValue(deep)).toContain("[...]");
    expect(describeValue(Array.from({ length: 500 }, (_, i) => i))).toContain("500 items");
    const huge = "x".repeat(LOG_FIELD_MAX * 3);
    expect(describeValue(huge).length).toBeLessThan(LOG_FIELD_MAX + 64);
  });

  it("survives a getter that throws", () => {
    const hostile = {
      get boom(): never {
        throw new Error("no");
      },
    };
    expect(() => describeValue(hostile)).not.toThrow();
    expect(describeValue(hostile)).toBe("[undescribable]");
  });
});

describe("the line", () => {
  const rec = (over: Partial<LogRecord> = {}): LogRecord => ({
    at: Date.UTC(2026, 7, 2, 13, 6, 9, 123),
    level: "warn",
    area: "update",
    msg: "nothing to install",
    ...over,
  });

  it("is a timestamp, a padded level, an area and the message", () => {
    expect(formatLogLine(rec())).toBe(
      "2026-08-02T13:06:09.123Z WARN  [update] nothing to install",
    );
  });

  it("puts the detail after a bar, so the message can be found by eye", () => {
    expect(formatLogLine(rec({ level: "error", data: '{"code":404}' }))).toBe(
      '2026-08-02T13:06:09.123Z ERROR [update] nothing to install | {"code":404}',
    );
  });

  it("does not lose the line to an impossible timestamp", () => {
    expect(formatLogLine(rec({ at: Number.NaN }))).toContain("nothing to install");
  });

  it("is what a sink receives, so a file sink never reformats", () => {
    const log = createLog({ level: "info", now: () => Date.UTC(2026, 7, 2) });
    let line = "";
    log.addSink((r, l) => {
      line = l;
      expect(l).toBe(formatLogLine(r));
    });
    log.info("save", "wrote", { slot: 2 });
    expect(line).toBe('2026-08-02T00:00:00.000Z INFO  [save] wrote | {"slot":2}');
  });
});

describe("eliding the home directory", () => {
  it("replaces it wherever it appears, in either separator style", () => {
    const home = "C:\\Users\\somebody";
    const text = `failed to open C:\\Users\\somebody\\Games\\save at file:///C:/Users/somebody/x.js`;
    const out = elideHome(text, home);
    expect(out).toBe("failed to open ~\\Games\\save at file:///~/x.js");
  });

  it("catches the JSON-escaped form, which is how paths actually reach the log", () => {
    /*
     * THE CASE THAT WAS MISSED. describeValue JSON-encodes its detail, so every
     * Windows path in a log line has DOUBLED backslashes - and a matcher that
     * only knew the raw and URL spellings matched none of them. The first
     * version of this function shipped that way and the two tests above passed,
     * because both used a hand-written path rather than a real log line.
     */
    const line = `ERROR [save] failed | {"path":"C:\\\\Users\\\\somebody\\\\save"}`;
    expect(elideHome(line, "C:\\Users\\somebody")).toBe(`ERROR [save] failed | {"path":"~\\\\save"}`);
  });

  it("handles all three spellings in one line", () => {
    const home = "C:\\Users\\somebody";
    const line = `C:\\Users\\somebody\\a {"p":"C:\\\\Users\\\\somebody\\\\b"} file:///C:/Users/somebody/c`;
    expect(elideHome(line, home)).toBe(`~\\a {"p":"~\\\\b"} file:///~/c`);
  });

  it("ignores case, because Windows paths do", () => {
    expect(elideHome("c:\\users\\SomeBody\\a", "C:\\Users\\somebody")).toBe("~\\a");
  });

  it("tolerates a trailing separator on the home path", () => {
    expect(elideHome("/home/somebody/a", "/home/somebody/")).toBe("~/a");
  });

  it("refuses to act on a home path too short to be one", () => {
    /* An empty or one-character home would replace half the file with tildes. */
    expect(elideHome("a/b/c", "")).toBe("a/b/c");
    expect(elideHome("a/b/c", undefined)).toBe("a/b/c");
    expect(elideHome("a/b/c", "/")).toBe("a/b/c");
  });

  it("is not fooled by regex characters in the path", () => {
    expect(elideHome("/home/a.b(c)/x", "/home/a.b(c)")).toBe("~/x");
  });
});
