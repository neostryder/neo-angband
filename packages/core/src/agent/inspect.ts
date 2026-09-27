/** Read-pure answers from the game's inspection and selection code. */
import { FEAT, IGNORE_TYPE_ENTRIES, OF, TF, TMD } from "../generated/index.js";
import { DDGRID } from "../loc.js";
import type { EffectRecordJson } from "../obj/types.js";
import type { GameState } from "../game/context.js";
import { knownDescOf, objectKindName } from "../game/describe.js";
import { USE_MODE, floorPile, scanItems } from "../game/floor.js";
import { gearGet } from "../game/gear.js";
import { knownFeat, knownFloorObject, knownIsClosedDoor, knownIsDiggable, knownIsOpenDoor, squareIsKnown } from "../game/known.js";
import { squareIsDisarmableTrap } from "../game/trap.js";
import { findPath } from "../game/player-path.js";
import { squareIsUnlockedDoor } from "../game/cave-cmd.js";
import { objectInfoTextblock } from "../game/object-inspect.js";
import { objCanRefill, objCanThrow, objCanWear, objHasInscrip, objIsActivatable, objectUseCode } from "../game/obj-cmd.js";
import { makeSpellChanceEnv, playerCanCast } from "../game/spell-cmd.js";
import { buildObjectEffectChain } from "../game/obj-cmd.js";
import { spellDamageSummary } from "../effects/effect-info.js";
import { loreDescription } from "../mon/lore-describe.js";
import { monsterIsVisible } from "../mon/predicate.js";
import { ODESC, objectDesc } from "../obj/desc.js";
import { QUALITY_VALUE_NAMES, ITYPE_MAX, egoHasIgnoreType } from "../obj/ignore.js";
import type { GameObject } from "../obj/object.js";
import {
  tvalIsEdible, tvalIsPotion,
  tvalIsRod, tvalIsScroll, tvalIsStaff, tvalIsWand,
} from "../obj/object.js";
import { PY_SPELL, objCanBrowse, objCanCastFrom, objCanStudy, playerObjectToBook, spellByIndex, spellChance, spellOkayToCast } from "../player/spell.js";
import { Chunk, featIsPassable } from "../world/chunk.js";
import { PROJECT, computeProjection, projectPath } from "../world/project.js";
import { inputToken } from "./boundary.js";
import { AgentCapabilityError } from "./types.js";
import type { AgentCapabilities, AgentViewDeps } from "./types.js";

export interface InspectResult {
  readonly token: ReturnType<typeof inputToken>;
  readonly title: string;
  readonly text: string;
}

export interface SpellInspectResult {
  readonly token: ReturnType<typeof inputToken>;
  readonly name: string;
  readonly description: string;
  readonly level: number;
  readonly mana: number;
  readonly failChance: number;
  readonly canCastNow: boolean;
}

export interface ItemTesterResult {
  readonly token: ReturnType<typeof inputToken>;
  readonly items: readonly ({ readonly handle: number } | { readonly floor: { readonly x: number; readonly y: number; readonly index: number } })[];
}

export interface GridInspectResult {
  readonly token: ReturnType<typeof inputToken>;
  readonly grids: readonly { readonly x: number; readonly y: number }[];
}

export interface TravelPathResult {
  readonly token: ReturnType<typeof inputToken>;
  readonly grids: readonly { readonly x: number; readonly y: number }[];
}

export interface TileActionsResult {
  readonly token: ReturnType<typeof inputToken>;
  readonly codes: readonly string[];
}

