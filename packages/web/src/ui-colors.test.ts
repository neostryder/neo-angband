/**
 * Palette-lint: the static half of the REND-2 / COLOR-* visual-parity gate.
 *
 * Every colour the shell paints into a terminal cell must come from the ported
 * z-color table (core/color.ts COLOR_TABLE == reference z-color.c
 * angband_color_table). This test fails the build if any UI source contains a
 * #rrggbb literal that is NOT a palette member, so an "invented pastel" can
 * never creep back in.
 *
 * The only lines allowed to carry an off-palette #rrggbb are those explicitly
 * marked `palette-exempt` - a short, reviewed set of map-lighting and DOM
 * browser-affordance values that are deliberately not terminal-glyph chrome
 * (documented at each site). The live half of the gate reads the actual
 * rendered grid via GlyphTerm.snapshotColored() (see term.ts).
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { colorToCss, MAX_COLORS } from "@neo-angband/core";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Every CSS colour the ported palette can produce, lower-cased. */
const PALETTE = new Set(
  Array.from({ length: MAX_COLORS }, (_, i) => colorToCss(i).toLowerCase()),
);

const HEX = /#[0-9a-fA-F]{6}\b/g;

function tsSources(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...tsSources(full));
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".test.ts"))
      out.push(full);
  }
  return out;
}

describe("UI palette lint", () => {
  it("uses no #rrggbb outside the ported z-color palette (except annotated exemptions)", () => {
    const violations: string[] = [];
    for (const file of tsSources(SRC_DIR)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.includes("palette-exempt")) return;
        const matches = line.match(HEX);
        if (!matches) return;
        for (const hex of matches) {
          if (!PALETTE.has(hex.toLowerCase())) {
            const rel = file.slice(SRC_DIR.length + 1).replace(/\\/g, "/");
            violations.push(`${rel}:${i + 1}: ${hex}`);
          }
        }
      });
    }
    expect(violations, `off-palette colours:\n${violations.join("\n")}`).toEqual(
      [],
    );
  });

  it("exposes the anchor colours at their z-color values", () => {
    // Guards the semantic anchors REND-2 depends on (curs_attrs, -more-).
    expect(colorToCss(1).toLowerCase()).toBe("#ffffff"); // WHITE  labels/normal
    expect(colorToCss(2).toLowerCase()).toBe("#808080"); // SLATE  dim/disabled
    expect(colorToCss(14).toLowerCase()).toBe("#00ffff"); // L_BLUE cursor/-more-
  });
});
