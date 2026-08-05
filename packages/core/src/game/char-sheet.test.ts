import { describe, expect, it } from "vitest";
import { STAT, TMD } from "../generated/index.js";
import {
  COLOUR_L_BLUE,
  COLOUR_L_GREEN,
  COLOUR_L_UMBER,
  COLOUR_RED,
  COLOUR_YELLOW,
} from "../color.js";
import { SKILL, STAT_MAX } from "../player/types.js";
import { makeState } from "./harness.js";
import type { CharSheetPanel } from "./char-sheet.js";
import {
  characterPanels,
  likert,
  maxColor,
  showDepth,
  statTable,
} from "./char-sheet.js";

function panel(panels: CharSheetPanel[], key: string): CharSheetPanel {
  const p = panels.find((x) => x.key === key);
  if (!p) throw new Error(`no panel ${key}`);
  return p;
}

/** Replace the combat skills[] with defaults (20) plus overrides by SKILL idx. */
function setSkills(state: ReturnType<typeof makeState>, over: Record<number, number>): void {
  const skills = new Array<number>(SKILL.DIGGING + 1).fill(20);
  for (const [idx, val] of Object.entries(over)) skills[Number(idx)] = val;
  state.actor.combat = { ...state.actor.combat, skills };
}

describe("likert (ui-player.c L274)", () => {
  it("returns Very Bad / RED for a negative value", () => {
    expect(likert(-1, 1)).toEqual({ desc: "Very Bad", color: COLOUR_RED });
  });

  it("maps x/y buckets to the exact description and colour", () => {
    expect(likert(0, 1)).toEqual({ desc: "Bad", color: COLOUR_RED });
    expect(likert(1, 1)).toEqual({ desc: "Bad", color: COLOUR_RED });
    expect(likert(2, 1)).toEqual({ desc: "Poor", color: COLOUR_RED });
    expect(likert(3, 1)).toEqual({ desc: "Fair", color: COLOUR_YELLOW });
    expect(likert(4, 1)).toEqual({ desc: "Fair", color: COLOUR_YELLOW });
    expect(likert(5, 1)).toEqual({ desc: "Good", color: COLOUR_YELLOW });
    expect(likert(6, 1)).toEqual({ desc: "Very Good", color: COLOUR_YELLOW });
    expect(likert(7, 1)).toEqual({ desc: "Excellent", color: COLOUR_L_GREEN });
    expect(likert(9, 1)).toEqual({ desc: "Superb", color: COLOUR_L_GREEN });
    expect(likert(14, 1)).toEqual({ desc: "Heroic", color: COLOUR_L_GREEN });
    expect(likert(18, 1)).toEqual({ desc: "Legendary", color: COLOUR_L_GREEN });
  });

  it("floors y at 1 (the y<=0 paranoia guard)", () => {
    expect(likert(5, 0)).toEqual({ desc: "Good", color: COLOUR_YELLOW });
  });
});

describe("max_color (ui-player.c L678)", () => {
  it("is yellow below the maximum and light-green at or above it", () => {
    expect(maxColor(3, 5)).toBe(COLOUR_YELLOW);
    expect(maxColor(5, 5)).toBe(COLOUR_L_GREEN);
    expect(maxColor(6, 5)).toBe(COLOUR_L_GREEN);
  });
});

describe("show_speed (ui-player.c L661)", () => {
  function speedText(state: ReturnType<typeof makeState>): string {
    return panel(characterPanels(state), "skills").lines.find((l) => l.label === "Speed")!.value;
  }

  it("is Normal at 110 and applies the TMD_FAST / TMD_SLOW adjustment", () => {
    const state = makeState();
    state.actor.speed = 110;
    expect(speedText(state)).toBe("Normal");

    /* 120 with TMD_FAST -> 110 -> Normal. */
    state.actor.speed = 120;
    state.actor.player.timed[TMD.FAST] = 1;
    expect(speedText(state)).toBe("Normal");
    state.actor.player.timed[TMD.FAST] = 0;

    /* 120, no effect: delta form "%d (%d.%dx)" -> starts with the +delta. */
    expect(speedText(state).startsWith("10 (")).toBe(true);

    /* 120 with TMD_SLOW -> 130 -> delta 20. */
    state.actor.player.timed[TMD.SLOW] = 1;
    expect(speedText(state).startsWith("20 (")).toBe(true);
  });
});

describe("show_depth (ui-player.c L650, max_depth)", () => {
  it("shows Town at max_depth 0 and feet + level below", () => {
    const state = makeState();
    const p = state.actor.player;
    p.maxDepth = 0;
    expect(showDepth(p)).toBe("Town");
    p.maxDepth = 1;
    expect(showDepth(p)).toBe("50' (L1)");
    p.maxDepth = 10;
    expect(showDepth(p)).toBe("500' (L10)");
  });
});

