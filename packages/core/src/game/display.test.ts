import { describe, expect, it } from "vitest";
import { STAT, TMD } from "../generated";
import {
  COLOUR_L_GREEN,
  COLOUR_L_UMBER,
  COLOUR_ORANGE,
  COLOUR_RED,
  COLOUR_WHITE,
  COLOUR_YELLOW,
} from "../color";
import { playerSpAttr } from "../player/calcs";
import { makeState, plReg } from "./harness";
import type { DisplayRun, SidebarField, StatusIndicator } from "./display";
import { cnvStat, sidebarModel, statusLineModel } from "./display";

function field(fields: SidebarField[] | StatusIndicator[], key: string): DisplayRun[] {
  const f = fields.find((x) => x.key === key);
  if (!f) throw new Error(`no field ${key}`);
  return f.runs;
}

describe("cnvStat (ui-display.c L115)", () => {
  it("formats plain, 18/NN and 18/*** values right-justified to six chars", () => {
    expect(cnvStat(16)).toBe("    16");
    expect(cnvStat(18)).toBe("    18");
    expect(cnvStat(18 + 50)).toBe(" 18/50");
    expect(cnvStat(18 + 150)).toBe("18/150");
    expect(cnvStat(18 + 220)).toBe("18/***");
    expect(cnvStat(3)).toBe("     3");
  });
});

describe("sidebar hp / sp colour thresholds (player.c L323/L337)", () => {
  it("colours current HP green at full, yellow above the warn line, red below", () => {
    const state = makeState();
    const p = state.actor.player;
    p.mhp = 1000;

    p.chp = 1000; /* >= mhp */
    expect(field(sidebarModel(state), "hp")[1]?.color).toBe(COLOUR_L_GREEN);

    p.chp = 500; /* > mhp * 3 / 10 = 300 */
    expect(field(sidebarModel(state), "hp")[1]?.color).toBe(COLOUR_YELLOW);

    p.chp = 100; /* <= 300 */
    expect(field(sidebarModel(state), "hp")[1]?.color).toBe(COLOUR_RED);
  });

  it("player_sp_attr uses the same thresholds on csp / msp", () => {
    expect(playerSpAttr({ csp: 50, msp: 50 }, 3)).toBe(COLOUR_L_GREEN);
    expect(playerSpAttr({ csp: 40, msp: 50 }, 3)).toBe(COLOUR_YELLOW); /* 40 > 15 */
    expect(playerSpAttr({ csp: 10, msp: 50 }, 3)).toBe(COLOUR_RED); /* 10 <= 15 */
  });

  it("hides the SP field for a non-casting class", () => {
    const state = makeState();
    expect(field(sidebarModel(state), "sp")).toEqual([]);
  });
});

describe("sidebar level / exp labels (ui-display.c L207/L226)", () => {
  it("uses upper-case label + green at the level maximum, mixed case + yellow below", () => {
    const state = makeState();
    const p = state.actor.player;

    p.lev = 1;
    p.maxLev = 1;
    let level = field(sidebarModel(state), "level");
    expect(level[0]?.text).toBe("LEVEL ");
    expect(level[1]?.color).toBe(COLOUR_L_GREEN);

    p.maxLev = 5;
    level = field(sidebarModel(state), "level");
    expect(level[0]?.text).toBe("Level ");
    expect(level[1]?.color).toBe(COLOUR_YELLOW);
  });

  it("labels NXT/green at max experience and Nxt/yellow when experience is below max", () => {
    const state = makeState();
    const p = state.actor.player;
    p.lev = 1;

    p.exp = 0;
    p.maxExp = 0;
    let exp = field(sidebarModel(state), "exp");
    /* Label padded to width 4 so the value run starts at col+4 (L245/L248). */
    expect(exp[0]?.text).toBe("NXT ");
    expect(exp[0]?.text.length).toBe(4);
    expect(exp[1]?.color).toBe(COLOUR_L_GREEN);

    p.exp = 50;
    p.maxExp = 100;
    exp = field(sidebarModel(state), "exp");
    expect(exp[0]?.text).toBe("Nxt ");
    expect(exp[1]?.color).toBe(COLOUR_YELLOW);
  });
});

