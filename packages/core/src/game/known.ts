/**
 * The player's map knowledge, a reduction of the upstream player->cave twin
 * chunk (cave.c cave_know_*, cave-square.c square_memorize / square_forget /
 * square_know_pile / square_sense_pile, and cave-view.c note_spot).
 *
 * Upstream duplicates the whole chunk for the player's knowledge so memory
 * can go stale (you remember the door you saw, not the open floor it has
 * since become). This port keeps the same staleness property with a flat
 * remembered-feat array plus a remembered-floor-object marker per grid;
 * that is exactly what detection, magic mapping and the renderer's
 * remembered-terrain display need. The full twin (known traps as objects,
 * per-object known twins) rides later batches and is ledgered.
 *
 * noteSpots() is the note_spot pass over the current field of view: every
 * SEEN grid is memorized with its floor pile. It then runs updateMonsters()
 * - the faithful port of update_mon (mon-util.c) - to refresh every live
 * monster's visibility flags from telepathy, infravision, see-invisible and
 * illumination. The session and front end call it after every updateView.
 *
 * update_mon only READS MFLAG_MARK; the detection-fade lifecycle
 * (MFLAG_MARK / MFLAG_SHOW clearing, game-world.c process_world) lives in
 * tickMonsterMarks() until the world-clock port absorbs it.
 */

import { FEAT, MFLAG, OF, RF, TF, TMD } from "../generated/index.js";
import type { Loc } from "../loc.js";
import { DDGRID_DDD, loc, locEq, locSum } from "../loc.js";
import {
  featIsBright,
  featIsGranite,
  featIsMagma,
  featIsPassable,
  featIsProjectable,
  featIsQuartz,
} from "../world/chunk.js";
import { caveIlluminate } from "../gen/cave.js";
import {
  squareIsNoEsp,
  squareIsSeen,
  squareIsView,
  type ViewerState,
} from "../world/view.js";
import { getLore, loreCountU16 } from "../mon/lore.js";
import {
  monsterIsCamouflaged,
  monsterIsEspDetectable,
  monsterIsInView,
  monsterIsInvisible,
  monsterIsMimicking,
  monsterIsVisible,
} from "../mon/predicate.js";
import { disturb } from "./player-path.js";
import { describeObject } from "./describe.js";
import { floorCarry, floorExcise, floorPile, squareHoldsObject } from "./floor.js";
import { noteSpotRevealTrap } from "./trap.js";
import { GEAR_LABELS, gearToLabel } from "./gear.js";
import { ODESC } from "../obj/desc.js";
import { monsterCarry } from "../mon/make.js";
import type { Monster } from "../mon/monster.js";
import type { GameObject } from "../obj/object.js";
import { objectCopy, tvalIsJewelry, tvalIsMoney } from "../obj/object.js";
import { objectTouch, playerKnowsEgo } from "../obj/known-object.js";
import {
  NOOP_FLAVOR_AWARE_DEPS,
  OBJ_NOTICE,
  buildRuneList,
  objectRunesKnown,
  playerKnowObjectAwareness,
} from "../obj/knowledge.js";
import type { GameState } from "./context.js";

/**
 * A remembered floor object: the port of grid_data's object fields
 * (map_info's object loop, cave-map.c:151-169).
 *
 * THE KIND, NOT A GLYPH. This used to be `{ ch, attr }` - the glyph resolved
 * once, at memorize time - and that threw away everything the DRAW needs.
 * Upstream keeps a kind pointer (`grid_data.first_kind`) and resolves it at
 * draw time through object_kind_attr / object_kind_char (ui-map.c:47,
 * grid_data_as_text), which is the SAME call a visible object goes through, so
 * a remembered object picks up two things a pre-resolved glyph cannot:
 *
 *   - the FLAVOUR of a kind the player is not yet aware of. `head.kind.dAttr`
 *     is a flavoured kind's placeholder colour, which for a potion is BLACK -
 *     so a remembered unidentified potion was drawn as an invisible `!`.
 *   - the x_attr TILE. A glyph has no tile, which is why every item on the
 *     floor turned into ASCII the moment it left view, in every tile set.
 *
 * The sensed marker keeps upstream's money/item split too: unknown_gold_kind
 * and unknown_item_kind are real object kinds (`<unknown treasure>` and
 * `<unknown item>` in object.txt), so a tile set draws them like anything else.
 */
export type KnownObjectMemory =
  /** An exact memory: grid_data.first_kind. */
  | { seen: true; kidx: number }
  /** grid_data.unseen_money / unseen_object: sensed, kind unknown. */
  | { seen: false; money: boolean };

/** The player's knowledge of the current level. */
export interface KnownMap {
  width: number;
  height: number;
  /** Remembered feat per grid; -1 = unknown. May be stale, as upstream. */
  feat: Int16Array;
  /** Remembered floor objects by grid index (y * width + x). */
  objects: Map<number, KnownObjectMemory>;
}

/** A blank (all-unknown) knowledge map for a fresh level. */
export function newKnownMap(width: number, height: number): KnownMap {
  return {
    width,
    height,
    feat: new Int16Array(width * height).fill(-1),
    objects: new Map(),
  };
}

function gi(state: GameState, grid: Loc): number {
  return grid.y * state.chunk.width + grid.x;
}

