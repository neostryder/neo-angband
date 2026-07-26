/**
 * The dispatch proof: every effect upstream can invoke has an implementation the
 * port can reach.
 *
 * `reference/src/list-effects.h` declares 112 effects, and the C's
 * `effect_handler_f effect_handlers[]` (`reference/src/effects.c`) supplies one
 * function per EF -- an effect with no handler is a hole in the game, because any
 * object, spell, monster spell, trap or terrain that names it does nothing.
 *
 * The port splits those handlers across nine registries by subject
 * (attack/detect/general/item/melee/monster/summon/teleport/terrain), each
 * publishing its keys as `*_HANDLER_CODES`. Nothing consumed those arrays: the
 * wiring census found all nine of them orphaned, which is exactly how a missing
 * handler would go unnoticed. This is what consumes them.
 *
 * `generated/codegen-drift.test.ts` proves the EF table still matches the
 * reference header; this proves each entry in that table is implemented. Neither
 * proves a handler is CORRECT -- that is what the behaviour tests are for.
 */

import { describe, expect, it } from "vitest";
import { EF, EFFECT_ENTRIES } from "../generated";
import { EFFECT_HANDLER_MANIFEST } from "../effects/handlers";
import { ATTACK_HANDLER_CODES } from "./effect-attack";
import { DETECT_HANDLER_CODES } from "./effect-detect";
import { GENERAL_HANDLER_CODES } from "./effect-general";
import { ITEM_HANDLER_CODES } from "./effect-item";
import { MELEE_HANDLER_CODES } from "./effect-melee";
import { MONSTER_HANDLER_CODES } from "./effect-monster";
import { SUMMON_HANDLER_CODES } from "./effect-summon";
import { TELEPORT_HANDLER_CODES } from "./effect-teleport";
import { TERRAIN_HANDLER_CODES } from "./effect-terrain";

/** EF codes for a list of upstream effect names (the manifest speaks in names). */
const codesFor = (names: readonly string[]): readonly number[] =>
  names
    .map((n) => EF[n as keyof typeof EF] as number | undefined)
    .filter((c) => c !== undefined);

const REGISTRIES = {
  /* The subject-neutral base registry in effects/handlers.ts, which owns the
   * effects the interpreter itself resolves (RANDOM, SELECT, the TIMED_* family,
   * SET_VALUE/CLEAR_VALUE and friends). */
  base: codesFor(EFFECT_HANDLER_MANIFEST.implemented),
  basePartial: codesFor(EFFECT_HANDLER_MANIFEST.partial),
  attack: ATTACK_HANDLER_CODES,
  detect: DETECT_HANDLER_CODES,
  general: GENERAL_HANDLER_CODES,
  item: ITEM_HANDLER_CODES,
  melee: MELEE_HANDLER_CODES,
  monster: MONSTER_HANDLER_CODES,
  summon: SUMMON_HANDLER_CODES,
  teleport: TELEPORT_HANDLER_CODES,
  terrain: TERRAIN_HANDLER_CODES,
} as const;

/** EF value -> upstream effect name, for readable failures. */
const nameOf = (code: number): string =>
  (EFFECT_ENTRIES[code - 1] as { name: string } | undefined)?.name ?? `EF#${code}`;

describe("effect handler coverage vs reference/src/list-effects.h", () => {
  it("implements every effect in the upstream table", () => {
    const implemented = new Map<number, string[]>();
    for (const [registry, codes] of Object.entries(REGISTRIES)) {
      for (const code of codes) {
        if (!implemented.has(code)) implemented.set(code, []);
        implemented.get(code)!.push(registry);
      }
    }

    const missing: string[] = [];
    for (let code = EF.NONE + 1; code <= EFFECT_ENTRIES.length; code++) {
      if (!implemented.has(code)) missing.push(`EF_${nameOf(code)} (${code})`);
    }
    expect(
      missing,
      `${missing.length} upstream effect(s) have no port handler:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("has no effect left only partially implemented", () => {
    /* effects/handlers.ts distinguishes fully-implemented handlers from PARTIAL
     * ones. A partial handler is a divergence by definition, so the set is
     * pinned: it may shrink, never grow. Empty is the goal. */
    const KNOWN_PARTIAL: readonly string[] = ["DAMAGE", "TIMED_INC"];
    expect(
      [...EFFECT_HANDLER_MANIFEST.partial].sort(),
      "the PARTIAL handler set changed; a partial handler is a parity gap, so " +
        "this list may shrink but must never grow",
    ).toEqual([...KNOWN_PARTIAL].sort());
  });

  it("registers each effect in exactly one registry", () => {
    const seen = new Map<number, string[]>();
    for (const [registry, codes] of Object.entries(REGISTRIES)) {
      /* basePartial overlaps by design: its two entries are superseded by the
       * full handlers in the attack and general registries, and are kept only so
       * the manifest can report them. Every OTHER overlap is a real hazard. */
      if (registry === "basePartial") continue;
      for (const code of codes) {
        if (!seen.has(code)) seen.set(code, []);
        seen.get(code)!.push(registry);
      }
    }
    /* Two registries claiming one effect means the dispatch result depends on
     * lookup order -- the divergence would be silent and intermittent. */
    const duplicated = [...seen.entries()]
      .filter(([, regs]) => regs.length > 1)
      .map(([code, regs]) => `EF_${nameOf(code)} in ${regs.join(" + ")}`);
    expect(duplicated, duplicated.join("\n")).toEqual([]);
  });

  it("registers no effect outside the upstream table", () => {
    const stray: string[] = [];
    for (const [registry, codes] of Object.entries(REGISTRIES)) {
      for (const code of codes) {
        if (code <= EF.NONE || code > EFFECT_ENTRIES.length) {
          stray.push(`${registry}: ${code}`);
        }
      }
    }
    expect(stray, stray.join("\n")).toEqual([]);
  });
});