describe("sidebar depth (fmt_depth, ui-display.c L519)", () => {
  it("shows Town at depth 0 and feet + level below", () => {
    const state = makeState();
    expect(field(sidebarModel(state), "depth")[0]?.text).toBe("Town");
    state.chunk.depth = 1;
    expect(field(sidebarModel(state), "depth")[0]?.text).toBe("50' (L1)");
  });
});

describe("sidebar speed (prt_speed_aux, ui-display.c L475)", () => {
  it("is empty at normal speed, Fast when quicker, Slow when slower", () => {
    const state = makeState();
    state.actor.speed = 110;
    expect(field(sidebarModel(state), "speed")).toEqual([]);

    state.actor.speed = 120;
    let speed = field(sidebarModel(state), "speed");
    expect(speed[0]?.text).toBe("Fast (+10)");
    expect(speed[0]?.color).toBe(COLOUR_L_GREEN);

    state.actor.speed = 105;
    speed = field(sidebarModel(state), "speed");
    expect(speed[0]?.text).toBe("Slow (-5)");
    expect(speed[0]?.color).toBe(COLOUR_L_UMBER);
  });
});

describe("sidebar stat drain (prt_stat, ui-display.c:153-171)", () => {
  it("uses the reduced label + yellow when a stat is drained, full label + green otherwise", () => {
    const state = makeState();
    const p = state.actor.player;
    p.statCur[STAT.STR] = 18;
    p.statMax[STAT.STR] = 18;
    let str = field(sidebarModel(state, { statUse: p.statCur }), "str");
    /* Label padded to width 6 so the value run starts at col+6 (L161/L165). */
    expect(str[0]?.text).toBe("STR:  ");
    expect(str[1]?.color).toBe(COLOUR_L_GREEN);

    p.statCur[STAT.STR] = 16; /* drained below the max */
    str = field(sidebarModel(state, { statUse: p.statCur }), "str");
    expect(str[0]?.text).toBe("Str:  ");
    expect(str[1]?.color).toBe(COLOUR_YELLOW);
  });

  it("places the value at col+6 with a blank at col 5, and the '!' at col+3 (L169-170)", () => {
    const state = makeState();
    const p = state.actor.player;
    p.statCur[STAT.STR] = 18 + 100;
    p.statMax[STAT.STR] = 18 + 100; /* natural maximum -> '!' overwrite */
    const str = field(sidebarModel(state, { statUse: p.statCur }), "str");
    const label = str[0]?.text ?? "";
    expect(label.length).toBe(6); /* value begins at index 6 */
    expect(label[3]).toBe("!"); /* put_str("!", col + 3) */
    expect(label[5]).toBe(" "); /* blank column at col 5 */
    expect(str[1]?.text).toBe("18/100"); /* six-char cnv_stat value of stat_use 118 */
    expect(str[1]?.text.length).toBe(6);
  });
});

describe("status tmd grade walk (prt_tmd, ui-display.c L1251)", () => {
  it("names the covering grade in its colour, with a trailing space", () => {
    const state = makeState();
    state.actor.player.timed[TMD.POISONED] = 5;
    const tmd = field(statusLineModel(state, { timedEffects: plReg.timed }), "tmd");
    expect(tmd[0]).toEqual({ text: "Poisoned ", color: COLOUR_ORANGE });
  });

  it("appends the percentage meter for TMD_FOOD", () => {
    const state = makeState();
    state.actor.player.timed[TMD.FOOD] = 5000;
    const tmd = field(statusLineModel(state, { timedEffects: plReg.timed }), "tmd");
    /* Fed grade name, then the meter, both in the grade colour. */
    expect(tmd[0]?.text).toBe("Fed ");
    expect(tmd[1]?.text).toBe("50 % ");
    expect(tmd[1]?.color).toBe(tmd[0]?.color);
  });
});