/** square_memorize: remember the grid's current terrain. */
export function squareMemorize(state: GameState, grid: Loc): void {
  /* square_set_known_feat (cave-square.c:1274), the static setter behind both
   * square_memorize (cave-square.c:1576) and square_forget (:1582): upstream
   * writes player->cave->squares[y][x].feat; the port writes state.known.feat.
   * The `c != cave` guard is structural here - there is only one known map. */
  state.known.feat[gi(state, grid)] = state.chunk.feat(grid);
}

/**
 * square_forget (cave-square.c:1580-1583): forget the grid's TERRAIN only.
 * Upstream is `square_set_known_feat(c, grid, FEAT_NONE)` and nothing else -
 * it does not touch the remembered object pile, and map_info's object loop
 * (cave-map.c:155-169) is NOT gated on square_isknown, so an object remembered
 * on a grid whose terrain has been forgotten stays on the player's map. The
 * remembered pile is dropped only by forget_remembered_objects, i.e. through
 * squareKnowPile / squareSensePile.
 */
export function squareForget(state: GameState, grid: Loc): void {
  state.known.feat[gi(state, grid)] = -1;
}

/**
 * cave_illuminate (cave-map.c L555), the runtime version: the generation-time
 * flag subset (gen/cave.ts caveIlluminate) plus the player-knowledge half
 * (square_memorize / square_forget), gated per grid on the same "light" test
 * upstream computes over the 9-entry ddgrid_ddd (the 8 neighbors plus self,
 * cave.c L72-73): a floor or stairs grid nearby makes the boundary worth
 * remembering. RNG-free.
 *
 * DEFERRED: PU_UPDATE_VIEW | PU_MONSTERS and the PR_MAP / PR_MONLIST /
 * PR_ITEMLIST redraws (cave-map.c L608-612) - the front end's updateView +
 * noteSpots pass already runs unconditionally after every state-changing
 * action (packages/web/src/main.ts), so there is no separate dirty-flag
 * mechanism to set here, matching the other knowledge-writing effect handlers
 * (game/effect-detect.ts) which don't re-trigger it either.
 */
export function caveIlluminateKnown(state: GameState, daytime: boolean): void {
  const c = state.chunk;

  /* Apply light or darkness (the flag subset, shared with generation). */
  caveIlluminate(c, daytime);

  /* The player-knowledge half: memorize / forget gated on adjacency light. */
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const grid = loc(x, y);

      /* Skip grids with no surrounding floors or stairs. */
      let light = false;
      for (let d = 0; d < 9; d++) {
        const aGrid = locSum(grid, DDGRID_DDD[d] as Loc);
        if (!c.inBoundsFully(aGrid)) continue;
        if (c.isFloor(aGrid) || c.isStairs(aGrid)) {
          light = true;
          break;
        }
      }

      if (daytime || !c.isFloor(grid)) {
        if (light) squareMemorize(state, grid);
      } else if (!featIsBright(c.features, c.feat(grid))) {
        /* Like cave_unlight(), forget "boring" grids. */
        if (c.isFloor(grid)) squareForget(state, grid);
      }
    }
  }

  /* Light shop doorways. */
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const grid = loc(x, y);
      if (!c.isShop(grid)) continue;
      for (let i = 0; i < 8; i++) {
        const aGrid = locSum(grid, DDGRID_DDD[i] as Loc);
        if (c.inBounds(aGrid)) squareMemorize(state, aGrid);
      }
    }
  }
}

/**
 * cave_known (cave-map.c:633-660): memorize town terrain except interior
 * wall/lava regions.
 *
 * MUST run BEFORE caveIlluminateKnown, as generate.c:1547-1550 does. The order
 * is load-bearing and not interchangeable: cave_illuminate writes player memory
 * too -- square_memorize at cave-map.c:582 and, at night, square_forget on
 * boring floor grids at :586-587. So upstream deliberately memorizes the whole
 * town here and then lets night-time illumination FORGET the boring floors
 * again. Running this second would leave a night town fully mapped, which is the
 * opposite of upstream.
 */
export function caveKnown(state: GameState): void {
  const c = state.chunk;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const grid = loc(x, y);
      let count = 0;
      for (let d = 0; d < 8; d++) {
        const adjacent = locSum(grid, DDGRID_DDD[d] as Loc);
        if (!c.isProjectable(adjacent) || featIsBright(c.features, c.feat(adjacent))) count++;
      }
      if (count < 8) squareMemorize(state, grid);
    }
  }
}

/** square_isknown: the player remembers some terrain here. */
export function squareIsKnown(state: GameState, grid: Loc): boolean {
  return state.known.feat[gi(state, grid)]! >= 0;
}

/** The remembered feat at a grid (-1 = unknown). */
export function knownFeat(state: GameState, grid: Loc): number {
  return state.known.feat[gi(state, grid)]!;
}

/**
 * square_isbelievedwall (cave-square.c L901-912): out-of-bounds is a wall,
 * unknown terrain is not believed to be a wall, and known terrain is tested
 * against the remembered feature rather than the live map.
 */
