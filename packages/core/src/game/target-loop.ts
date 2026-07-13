/**
 * The interactive look/target browsing loop, ported from
 * reference/src/ui-target.c: target_set_interactive's key-handling chain
 * (L1309-1634), target_set_interactive_aux plus its aux_* handlers
 * (L431-965), target_dir_allow (L95), and draw_path's colour rules
 * (L1072-1167).
 *
 * This module is the non-rendering half: given the current keypress it
 * decides the next cursor / interesting-grid-index / mode, and (on a
 * selection) drives target.ts's targetSetMonster/targetSetLocation exactly
 * as textui_target does; given a grid it builds the faithful one-line "look"
 * description; given a projected path it returns the faithful per-grid
 * colour. All actual screen I/O - the canvas, the camera, panels, mouse, the
 * help banner, the keyboard listener itself - is presentation (#25) and
 * lives in packages/web/src/main.ts's runTargetLoop, which drives this state
 * machine and repaints from what it returns. Nothing here reads the game
 * RNG: it only reads monster/grid/object/terrain state and calls the
 * deterministic projectPath/targetPick geometry.
 *
 * Reductions (alongside target.ts's own ledger):
 * - No panels on the web: change_panel / adjust_panel_help have no
 *   equivalent, so a direction key that finds no new interesting grid is
 *   simply silent (upstream's own behaviour once the retry-in-next-panel
 *   also fails) rather than bell()ing; only an unrecognized key bells.
 * - The per-grid content cascade (aux_monster's recall toggle, aux_object's
 *   per-item OLIST browse, aux_trap/aux_terrain's "press space to continue")
 *   collapses into ONE description string per grid (describeLookGrid),
 *   showing the highest-precedence content (monster > trap > object >
 *   terrain) instead of a press-by-press walk through all of them. A player
 *   who wants full recall opens the existing lore/inventory screens.
 * - Object piles: aux_object's floor_list is scanned from the player's
 *   remembered twin chunk (square_object(player->cave, grid)); this port has
 *   no per-object known twin (game/known.ts's own ledger), so a currently
 *   SEEN grid describes the live pile (floorPile) and a remembered-but-
 *   unseen grid falls back to the knownObject glyph marker ("something" /
 *   "an object") instead of the exact remembered name/count.
 * - draw_path's object/wall colours read square_object(player->cave, ...)
 *   and square_isprojectable(player->cave, ...) - the player's remembered
 *   map. Without a remembered-object list or a "believed wall" predicate
 *   (project.ts's own note on PROJECT_INFO), this port uses the live floor
 *   pile and the live projectability, which project.ts already documents as
 *   the approximation for this exact, UI-only, deferred branch.
 */

import { RF, TMD } from "../generated";
import type { Loc } from "../loc";
import { DDX, DDY, distance, loc } from "../loc";
import type { Monster } from "../mon/monster";
import {
  monsterIsCamouflaged,
  monsterIsMimicking,
  monsterIsObvious,
  monsterIsVisible,
} from "../mon/predicate";
import {
  COLOUR_BLUE,
  COLOUR_L_DARK,
  COLOUR_L_RED,
  COLOUR_WHITE,
  COLOUR_YELLOW,
} from "../color";
import { describeObject } from "./describe";
import { ODESC } from "../obj/desc";
import { floorPile } from "./floor";
import {
  knownObject,
  squareApparentLookInPreposition,
  squareApparentLookPrefix,
  squareApparentName,
  squareIsKnown,
} from "./known";
import { squareIsVisibleTrap, squareTrap } from "./trap";
import { squareIsSeen } from "../world/view";
import type { GameState } from "./context";
import { squareMonster } from "./context";
import {
  coordsDesc,
  lookMonDesc,
  targetAble,
  targetPick,
  targetSetLocation,
  targetSetMonster,
} from "./target";

/** is_a_vowel (z-util.c). */
function isAVowel(c: string): boolean {
  return "aeiouAEIOU".includes(c);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * monster_desc's MDESC_IND_VIS: an indefinite-article name for a visible
 * monster ("a kobold", "an ogre"), or the proper name for a unique. A
 * reduction consistent with target.ts's own ledger (the race name stands in
 * for the full monster_desc machinery).
 */