describe("status level feeling (prt_level_feeling, ui-display.c L1053)", () => {
  it("shows ? for objects before enough squares are explored", () => {
    const state = makeState();
    state.chunk.depth = 1;
    state.chunk.feeling = 0;
    state.chunk.feelingSquares = 0; /* < feeling_need (10) */
    const lf = field(statusLineModel(state), "level_feeling");
    expect(lf[0]).toEqual({ text: "LF:", color: COLOUR_WHITE });
    expect(lf[3]).toEqual({ text: "?", color: COLOUR_WHITE });
    /* One trailing gap column baked in (return == ... + strlen(obj) + 1, L1121). */
    expect(lf[4]).toEqual({ text: " ", color: COLOUR_WHITE });
  });

  it("shows reversed danger/treasure symbols and colours once explored", () => {
    const state = makeState();
    state.chunk.depth = 1;
    state.chunk.feeling = 52; /* obj_feeling 5, mon_feeling 2 */
    state.chunk.feelingSquares = 10; /* >= feeling_need */
    const lf = field(statusLineModel(state), "level_feeling");
    expect(lf[1]).toEqual({ text: "8", color: COLOUR_ORANGE }); /* mon: 10-2, MON[2] */
    expect(lf[2]).toEqual({ text: "-", color: COLOUR_WHITE });
    expect(lf[3]).toEqual({ text: "6", color: COLOUR_YELLOW }); /* obj: 11-5, OBJ[5] */
  });

  it("is empty when the birth_feelings option is off", () => {
    const state = makeState();
    state.chunk.depth = 1;
    expect(field(statusLineModel(state, { birthFeelings: false }), "level_feeling")).toEqual([]);
  });
});

describe("status state (prt_state, ui-display.c:957-1017)", () => {
  it("renders a ten-char rest field plus one trailing gap, and a repeat count", () => {
    const state = makeState();
    /* return == strlen(text) + 1 (L1016): the 10-char field gets one trailing gap. */
    let st = field(statusLineModel(state, { isResting: true, restingCount: 5 }), "state");
    expect(st[0]?.text).toBe("Rest     5 ");
    expect(st[0]?.text.length).toBe(11);
    expect(st[0]?.color).toBe(COLOUR_WHITE);

    st = field(statusLineModel(state, { nRepeats: 5 }), "state");
    expect(st[0]?.text).toBe("Repeat   5 ");
  });

  it("reserves a single blank column when idle (return == strlen(\"\") + 1)", () => {
    const state = makeState();
    const st = field(statusLineModel(state), "state");
    expect(st).toEqual([{ text: " ", color: COLOUR_WHITE }]);
  });
});

describe("status segments bake exactly one trailing gap (update_statusline_aux widths)", () => {
  it("unignore returns 'Unignoring ' (strlen + 1, L1285)", () => {
    const state = makeState();
    const runs = field(statusLineModel(state, { unignoring: true }), "unignore");
    expect(runs).toEqual([{ text: "Unignoring ", color: COLOUR_WHITE }]);
  });

  it("recall returns 'Recall ' (sizeof \"Recall\" == 7, L929)", () => {
    const state = makeState();
    state.actor.player.wordRecall = 10;
    const runs = field(statusLineModel(state), "recall");
    expect(runs).toEqual([{ text: "Recall ", color: COLOUR_WHITE }]);
  });

  it("descent returns 'Descent ' (sizeof \"Descent\" == 8, L943)", () => {
    const state = makeState();
    state.actor.player.deepDescent = 5;
    const runs = field(statusLineModel(state), "descent");
    expect(runs).toEqual([{ text: "Descent ", color: COLOUR_WHITE }]);
  });

  it("study returns 'Study (N) ' (strlen + 1, L1241)", () => {
    const state = makeState();
    state.actor.player.upkeep.newSpells = 2;
    const runs = field(statusLineModel(state), "study");
    expect(runs[0]?.text).toBe("Study (2) ");
  });
});

describe("skipped indicators and handler-table order", () => {
  it("returns empty runs for inactive status indicators", () => {
    const state = makeState();
    const model = statusLineModel(state);
    /* "state" is excluded: idle prt_state still reserves one blank column
       (return == strlen("") + 1 == 1, L1016), so it is never empty. */
    for (const key of ["moves", "unignore", "recall", "descent", "study", "tmd", "dtrap"]) {
      expect(field(model, key)).toEqual([]);
    }
  });

  it("emits sidebar fields in side_handlers[] order", () => {
    const state = makeState();
    expect(sidebarModel(state).map((f) => f.key)).toEqual([
      "race", "title", "class", "level", "exp", "gold", "equippy",
      "str", "int", "wis", "dex", "con",
      "ac", "hp", "sp", "health", "speed", "depth",
    ]);
  });

  it("emits status indicators in status_handlers[] order", () => {
    const state = makeState();
    expect(statusLineModel(state).map((f) => f.key)).toEqual([
      "level_feeling", "light", "moves", "unignore", "recall",
      "descent", "state", "study", "tmd", "dtrap", "terrain",
    ]);
  });
});
