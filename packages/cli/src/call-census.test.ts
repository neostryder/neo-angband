/**
 * THE RATCHET on dead ported code.
 *
 * call-census.ts tier 1: the port DEFINES a function of an upstream name and
 * then never mentions it - not called, not passed as a callback, not
 * re-exported. Upstream calls it, so something on the port side is unwired.
 *
 * This test fails if any tier-1 entry is not listed below with a reason. It is
 * the companion to text-census.test.ts: that one catches text the port never
 * says, this one catches a caller the port never wires. The second kind is what
 * play sessions kept finding, because the ported function reads perfectly - the
 * defect is somewhere else, in a call that does not exist.
 *
 * It also fails in the OTHER direction: an entry here whose symbol the port now
 * uses must be deleted, so the list cannot rot into a pile of excuses.
 *
 * Reason keys are prefixed by category:
 *   renamed   - the port does the same work under a different name, and the
 *               unused same-named export is a leftover. Named the real one.
 *   reduced   - the port models this area differently (a documented, ledgered
 *               reduction), so the faithful helper exists ahead of the model
 *               that will use it.
 *   host      - the C function belongs to a layer the port replaces wholesale
 *               (the command queue's arg store, textblocks, the z-layer).
 *   dead-in-c - nothing calls it upstream either, or the only caller passes the
 *               argument that makes it a no-op.
 *   LEAD      - a real candidate not yet run to ground. Tracked, not excused.
 *
 * WHAT THIS IS NOT: it compares call COUNTS, not call CORRECTNESS. A port that
 * calls the right function from the wrong place passes.
 */

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runCallCensus } from "./call-census";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** C function name -> why the port defines it and never uses it. */
const KNOWN_UNUSED: Record<string, readonly string[]> = {
  "renamed: the port does this work under another name; the same-named export is a leftover":
    [
      /* mon-place.ts:224 calls createDrop for exactly this, at exactly
       * mon-make.c:1046. mon-death.ts also exports monCreateDrop, which
       * nothing reaches. */
      "mon_create_drop",
      /* game/pathfind + player-path own the direction walk; the C's
       * pathfind_direction_to has one caller and the port reaches the same
       * result through motionDir. */
      "pathfind_direction_to",
    ],

  "reduced: the port models this area with a flatter structure, and the faithful helper waits on the fuller one (documented in known.ts:6-12 and ledgered)":
    [
      /* squareKnowPile / squareSensePile work against the flat
       * remembered-object marker, not a per-object known twin, so the exact
       * object_see / object_sense / object_grab lifecycle has nothing to drive
       * it yet. cave-square.c:1152, :1179; mon-util.c:1486, :1512. */
      "object_see",
      "object_sense",
      "object_grab",
      /* obj-knowledge.c:406/414 rune notes: the port autoinscribes through
       * state.autoinscribeAll / autoinscribeObject rather than a per-rune note
       * store, so runeSetNote and getAutoinscription have no caller. */
      "rune_set_note",
      "get_autoinscription",
      /* mon-lore.c:441 is used by upstream's lore-menu completeness display;
       * the port's monster recall renders from the same lore counters without
       * the boolean. */
      "lore_is_fully_known",
      /* obj-pile.c:248. Both upstream consumers (gear_last_item ->
       * combine_pack, obj-ignore.c ignore_drop) use it only to walk the gear
       * list BACKWARDS, which over the port's array is a reversed index loop
       * (game/gear.ts combinePack, game/ignore-cmd.ts) - there is no tail
       * pointer to fetch. Ported and kept for the diff; nothing can call it. */
      "pile_last_item",
    ],

  "host: the C layer the port replaces wholesale, so the ported shape has no caller by construction":
    [
      /* cmd-core.c's arg store: the port's commands carry typed args on the
       * PlayerCommand object, so there is nothing to set/get/name. */
      "cmd_set_arg",
      "cmd_get_arg",
      /* z-textblock's attribute array and z-queue's constructor: the port uses
       * arrays and the renderer's own line model. */
      "textblock_attrs",
      /* score.c:84 counts entries in the on-disk table; the port's ScoreStore
       * returns an array whose length is the count. */
      "highscore_count",
      /* z-type.c:70 / z-rand.c:558: loc arithmetic and scaled chances are
       * inlined at the port's use sites (locSum / the rng helpers). */
      "loc_offset",
      "random_chance_scaled",
      /* player-history.c:56 frees the C list; the port's history is an array
       * replaced at birth. */
      "history_clear",
    ],

};

const ACCOUNTED = new Set(Object.values(KNOWN_UNUSED).flat());

describe("upstream call-site census (tier 1: ported, never used)", () => {
  const { cFns, underCalled } = runCallCensus(ROOT);
  const dead = underCalled.filter(
    (u) => u.portCalls === 0 && u.portRefs === 0,
  );

  it("finds a substantial body of upstream functions to check", () => {
    /* A floor, not an exact count: upstream's function set is fixed at 4.2.6,
     * so a large drop here means the extractor broke. */
    expect(cFns.length).toBeGreaterThan(3000);
  });

  it("has no ported-but-unused function without a reason", () => {
    const unaccounted = dead.filter((u) => !ACCOUNTED.has(u.name));
    const report = unaccounted
      .map(
        (u) =>
          `  ${u.name} -> ${u.portName}  (${u.cFile}:${u.cLine}, ` +
          `${u.cCalls} C call site(s))`,
      )
      .join("\n");
    expect(
      unaccounted.length,
      unaccounted.length === 0
        ? ""
        : `\n${unaccounted.length} function(s) exist in the port and are never used there,\n` +
          `while upstream calls them. Either wire the missing caller, or add an\n` +
          `entry to KNOWN_UNUSED with the reason:\n\n${report}\n`,
    ).toBe(0);
  });

  it("has no stale KNOWN_UNUSED entries", () => {
    const deadNames = new Set(dead.map((u) => u.name));
    const stale = [...ACCOUNTED].filter((n) => !deadNames.has(n));
    expect(
      stale.length,
      stale.length === 0
        ? ""
        : `\nThe port now uses these, so their KNOWN_UNUSED entries are stale and\n` +
          `must be deleted:\n\n${stale.map((n) => `  ${n}`).join("\n")}\n`,
    ).toBe(0);
  });
});