export function monsterLookName(mon: Monster): string {
  const n = mon.race.name;
  if (mon.race.flags.has(RF.UNIQUE)) return n;
  return `${isAVowel(n.charAt(0)) ? "an" : "a"} ${n}`;
}

/** The floor-object clause of a look description, or null if the grid has
 * nothing on it (aux_object, reduced per the module doc). */
function describeFloorAtGrid(state: GameState, grid: Loc): string | null {
  if (squareIsSeen(state.chunk, grid)) {
    const pile = floorPile(state, grid);
    if (pile.length > 1) return `a pile of ${pile.length} objects`;
    if (pile.length === 1) {
      return describeObject(state, pile[0]!, ODESC.PREFIX | ODESC.FULL);
    }
    return null;
  }
  const mem = knownObject(state, grid);
  if (!mem) return null;
  return mem.ch === null ? "something" : "an object";
}

/** The monster this description named, if any (for healthWho / lore tracking). */
export interface LookGridResult {
  text: string;
  mon: Monster | null;
}

/**
 * target_set_interactive_aux (L981) plus its aux_reinit/aux_hallucinate/
 * aux_monster/aux_trap/aux_object/aux_terrain handlers, folded into a single
 * "one line, highest precedence content" description per the module's
 * reduction note (monster > trap > object > terrain; hallucination overrides
 * everything but the player's own grid phrasing). `mode` is accepted for call-
 * site parity with target_set_interactive_aux (TARGET_LOOK vs TARGET_KILL)
 * but does not change the precedence order in this single-line reduction -
 * both modes describe the same highest-precedence content for a grid.
 */
export function describeLookGrid(
  state: GameState,
  grid: Loc,
  _mode: number,
): LookGridResult {
  const coords = coordsDesc(state, grid);

  /* aux_reinit (L431-468): phrase1/phrase2. */
  let phrase1: string;
  let phrase2: string;
  if (state.chunk.mon(grid) < 0) {
    phrase1 = "You are ";
    phrase2 = "on ";
  } else if (squareIsSeen(state.chunk, grid)) {
    phrase1 = "You see ";
    phrase2 = "";
  } else {
    const seenMon = squareMonster(state, grid);
    phrase1 = seenMon && monsterIsObvious(seenMon) ? "You sense " : "You recall ";
    phrase2 = "";
  }

  /* aux_hallucinate (L473-508). */
  if ((state.actor.player.timed[TMD.IMAGE] ?? 0) > 0) {
    return {
      text: `${phrase1}${phrase2}something strange, ${coords}.`,
      mon: null,
    };
  }

  /* aux_monster (L516-691, reduced: no carried-object / recall sub-loop). */
  const mon = squareMonster(state, grid);
  if (mon && monsterIsObvious(mon)) {
    const name = monsterLookName(mon);
    const health = lookMonDesc(mon);
    return {
      text: `${phrase1}${phrase2}${name} (${health}), ${coords}.`,
      mon,
    };
  }

  /* aux_trap (L696-758). */
  if (squareIsVisibleTrap(state, grid)) {
    const trap = squareTrap(state, grid)[0];
    if (trap) {
      const art = isAVowel(trap.kind.desc.charAt(0)) ? "an " : "a ";
      return {
        text: `${phrase1}${phrase2}${art}${trap.kind.desc}, ${coords}.`,
        mon: null,
      };
    }
  }

  /* aux_object (L763-888, reduced per the module doc). */
  const objDesc = describeFloorAtGrid(state, grid);
  if (objDesc) {
    return { text: `${phrase1}${phrase2}${objDesc}, ${coords}.`, mon: null };
  }

  /* aux_terrain (L893-950): shown whenever nothing else claimed the grid. */
  const name = squareApparentName(state, grid);
  const lphrase2 = phrase2 ? squareApparentLookInPreposition(state, grid) : "";
  const lphrase3 = squareApparentLookPrefix(state, grid);
  return {
    text: `${phrase1}${lphrase2}${lphrase3}${name}, ${coords}.`,
    mon: null,
  };
}