export function squareIsBelievedWall(state: GameState, grid: Loc): boolean {
  if (!state.chunk.inBoundsFully(grid)) return true;
  if (!squareIsKnown(state, grid)) return false;
  return !featIsProjectable(state.chunk.features, knownFeat(state, grid));
}

/**
 * square_isrubble(player->cave, grid): is the terrain the player REMEMBERS here
 * rubble? Upstream freely runs the square predicates against player->cave to
 * ask "what does the player think is there", which is how the bump-into-terrain
 * paths decide whether their message contradicts the player's memory
 * (cmd-cave.c:1112, :1243). Unknown terrain is not remembered as anything.
 */
export function knownIsRubble(state: GameState, grid: Loc): boolean {
  const feat = knownFeat(state, grid);
  if (feat < 0) return false;
  const reg = state.chunk.features;
  return !reg.featHas(feat, TF["WALL"]) && reg.featHas(feat, TF["ROCK"]);
}

/**
 * square_isperm(player->cave, grid): PERMANENT and ROCK, remembered.
 * do_cmd_tunnel_test MEMORIZES rather than forgets on this one - hitting
 * permanent rock the player did not know about teaches them it is there
 * (cmd-cave.c:462-468).
 */
export function knownIsPerm(state: GameState, grid: Loc): boolean {
  const feat = knownFeat(state, grid);
  if (feat < 0) return false;
  const reg = state.chunk.features;
  return reg.featHas(feat, TF["PERMANENT"]) && reg.featHas(feat, TF["ROCK"]);
}

/** square_isopendoor(player->cave, grid): a remembered closable door. */
export function knownIsOpenDoor(state: GameState, grid: Loc): boolean {
  const feat = knownFeat(state, grid);
  if (feat < 0) return false;
  return state.chunk.features.featHas(feat, TF["CLOSABLE"]);
}

/** square_isbrokendoor(player->cave, grid): remembered, passable, unclosable. */
export function knownIsBrokenDoor(state: GameState, grid: Loc): boolean {
  const feat = knownFeat(state, grid);
  if (feat < 0) return false;
  const reg = state.chunk.features;
  return (
    reg.featHas(feat, TF["DOOR_ANY"]) &&
    reg.featHas(feat, TF["PASSABLE"]) &&
    !reg.featHas(feat, TF["CLOSABLE"])
  );
}

/**
 * square_isdiggable(player->cave, grid): remembered mineral wall, secret door
 * or rubble - square_ismineral || square_issecretdoor || square_isrubble
 * (cave-square.c), evaluated on the remembered feature index.
 */
export function knownIsDiggable(state: GameState, grid: Loc): boolean {
  const feat = knownFeat(state, grid);
  if (feat < 0) return false;
  const reg = state.chunk.features;
  const isDoor = reg.featHas(feat, TF["DOOR_ANY"]);
  const mineral =
    featIsMagma(reg, feat) ||
    featIsQuartz(reg, feat) ||
    (featIsGranite(reg, feat) && !isDoor);
  const secretDoor = featIsGranite(reg, feat) && isDoor;
  return mineral || secretDoor || knownIsRubble(state, grid);
}

/**
 * square_iscloseddoor(player->cave, grid): does the player REMEMBER a closed
 * door here? The open / close / disarm tests use it to spot a stale memory - a
 * remembered door where the real grid has none is forgotten rather than left to
 * mislead the map (cmd-cave.c:160-163, :243-246).
 */
export function knownIsClosedDoor(state: GameState, grid: Loc): boolean {
  const feat = knownFeat(state, grid);
  if (feat < 0) return false;
  return state.chunk.features.featHas(feat, TF["DOOR_CLOSED"]);
}

/**
 * square_ispassable || square_isrubble || square_iscloseddoor on player->cave
 * (cmd-cave.c:1126-1128, :1253-1255): the player remembers something they could
 * have walked into here. Discovering a wall instead means the memory was wrong
 * and upstream forgets the grid.
 */
export function knownIsEnterable(state: GameState, grid: Loc): boolean {
  const feat = knownFeat(state, grid);
  if (feat < 0) return false;
  const reg = state.chunk.features;
  return (
    featIsPassable(reg, feat) ||
    knownIsRubble(state, grid) ||
    reg.featHas(feat, TF["DOOR_CLOSED"])
  );
}

/**
 * square_ismemorybad: the player remembers terrain here that no longer
 * matches the live cave.
 */
export function squareMemoryBad(state: GameState, grid: Loc): boolean {
  const known = state.known.feat[gi(state, grid)]!;
  return known >= 0 && known !== state.chunk.feat(grid);
}

/** The remembered feat at a grid, or FEAT_NONE ("unknown grid") if unknown. */
function apparentFeat(state: GameState, grid: Loc): number {
  const f = knownFeat(state, grid);
  return f >= 0 ? f : FEAT.NONE;
}

/** The mimic-resolved feature backing the grid's remembered terrain. */
function apparentFeature(state: GameState, grid: Loc) {
  const f = state.chunk.features.get(apparentFeat(state, grid));
  return f.mimic !== null ? state.chunk.features.get(f.mimic) : f;
}

/**
 * square_apparent_name (cave-square.c): the mimic-resolved name of the
 * grid's remembered terrain (the look/target UI's "You see <name>").
 */
export function squareApparentName(state: GameState, grid: Loc): string {
  return apparentFeature(state, grid).name;
}

