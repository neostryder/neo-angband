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
 *   remembered twin chunk (square_object(player->cave, grid)); a currently
 *   SEEN grid describes the live pile (floorPile) and a remembered-but-unseen
 *   grid describes game/known.ts's per-object twin (knownPile) the same way -
 *   this used to fall back to a generic "something" / "an object" marker
 *   before knownPile existed to name the remembered object exactly.
 * - draw_path's object/wall colours read square_object(player->cave, ...)
 *   and square_isprojectable(player->cave, ...) - the player's remembered
 *   map. The WALL half is now exact: `squareIsBelievedWall` (game/known.ts)
 *   is square_isprojectable against the remembered feat, and this note used
 *   to say no such predicate existed. It was written before the predicate
 *   was, and then outlived it - PORT_TODO 7.1. Reading the live map here was
 *   an information leak, not a cosmetic one: a wall tunnelled out of sight,
 *   or rubble dropped behind the player, coloured the path by what is really
 *   there rather than by what the player has seen.
 *   The OBJECT half stays approximate, and for a reason that has not gone
 *   away: there is no per-object remembered twin (game/known.ts's own
 *   ledger), so `floorPile` is the live pile.
 */

import { RF, TMD } from "../generated/index.js";
import type { Loc } from "../loc.js";
import { DDX, DDY, distance, loc } from "../loc.js";
import type { Monster } from "../mon/monster.js";
import {
  monsterIsCamouflaged,
  monsterIsMimicking,
  monsterIsObvious,
  monsterIsVisible,
} from "../mon/predicate.js";
import {
  COLOUR_BLUE,
  COLOUR_L_DARK,
  COLOUR_L_RED,
  COLOUR_WHITE,
  COLOUR_YELLOW,
} from "../color.js";
import { describeObject } from "./describe.js";
import { ODESC } from "../obj/desc.js";
import { floorPile } from "./floor.js";
import {
  knownPile,
  squareApparentLookInPreposition,
  squareApparentLookPrefix,
  squareApparentName,
  squareIsBelievedWall,
  squareIsKnown,
} from "./known.js";
import { squareIsVisibleTrap, squareTrap } from "./trap.js";
import { squareIsSeen } from "../world/view.js";
import type { GameState } from "./context.js";
import { squareMonster } from "./context.js";
import { pathNearestKnown } from "./player-path.js";
import {
  coordsDesc,
  lookMonDesc,
  targetAble,
  targetPick,
  targetSetLocation,
  targetSetMonster,
} from "./target.js";

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
  /* scan_distant_floor (obj-pile.c:1334-1359) walks the player's remembered
   * pile (player->cave), not the live one, for an out-of-view grid - but it
   * still names what it finds with the SAME object_desc call a currently-seen
   * grid gets. It skips a sensed-only memory (kind unknown_item_kind: "you
   * sense something is here" carries no further description than that) and
   * an ignored item, same as this filter. */
  const pile = knownPile(state, grid).filter(
    (entry) => !entry.sensed && !state.isIgnored?.(entry.obj),
  );
  if (pile.length > 1) return `a pile of ${pile.length} objects`;
  if (pile.length === 1) {
    return describeObject(state, pile[0]!.obj, ODESC.PREFIX | ODESC.FULL);
  }
  return null;
}

/** The monster this description named, if any (for healthWho / lore tracking). */
export interface LookGridResult {
  text: string;
  mon: Monster | null;
}

/**
 * The wizard-mode tail every aux_* description carries (ui-target.c L400-407,
 * L483-487, L559-563, L717-721, L790-793, L915-918): where an ordinary look line
 * ends "..., <coords>.", a wizard's ends "..., <coords> (y:x, noise=N, scent=N).".
 * The same seven-site pattern in the C, so it lives in one place here.
 *
 * cave->noise.grids[y][x] / cave->scent.grids[y][x] are the flow maps the port
 * keeps as flat y*width+x arrays (the same ones do_cmd_wiz_peek_noise_scent
 * walks, see game/wizard.ts wizPeekFlow).
 */
