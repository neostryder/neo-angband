import { describe, expect, it } from "vitest";
import { OPTION_ENTRIES } from "../generated/options";
import {
  DEFAULT_DELAY_FACTOR,
  DEFAULT_HITPOINT_WARN,
  OptionState,
} from "./options";

describe("OptionState defaults (option.c options_init_defaults)", () => {
  it("seeds every option from OPTION_ENTRIES.normal", () => {
    const opts = new OptionState();
    for (const entry of OPTION_ENTRIES) {
      expect(opts.get(entry.name)).toBe(entry.normal);
    }
  });

  it("defaults hitpoint_warn to 3 and delay_factor to 40", () => {
    const opts = new OptionState();
    expect(opts.hitpointWarn).toBe(DEFAULT_HITPOINT_WARN);
    expect(DEFAULT_HITPOINT_WARN).toBe(3);
    expect(opts.delayFactor).toBe(DEFAULT_DELAY_FACTOR);
    expect(DEFAULT_DELAY_FACTOR).toBe(40);
  });

  it("clamps hitpoint_warn into 0..9", () => {
    expect(new OptionState({ hitpointWarn: 20 }).hitpointWarn).toBe(9);
    expect(new OptionState({ hitpointWarn: -5 }).hitpointWarn).toBe(0);
    expect(new OptionState({ hitpointWarn: 7 }).hitpointWarn).toBe(7);
  });

  it("reports an unknown option as false", () => {
    expect(new OptionState().get("does_not_exist")).toBe(false);
  });
});

describe("OptionState cheat->score coupling (option.c option_set)", () => {
  it("turning a cheat option on forces its score twin", () => {
    const opts = new OptionState();
    expect(opts.get("score_hear")).toBe(false);
    expect(opts.anyScoreSet()).toBe(false);

    expect(opts.set("cheat_hear", true)).toBe(true);
    expect(opts.get("cheat_hear")).toBe(true);
    expect(opts.get("score_hear")).toBe(true);
    expect(opts.anyScoreSet()).toBe(true);
  });

  it("keeps the score twin set even after the cheat is turned back off", () => {
    const opts = new OptionState();
    opts.set("cheat_room", true);
    expect(opts.get("score_room")).toBe(true);
    /* Upstream never clears score_* when the cheat is disabled: the character
     * stays a "cheater" for scoring purposes. */
    opts.set("cheat_room", false);
    expect(opts.get("cheat_room")).toBe(false);
    expect(opts.get("score_room")).toBe(true);
    expect(opts.anyScoreSet()).toBe(true);
  });

  it("applies the coupling to overrides passed at construction", () => {
    const opts = new OptionState({ overrides: { cheat_live: true } });
    expect(opts.get("cheat_live")).toBe(true);
    expect(opts.get("score_live")).toBe(true);
    expect(opts.anyScoreSet()).toBe(true);
  });
});

describe("OptionState birth snapshot immutability", () => {
  it("locks birth options after construction (set is a no-op)", () => {
    const opts = new OptionState();
    /* birth_stacking ships true. */
    expect(opts.get("birth_stacking")).toBe(true);
    expect(opts.isBirth("birth_stacking")).toBe(true);

    /* set() refuses to change a birth option and returns false. */
    expect(opts.set("birth_stacking", false)).toBe(false);
    expect(opts.get("birth_stacking")).toBe(true);
    expect(opts.birthValue("birth_stacking")).toBe(true);
  });

  it("captures the birth choices made at construction, frozen thereafter", () => {
    const opts = new OptionState({
      overrides: { birth_randarts: true, birth_feelings: false },
    });
    expect(opts.birthValue("birth_randarts")).toBe(true);
    expect(opts.birthValue("birth_feelings")).toBe(false);
    /* The live value equals the birth value and stays locked. */
    expect(opts.get("birth_randarts")).toBe(true);
    opts.set("birth_randarts", false);
    expect(opts.get("birth_randarts")).toBe(true);
    expect(opts.birthValue("birth_randarts")).toBe(true);
  });

  it("allows non-birth (interface) options to change in play", () => {
    const opts = new OptionState();
    expect(opts.get("effective_speed")).toBe(false);
    expect(opts.set("effective_speed", true)).toBe(true);
    expect(opts.get("effective_speed")).toBe(true);
  });
});

describe("OptionState serialize / restore round trip", () => {
  it("round-trips values, scalars and the birth snapshot", () => {
    const opts = new OptionState({
      overrides: { birth_randarts: true, cheat_hear: true },
      hitpointWarn: 5,
    });
    opts.set("effective_speed", true);

    const data = JSON.parse(JSON.stringify(opts.snapshot()));
    const restored = OptionState.restore(data);

    for (const entry of OPTION_ENTRIES) {
      expect(restored.get(entry.name)).toBe(opts.get(entry.name));
    }
    expect(restored.hitpointWarn).toBe(5);
    expect(restored.delayFactor).toBe(DEFAULT_DELAY_FACTOR);
    expect(restored.birthValue("birth_randarts")).toBe(true);
    expect(restored.get("score_hear")).toBe(true);
    expect(restored.get("effective_speed")).toBe(true);

    /* The restored birth snapshot is still locked. */
    expect(restored.set("birth_randarts", false)).toBe(false);
    expect(restored.birthValue("birth_randarts")).toBe(true);
  });

  it("fills missing options from the table default (old saves)", () => {
    /* Simulate a save that predates a later option: only a subset present. */
    const partial = {
      values: { pickup_always: true },
      hitpointWarn: 3,
      delayFactor: 40,
      birth: {},
    };
    const restored = OptionState.restore(partial);
    expect(restored.get("pickup_always")).toBe(true);
    /* pickup_inven ships true and was absent -> table default. */
    expect(restored.get("pickup_inven")).toBe(true);
  });
});