/**
 * square_apparent_look_prefix (cave-square.c): the indefinite article (or a
 * feature-specific override) that precedes squareApparentName. Overrides are
 * reproduced verbatim from terrain.txt, trailing space and all - stores'
 * "the entrance to the " carries one, LAVA's "some" does not (upstream data,
 * not a port bug).
 */
export function squareApparentLookPrefix(state: GameState, grid: Loc): string {
  const f = apparentFeature(state, grid);
  if (f.lookPrefix) return f.lookPrefix;
  const c = f.name.charAt(0).toLowerCase();
  return "aeiou".includes(c) ? "an " : "a ";
}

/**
 * square_apparent_look_in_preposition (cave-square.c): the preposition (or a
 * feature-specific override) used for the player's own grid ("You are
 * <preposition><name>."). Overrides are reproduced verbatim from terrain.txt
 * (e.g. doors' "in" carries no trailing space, unlike the "on " default).
 */
export function squareApparentLookInPreposition(state: GameState, grid: Loc): string {
  const f = apparentFeature(state, grid);
  return f.lookInPreposition || "on ";
}

/**
 * square_isinteresting (cave-square.c), read against the player's knowledge
 * (as target_accept and the look UI's terrain handler do): a memorized grid
 * whose feature carries TF_INTERESTING.
 */
export function squareIsInteresting(state: GameState, grid: Loc): boolean {
  if (!squareIsKnown(state, grid)) return false;
  return state.chunk.features.featHas(knownFeat(state, grid), TF.INTERESTING);
}

/** The remembered floor object at a grid, if any. */
export function knownObject(
  state: GameState,
  grid: Loc,
): KnownObjectMemory | null {
  return state.known.objects.get(gi(state, grid)) ?? null;
}

function pileHead(
  state: GameState,
  grid: Loc,
  pred?: (obj: GameObject) => boolean,
): GameObject | null {
  const pile = state.floor.get(gi(state, grid));
  if (!pile) return null;
  for (const obj of pile) {
    if (!pred || pred(obj)) return obj;
  }
  return null;
}

/**
 * square_know_pile (reduced): remember the (first matching) floor object
 * exactly; forget a remembered object that is no longer there. Without a
 * predicate the whole pile is considered (the note_spot case).
 *
 * forget_remembered_objects (cave-square.c:1106, called at :1156 and :1186):
 * upstream walks player->cave's shadow pile and excises/deletes any known
 * twin whose original is no longer on the grid. The port's knowledge is one
 * glyph per grid (state.known.objects), so that whole walk collapses to the
 * "nothing here any more -> delete the entry" branch at the end of this
 * function and of squareSensePile.
 */
export function squareKnowPile(
  state: GameState,
  grid: Loc,
  pred?: (obj: GameObject) => boolean,
): void {
  /* object_touch (cave-square.c square_know_pile L1177-1181, obj-knowledge.c
   * object_touch L960-972): only the pile on the player's OWN grid is "touched",
   * which marks each object ASSESSED (revealing its combat bracket and, for an
   * artifact, its name - the shadow gates both on ASSESSED), auto-notices the
   * artifact, and logs the find (history_find_artifact). A detected/lit pile at
   * a distance is only "seen", never touched, so it does not count as found -
   * hence the player-grid gate here. (player_know_object's flavour-awareness
   * side effect is the cross-object rune-learn sweep - updatePlayerObjectKnowledge
   * below - fired at the live rune-learn sites, not here.) */
  if (locEq(grid, state.actor.grid)) {
    const pile = state.floor.get(gi(state, grid));
    if (pile) {
      for (const obj of pile) {
        if (!pred || pred(obj)) {
          objectTouch(obj, {
            onArtifactFound: () => state.onArtifactFound?.(obj.artifact!),
          });
        }
      }
    }
  }

  const head = pileHead(state, grid, pred);
  if (head) {
    /* grid_data.first_kind (cave-map.c:165): the KIND, resolved to a glyph and
     * a tile at draw time by object_kind_attr / object_kind_char. */
    state.known.objects.set(gi(state, grid), { seen: true, kidx: head.kind.kidx });
  } else if (!pileHead(state, grid)) {
    /* Nothing at all here: any memory is stale. */
    state.known.objects.delete(gi(state, grid));
  }
}

/**
 * gear_to_label (obj-gear.c:443) for a held handle. The one implementation lives
 * in game/gear.ts; equipment is handled by this module's callers (they know the
 * body slot), so the two-argument form is what is wanted here.
 */
function gearPackLabel(state: GameState, handle: number): string {
  return gearToLabel(state.gear, handle);
}