function lookTail(state: GameState, grid: Loc): string {
  if (state.wizard !== true) return ".";
  const c = state.chunk;
  const i = grid.y * c.width + grid.x;
  return ` (${grid.y}:${grid.x}, noise=${c.noise[i] ?? 0}, scent=${c.scent[i] ?? 0}).`;
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
      text: `${phrase1}${phrase2}something strange, ${coords}${lookTail(state, grid)}`,
      mon: null,
    };
  }

  /* aux_monster (L516-691, reduced: no carried-object / recall sub-loop). The
   * wizard-only "She is carrying <object>" walk over mon->held_obj (L622-687) is
   * part of that same absent sub-loop - it is an interactive keypress loop, not a
   * line, so it lands with the sub-loop port and not with the wizard tail. */
  const mon = squareMonster(state, grid);
  if (mon && monsterIsObvious(mon)) {
    const name = monsterLookName(mon);
    const health = lookMonDesc(mon);
    return {
      text: `${phrase1}${phrase2}${name} (${health}), ${coords}${lookTail(state, grid)}`,
      mon,
    };
  }

  /* aux_trap (L696-758). */
  if (squareIsVisibleTrap(state, grid)) {
    const trap = squareTrap(state, grid)[0];
    if (trap) {
      const art = isAVowel(trap.kind.desc.charAt(0)) ? "an " : "a ";
      return {
        text: `${phrase1}${phrase2}${art}${trap.kind.desc}, ${coords}${lookTail(state, grid)}`,
        mon: null,
      };
    }
  }

  /* aux_object (L763-888, reduced per the module doc). */
  const objDesc = describeFloorAtGrid(state, grid);
  if (objDesc) {
    return {
      text: `${phrase1}${phrase2}${objDesc}, ${coords}${lookTail(state, grid)}`,
      mon: null,
    };
  }

  /* aux_terrain (L893-950): shown whenever nothing else claimed the grid. */
  const name = squareApparentName(state, grid);
  const lphrase2 = phrase2 ? squareApparentLookInPreposition(state, grid) : "";
  const lphrase3 = squareApparentLookPrefix(state, grid);
  return {
    text: `${phrase1}${lphrase2}${lphrase3}${name}, ${coords}${lookTail(state, grid)}`,
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
      } else if (squareIsKnown(state, grid) && squareIsBelievedWall(state, grid)) {
        colour = COLOUR_BLUE;
      } else {
        colour = COLOUR_WHITE;
      }
    } else if (hasObj) {
      colour = COLOUR_YELLOW;
    } else if (squareIsKnown(state, grid) && squareIsBelievedWall(state, grid)) {
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

/** Roguelike keyset direction letters (hjkl + yubn), mirroring keymap.ts's
 * DIRS_ROGUELIKE. Duplicated rather than imported: core does not depend on
 * the web package. */
const ROGUELIKE_DIRS: Record<string, number> = {
  h: 4,
  j: 2,
  k: 8,
  l: 6,
  y: 7,
  u: 9,
  b: 1,
  n: 3,
};

/**
 * target_dir_allow (L95), reduced to the web's keyset: a digit 1-9 or an
 * arrow key resolves to a keypad direction, 0 otherwise. When `rogueLike` is
 * set (rogue_like_commands), the hjkl/yubn letters also resolve - upstream's
 * keymap has already turned those into directions by the time
 * target_dir_allow sees them (they arrive as the same keypad-direction
 * keypresses digits and arrows do), so the port must translate them here
 * too rather than only in ordinary movement. No keymaps otherwise exist on
 * the web, so the allow_5/allow_esc parameters never matter here - the loop
 * handles '5' and Escape directly, at the same precedence upstream gives
 * them (both are intercepted before target_dir_allow is ever called).
 */
export function targetDirAllow(key: string, rogueLike = false): number {
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
      if (rogueLike) return ROGUELIKE_DIRS[key] ?? 0;
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
 * (L1422-1632), minus mouse/panel/ignore branches that have no web equivalent.
 * The nearest-stair '<'/'>' branches are retained as cursor-only operations;
 * unlike navigate-up/down they do not spend energy or enqueue a player turn.
 */
export function stepTargetLoop(
  state: GameState,
  targets: readonly Loc[],
  ui: TargetLoopUi,
  key: string,
  rogueLike = false,
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

  /* target_set_interactive's nearest-known-stair branches (ui-target.c
   * L1506-1542): search from the cursor, not from the player, and move only
   * the target cursor. This is UI navigation, so it draws no RNG and spends
   * no energy; the web caller repaints the target panel after this step. */
  if (key === ">" || key === "<") {
    const start = currentLoopGrid(ui, targets);
    const found = pathNearestKnown(
      state,
      start,
      key === ">"
        ? (s, grid) => s.chunk.isDownstairs(grid)
        : (s, grid) => s.chunk.isUpstairs(grid),
    );
    if (found.length > 0) {
      return {
        ui: { ...ui, x: found.dest.x, y: found.dest.y, showInteresting: false },
        done: false,
        bell: false,
      };
    }
    return { ui, done: false, bell: true };
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

  const dir = targetDirAllow(key, rogueLike);
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
