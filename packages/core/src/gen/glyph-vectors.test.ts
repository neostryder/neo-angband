/**
 * Replay of the room-template / vault glyph golden vectors.
 *
 * WHAT THIS EXISTS TO CATCH. The three glyph-decode loops in `room.ts` were
 * closed `switch` statements; they are now a keyed registry so a mod can teach
 * the game a new glyph. A registry changes WHO CAN REGISTER, never what the
 * unmodded game draws - and "never" is a claim that needs 3,996 pieces of
 * evidence, not an assertion.
 *
 * `glyph-vectors.json` was recorded from the code BEFORE the registry existed
 * (commit that introduced this file; see the module header of
 * `glyph-vectors.ts`). Every vector here re-runs the same build and compares
 * the whole chunk, every placement, and the RNG position afterwards.
 *
 * THE CONTROL: changing any core handler - say, making a vault's `>` place a
 * down staircase unconditionally instead of consulting the quest and depth
 * gate - fails a large block of these, and the failure names the vault. That
 * was run, not assumed.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeGlyphVectors,
  GLYPH_VECTOR_DEPTHS,
  GLYPH_VECTOR_SEEDS,
  SYNTHETIC_ROOMS,
  SYNTHETIC_VAULTS,
} from "./glyph-vectors.js";
import type { GlyphVector } from "./glyph-vectors.js";
import { glyphVectorFixtures } from "./glyph-vectors.fixtures.js";
import { createGlyphRegistry } from "./room.js";

const recorded = JSON.parse(
  readFileSync(new URL("./glyph-vectors.json", import.meta.url), "utf8"),
) as GlyphVector[];

describe("room-template and vault glyph decoding", () => {
  const fresh = computeGlyphVectors(glyphVectorFixtures());

  it("records the same number of scenarios as when the fixture was taken", () => {
    /* A template or vault leaving the pack, or a seed/depth dropping out of the
     * grid, would otherwise silently shrink the evidence rather than fail it. */
    expect(fresh.length).toBe(recorded.length);
    expect(recorded.length).toBeGreaterThan(3000);
  });

  it("covers both the pack's templates and vaults and the synthetic ones", () => {
    const kinds = new Set(fresh.map((v) => v.kind));
    expect([...kinds].sort()).toEqual(["template", "vault"]);
    /* The synthetic scenarios are the only cover for glyphs the pack does not
     * use; if they stop being recorded the alphabet stops being tested. */
    const synthetic = fresh.filter((v) => v.name.startsWith("SYNTHETIC"));
    expect(synthetic.length).toBe(
      4 * GLYPH_VECTOR_SEEDS.length * GLYPH_VECTOR_DEPTHS.length,
    );
  });

  it("runs every glyph core decodes through at least one scenario", () => {
    /* WHY: a handler no scenario reaches is a handler no vector can defend.
     * This was not hypothetical - the first control run broke a vault's `>`
     * and PASSED, because nothing in the grid reached the arm. The depth list
     * grew a 127 for that, and this assertion is what stops the next one. */
    const fx = glyphVectorFixtures();
    const r = createGlyphRegistry();
    const used = {
      template: new Set<string>(
        [...fx.templates(), ...SYNTHETIC_ROOMS].flatMap((t) => t.rows.flatMap((row) => [...row])),
      ),
      vault: new Set<string>(
        [...fx.vaults(), ...SYNTHETIC_VAULTS].flatMap((v) => v.rows.flatMap((row) => [...row])),
      ),
    };
    for (const kind of ["template", "vault"] as const) {
      const unreached = r.glyphs(kind).filter((ch) => !used[kind].has(ch));
      expect({ kind, unreached }).toEqual({ kind, unreached: [] });
    }
  });

  it("lays every template and vault exactly as recorded, RNG position included", () => {
    const moved: string[] = [];
    for (let i = 0; i < fresh.length; i++) {
      const a = recorded[i];
      const b = fresh[i];
      if (!a || !b) {
        moved.push(`#${String(i)}: missing`);
        continue;
      }
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        moved.push(
          `${b.kind} "${b.name}" seed ${String(b.seed)} depth ${String(b.depth)}: ` +
            `grid ${a.grid}->${b.grid}, ` +
            `objects ${String(a.objects.length)}->${String(b.objects.length)}, ` +
            `monsters ${String(a.monsters.length)}->${String(b.monsters.length)}, ` +
            `traps ${String(a.traps.length)}->${String(b.traps.length)}, ` +
            `probe ${String(a.rngProbe)}->${String(b.rngProbe)}`,
        );
      }
    }
    expect(moved.slice(0, 10)).toEqual([]);
    expect(moved.length).toBe(0);
  });
});