/**
 * update_player_object_knowledge (obj-knowledge.c L1218): after any rune-learn,
 * re-run player_know_object over every object the player can currently see or
 * hold, so a newly-learned rune propagates awareness across ALL of them - not
 * just the object that taught it. This is the sweep the audit's KN-03 flagged
 * missing: e.g. wielding a Ring of Strength learns the STR modifier rune, and it
 * is this sweep (not object_learn_on_wield itself) that then makes the ring's
 * kind flavour-aware, so it stops reading as an unidentified "Steel Ring".
 *
 * The port keeps rune knowledge in typed player stores and synthesises each
 * object's known-twin on demand for display, so the only persistent side effect
 * that needs a home here is player_know_object's awareness half (L1163-1198): a
 * carried/floor jewel whose non-curse runes are now all known becomes
 * flavour-aware (L1163-1167, KN-03), a special artifact becomes aware outright
 * (L1168-1175), and a first reveal of a name/ego prints "You have %s (%c)." /
 * "On the ground: %s." (L1184-1198, KN-04).
 *
 * Scope vs upstream: flavour awareness is per-KIND and global to the game (the
 * shared FlavorKnowledge), so making a kind aware from a carried jewel already
 * covers every store / curse-template instance of that kind - the port need only
 * sweep the player's gear and the floor, not the store/curse lists C also walks
 * purely to rewrite their per-object display twins. Called at the live rune-learn
 * sites (wield, being hit, identify), exactly where C's player_learn_rune
 * tail-calls it (L1373).
 */
export function updatePlayerObjectKnowledge(state: GameState): void {
  const flavor = state.flavorKnown;
  if (!flavor) return; // worldless harness: no flavour store to mutate.
  const flavorDeps = state.flavorAwareDeps ?? NOOP_FLAVOR_AWARE_DEPS;
  const env = state.runeEnv;
  const p = state.actor.player;
  const runes = buildRuneList(env);
  const nonCurse = runes.filter((r) => r.variety !== "curse");

  const know = (obj: GameObject, report: (name: string) => void): void => {
    /* player_know_object early return (L1033): the unassessed get no ID. */
    if ((obj.notice & OBJ_NOTICE.ASSESSED) === 0) return;

    /* seen defaults true (L1025); a first name/ego reveal sets it false. */
    let seen = true;

    /* Ego branch (L1156-1161): a newly-known ego reports unless its ego was
     * already everseen. */
    if (obj.ego && playerKnowsEgo(p, obj.ego, obj, env)) {
      seen = state.everseen ? state.everseen.egoSeen(obj.ego) : true;
    }

    /* Jewelry / special-artifact awareness (L1163-1175). playerKnowObjectAwareness
     * fires object_flavor_aware for both; the `seen` reads below mirror its
     * conditions (from the same objectRunesKnown / kidx tests) purely to decide
     * whether to print the report. */
    if (tvalIsJewelry(obj.tval)) {
      if (objectRunesKnown(p, env, obj, nonCurse)) {
        seen = obj.artifact
          ? true
          : state.everseen
            ? state.everseen.kindSeen(obj.kind)
            : true;
      }
    } else if (obj.kind.kidx >= flavor.ordinaryKindMax) {
      seen = true; // L1173: special artifacts never report from this branch.
    }

    /* The awareness mutation itself (idempotent across repeated sweeps). */
    playerKnowObjectAwareness(p, env, obj, runes, flavor, flavorDeps);

    /* Report on new stuff (L1184-1198). describeObject marks kind/ego everseen
     * (obj-desc.c L633-637), exactly as C's object_desc does at L1190. */
    if (!seen) report(describeObject(state, obj, ODESC.PREFIX | ODESC.FULL));
  };

  /* Level objects first (L1223-1226: cave->objects), matching C's order so a
   * floor instance wins the first-reveal report over a carried one of the same
   * (now-everseen) kind. */
  for (const pile of state.floor.values()) {
    for (const obj of pile) {
      /* Every level object becomes known, but the REPORT is gated on
       * square_holds_object(cave, p->grid, obj) (L1193) - only what is under the
       * player's feet is announced. The port used to announce every pile on the
       * level, so learning one rune could name objects across the whole floor. */
      know(obj, (name) => {
        if (squareHoldsObject(state, state.actor.grid, obj)) {
          state.msg?.(`On the ground: ${name}.`);
        }
      });
    }
  }

  /* Player objects (L1229 walks p->gear; the port splits it into equipment +
   * pack). */
  const equip = p.equipment;
  for (let slot = 0; slot < equip.length; slot++) {
    const handle = equip[slot] ?? 0;
    if (!handle) continue;
    const obj = state.gear.store.get(handle);
    if (!obj) continue;
    const label = GEAR_LABELS[slot] ?? ""; // equipped_item_slot -> label (L452).
    know(obj, (name) => state.msg?.(`You have ${name} (${label}).`));
  }
  for (const handle of state.gear.pack) {
    const obj = state.gear.store.get(handle);
    if (!obj) continue;
    const label = gearPackLabel(state, handle);
    know(obj, (name) => state.msg?.(`You have ${name} (${label}).`));
  }

  /* autoinscribe_ground + autoinscribe_pack (obj-knowledge.c:1245-1247): the
   * tail of update_player_object_knowledge. This is where learning a rune
   * stamps its autoinscription onto everything the player can already see or
   * carry, and where a newly-aware kind's note lands. Reached through the
   * state seam because obj-cmd.ts imports this module. */
  state.autoinscribeAll?.();
}

/**
 * square_sense_pile (reduced): become aware that something matching is
 * here without learning what (the sensed marker), keeping an exact
 * memory if one exists; forget stale memories like squareKnowPile.
 */
