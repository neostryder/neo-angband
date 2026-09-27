/** One read of the player's known level, separate from the small input capture. */

import { SQUARE, TRF } from "../generated/index.js";
import type { GameState } from "../game/context.js";
import { knownFeat, knownPile, squareIsKnown } from "../game/known.js";
import { squareTrap } from "../game/trap.js";
import { tvalIsMoney } from "../obj/object.js";
import { inputToken } from "./boundary.js";
import type { InputToken } from "./boundary.js";
import { itemView } from "./entity-views.js";
import type { AgentViewDeps, ItemView } from "./types.js";

export interface TrapView {
  readonly index: number;
  readonly name: string;
}

/** A shadow-pile entry. Sensed objects reveal only money versus other items. */
export type RememberedObject =
  | { readonly sensed: true; readonly money: boolean }
  | { readonly sensed: false; readonly kindIndex: number; readonly kindId?: string };

export interface RememberedCell {
  readonly feat: number;
  readonly featCode?: string;
  readonly traps: readonly TrapView[];
  readonly objects: readonly RememberedObject[];
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
): KnownLevelView {
  const { chunk } = state;
  const cells: KnownLevelCell[] = [];
  for (let y = 0; y < chunk.height; y++) {
    for (let x = 0; x < chunk.width; x++) {
      const grid = { x, y };
      if (!squareIsKnown(state, grid)) continue;
      const feat = knownFeat(state, grid);
      const remembered: RememberedCell = {
        feat,
        traps: squareTrap(state, grid)
          .filter((trap) => trap.flags.has(TRF.VISIBLE))
          .map((trap) => ({ index: trap.tidx, name: trap.kind.name })),
        objects: knownPile(state, grid).map((entry): RememberedObject => {
          if (entry.sensed) {
            return { sensed: true, money: tvalIsMoney(entry.obj.tval) };
          }
          const kindIndex = entry.obj.kind.kidx;
          const kindId = deps.resolver?.kindIdOrNull(kindIndex);
          return {
            sensed: false,
            kindIndex,
            ...(kindId ? { kindId } : {}),
          };
        }),
      };
      const rememberedCode = deps.resolver?.featIdOrNull(feat);
      if (rememberedCode !== null && rememberedCode !== undefined) {
        (remembered as { featCode?: string }).featCode = rememberedCode;
      }
      const cell: KnownLevelCell = {
        x,
        y,
        remembered,
        visible: chunk.sqinfoHas(grid, SQUARE.VIEW),
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
