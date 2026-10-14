/** One read of the player's known level, separate from the small input capture. */

import { SQUARE } from "../generated/index.js";
import { squareIsSeen } from "../world/view.js";
import type { GameState } from "../game/context.js";
import { knownFeat, knownPile, squareIsKnown } from "../game/known.js";
import { squareKnownTraps, squareTrap } from "../game/trap.js";
import { tvalIsMoney, type GameObject } from "../obj/object.js";
import { OBJ_NOTICE } from "../obj/knowledge.js";
import { objectIsKnownArtifact, objectKnownShadow, objectRunesKnownUpstream } from "../obj/known-object.js";
import { describeObject, knownDescOf } from "../game/describe.js";
import { ODESC } from "../obj/desc.js";
import { inputToken } from "./boundary.js";
import type { InputToken } from "./boundary.js";
import { itemView } from "./entity-views.js";
import { knownFloorItems, type KnownItem } from "./known-world.js";
import type { AgentViewDeps, ItemView } from "./types.js";

export interface TrapView {
  readonly index: number;
  readonly name: string;
  readonly disabled: boolean;
}

/** A shadow-pile entry. Sensed objects reveal only money versus other items. */
/**
 * One remembered object, as the player can tell it apart. A flavoured kind the
 * player is not aware of is reported by its flavour and item class only, the
 * way upstream draws it (object_kind_char's use_flavor_glyph): its kind index
 * would name the potion or scroll the player has not identified.
 */
export type RememberedObject =
  | { readonly sensed: true; readonly money: boolean }
  | {
      readonly sensed: false;
      readonly aware: true;
      readonly kindIndex: number;
      readonly name: string;
      readonly kindId?: string;
      readonly aura?: ObjectAura;
    }
  | {
      readonly sensed: false;
      readonly aware: false;
      readonly tval: number;
      readonly flavorIndex: number;
      readonly flavorText: string;
      readonly aura?: ObjectAura;
    };

/**
 * What the player can already read on a remembered object's name, as a glow
 * class: `cursed` for a known curse (the "{cursed}" marker), `artifact` for an
 * object known to be an artifact, `rune` for an assessed object with a rune the
 * player has not learned (the "{??}" marker). One class per object, in that
 * order of precedence; absent when none applies. It is read from the player's
 * knowledge of the object, so it tells a mod nothing the item list does not.
 */
export type ObjectAura = "cursed" | "artifact" | "rune";

function objectAura(state: GameState, obj: GameObject): ObjectAura | undefined {
  const p = state.actor.player;
  const shadow = objectKnownShadow(obj, p, state.runeEnv, knownDescOf(state, true));
  if (shadow.curses) return "cursed";
  if (objectIsKnownArtifact(shadow)) return "artifact";
  if ((shadow.notice & OBJ_NOTICE.ASSESSED) !== 0 && !objectRunesKnownUpstream(obj, shadow, p, state.runeEnv)) {
    return "rune";
  }
  return undefined;
}

export interface RememberedCell {
  readonly feat: number;
  readonly featCode?: string;
  readonly traps: readonly TrapView[];
  readonly objects: readonly RememberedObject[];
  readonly items: readonly KnownItem[] | null;
}

export interface ActualCell {
  readonly feat: number;
  readonly featCode?: string;
  readonly traps: readonly TrapView[];
  readonly objects: readonly ItemView[];
  readonly monster: number;
}

export interface KnownLevelCell {
  readonly x: number;
  readonly y: number;
  readonly remembered: RememberedCell;
  readonly visible: boolean;
  readonly seen: boolean;
  readonly glow: boolean;
  readonly actual?: ActualCell;
}

export interface KnownLevelView {
  readonly token: InputToken;
  readonly levelId: number;
  readonly depth: number;
  readonly width: number;
  readonly height: number;
  readonly cells: readonly KnownLevelCell[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

/** Build from the game's knowledge helpers; actual data requires a separate grant. */
export function captureKnownLevel(
  state: GameState,
  deps: AgentViewDeps = {},
  includeActual = false,
  includeItems = true,
): KnownLevelView {
  const { chunk } = state;
  const cells: KnownLevelCell[] = [];
  for (let y = 0; y < chunk.height; y++) {
    for (let x = 0; x < chunk.width; x++) {
      const grid = { x, y };
      const pile = knownPile(state, grid);
      const terrainKnown = squareIsKnown(state, grid);
      if (!terrainKnown && pile.length === 0) continue;
      const feat = terrainKnown ? knownFeat(state, grid) : 0;
      const remembered: RememberedCell = {
        feat,
        /* The player's trap memory, not the live grid: a trap removed or
         * re-armed out of view is remembered as it was last seen. */
        traps: squareKnownTraps(state.known, grid).map((kind, index) => ({ index: kind.tidx, name: kind.name,
          disabled: state.known.trapDisabled?.get(y * chunk.width + x)?.[index] ?? false })),
        objects: pile.map((entry): RememberedObject => {
          if (entry.sensed) {
            return { sensed: true, money: tvalIsMoney(entry.obj.tval) };
          }
          const kind = entry.obj.kind;
          const aware = state.isAware ? state.isAware(kind) : true;
          const aura = objectAura(state, squareIsSeen(chunk, grid) ? entry.obj : entry.remembered ?? entry.obj);
          const flavor =
            !aware && state.hasFlavor?.(kind) ? state.flavorGlyph?.(kind) : undefined;
          if (flavor) {
            return {
              sensed: false,
              aware: false,
              tval: entry.obj.tval,
              flavorIndex: flavor.fidx,
              flavorText: flavor.text,
              ...(aura ? { aura } : {}),
            };
          }
          const kindIndex = kind.kidx;
          const obj = squareIsSeen(chunk, grid) ? entry.obj : entry.remembered ?? entry.obj;
          const kindId = deps.resolver?.kindIdOrNull(kindIndex);
          return {
            sensed: false,
            aware: true,
            kindIndex,
            name: describeObject(state, obj, ODESC.PREFIX | ODESC.FULL),
            ...(kindId ? { kindId } : {}),
            ...(aura ? { aura } : {}),
          };
        }),
        items: includeItems ? knownFloorItems(state, grid, deps) : null,
      };
      const rememberedCode = chunk.features.get(feat).code;
      if (rememberedCode !== null && rememberedCode !== undefined) {
        (remembered as { featCode?: string }).featCode = rememberedCode;
      }
      const cell: KnownLevelCell = {
        x,
        y,
        remembered,
        visible: chunk.sqinfoHas(grid, SQUARE.VIEW),
        seen: squareIsSeen(chunk, grid),
        glow: (state.known.glow?.[y * chunk.width + x] ?? 0) !== 0,
      };
      if (includeActual) {
        const index = y * chunk.width + x;
        const actualFeat = chunk.feat(grid);
        const actualCode = deps.resolver?.featIdOrNull(actualFeat);
        const actual: ActualCell = {
          feat: actualFeat,
          ...(actualCode ? { featCode: actualCode } : {}),
          traps: squareTrap(state, grid).map((trap) => ({
            index: trap.tidx,
            name: trap.kind.name,
            disabled: trap.timeout > 0,
          })),
          objects: (state.floor.get(index) ?? []).map((obj) =>
            itemView(0, obj, state, deps),
          ),
          monster: chunk.mon(grid),
        };
        (cell as { actual?: ActualCell }).actual = actual;
      }
      cells.push(cell);
    }
  }
  return deepFreeze({
    token: inputToken(state),
    levelId: state.levelSerial ?? 0,
    depth: chunk.depth,
    width: chunk.width,
    height: chunk.height,
    cells,
  });
}
