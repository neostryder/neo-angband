import { describe, expect, it } from "vitest";
import { Rng } from "../rng.js";
import { buildProb } from "../obj/randname.js";
import { playerRandomName } from "./player.js";

/**
 * player_random_name (player.c L375): randname_make(RANDNAME_TOLKIEN, 4, 8,
 * ...) then my_strcap. Faithfulness of randname_make itself is proven by
 * obj/randname.upstream.test.ts; this only proves the wiring: bounds, capping,
 * and the "no corpus" no-op.
 */
describe("playerRandomName (player.c L375)", () => {
  /* A tiny corpus with enough letter transitions to always emit a word. */
  const probs = buildProb(["frodo", "bilbo", "gandalf", "aragorn", "legolas"]);

  it("returns '' when no corpus is available (caller keeps the old name)", () => {
    expect(playerRandomName(new Rng(1), null)).toBe("");
  });

  it("caps only the first character (my_strcap), length in [4, 8]", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const name = playerRandomName(new Rng(seed), probs);
      expect(name.length).toBeGreaterThanOrEqual(4);
      expect(name.length).toBeLessThanOrEqual(8);
      expect(name[0]).toBe(name[0]!.toUpperCase());
      expect(name.slice(1)).toBe(name.slice(1).toLowerCase());
    }
  });

  it("is deterministic for a fixed seed (same draw sequence as randnameMake)", () => {
    const a = playerRandomName(new Rng(42), probs);
    const b = playerRandomName(new Rng(42), probs);
    expect(a).toBe(b);
  });
});
