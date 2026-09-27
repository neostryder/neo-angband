/** Read-pure answers from the game's inspection and selection code. */
import { FEAT, OF, SQUARE } from "../generated/index.js";
import type { EffectRecordJson } from "../obj/types.js";
import type { GameState } from "../game/context.js";
import { knownDescOf } from "../game/describe.js";
import { USE_MODE, floorPile, scanItems } from "../game/floor.js";
import { gearGet } from "../game/gear.js";
import { squareIsKnown, knownFeat } from "../game/known.js";
import { objectInfoTextblock } from "../game/object-inspect.js";
import { objCanRefill, objCanThrow, objCanWear, objHasInscrip, objIsActivatable, objectUseCode } from "../game/obj-cmd.js";
import { makeSpellChanceEnv, playerCanCast } from "../game/spell-cmd.js";
import { buildObjectEffectChain } from "../game/obj-cmd.js";
import { spellDamageSummary } from "../effects/effect-info.js";
import { loreDescription } from "../mon/lore-describe.js";
import { monsterIsVisible } from "../mon/predicate.js";
import { ODESC, objectDesc } from "../obj/desc.js";
import type { GameObject } from "../obj/object.js";
import {
  tvalIsEdible, tvalIsPotion,
  tvalIsRod, tvalIsScroll, tvalIsStaff, tvalIsWand,
} from "../obj/object.js";
import { PY_SPELL, objCanBrowse, objCanCastFrom, objCanStudy, playerObjectToBook, spellByIndex, spellChance, spellOkayToCast } from "../player/spell.js";
import { Chunk } from "../world/chunk.js";
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
      if (!obj || (typeof ref !== "number" &&
        !state.chunk.sqinfoHas(ref.floor, SQUARE.VIEW) &&
        (ref.floor.x !== state.actor.grid.x || ref.floor.y !== state.actor.grid.y))) return null;
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
      if (!race || !lore || !loreDeps) return null;
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
  };
}