describe("get_panel_skills (ui-player.c L778): BOUND clamps + colour_table", () => {
  it("clamps the saving throw to 0..100 and indexes colour_table by skill/10", () => {
    const state = makeState();
    setSkills(state, { [SKILL.SAVE]: 250 });
    let sk = panel(characterPanels(state), "skills");
    let save = sk.lines.find((l) => l.label === "Saving Throw")!;
    expect(save.value).toBe("100%");
    expect(save.color).toBe(COLOUR_L_BLUE); /* colour_table[10] */

    setSkills(state, { [SKILL.SAVE]: -5 });
    sk = panel(characterPanels(state), "skills");
    save = sk.lines.find((l) => l.label === "Saving Throw")!;
    expect(save.value).toBe("0%");
    expect(save.color).toBe(COLOUR_RED); /* colour_table[0] */
  });

  it("adjusts physical disarming by depth/5 and clamps to 2..100", () => {
    const state = makeState();
    state.chunk.depth = 20; /* depth/5 = 4 */
    setSkills(state, { [SKILL.DISARM_PHYS]: 10 });
    const sk = panel(characterPanels(state), "skills");
    const disarm = sk.lines.find((l) => l.label === "Disarm - phys.")!;
    expect(disarm.value).toBe("6%"); /* bound(10 - 4, 2, 100) */
  });

  it("indexes magic devices by skill/13", () => {
    const state = makeState();
    setSkills(state, { [SKILL.DEVICE]: 130 });
    const sk = panel(characterPanels(state), "skills");
    const dev = sk.lines.find((l) => l.label === "Magic Devices")!;
    expect(dev.value).toBe("130");
    expect(dev.color).toBe(COLOUR_L_BLUE); /* colour_table[10] */
  });

  it("formats infravision in feet and speed with its own colour", () => {
    const state = makeState();
    state.actor.speed = 105; /* slow */
    const sk = panel(characterPanels(state), "skills");
    const infra = sk.lines.find((l) => l.label === "Infravision")!;
    expect(infra.value).toBe(`${state.actor.player.race.infravision * 10} ft`);
    const speed = sk.lines.find((l) => l.label === "Speed")!;
    expect(speed.color).toBe(COLOUR_L_UMBER); /* net < 110 */
  });
});

describe("get_panel_combat / topleft label + format (ui-player.c L728/L694)", () => {
  it("formats Armor, Melee, To-hit, Blows and the ranged rows", () => {
    const state = makeState();
    setSkills(state, {}); /* all 20 -> bth = 20*10/3 = 66 -> /10 = 6 */
    const c = state.actor.combat;
    c.toD = 0;
    c.toH = 0;
    c.toA = 0;
    c.ac = 0;
    c.numBlows = 100;
    const combat = panel(characterPanels(state), "combat").lines;
    expect(combat[0]).toEqual({ label: "Armor", value: "[0,+0]", color: COLOUR_L_BLUE });
    expect(combat[1]!.label).toBe(""); /* panel_space */
    expect(combat[2]).toMatchObject({ label: "Melee", value: "1d1,+0" });
    expect(combat[3]).toMatchObject({ label: "To-hit", value: "6,+0" });
    expect(combat[4]).toMatchObject({ label: "Blows", value: "1.0/turn" });
    expect(combat[6]).toMatchObject({ label: "Shoot to-dam", value: "+0" });
    expect(combat[8]).toMatchObject({ label: "Shots", value: "0.0/turn" });
  });

  it("builds the topleft HP/SP rows and blank name", () => {
    const state = makeState();
    const top = panel(characterPanels(state), "topleft").lines;
    expect(top[0]).toEqual({ label: "Name", value: "", color: COLOUR_L_BLUE });
    expect(top[1]!.value).toBe(state.actor.player.race.name);
    expect(top[4]).toMatchObject({ label: "HP", value: "1000/1000" });
    expect(top[5]).toMatchObject({ label: "SP", value: "0/0" });
  });

  it("orders the panels topleft, misc, midleft, combat, skills", () => {
    const state = makeState();
    expect(characterPanels(state).map((p) => p.key)).toEqual([
      "topleft",
      "misc",
      "midleft",
      "combat",
      "skills",
    ]);
  });
});

describe("display_player_stat_info (ui-player.c L449)", () => {
  it("returns STAT_MAX rows", () => {
    const state = makeState();
    expect(statTable(state)).toHaveLength(STAT_MAX);
  });

  it("shows the natural / best via cnv_stat and the %+3d bonuses", () => {
    const state = makeState();
    const p = state.actor.player;
    p.statMax[STAT.STR] = 16;
    p.statCur[STAT.STR] = 16; /* not drained */
    p.race.statAdj[STAT.STR] = 2;
    p.cls.statAdj[STAT.STR] = -1;
    const row = statTable(state, { statAdd: [3, 0, 0, 0, 0], statTop: [18, 0, 0, 0, 0] })[STAT.STR]!;
    expect(row.key).toBe("str");
    expect(row.label).toBe("STR: ");
    expect(row.natural).toBe("    16"); /* cnv_stat(16) */
    expect(row.best).toBe("    18"); /* cnv_stat(stat_top) */
    expect(row.raceBonus).toBe(" +2");
    expect(row.classBonus).toBe(" -1");
    expect(row.equipBonus).toBe(" +3");
    expect(row.reduced).toBeNull();
    expect(row.drained).toBe(false);
    expect(row.naturalMax).toBe(false);
  });

  it("uses the lower-case label + non-null reduced value when drained, and the ! at 18/100", () => {
    const state = makeState();
    const p = state.actor.player;
    p.statMax[STAT.CON] = 18 + 100;
    p.statCur[STAT.CON] = 18; /* drained: 18 < 118 */
    const row = statTable(state, { statUse: [0, 0, 0, 0, 17] })[STAT.CON]!;
    expect(row.label).toBe("Con: ");
    expect(row.drained).toBe(true);
    expect(row.naturalMax).toBe(true);
    expect(row.natural).toBe("18/100"); /* cnv_stat(118) */
    expect(row.reduced).toBe(cnvStr17());
  });

  function cnvStr17(): string {
    /* cnv_stat(17) is a plain value right-justified to six chars. */
    return "    17";
  }
});

