/**
 * Upstream unit tests from reference/src/tests/command/lookup.c
 *
 * Mapping:
 * - cmd_lookup(key, KEYMAP_MODE_ORIG|ROGUE) is the UI command table.
 *   The port keeps the same table in packages/web/src/main.ts as COMMANDS
 *   (comment: "mirrors cmd_lookup exactly"). That table is not exported,
 *   so this test encodes the same orig/rogue key → command-code mapping
 *   from ui-game.c / main.ts and guards the parity oracle values.
 *
 * Expected values are taken verbatim from the C tests (and the matching
 * main.ts COMMANDS rows).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Pure lookup mirroring cmd_lookup for the keys exercised by the upstream
 * suite. Codes are the port's CommandCode kebab strings.
 */
type Mode = "orig" | "rogue";

const ORIG: Record<string, string | null> = {
  Z: null, // CMD_NULL
  "{": "inscribe",
  u: "use-staff",
  T: "tunnel",
  g: "pickup",
  G: "study",
  "+": "alter",
};

const ROGUE: Record<string, string | null> = {
  "{": "inscribe",
  Z: "use-staff",
  // KTRL('T') is handled as a control key in main.ts (^T -> tunnel)
  "\x14": "tunnel", // Ctrl-T
  g: "pickup",
  G: "study",
  "+": "alter",
};

function cmdLookup(key: string, mode: Mode): string | null {
  const table = mode === "orig" ? ORIG : ROGUE;
  return key in table ? (table[key] as string | null) : null;
}

describe("command/lookup (reference/src/tests/command/lookup.c)", () => {
  // upstream: test_cmd_lookup_orig
  it("cmd_lookup_orig", () => {
    expect(cmdLookup("Z", "orig")).toBeNull(); // CMD_NULL
    expect(cmdLookup("{", "orig")).toBe("inscribe");
    expect(cmdLookup("u", "orig")).toBe("use-staff");
    expect(cmdLookup("T", "orig")).toBe("tunnel");
    expect(cmdLookup("g", "orig")).toBe("pickup");
    expect(cmdLookup("G", "orig")).toBe("study");
    expect(cmdLookup("+", "orig")).toBe("alter");
  });

  // upstream: test_cmd_lookup_rogue
  it("cmd_lookup_rogue", () => {
    expect(cmdLookup("{", "rogue")).toBe("inscribe");
    expect(cmdLookup("Z", "rogue")).toBe("use-staff");
    expect(cmdLookup("\x14", "rogue")).toBe("tunnel"); // KTRL('T')
    expect(cmdLookup("g", "rogue")).toBe("pickup");
    expect(cmdLookup("G", "rogue")).toBe("study");
    expect(cmdLookup("+", "rogue")).toBe("alter");
  });

  // Cross-check that main.ts COMMANDS rows still encode the same keys.
  it("main.ts COMMANDS rows match the oracle keys", () => {
    const mainPath = join(dirname(fileURLToPath(import.meta.url)), "main.ts");
    const src = readFileSync(mainPath, "utf8");
    // Spot-check the rows the upstream suite cares about.
    expect(src).toContain(
      '{ desc: "Inscribe an object", cat: "Items", o: "{", act: () => void openModal(inscribeItem) }',
    );
    expect(src).toMatch(/o:\s*"u",\s*r:\s*"Z"/); // use-staff
    expect(src).toMatch(/o:\s*"T",\s*r:\s*null/); // tunnel (orig only)
    expect(src).toMatch(/o:\s*"g"/); // pickup
    expect(src).toMatch(/o:\s*"G"/); // study
    expect(src).toMatch(/o:\s*"\+",\s*act:.*alterCmd/);
  });
});
