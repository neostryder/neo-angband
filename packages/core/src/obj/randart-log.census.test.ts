/**
 * randart.log coverage, MEASURED against the C rather than claimed (5.5).
 *
 * WHY A CENSUS AND NOT A GOLDEN FILE. There is no compiled Angband in this
 * repository and no toolchain to build one, so no byte-for-byte diff of a real
 * randart.log is available. Saying "the log is ported" without one would be a
 * claim with nothing behind it. What CAN be measured exactly is the set of
 * format strings: upstream emits one per site, and a site that has no
 * counterpart in the port is a line the file will be missing.
 *
 * So this test extracts every `log_obj(...)` in obj-power.c and every
 * `file_putf(log_file, ...)` in obj-randart.c, reduces each format string to
 * its literal spans, and requires each span to appear in the port. It is a
 * RATCHET: `EXPECTED_MISSING` is the count still outstanding, and the test
 * fails if that number goes UP (a regression) or DOWN (finish the row and
 * lower the number). A list that can drift silently is the same as no list.
 *
 * It cannot prove ORDER or ARGUMENTS. Those are covered by the port's function
 * decomposition being 1:1 with the C's - each emitter sits inside the function
 * that owns it - and by randart-log.test.ts, which runs a real generation and
 * reads the text.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REF = new URL("../../../../reference/src/", import.meta.url);
const SRC = new URL("./", import.meta.url);

function read(base: URL, name: string): string {
  return readFileSync(new URL(name, base), "utf8");
}

/**
 * Every literal span of a C format string, in order: "Add %d for slays\n"
 * yields ["Add ", " for slays"]. Trailing "\n" and spans shorter than four
 * characters are dropped - " " and "x" match everything and would make the
 * check unfalsifiable.
 */
function literalSpans(fmt: string): string[] {
  return fmt
    .replace(/\\n/g, "\n")
    .split(/%[-+ #0-9.]*(?:l|ll|h|hh|z)?[diouxXeEfgGcsp%]/)
    .map((s) => s.replace(/\n/g, "").trim())
    .filter((s) => s.length >= 4);
}

/** Pull the (possibly continued) string literal out of each matching call. */
function formatStrings(src: string, callPattern: RegExp): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(callPattern)) {
    const parts = m[1]!.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
    out.push(parts.map((p) => p.slice(1, -1)).join(""));
  }
  return out;
}

const PORT = [
  "power.ts",
  "randart.ts",
  "randart-data.ts",
  "randart-build.ts",
  "randart-log.ts",
]
  .map((f) => read(SRC, f))
  .join("\n");

interface Site {
  file: string;
  fmt: string;
  spans: string[];
}

function sites(file: string, pattern: RegExp): Site[] {
  return formatStrings(read(REF, file), pattern)
    .map((fmt) => ({ file, fmt, spans: literalSpans(fmt) }))
    .filter((s) => s.spans.length > 0);
}