export interface ItemRulesResult {
  readonly token: ReturnType<typeof inputToken>;
  readonly kinds: readonly { readonly kidx: number; readonly name: string; readonly ignoreAware: boolean; readonly ignoreUnaware: boolean; readonly noteAware: string | null; readonly noteUnaware: string | null }[];
  readonly quality: readonly { readonly itype: number; readonly name: string; readonly threshold: number; readonly thresholdName: string }[];
  readonly egos: readonly { readonly eidx: number; readonly name: string; readonly itype: number; readonly ignored: boolean }[];
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

function gate<T extends unknown[], R>(caps: AgentCapabilities | undefined, domain: string, read: (...args: T) => R): (...args: T) => R {
  return (...args) => {
    if (caps && !caps.has(`state:${domain}.read`) && !caps.has("state:*.read")) {
      throw new AgentCapabilityError(`agent inspect: capability "state:${domain}.read" is not granted`);
    }
    return read(...args);
  };
}

function itemSelection(state: GameState, code: string): { mode: number; test: (obj: GameObject) => boolean } | null {
  const p = state.actor.player;
  const packFloor = USE_MODE.INVEN | USE_MODE.QUIVER | USE_MODE.FLOOR;
  const invenFloor = USE_MODE.INVEN | USE_MODE.FLOOR;
  const selections: Record<string, { mode: number; test: (obj: GameObject) => boolean }> = {
    inspect: { mode: packFloor | USE_MODE.EQUIP, test: () => true },
    wield: { mode: packFloor, test: (o) => objCanWear(state, o) },
    takeoff: { mode: USE_MODE.EQUIP, test: (o) => !o.flags.has(OF.STICKY) },
    drop: { mode: USE_MODE.INVEN | USE_MODE.QUIVER | USE_MODE.EQUIP, test: () => true },
    inscribe: { mode: packFloor | USE_MODE.EQUIP, test: () => true },
    uninscribe: { mode: packFloor | USE_MODE.EQUIP, test: objHasInscrip },
    activate: { mode: USE_MODE.EQUIP, test: objIsActivatable },
    "use-staff": { mode: invenFloor, test: (o) => tvalIsStaff(o.tval) },
    "aim-wand": { mode: invenFloor, test: (o) => tvalIsWand(o.tval) },
    "zap-rod": { mode: invenFloor, test: (o) => tvalIsRod(o.tval) },
    eat: { mode: invenFloor, test: (o) => tvalIsEdible(o.tval) },
    quaff: { mode: invenFloor, test: (o) => tvalIsPotion(o.tval) },
    read: { mode: invenFloor, test: (o) => tvalIsScroll(o.tval) },
    refill: { mode: packFloor, test: (o) => objCanRefill(state, o) },
    cast: { mode: USE_MODE.INVEN, test: (o) => objCanCastFrom(p, o) },
    study: { mode: USE_MODE.INVEN, test: (o) => objCanStudy(p, o) },
    browse: { mode: USE_MODE.INVEN, test: (o) => objCanBrowse(p, o) },
    fire: { mode: packFloor, test: (o) => o.tval === state.actor.combat.ammoTval },
    ignore: { mode: packFloor | USE_MODE.EQUIP, test: () => true },
    throw: { mode: packFloor | USE_MODE.EQUIP, test: (o) => objCanThrow(state, o) },
    use: { mode: USE_MODE.INVEN | USE_MODE.EQUIP, test: (o) =>
      (p.equipment.some((h) => h && gearGet(state.gear, h) === o)) ? objIsActivatable(o) :
      objectUseCode(state, o) !== null },
  };
  return Object.hasOwn(selections, code) ? selections[code]! : null;
}

/** Use the player's remembered features and visible monsters for geometry. */
function knownChunk(state: GameState): Chunk {
  const live = state.chunk;
  const known = new Chunk(live.features, live.height, live.width);
  for (let y = 0; y < live.height; y++) {
    for (let x = 0; x < live.width; x++) {
      const at = { x, y };
      known.setFeat(at, squareIsKnown(state, at) ? knownFeat(state, at) : FEAT.FLOOR);
      const midx = live.mon(at);
      if (midx > 0 && state.monsters[midx] && monsterIsVisible(state.monsters[midx]!)) {
        known.setMon(at, midx);
      }
    }
  }
  return known;
}

export function createInspectView(state: GameState, deps: AgentViewDeps, caps?: AgentCapabilities) {
  const at = () => inputToken(state);
  const valid = (to: { x: number; y: number }) => Number.isInteger(to.x) && Number.isInteger(to.y) && state.chunk.inBoundsFully(to);
  return {
    inspectItem: gate(caps, "inventory", (ref: number | { floor: { x: number; y: number; index: number } }): InspectResult | null => {
      const obj = typeof ref === "number" ? gearGet(state.gear, ref) :
        state.chunk.inBounds(ref.floor) ? state.floor.get(ref.floor.y * state.chunk.width + ref.floor.x)?.[ref.floor.index] : undefined;
      /* A floor object answers only when the player remembers that exact
       * object; a sensed "something is here" memory does not name it. */
      if (!obj) return null;
      if (typeof ref !== "number") {
        const known = knownFloorObject(state, ref.floor, obj);
        if (!known || known.sensed) return null;
      }
      const extras = deps.inspect?.objectInfo;
      if (!extras) return null;
      const title = objectDesc(obj, ODESC.PREFIX | ODESC.FULL, state.actor.player, state.runeEnv, knownDescOf(state, true), undefined, state.chestTraps);
      const text = objectInfoTextblock(state, obj, extras, true).runs.map((run) => run.text).join("");
      return freeze({ token: at(), title: title.charAt(0).toUpperCase() + title.slice(1), text });
    }),
    monsterRecall: gate(caps, "monsters", (raceIndex: number): InspectResult | null => {
      const race = deps.inspect?.races?.[raceIndex];
      const lore = state.lore.get(raceIndex);
      const loreDeps = deps.inspect?.loreDeps;
      /* Recall covers races the player has met, as the knowledge menu does. */
      if (!race || !lore || !loreDeps || !(lore.sights > 0 || lore.allKnown)) return null;
      const text = loreDescription(race, lore, loreDeps()).map((run) => run.text).join("");
      return freeze({ token: at(), title: race.name, text });
    }),
    spellInfo: gate(caps, "spells", (spellIndex: number): SpellInspectResult | null => {
      const player = state.actor.player;
      const spell = spellByIndex(player.cls, spellIndex);
      if (!spell) return null;
      let description = spell.text;
      const flags = player.spellFlags[spellIndex] ?? 0;
      if ((flags & PY_SPELL.WORKED) && !(flags & PY_SPELL.FORGOTTEN)) {
        const chain = buildObjectEffectChain(spell.effectsRaw as EffectRecordJson[], state);
        const summary = spellDamageSummary(chain, deps.inspect?.projections ?? []);
        if (summary) description += `  ${summary}`;
      }
      const books = scanItems(state, state.gear.pack.length + state.z.floorSize, USE_MODE.INVEN, (o) => objCanCastFrom(player, o));
      const hasBook = books.some((obj) => playerObjectToBook(player, obj)?.spells.some((s) => s.sidx === spellIndex));
      return freeze({ token: at(), name: spell.name, description, level: spell.level, mana: spell.mana,
        failChance: spellChance(player, state.statInd ?? [], spellIndex, makeSpellChanceEnv(state)),
        canCastNow: playerCanCast(state) && spellOkayToCast(player, spellIndex) && hasBook });
    }),
    itemTester: gate(caps, "inventory", (code: string): ItemTesterResult => {
      const selection = itemSelection(state, code);
      if (!selection) return freeze({ token: at(), items: [] });
      const objects = new Set(scanItems(state, state.gear.store.size + state.z.floorSize, selection.mode, selection.test));
      const from = state.actor.grid;
      const pile = floorPile(state, from);
      const items: ItemTesterResult["items"][number][] = [];
      const addHandle = (handle: number) => {
        if (objects.has(gearGet(state.gear, handle)!)) items.push({ handle });
      };
      /* The prompt labels inventory in upkeep->inven order, then equipment,
       * quiver and floor. scanItems supplies the tester result above; these
       * lists preserve the same choice order the web picker displays. */
      if (selection.mode & USE_MODE.INVEN) for (const handle of state.gear.inven ?? []) addHandle(handle);
      if (selection.mode & USE_MODE.EQUIP) for (const handle of state.actor.player.equipment) if (handle) addHandle(handle);
      if (selection.mode & USE_MODE.QUIVER) for (const handle of state.gear.quiver ?? []) if (handle) addHandle(handle);
      if (selection.mode & USE_MODE.FLOOR) pile.forEach((obj, index) => {
        if (objects.has(obj)) items.push({ floor: { x: from.x, y: from.y, index } });
      });
      return freeze({ token: at(), items });
    }),
    projectionPath: gate(caps, "map", (to: { x: number; y: number }): GridInspectResult => {
      const grids = valid(to) ? projectPath(knownChunk(state), state.z.maxRange, state.actor.grid, to, PROJECT.INFO | PROJECT.STOP) : [];
      return freeze({ token: at(), grids });
    }),
    blastArea: gate(caps, "map", (to: { x: number; y: number }, radius: number): GridInspectResult => {
      if (!valid(to) || !Number.isSafeInteger(radius) || radius < 1) return freeze({ token: at(), grids: [] });
      const grids = computeProjection(knownChunk(state), { origin: state.actor.grid, finish: to, rad: radius,
        typ: 0, flg: PROJECT.INFO | PROJECT.STOP | PROJECT.KILL, maxRange: state.z.maxRange, dam: 0 }).grids;
      return freeze({ token: at(), grids });
    }),
    travelPath: gate(caps, "map", (to: { x: number; y: number }): TravelPathResult | null => {
      if (!valid(to) || !squareIsKnown(state, to) || (state.actor.player.timed[TMD.CONFUSED] ?? 0) > 0) return null;
      /* find_path reads chunk predicates; give it the remembered features,
       * while its own distance and tie-breaking code chooses the route. */
      const path = findPath({ ...state, chunk: knownChunk(state) }, state.actor.grid, to);
      if (path.length < 0) return null;
      const grids: { x: number; y: number }[] = [];
      let { x, y } = state.actor.grid;
      for (let i = path.length - 1; i >= 0; i--) {
        const step = DDGRID[path.steps[i]!]!;
        x += step.x;
        y += step.y;
        grids.push({ x, y });
      }
      return freeze({ token: at(), grids });
    }),
    tileActions: gate(caps, "map", (to: { x: number; y: number }): TileActionsResult => {
      const codes: string[] = [];
      if (!valid(to) || !squareIsKnown(state, to)) return freeze({ token: at(), codes });
      const from = state.actor.grid;
      const here = to.x === from.x && to.y === from.y;
      const adjacent = !here && Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) === 1;
      const feat = knownFeat(state, to);
      const features = state.chunk.features;
      if (adjacent) {
        if (knownIsDiggable(state, to) || (knownIsClosedDoor(state, to) && !features.featHas(feat, TF.PERMANENT))) codes.push("tunnel");
        if (knownIsClosedDoor(state, to)) codes.push("open");
        if (knownIsOpenDoor(state, to)) codes.push("close");
        if (squareIsDisarmableTrap(state, to) || (knownIsClosedDoor(state, to) && squareIsUnlockedDoor(state, to, deps.inspect?.trapDeps))) codes.push("disarm");
        /* A walk into a monster is the registered melee command. */
        if (featIsPassable(features, feat)) codes.push("walk");
      }
      if (here) {
        if (features.featHas(feat, TF.UPSTAIR) && !(state.options?.get("birth_force_descend") ?? false)) codes.push("ascend");
        if (features.featHas(feat, TF.DOWNSTAIR) && (state.levelTopology ? state.levelTopology.canTravel(state.chunk.depth, 1) : state.chunk.depth < state.z.maxDepth - 1)) codes.push("descend");
        if (floorPile(state, to).length > 0) codes.push("pickup");
      }
      return freeze({ token: at(), codes });
    }),
    itemRules: gate(caps, "inventory", (): ItemRulesResult => {
      const reg = deps.reg;
      const kinds = (reg?.kinds ?? []).filter((kind) => kind && (state.isAware?.(kind) ?? true) && (state.everseen?.kindSeen(kind) ?? false))
        .map((kind) => ({ kidx: kind.kidx, name: objectKindName(state, kind, true),
          ignoreAware: state.ignore.kindIsIgnoredAware(kind.kidx), ignoreUnaware: state.ignore.kindIsIgnoredUnaware(kind.kidx),
          noteAware: state.autoinscribe?.get(kind.kidx, true) ?? null, noteUnaware: state.autoinscribe?.get(kind.kidx, false) ?? null }));
      const quality = Array.from({ length: ITYPE_MAX - 1 }, (_, index) => {
        const itype = index + 1;
        const threshold = state.ignore.level[itype] ?? 0;
        return { itype, name: IGNORE_TYPE_ENTRIES[itype]?.description ?? "", threshold,
          thresholdName: QUALITY_VALUE_NAMES[threshold] ?? QUALITY_VALUE_NAMES[0]! };
      });
      const egos = (reg?.egos ?? []).filter((ego) => ego && (state.everseen?.egoSeen(ego) ?? false))
        .flatMap((ego) => quality.filter(({ itype }) => egoHasIgnoreType(ego, itype, reg!.kinds))
          .map(({ itype }) => ({ eidx: ego.eidx, name: ego.name, itype, ignored: state.ignore.egoIsIgnored(ego.eidx, itype) })));
      return freeze({ token: at(), kinds, quality, egos });
    }),
  };
}
