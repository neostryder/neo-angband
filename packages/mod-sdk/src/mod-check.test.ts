/**
 * `neo-angband-mod-check`: the author-side door onto the same rules the game
 * enforces at install.
 *
 * The rules themselves are tested in standards.test.ts, each shown able to fail.
 * This file is about REACH: that the published bin actually calls those rules,
 * so a typo'd capability that checkMod would refuse is also refused by the
 * command an author runs. A test that imported checkMod would prove the
 * function; this proves the tool.
 *
 * It shells out rather than importing the checker: a test that reimplements the
 * CLI proves the reimplementation. The bin loads `dist/`, so this file assumes
 * a prior `pnpm build`.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const PKG = join(import.meta.dirname, "..");
const BIN = join(PKG, "bin", "neo-angband-mod-check.mjs");

const temps: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "neo-mod-check-"));
  temps.push(d);
  return d;
}
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const GOOD = {
  id: "demo",
  name: "Demo",
  version: "1.2.0",
  shape: "plugin",
  engine: ">=0.18.0",
  license: "MIT",
  author: "neostryder",
  repository: "https://github.com/neostryder/neo-angband-mod-demo",
  description: "A mod that exists to be checked, with a description long enough to count.",
};

interface Run {
  readonly code: number;
  readonly out: string;
}

function writeMod(manifest: unknown): string {
  const dir = tempDir();
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return dir;
}

/** Run the checker over one folder. Never throws, so a failure is a value to assert on. */
function run(dir: string, extra: readonly string[] = []): Run {
  try {
    const out = execFileSync(process.execPath, [BIN, dir, ...extra], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("a well-formed mod passes", () => {
  it("exits 0 and says so", () => {
    const r = run(writeMod(GOOD));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/All clear|Installable/u);
  });
});

describe("the capability grammar is the loader's, not a second copy", () => {
  it("refuses a typo'd capability with parseCapability's own words", () => {
    const r = run(writeMod({ ...GOOD, capabilities: ["comand:add"] }));
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toContain("unrecognized capability");
    expect(r.out).toContain("comand:add");
    expect(r.out).toContain("capabilities-recognized");
  });

  it("refuses a content pack that requests capabilities", () => {
    const r = run(
      writeMod({ ...GOOD, shape: "content", capabilities: ["command:add"] }),
    );
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/only shape "plugin"/u);
  });

  it("accepts a plugin whose capabilities parse", () => {
    const r = run(writeMod({ ...GOOD, capabilities: ["command:add", "event:turn-start"] }));
    expect(r.code, r.out).toBe(0);
  });
});

describe("--list names every rule", () => {
  it("prints the capability rule among the rest", () => {
    const r = run(".", ["--list"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("capabilities-recognized");
    expect(r.out).toContain("Request only capabilities the game knows");
  });
});