/** log_obj(...) in obj-power.c, minus the definition's own `fmt` parameter. */
const POWER_SITES = sites(
  "obj-power.c",
  /log_obj\(\s*((?:"(?:[^"\\]|\\.)*"\s*)+)/g,
);
/** file_putf(log_file, ...) in obj-randart.c. */
const RANDART_SITES = sites(
  "obj-randart.c",
  /file_putf\(log_file,\s*((?:"(?:[^"\\]|\\.)*"\s*)+)/g,
);

/** A site is covered when every one of its literal spans is in the port. */
function covered(s: Site): boolean {
  return s.spans.every((span) => PORT.includes(span));
}

/**
 * The obj-randart.c sites still to write, counted 2026-08-06. Lower this as the
 * row is finished; it must never rise.
 *
 * Down to ONE: do_randart's randart.txt header, which upstream writes only
 * under `create_file` by reusing the log_file handle for a second file.
 *
 * ONE IS NOT THE WHOLE REMAINDER. This number counts only sites the span
 * filter can SEE, and a format string with no literal span of four characters
 * is invisible to it - "%s\n" reduces to nothing at all. The spanless sites
 * are enumerated and given a status by the test below, so the gap has a name
 * instead of hiding inside a reassuring 1.
 *
 * Everything else - the count_* family, parse_frequencies,
 * collect_artifact_data, artifact_power's header pair, the whole add_* family,
 * store_base_power, get_base_item, artifact_prep, build_freq_table,
 * try_supercharge, choose_ability, make_bad and design_artifact - landed
 * 2026-08-07, taking this from 122 to 1.
 */
const EXPECTED_MISSING_RANDART = 1;

/**
 * Spanless sites the port does NOT emit. Only one: artifact_power's
 * object_desc line. A ratchet rather than an assertion, because no expectation
 * over the port's text can distinguish "not written" from "written differently".
 */
const UNWRITTEN_SPANLESS = 1;

describe("randart.log covers obj-power.c (PORT_TODO 5.5)", () => {
  it("finds the C's log sites at all", () => {
    /* A fixture guard: an extraction that matched nothing would make every
     * assertion below pass for free. 60 = 59 emitters + log_obj's own `fmt`,
     * which has no literal spans and is filtered out above. */
    expect(POWER_SITES.length).toBeGreaterThanOrEqual(55);
  });

  it("every obj-power.c log line has a counterpart in the port", () => {
    const missing = POWER_SITES.filter((s) => !covered(s)).map((s) => s.fmt);
    expect(missing).toEqual([]);
  });
});

describe("randart.log coverage of obj-randart.c (PORT_TODO 5.5, in progress)", () => {
  it("finds the C's log sites at all", () => {
    expect(RANDART_SITES.length).toBeGreaterThanOrEqual(170);
  });

  it("is at exactly the recorded coverage - a ratchet in both directions", () => {
    const missing = RANDART_SITES.filter((s) => !covered(s));
    expect(
      missing.length,
      missing.length > EXPECTED_MISSING_RANDART
        ? "a randart.log line was LOST - see the first few missing below"
        : "randart.log gained coverage: lower EXPECTED_MISSING_RANDART to " +
          String(missing.length),
    ).toBe(EXPECTED_MISSING_RANDART);
  });

  /**
   * A format string of pure conversions ("%s\n") or three spaces has no span
   * this census can match on, so `sites()` drops it and the ratchet never sees
   * it. That is a blind spot, and a blind spot with no inventory is a claim
   * that the number above is the whole truth. So: enumerate them, and state
   * what the port does with each.
   */
  it("names the sites the span filter cannot see, and their status", () => {
    const spanless = (file: string, pattern: RegExp): string[] =>
      formatStrings(read(REF, file), pattern).filter(
        (fmt) => literalSpans(fmt).length === 0,
      );

    expect(
      spanless("obj-randart.c", /file_putf\(log_file,\s*((?:"(?:[^"\\]|\\.)*"\s*)+)/g),
    ).toEqual(["%s\\n", "   "]);
    expect(
      spanless("obj-power.c", /log_obj\(\s*((?:"(?:[^"\\]|\\.)*"\s*)+)/g),
    ).toEqual(["%sx%d ", "%sx%d "]);

    /* Three of the four ARE written; assert the distinctive shape of each so
     * this cannot rot into a comment. */
    expect(PORT).toContain('randartLog("   ")'); // make_bad's indent
    expect(PORT).toContain("}x${b.multiplier} `"); // obj-power.c brands
    expect(PORT).toContain("}x${sl.multiplier} `"); // obj-power.c slays

    /* The fourth is artifact_power's object_desc of the fake artifact
     * (obj-randart.c:205-206), and it is NOT written: object_desc needs a
     * KnownDesc this pure module does not hold. There is no assertion that
     * can prove an absence, so it is carried as a number instead - lower this
     * to 0 when the line lands, and PORT_TODO 5.5 stays open until it does. */
    expect(UNWRITTEN_SPANLESS).toBe(1);
  });

  it("the sites already written stay written", () => {
    /* Named explicitly so the ratchet above cannot be satisfied by losing one
     * of these and gaining another. */
    for (const span of [
      "instances of extra to-hit bonus for weapon",
      "for super-charged damage dice!",
      "for supercharged blows (3 or more!)",
      "for aggravation - nonweapon",
      "for AC bonus - body armor",
      "instances of extra to-hit and to-dam bonus for gloves",
    ]) {
      expect(PORT, span).toContain(span);
    }
  });
});