/**
 * draw_path (L1072-1167): the per-grid colour for the projected path
 * overlay, in order (past an unknown grid, everything after reads grey;
 * mimic/visible-monster/object/known-wall/unknown/plain).
 */
export function computePathColours(
  state: GameState,
  path: readonly Loc[],
): number[] {
  let pastKnown = false;
  const out: number[] = [];
  for (const grid of path) {
    let colour: number;
    const mon = squareMonster(state, grid);
    const hasObj = floorPile(state, grid).length > 0;

    if (pastKnown) {
      colour = COLOUR_L_DARK;
    } else if (mon && monsterIsVisible(mon)) {
      if (monsterIsMimicking(mon)) {
        colour = COLOUR_YELLOW;
      } else if (!monsterIsCamouflaged(mon)) {
        colour = COLOUR_L_RED;
      } else if (hasObj) {
        colour = COLOUR_YELLOW;
      } else if (squareIsKnown(state, grid) && !state.chunk.isProjectable(grid)) {
        colour = COLOUR_BLUE;
      } else {
        colour = COLOUR_WHITE;
      }
    } else if (hasObj) {
      colour = COLOUR_YELLOW;
    } else if (squareIsKnown(state, grid) && !state.chunk.isProjectable(grid)) {
      colour = COLOUR_BLUE;
    } else if (!squareIsKnown(state, grid)) {
      pastKnown = true;
      colour = COLOUR_L_DARK;
    } else {
      colour = COLOUR_WHITE;
    }
    out.push(colour);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The browsing loop's cursor/mode state (target_set_interactive proper).
 * ------------------------------------------------------------------ */

/** The loop's mutable UI state: cursor grid, interesting-list index, mode. */
export interface TargetLoopUi {
  x: number;
  y: number;
  /** show_interesting: browsing the interesting-grid list vs a free cursor. */
  showInteresting: boolean;
  targetIndex: number;
  help: boolean;
}

/**
 * target_set_interactive's init (L1282-1306), minus the panel/help-prompt
 * screen writes (presentation): start on the player in interesting mode
 * unless a valid starting grid is given, and cancel any existing target
 * exactly as upstream's target_set_monster(0) does.
 */
export function initTargetLoopUi(
  state: GameState,
  startX?: number,
  startY?: number,
): TargetLoopUi {
  let x: number;
  let y: number;
  let showInteresting: boolean;
  if (
    startX === undefined ||
    startY === undefined ||
    !state.chunk.inBoundsFully(loc(startX, startY))
  ) {
    x = state.actor.grid.x;
    y = state.actor.grid.y;
    showInteresting = true;
  } else {
    x = startX;
    y = startY;
    showInteresting = false;
  }
  targetSetMonster(state, null);
  return { x, y, showInteresting, targetIndex: 0, help: false };
}

/** use_interesting_mode (L1311): browsing the list, and it is non-empty. */
export function useInterestingLoopMode(
  ui: TargetLoopUi,
  targets: readonly Loc[],
): boolean {
  return ui.showInteresting && targets.length > 0;
}

/** The grid currently under the cursor (L1316-1317). */
export function currentLoopGrid(ui: TargetLoopUi, targets: readonly Loc[]): Loc {
  return useInterestingLoopMode(ui, targets)
    ? targets[ui.targetIndex]!
    : loc(ui.x, ui.y);
}

/**
 * target_dir_allow (L95), reduced to the web's keyset: a digit 1-9 or an
 * arrow key resolves to a keypad direction, 0 otherwise. No keymaps exist on
 * the web, so the allow_5/allow_esc parameters never matter here - the loop
 * handles '5' and Escape directly, at the same precedence upstream gives
 * them (both are intercepted before target_dir_allow is ever called).
 */
export function targetDirAllow(key: string): number {
  if (/^[1-9]$/.test(key)) return Number(key);
  switch (key) {
    case "ArrowDown":
      return 2;
    case "ArrowLeft":
      return 4;
    case "ArrowRight":
      return 6;
    case "ArrowUp":
      return 8;
    default:
      return 0;
  }
}

/** The result of one keypress through the loop. */
export interface TargetLoopStep {
  ui: TargetLoopUi;
  done: boolean;
  /** A bell() moment (an unrecognized key, or 't' on a non-target-able
   * monster) - presentation plays the sound; nothing here touches audio. */
  bell: boolean;
}

/**
 * One keypress through target_set_interactive's key-handling chain
 * (L1422-1632), minus every mouse/panel/pathfinding/ignore/stairs branch
 * (no mouse or panels on the web; pathfinding, ignore and nearest-stairs are
 * sibling gaps - an unrecognized/deferred key falls through to the
 * direction branch and bells exactly as upstream's "no direction" case).
 */
export function stepTargetLoop(
  state: GameState,
  targets: readonly Loc[],
  ui: TargetLoopUi,
  key: string,
): TargetLoopStep {
  const interesting = useInterestingLoopMode(ui, targets);

  if (key === "Escape" || key === "q") {
    return { ui, done: true, bell: false };
  }

  if (key === " " || key === "*" || key === "+") {
    if (interesting) {
      const next = (ui.targetIndex + 1) % targets.length;
      return { ui: { ...ui, targetIndex: next }, done: false, bell: false };
    }
    return { ui, done: false, bell: false };
  }

  if (key === "-") {
    if (interesting) {
      const next = (ui.targetIndex - 1 + targets.length) % targets.length;
      return { ui: { ...ui, targetIndex: next }, done: false, bell: false };
    }
    return { ui, done: false, bell: false };
  }

  if (key === "p") {
    return {
      ui: {
        ...ui,
        x: state.actor.grid.x,
        y: state.actor.grid.y,
        showInteresting: false,
      },
      done: false,
      bell: false,
    };
  }

  if (key === "o") {
    return { ui: { ...ui, showInteresting: false }, done: false, bell: false };
  }

  if (key === "m") {
    if (!interesting && targets.length > 0) {
      const cur = loc(ui.x, ui.y);
      let bestIndex = 0;
      let bestDist = Infinity;
      for (let i = 0; i < targets.length; i++) {
        const d = distance(cur, targets[i]!);
        if (d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      }
      return {
        ui: { ...ui, showInteresting: true, targetIndex: bestIndex },
        done: false,
        bell: false,
      };
    }
    return { ui, done: false, bell: false };
  }

  if (key === "t" || key === "5" || key === "0" || key === ".") {
    if (interesting) {
      const cur = currentLoopGrid(ui, targets);
      const mon = squareMonster(state, cur);
      if (targetAble(state, mon)) {
        /* Monster race and health are tracked by the caller's
         * describeLookGrid, matching upstream's own aux_monster. */
        targetSetMonster(state, mon);
        return { ui, done: true, bell: false };
      }
      return { ui, done: false, bell: true };
    }
    targetSetLocation(state, loc(ui.x, ui.y));
    return { ui, done: true, bell: false };
  }

  if (key === "?") {
    return { ui: { ...ui, help: !ui.help }, done: false, bell: false };
  }

  const dir = targetDirAllow(key);
  if (!dir) {
    return { ui, done: false, bell: true };
  }
  if (interesting) {
    const cur = currentLoopGrid(ui, targets);
    const ni = targetPick(cur.y, cur.x, DDY[dir]!, DDX[dir]!, targets);
    /* No panels on the web (change_panel is a no-op reduction): a miss
     * here stays SILENT, exactly as upstream once the retry-in-the-next-
     * panel also fails - only an unrecognized key (dir === 0) bells. */
    if (ni >= 0) {
      return { ui: { ...ui, targetIndex: ni }, done: false, bell: false };
    }
    return { ui, done: false, bell: false };
  }
  const nx = clamp(ui.x + DDX[dir]!, 1, state.chunk.width - 2);
  const ny = clamp(ui.y + DDY[dir]!, 1, state.chunk.height - 2);
  return { ui: { ...ui, x: nx, y: ny }, done: false, bell: false };
}