export function squareSensePile(
  state: GameState,
  grid: Loc,
  pred?: (obj: GameObject) => boolean,
): void {
  const idx = gi(state, grid);
  const head = pileHead(state, grid, pred);
  if (head) {
    const existing = state.known.objects.get(idx);
    if (!existing || !existing.seen) {
      /* object_sense's fake-kind assignment (obj-knowledge.c:886-892): the
       * marker is unknown_gold_kind for money and unknown_item_kind otherwise,
       * and the two draw differently (a white `*` and a red one, plus whatever
       * the tile set maps them to). The port used to collapse both to one
       * colourless marker. */
      state.known.objects.set(idx, { seen: false, money: tvalIsMoney(head.tval) });
    }
  } else if (!pileHead(state, grid)) {
    state.known.objects.delete(idx);
  }
}

/* forgetMap (a whole-map "forget everything + wipe DTRAP" pass) was removed:
 * 4.2.6 has no such function. It existed only to back wiz_dark, and wiz_dark
 * (cave-map.c:490-546) does the OPPOSITE - it memorizes terrain exactly as
 * wiz_light does and only perma-darkens the grids. See game/effect-terrain.ts
 * wizLightLevel. */

/** OPT(player, disturb_near): shipped default true (options.c). */
function disturbNear(state: GameState): boolean {
  return state.options?.get("disturb_near") ?? true;
}

/**
 * `monster_is_mimicking(mon) && ignore_item_ok(player, mon->mimicked_obj)`:
 * true when the monster is pretending to be an object the player has chosen to
 * ignore, which is the one case where mimicry makes it LESS visible rather than
 * more (mon-util.c L394-399 and L429-433).
 *
 * The port has no object oidx registry, so the live link is the floor object's
 * mimickingMIdx back-reference (game/mon-place.ts monCreateMimickedObject) -
 * the same resolution becomeAware does.
 */
function mimickedObjectIgnored(state: GameState, mon: Monster): boolean {
  if (!monsterIsMimicking(mon)) return false;
  const obj = floorPile(state, mon.grid).find((o) => o.mimickingMIdx === mon.midx);
  return obj ? (state.isIgnored?.(obj) ?? false) : false;
}

/**
 * update_mon (mon-util.c): recompute a single monster's visibility. When
 * `full`, recompute its distance to the player (mon->cdis); otherwise use the
 * stored one. Sets MFLAG_VISIBLE / MFLAG_VIEW from telepathy, infravision,
 * see-invisible and illumination, learns the associated lore flags, and
 * disturbs the player on appearance / disappearance. Draws no RNG.
 *
 * The player's derived flags (OF_TELEPATHY / OF_SEE_INVIS) and see_infra come
 * from the last calc_bonuses (state.playerState); the blind check reads
 * player->timed[TMD_BLIND] directly. update_mon only READS MFLAG_MARK - the
 * MARK / SHOW detection-fade lives in tickMonsterMarks.
 */
