import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STAT, TMD, TV } from "../generated/index.js";
import {
  COLOUR_DARK,
  COLOUR_L_GREEN,
  COLOUR_L_UMBER,
  COLOUR_ORANGE,
  COLOUR_RED,
  COLOUR_VIOLET,
  COLOUR_WHITE,
  COLOUR_YELLOW,
} from "../color.js";
import { calcBonuses, playerSpAttr } from "../player/calcs.js";
import { statTable } from "./char-sheet.js";
import { objectNew } from "../obj/object.js";
import type { ObjectKind } from "../obj/types.js";
import { gearAdd } from "./gear.js";
import { makeState, plReg } from "./harness.js";
import type { DisplayRun, SidebarField, StatusIndicator } from "./display.js";
import { SIDE_HANDLERS, sidebarLayout } from "./display.js";
import { loc } from "../loc.js";
import { cnvStat, panelContains, sidebarModel, statusLineModel } from "./display.js";

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

describe("the sidebar's stat rows read the live calc_bonuses result (PORT_TODO 3.5)", () => {
  /* prt_stat reads player->state.stat_use. Before this, the model's default
   * was race + class over stat_cur and no shell supplied the dep, so a worn
   * +STR ring changed the character sheet (which reads playerState.statUse)
   * and left the sidebar alone. The fixture goes through calcBonuses rather
   * than hand-writing a statUse array, so the assertion is about the producer
   * the live shell actually installs (session/game.ts:718). */
  function withStrRing(): { state: ReturnType<typeof makeState>; bare: number } {
    const state = makeState();
    const p = state.actor.player;
    const equipment: (ReturnType<typeof objectNew> | null)[] = new Array(
      p.body.count,
    ).fill(null);
    const ring = objectNew({} as ObjectKind);
    ring.modifiers[STAT.STR] = 5;
    equipment[p.body.count - 1] = ring;
    /* Rune known, or calc_bonuses is right to ignore the modifier. */
    p.objKnown.modifiers[STAT.STR] = 1;
    const bare = calcBonuses(p).statUse[STAT.STR] ?? 0;
    state.playerState = calcBonuses(p, { equipment });
    return { state, bare };
  }

  it("shows the equipped value, not the race+class one", () => {
    const { state, bare } = withStrRing();
    const worn = state.playerState?.statUse[STAT.STR] ?? 0;
    expect(worn).toBeGreaterThan(bare); /* the fixture must be able to fail */

    const str = field(sidebarModel(state), "str");
    expect(str[1]?.text).toBe(cnvStat(worn));
    expect(str[1]?.text).not.toBe(cnvStat(bare));
  });

  it("agrees with the character sheet, which is the screen it used to contradict", () => {
    const { state } = withStrRing();
    const ps = state.playerState;
    /* Undrained, so the sheet's headline "Best" (stat_top) is the same number
     * prt_stat prints; the sheet gets it from playerState and always did. */
    if (!ps) throw new Error("fixture did not set playerState");
    const sheet = statTable(state, {
      statAdd: ps.statAdd,
      statTop: ps.statTop,
      statUse: ps.statUse,
    })[STAT.STR];
    expect(sheet?.drained).toBe(false);
    expect(field(sidebarModel(state), "str")[1]?.text).toBe(sheet?.best);
    expect(sheet?.equipBonus.trim()).toBe("+5");
  });

  it("still falls back to race+class when there is no playerState at all", () => {
    const state = makeState();
    delete state.playerState; /* the worldless harness never sets it */
    const p = state.actor.player;
    const str = field(sidebarModel(state), "str");
    expect(str[1]?.text).toBe(cnvStat(calcBonuses(p).statUse[STAT.STR] ?? 0));
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

  /**
   * player_is_resting is upkeep->resting (player-util.c:1397), which GameState
   * carries as state.resting - so the field must appear off the STATE, not only
   * when a caller remembers the dep. It appeared nowhere at all: no shell passed
   * isResting, so the web shell printed an invented "Resting..." message line
   * instead, and never cleared it.
   */
  describe("the Rest field comes from state.resting, with no dep passed", () => {
    it("shows the count while a timed rest runs", () => {
      const state = makeState();
      state.resting = { count: 42, turnsRested: 3 };
      const st = field(statusLineModel(state), "state");
      expect(st[0]?.text).toBe("Rest    42 ");
    });

    it("shows the conditional modes' own glyphs (* & !)", () => {
      const state = makeState();
      for (const [count, glyph] of [[-1, "*"], [-2, "&"], [-3, "!"]] as const) {
        state.resting = { count, turnsRested: 0 };
        expect(field(statusLineModel(state), "state")[0]?.text).toBe(
          `Rest ${glyph.repeat(5)} `,
        );
      }
    });

    it("goes back to one blank column the moment the rest ends", () => {
      const state = makeState();
      state.resting = { count: 7, turnsRested: 1 };
      expect(field(statusLineModel(state), "state")[0]?.text).toBe("Rest     7 ");
      /* driveRest's finally clause deletes it. */
      delete state.resting;
      expect(field(statusLineModel(state), "state")).toEqual([
        { text: " ", color: COLOUR_WHITE },
      ]);
    });

    it("a count of 0 is not resting (player_is_resting is > 0 or special)", () => {
      const state = makeState();
      state.resting = { count: 0, turnsRested: 9 };
      expect(field(statusLineModel(state), "state")).toEqual([
        { text: " ", color: COLOUR_WHITE },
      ]);
    });

    it("an explicit dep still wins over the state", () => {
      const state = makeState();
      state.resting = { count: 42, turnsRested: 3 };
      const st = field(
        statusLineModel(state, { isResting: false }),
        "state",
      );
      expect(st).toEqual([{ text: " ", color: COLOUR_WHITE }]);
    });
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

/**
 * PORT_TODO 3.10, 3.11, 3.12: three sidebar/status seams whose data was live and
 * which had NO supplier, so each row was permanently blank or false.
 *
 * Same defect as 3.9's char-sheet half: an optional seam on a resolver that
 * already holds the GameState. Fixed by deriving rather than defaulting, so no
 * caller has to remember. These tests drive each seam THROUGH THE STATE and never
 * pass a `deps` argument - passing deps is what the existing tests do, and it is
 * exactly what cannot catch an absent supplier.
 */
describe("sidebar seams derive from the live state (PORT_TODO 3.10-3.12)", () => {
  it("prt_moves reads PlayerState.numMoves (3.10)", () => {
    const state = makeState();
    /* No playerState: prt_moves emits nothing, as upstream does for num_moves 0. */
    expect(field(statusLineModel(state), "moves")).toEqual([]);

    (state as unknown as { playerState?: { numMoves: number } }).playerState = {
      numMoves: 2,
    };
    expect(field(statusLineModel(state), "moves")[0]?.text).toBe("Moves +2 ");

    (state as unknown as { playerState: { numMoves: number } }).playerState.numMoves =
      -1;
    expect(field(statusLineModel(state), "moves")[0]?.text).toBe("Moves -1 ");
  });

  it("prt_state's repeat branch reads the LIVE queue (3.11)", () => {
    const state = makeState();
    expect(field(statusLineModel(state), "state")).toEqual([
      { text: " ", color: COLOUR_WHITE },
    ]);

    /* queueCommandRepeat (context.ts) pushes the repeat onto state.cmdQueue with
     * repeatRemaining. cmd.ts's CommandQueue - which the item named as the
     * available answer - is a faithful port nothing drives, so wiring THAT would
     * still have read 0. */
    state.cmdQueue = [{ code: "hold", repeatRemaining: 7 } as never];
    expect(field(statusLineModel(state), "state")[0]?.text).toBe("Repeat   7 ");
  });

  it("fmt_title shows the winner and wizard markers (3.12)", () => {
    const state = makeState();
    const plain = field(sidebarModel(state), "title")[0]?.text ?? "";
    expect(plain, "fixture: an ordinary character has a class title").not.toBe("");

    state.actor.player.totalWinner = true;
    expect(field(sidebarModel(state), "title")[0]?.text).toBe("***WINNER***");

    /* wizard wins over winner (fmt_title L271 precedes L272). */
    state.wizard = true;
    expect(field(sidebarModel(state), "title")[0]?.text).toBe("[=-WIZARD-=]");

    state.wizard = false;
    state.actor.player.totalWinner = false;
    expect(field(sidebarModel(state), "title")[0]?.text).toBe(plain);
  });
});

/**
 * prt_equippy (ui-display.c:269-296) reads object_attr / object_char, which
 * route through use_flavor_glyph. The port defaulted both to the KIND record,
 * and the seam that was supposed to supply the flavour-aware version had no
 * supplier in either shell - so a worn ring drew in the kind colour every
 * flavoured kind in the shipped data shares: `d`, dark.
 */
describe("prt_equippy uses object_attr / object_char (PORT_TODO 3.14)", () => {
  const RING_KIND = {
    kidx: 42,
    tval: TV.RING,
    dChar: "=",
    dAttr: "d" /* every ring kind ships this colour */,
  } as unknown as ObjectKind;
  const FLAVOR = { fidx: 3, char: "=", attr: "Violet" };

  function wearing(flavoured: boolean, aware: boolean): DisplayRun[] {
    const state = makeState();
    const obj = objectNew(RING_KIND);
    obj.tval = TV.RING;
    const handle = gearAdd(state.gear, obj);
    state.actor.player.equipment[0] = handle;
    if (flavoured) state.flavorGlyph = () => FLAVOR as never;
    state.isAware = () => aware;
    return field(sidebarModel(state), "equippy");
  }

  it("draws a worn flavoured ring in its FLAVOUR colour, not the kind's dark", () => {
    const runs = wearing(true, false);
    expect(runs[0]).toEqual({ text: "=", color: COLOUR_VIOLET });
    expect(runs[0]?.color).not.toBe(COLOUR_DARK);
  });

  it("keeps the flavour colour after the player learns the kind", () => {
    /* A ring is not a scroll: awareness does not end its flavour. */
    expect(wearing(true, true)[0]?.color).toBe(COLOUR_VIOLET);
  });

  it("falls back to the kind record when the kind has no flavour", () => {
    expect(wearing(false, false)[0]).toEqual({ text: "=", color: COLOUR_DARK });
  });
});

/*
 * panel_contains (ui-output.c:689). Upstream writes it in UNSIGNED arithmetic,
 * `(y - offset_y) < hgt`, so a grid ABOVE or LEFT of the camera wraps to a huge
 * number and reads false rather than negative-and-true. The port writes the
 * signed form, and these pin that the two agree at all four edges.
 */
describe("panelContains (ui-output.c:689)", () => {
  const PANEL = { camX: 10, camY: 20, mapCols: 66, mapRows: 22 };

  it("the top-left grid is inside and one step out on each axis is not", () => {
    expect(panelContains(PANEL, loc(10, 20))).toBe(true);
    expect(panelContains(PANEL, loc(9, 20))).toBe(false);
    expect(panelContains(PANEL, loc(10, 19))).toBe(false);
  });

  it("the bottom-right grid is inside and one past it is not", () => {
    expect(panelContains(PANEL, loc(75, 41))).toBe(true);
    expect(panelContains(PANEL, loc(76, 41))).toBe(false);
    expect(panelContains(PANEL, loc(75, 42))).toBe(false);
  });

  /* The unsigned wrap is the whole reason the C reads the way it does: a
   * negative difference must be OUTSIDE, not inside. */
  it("a grid far above and left of the camera is outside, not wrapped inside", () => {
    expect(panelContains(PANEL, loc(0, 0))).toBe(false);
    expect(panelContains(PANEL, loc(-5, -5))).toBe(false);
  });

  it("a zero-size panel contains nothing, including its own origin", () => {
    expect(panelContains({ camX: 0, camY: 0, mapCols: 0, mapRows: 0 }, loc(0, 0))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// side_handlers[] and update_sidebar (ui-display.c L805-889) - PORT_TODO 3.17
// ---------------------------------------------------------------------------

describe("SIDE_HANDLERS (side_handlers[], ui-display.c L810)", () => {
  /**
   * The table is transcribed from C, so the ground truth is the C - not a
   * second transcription in this file. Parse the real array out of the
   * reference tree and compare, so a priority typed wrong is a failure rather
   * than two copies of the same mistake agreeing.
   */
  it("is the upstream array, parsed out of ui-display.c", () => {
    const src = readFileSync(
      new URL("../../../../reference/src/ui-display.c", import.meta.url),
      "utf8",
    );
    const block = /\}\s*side_handlers\[\]\s*=\s*\{([\s\S]*?)\n\};/u.exec(src);
    expect(block).not.toBeNull();
    const parsed: { key: string | null; priority: number }[] = [];
    for (const m of block![1]!.matchAll(/\{\s*(\w+),\s*(-?\d+),/gu)) {
      const hook = m[1]!;
      parsed.push({
        key: hook === "NULL" ? null : hook.replace(/^prt_/u, ""),
        priority: Number(m[2]),
      });
    }
    expect(parsed).toHaveLength(22);
    expect(SIDE_HANDLERS).toEqual(parsed);
  });

  it("names a real sidebarModel field for every non-NULL row, and nothing else", () => {
    const st = makeState();
    const modelKeys = sidebarModel(st).map((f) => f.key);
    const handlerKeys = SIDE_HANDLERS.filter((h) => h.key !== null).map((h) => h.key);
    /* Both directions: a handler with no field would draw nothing, and a field
     * with no handler would never be placed at all. */
    expect(handlerKeys).toEqual(modelKeys);
  });
});

describe("sidebarLayout (update_sidebar, ui-display.c L844)", () => {
  const at = (rows: number) => new Map(sidebarLayout(rows).map((p) => [p.key, p.row]));

  it("at the standard 24 rows nothing is culled, and the four gaps land where the C puts them", () => {
    const placed = sidebarLayout(24);
    expect(placed).toHaveLength(18); // the 22 rows minus the four blank ones
    const rows = at(24);
    expect(rows.get("race")).toBe(1);
    expect(rows.get("con")).toBe(12);
    /* 13 is the NULL at index 12, so AC starts the next block at 14. */
    expect(rows.get("ac")).toBe(14);
    expect(rows.get("sp")).toBe(16);
    /* 17 is a NULL; health is 18; 19 and 20 are two more NULLs in a row. */
    expect(rows.get("health")).toBe(18);
    expect(rows.get("speed")).toBe(21);
    expect(rows.get("depth")).toBe(22);
    /* No two fields share a row. */
    expect(new Set(placed.map((p) => p.row)).size).toBe(placed.length);
  });

  it("culls the LEAST important rows first - the inversion the priorities exist for", () => {
    /* 18 rows is the reflow floor (web term.ts minRows), so max_priority = 16.
     * A renderer that just walked the model until it ran out of screen would
     * keep class/race/title/equippy and lose these three. */
    const rows = at(18);
    expect(rows.has("depth")).toBe(true);
    expect(rows.has("speed")).toBe(true);
    expect(rows.has("health")).toBe(true);
    expect(rows.has("hp")).toBe(true);
    expect(rows.has("class")).toBe(false); // priority 22, the least important
    expect(rows.has("race")).toBe(false); // 19
    expect(rows.has("title")).toBe(false); // 18
    expect(rows.has("equippy")).toBe(false); // 17
    expect(rows.has("exp")).toBe(true); // 16, exactly at max_priority
  });

  it("max_priority is height - 2, so a row appears the moment its height allows", () => {
    /* prt_exp is priority 16: absent at 17 rows (max 15), present at 18. */
    expect(at(17).has("exp")).toBe(false);
    expect(at(18).has("exp")).toBe(true);
    /* And CON, priority 2, survives a screen with nothing else on it. */
    expect(at(4).has("con")).toBe(true);
  });

  it("shrinking the screen only ever removes rows", () => {
    for (let h = 5; h < 24; h++) {
      const smaller = new Set(sidebarLayout(h).map((p) => p.key));
      const bigger = new Set(sidebarLayout(h + 1).map((p) => p.key));
      for (const key of smaller) expect(bigger.has(key)).toBe(true);
    }
  });

  it("a blank grouping row consumes a row even though nothing draws it", () => {
    /* Constructed, because every shipped NULL is followed by rows whose offsets
     * this would otherwise be indistinguishable from. */
    const withGap = sidebarLayout(24, [
      { key: "hp", priority: 1 },
      { key: null, priority: 1 },
      { key: "sp", priority: 1 },
    ]);
    expect(withGap).toEqual([
      { key: "hp", row: 1 },
      { key: "sp", row: 3 },
    ]);
  });

  it("a culled blank grouping row does NOT consume one", () => {
    const culled = sidebarLayout(24, [
      { key: "hp", priority: 1 },
      { key: null, priority: 90 }, // above max_priority (22): skipped entirely
      { key: "sp", priority: 1 },
    ]);
    expect(culled).toEqual([
      { key: "hp", row: 1 },
      { key: "sp", row: 2 },
    ]);
  });

  it("a negative priority prints from the bottom (L871-875, L880-881)", () => {
    /* No shipped entry has one; the arm is ported because it is a line of the C,
     * so it is exercised with a table that supplies one. -3 is priority 3, and
     * the row is hgt - (count - index) = 24 - (3 - 1) = 22. */
    const table = [
      { key: "hp", priority: 1 },
      { key: "depth", priority: -3 },
      { key: "sp", priority: 1 },
    ];
    expect(sidebarLayout(24, table)).toEqual([
      { key: "hp", row: 1 },
      { key: "depth", row: 22 },
      /* It still advanced the counter, so sp is on 3 and not 2. */
      { key: "sp", row: 3 },
    ]);
    /* And it is culled on its ABSOLUTE priority: |-3| = 3 > 24 - 2 is false, so
     * try a screen where it is: max_priority = 2. */
    expect(sidebarLayout(4, table).map((p) => p.key)).toEqual(["hp", "sp"]);
  });
});