/**
 * PORT_TODO 3.9's second half. `resolveDeps` had `launcher: deps.launcher ?? null`
 * and NOTHING in the tree supplied it - `screens.ts charSheetDeps` is the only
 * builder and it does not mention the field - so the sheet's "Shoot to-dam" and
 * ranged "To-hit" rows read as if every character were unarmed with a bow in
 * hand. `meleeWeapon`, one line above it, had always defaulted to the live actor;
 * this seam was the odd one out.
 */
describe("the sheet's ranged rows read the equipped launcher (PORT_TODO 3.9)", () => {
  function combatRows(state: ReturnType<typeof makeState>): Map<string, string> {
    const rows = new Map<string, string>();
    for (const l of panel(characterPanels(state), "combat").lines) {
      if (l.label) rows.set(l.label, l.value);
    }
    return rows;
  }

  it("a bow with a to-dam bonus moves Shoot to-dam off zero", () => {
    const state = makeState();
    const bowSlot = state.actor.player.body.slots.findIndex((s) => s?.type === "BOW");
    expect(bowSlot, "fixture: the body has a shooting slot").toBeGreaterThanOrEqual(0);

    const before = combatRows(state);
    expect(before.get("Shoot to-dam"), "unarmed baseline").toBe("+0");

    /* A minimal launcher: the sheet reads only object_to_dam / object_to_hit off
     * it, both of which are the object's own known to_d / to_h. Constructing the
     * object here rather than prepping a real kind keeps the assertion about the
     * WIRING - a real kind rolls +0 to-dam at "average" and would read the same
     * as no launcher at all, which is exactly the vacuous test to avoid. */
    const handle = state.gear.next++;
    state.gear.store.set(handle, {
      ...(state.gear.store.get(state.actor.player.equipment[0] ?? 0) ?? {}),
      toD: 7,
      toH: 5,
      dd: 0,
      ds: 0,
      number: 1,
      known: { toD: 7, toH: 5 },
    } as never);
    state.actor.player.equipment[bowSlot] = handle;

    const after = combatRows(state);
    expect(after.get("Shoot to-dam"), "the bow's to-dam is counted").not.toBe("+0");
  });
});

/**
 * PORT_TODO 3.12 and 3.13 on the sheet side. Both were unsupplied seams on
 * `resolveDeps`, which already holds the state - the same shape as 3.9's
 * launcher, and the third time this pattern has cost a visible row.
 *
 * 3.13 was TWO bugs, not one: the line had no supplier AND nothing incremented
 * the counter. `player_resting_step_turn` (player-util.c:1487-1488) bumps two
 * counters - `player_turns_rested`, the x2-regen gate that resets per rest, and
 * `player->resting_turn`, the lifetime total this line shows, reset only at
 * birth. The port's rest loop bumped the first and not the second.
 */
describe("the sheet's misc panel reads the live state (PORT_TODO 3.12, 3.13)", () => {
  function miscRows(state: ReturnType<typeof makeState>): Map<string, string> {
    const rows = new Map<string, string>();
    for (const l of panel(characterPanels(state), "misc").lines) {
      if (l.label) rows.set(l.label, l.value);
    }
    return rows;
  }

  it("Resting shows GameState.restingTurn, not a hardcoded 0 (3.13)", () => {
    const state = makeState();
    expect(miscRows(state).get("Resting"), "a fresh character has rested 0").toBe("0");

    /* What the rest loop now does once per rested player turn. */
    state.restingTurn = 137;
    expect(miscRows(state).get("Resting")).toBe("137");
  });

  it("the title line shows the winner and wizard markers (3.12)", () => {
    const state = makeState();
    const titleOf = (): string =>
      panel(characterPanels(state), "topleft").lines.find((l) => l.label === "Title")
        ?.value ?? "";
    const plain = titleOf();

    state.actor.player.totalWinner = true;
    expect(titleOf(), "***WINNER*** (show_title L630)").toBe("***WINNER***");

    state.wizard = true;
    expect(titleOf(), "wizard outranks winner").toBe("[=-WIZARD-=]");

    state.wizard = false;
    state.actor.player.totalWinner = false;
    expect(titleOf()).toBe(plain);
  });
});