export function updateMon(
  state: GameState,
  mon: Monster,
  full: boolean,
): void {
  const c = state.chunk;
  const lore = getLore(state.lore, mon.race);

  /* If still generating the level, measure distances from the middle
   * (character_dungeon); a live refresh always uses the player's grid. */
  const pgrid: Loc = state.playing
    ? state.actor.grid
    : loc(Math.trunc(c.width / 2), Math.trunc(c.height / 2));

  /* Seen at all. */
  let flag = false;
  /* Seen by vision. */
  let easy = false;

  /* ESP permitted, see-invisible and infravision come from the derived
   * player state (racial / class innate flags, worn equipment, and the timed
   * player_flags_timed / see_infra bumps all flow through calc_bonuses). With
   * no derived state (worldless harness) fall back to a bare character: no OF
   * flags, racial infravision only. */
  const ps = state.playerState;
  let telepathyOk = ps ? ps.flags.has(OF.TELEPATHY) : false;
  const seeInvis = ps ? ps.flags.has(OF.SEE_INVIS) : false;
  const seeInfra = ps ? ps.seeInfra : state.actor.player.race.infravision;

  /* Compute distance, or just use the current one. */
  let d: number;
  if (full) {
    const dy = Math.abs(pgrid.y - mon.grid.y);
    const dx = Math.abs(pgrid.x - mon.grid.x);
    d = dy > dx ? dy + (dx >> 1) : dx + (dy >> 1);
    if (d > 255) d = 255;
    mon.cdis = d;
  } else {
    d = mon.cdis;
  }

  /* Detected (read-only: the MARK / SHOW fade belongs to tickMonsterMarks). */
  if (mon.mflag.has(MFLAG.MARK)) flag = true;

  /* Check if telepathy works here. */
  if (squareIsNoEsp(c, mon.grid) || squareIsNoEsp(c, pgrid)) {
    telepathyOk = false;
  }

  /* Nearby. */
  if (d <= state.z.maxSight) {
    /* Basic telepathy. */
    if (telepathyOk && monsterIsEspDetectable(mon)) {
      flag = true;
      /* Check for LOS so that MFLAG_VIEW is set later. */
      if (squareIsView(c, mon.grid)) easy = true;
    }

    /* Normal line of sight and player is not blind. */
    if (squareIsView(c, mon.grid) && !state.actor.player.timed[TMD.BLIND]) {
      /* Use "infravision". */
      if (d <= seeInfra) {
        /* Learn about warm / cold blood. */
        lore.flags.on(RF.COLD_BLOOD);
        if (!mon.race.flags.has(RF.COLD_BLOOD)) {
          easy = flag = true;
        }
      }

      /* Use illumination. */
      if (squareIsSeen(c, mon.grid)) {
        /* Learn about invisibility. */
        lore.flags.on(RF.INVISIBLE);
        if (monsterIsInvisible(mon)) {
          /* See invisible. */
          if (seeInvis) easy = flag = true;
        } else {
          easy = flag = true;
        }
      }

      /* path_analyse (learn intervening-square terrain): DEFERRED. */
    }
  }

  /* If a mimic looks like an ignored item, it's not seen (mon-util.c L394-399).
   * This used to be a comment saying mon.mimickedObj is always 0 so the guard
   * cannot fire - true when it was written, and NOT true since generation
   * started building mimic objects (gen/util.ts placeNewMonsterOne). */
  if (mimickedObjectIgnored(state, mon)) easy = flag = false;

  /* Is the monster now visible? */
  if (flag) {
    /* Learn about the monster's mind. */
    if (telepathyOk) {
      lore.flags.on(RF.EMPTY_MIND);
      lore.flags.on(RF.WEIRD_MIND);
      lore.flags.on(RF.SMART);
      lore.flags.on(RF.STUPID);
    }

    /* It was previously unseen. */
    if (!monsterIsVisible(mon)) {
      mon.mflag.on(MFLAG.VISIBLE);
      /* square_light_spot / PR_HEALTH / PR_MONLIST are presentation (#25). */
      /* Count "fresh" sightings (capped at SHRT_MAX). */
      loreCountU16(lore, "sights");
    }
  } else if (monsterIsVisible(mon)) {
    /* Not visible but was previously seen - treat mimics differently
     * (mon-util.c L429-433): a monster still mimicking a NON-ignored item keeps
     * MFLAG_VISIBLE, because what the player is looking at is the item. */
    if (mon.mimickedObj === 0 || mimickedObjectIgnored(state, mon)) {
      mon.mflag.off(MFLAG.VISIBLE);
    }
  }

  /* Is the monster now easily visible? */
  if (easy) {
    if (!monsterIsInView(mon)) {
      mon.mflag.on(MFLAG.VIEW);
      /* Disturb on appearance. */
      if (disturbNear(state)) disturb(state);
    }
  } else {
    if (monsterIsInView(mon)) {
      mon.mflag.off(MFLAG.VIEW);
      /* Disturb on disappearance (but not for a camouflaged monster). */
      if (disturbNear(state) && !monsterIsCamouflaged(mon)) disturb(state);
    }
  }
}

/**
 * become_aware (mon-util.c L711): reveal a camouflaged mimic. Clears
 * MFLAG_CAMOUFLAGE and, when the race has RF_UNAWARE, learns that flag into
 * its lore. If the monster was mimicking a floor object, names it (ODESC_BASE)
 * in a message when its square is seen, breaks the mimicry link on both
 * sides, removes the fake item from the floor, and refreshes the monster's
 * own visibility now that mimicry no longer masks it (update_mon). A no-op
 * monster that is not camouflaged. Draws no RNG.
 *
 * Object-mimic placement links mon.mimickedObj and the object's mimickingMIdx
 * back-reference at the monster's grid, so the object branch below fires for
 * every real mimic: generation-spawned ones through gen/util.ts
 * placeNewMonsterOne, and live-placed (summoned / bred) ones through
 * game/mon-place.ts monCreateMimickedObject.
 *
 * RF_MIMIC_INV's "give the monster a copy of the object before deleting it"
 * (mon-util.c L740-758) is now ported via obj/object.ts objectCopy (memcpy, no
 * RNG); only the known twin is DEFERRED with the knowledge subsystem. The
 * upkeep/redraw bits (PU_UPDATE_VIEW | PU_MONSTERS, PR_MONLIST | PR_ITEMLIST,
 * square_note_spot, square_light_spot) are presentation (#25), matching the
 * redraw deferral already noted for updateMon above.
 */
export function becomeAware(state: GameState, mon: Monster): void {
  if (!monsterIsCamouflaged(mon)) return;
  mon.mflag.off(MFLAG.CAMOUFLAGE);

  const lore = getLore(state.lore, mon.race);
  if (mon.race.flags.has(RF.UNAWARE)) lore.flags.on(RF.UNAWARE);

  if (mon.mimickedObj !== 0) {
    const obj = floorPile(state, mon.grid).find(
      (o) => o.mimickingMIdx === mon.midx,
    );
    if (obj && obj.grid) {
      const name = describeObject(state, obj, ODESC.BASE);
      if (squareIsSeen(state.chunk, obj.grid)) {
        state.msg?.(`The ${name} was really a monster!`);
      }

      /* Clear the mimicry. */
      obj.mimickingMIdx = 0;
      mon.mimickedObj = 0;

      /* Give a copy of the object to the monster if appropriate
       * (mon-util.c L740-758). object_copy is a memcpy (draws no RNG); the
       * known twin (given->known) is DEFERRED with the knowledge subsystem
       * (obj/object.ts module docs), so only the base object is copied. The
       * port's monsterCarry always succeeds (it prepends to heldObj), so the
       * upstream carry-failed delete branch (L751-757) is unreachable and
       * omitted. */
      if (mon.race.flags.has(RF.MIMIC_INV)) {
        const given = objectCopy(obj);
        monsterCarry(mon.heldObj, given, mon.midx);
      }

      /* Delete the mimicked object; lighting/noting done via update_mon. */
      floorExcise(state, obj.grid, obj);

      /* Since mimicry affects visibility, update that. */
      updateMon(state, mon, false);
    }
  }
}

/**
 * move_mimicked_object (mon-util.c L620-650): move the fake floor object with
 * a camouflaged monster swap. The copied object keeps its mimic back-link;
 * if the destination cannot carry it, RF_MIMIC_INV gives it to the monster.
 * This operation is presentation/RNG-free.
 */
export function moveMimickedObject(
  state: GameState,
  mon: Monster,
  from: Loc,
  to: Loc,
): void {
  if (mon.mimickedObj === 0) return;
  const obj = floorPile(state, from).find((o) => o.mimickingMIdx === mon.midx);
  if (!obj) return;

  const moved = objectCopy(obj);
  if (!floorCarry(state, to, moved)) {
    if (mon.race.flags.has(RF.MIMIC_INV)) {
      monsterCarry(mon.heldObj, moved, mon.midx);
    }
  }
  floorExcise(state, from, obj);
  if (!floorPile(state, to).some((o) => o.mimickingMIdx === mon.midx)) {
    mon.mimickedObj = 0;
  }
}

/** update_monsters (mon-util.c): update every live (non-dead) monster. */
export function updateMonsters(state: GameState, full: boolean): void {
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    updateMon(state, mon, full);
  }
}

/**
 * The five player fields updateView reads, taken off a live GameState.
 *
 * One definition because there were two, and they agreed on the wrong thing.
 * `level` is `p->lev` (cave-view.c:778, the UNLIGHT view radius
 * `2 + p->lev / 6 - cur_light`), and both the web shell and the MCP session were
 * passing `chunk.depth` - the dungeon depth. Only an UNLIGHT player carrying no
 * light can see the difference, which is exactly the kind of field that stays
 * wrong for a year in two copies and is right once in one.
 */
export function viewerStateOf(state: GameState): ViewerState {
  const actor = state.actor;
  return {
    grid: actor.grid,
    curLight: actor.light,
    blind: (actor.player.timed[TMD.BLIND] ?? 0) > 0,
    hasUnlight: actor.unlight,
    level: actor.player.lev,
  };
}

/**
 * note_spot pass: memorize every currently seen grid with its floor pile,
 * then refresh all monster visibility via update_mon.
 *
 * Called after every updateView. Upstream, movement sets PU_DISTANCE and
 * update() runs update_monsters(TRUE) - cdis and visibility recompute in one
 * pass - while a view-only change runs update_monsters(FALSE). Since cdis is
 * purely geometric (idempotent when nothing moved, correct when the player
 * did), noteSpots recomputes it here (full=true) so the d <= max_sight and
 * d <= see_infra gates never read a stale distance after a step.
 */
export function noteSpots(state: GameState): void {
  const c = state.chunk;

  /*
   * Blind forget of the current non-passable remembered square
   * (cave-view.c:894-897): when blind and the player grid is known as
   * impassable in map memory, forget it. Lives here (not pure view.ts)
   * because it mutates KnownMap; called immediately after every updateView.
   */
  if ((state.actor.player.timed[TMD.BLIND] ?? 0) > 0) {
    const pgrid = state.actor.grid;
    if (squareIsKnown(state, pgrid)) {
      const feat = knownFeat(state, pgrid);
      if (feat >= 0 && !featIsPassable(c.features, feat)) {
        squareForget(state, pgrid);
      }
    }
  }

  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const grid = { x, y };
      if (!squareIsSeen(c, grid)) continue;
      squareMemorize(state, grid);
      squareKnowPile(state, grid);
      /* Notice secret traps on the newly-seen grid (cave-map.c square_note_spot
       * L236-238 / cave-view.c update_one L840-842). */
      noteSpotRevealTrap(state, grid);
    }
  }

  updateMonsters(state, true);
}

/**
 * The MFLAG_NICE / MFLAG_MARK / MFLAG_SHOW housekeeping process_world runs at
 * the end of a player turn (game-world.c:882-908): clear NICE; where a monster
 * is MARKed but no longer SHOWn, drop the mark and re-run update_mon; then
 * clear every SHOW. This keeps a freshly detected monster displayed for one
 * more refresh before fading. Interim home until the world-clock / process_world
 * port absorbs it (the NICE clear must be preserved when it does).
 */
export function tickMonsterMarks(state: GameState): void {
  /* Clear NICE flag, and show marked monsters. */
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    mon.mflag.off(MFLAG.NICE);
    if (mon.mflag.has(MFLAG.MARK) && !mon.mflag.has(MFLAG.SHOW)) {
      mon.mflag.off(MFLAG.MARK);
      updateMon(state, mon, false);
    }
  }

  /* Clear SHOW flag. */
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    mon.mflag.off(MFLAG.SHOW);
  }
}
