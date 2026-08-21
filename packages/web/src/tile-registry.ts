/**
 * The single door through which a mod supplies tiles the loaded pack does not
 * draw (registry:tiles).
 *
 * WHY THE GAME DOES NOT DO THIS ITSELF. It used to. 0.22.0 shipped a rule in
 * core that gave a mod-added monster the tile of a race sharing its `base`, and
 * an added object kind the tile of a kind sharing its `tval`. The rule worked,
 * and it was the port inventing something: 4.2.6 has no concept of a record a
 * mod added, so it has no opinion about what one should look like, and "the
 * lowest-index relative's picture" is authored taste rather than ported
 * behaviour. Worse, it made that call on behalf of tile sets the game does not
 * own - a pack drawn in 2003 has no art for content added twenty years later,
 * and a sibling's picture there is a confident lie where a letter was an honest
 * answer. So the game keeps the mechanism and a tileset mod holds the policy.
 * The removal is recorded in docs/modding/MOD_COMPATIBILITY.md.
 *
 * WHAT THIS GUARANTEES, so that no filler has to be trusted to be careful:
 *
 *   1. A filler can only write where NOTHING is assigned. Every pref layer -
 *      the pack's own, then each enabled mod's - has already run when fillers
 *      are called, so a tile an author named is not a blank and cannot be
 *      taken. `fillMonster` / `fillObject` return false rather than writing.
 *   2. Two fillers cannot fight. First to ask for an index gets it, and neither
 *      can undo the other, so their order changes nothing a player can see
 *      beyond which mod supplied a picture nothing else claimed.
 *   3. A filler that throws loses its fill and nothing else. A tile map that
 *      failed to build is a black screen, which is not a price a mod's bug gets
 *      to charge the player.
 *
 * AND SO THERE IS NO CONFLICT ROW FOR THIS, which is deliberate and is the kind
 * of omission an audit should be able to find an answer to. `mod-conflicts.ts`
 * reports CONTESTED slots - two mods wanting the same menu, the same HUD region,
 * the same grafID - and guarantee 2 above means two fillers are never contesting
 * anything. A row saying "these two mods both supply tiles" would report a
 * contest that cannot happen. The grafID claims a tiles mod makes are still
 * reported, because those are genuinely last-wins.
 */

import type {
  TileAtlas,
  TileFill,
  TileFillPack,
  TileFiller,
  TileMap,
  TileRegistryTarget,
} from "@rpgm-tools/neo-angband-core";

/** Report a filler's misbehaviour to the player, attributed to its mod. */
export type TileFillProblem = (owner: string | null, message: string) => void;

interface InstalledFiller {
  readonly owner: string | null;
  readonly filler: TileFiller;
}

/** What one run of the fillers supplied. */
export interface TileFillOutcome {
  /** How many fillers ran. */
  readonly fillers: number;
  /** Race tiles supplied. */
  readonly monsters: number;
  /** Object-kind tiles supplied. */
  readonly objects: number;
  /** Writes refused because something had already assigned that index. */
  readonly refused: number;
}

/** A tile is the raw (attr, char) pair; anything else is a mod's bug. */
function isAtlas(value: unknown): value is TileAtlas {
  if (value === null || typeof value !== "object") return false;
  const tile = value as Partial<TileAtlas>;
  return Number.isInteger(tile.attr) && Number.isInteger(tile.char);
}

export class TileFillerRegistry implements TileRegistryTarget {
  /**
   * Keyed by owner so a mod registering twice replaces its OWN filler and never
   * another mod's. Insertion order is load order, which is the order they run.
   */
  readonly #fillers = new Map<string | null, InstalledFiller>();

  constructor(private readonly report: TileFillProblem) {}

  register(filler: TileFiller, owner?: string): void {
    if (typeof filler !== "function") {
      throw new Error("tile registry: a filler must be a function");
    }
    this.#fillers.set(owner ?? null, { filler, owner: owner ?? null });
  }

  /** Bind registration attribution to one mod. */
  forOwner(owner: string): TileRegistryTarget {
    return { register: (filler): void => this.register(filler, owner) };
  }

  /** Whether anything would run, so a caller can skip building the door. */
  get size(): number {
    return this.#fillers.size;
  }

  /** Test/session teardown: no installed mod means no filler survives. */
  clear(): void {
    this.#fillers.clear();
  }

  /**
   * Run every registered filler over a freshly built map.
   *
   * `derive` is the engine's own capability - synthesise a tile drawing a
   * donor's asset with its hue rotated - or null on an engine that cannot,
   * which is every fixed atlas: its tiles are cells of a sheet and there is no
   * spare cell to put a variant in.
   */
  run(
    map: TileMap,
    pack: TileFillPack,
    derive: ((donor: TileAtlas, hue: number) => TileAtlas | null) | null,
  ): TileFillOutcome {
    let monsters = 0;
    let objects = 0;
    let refused = 0;

    for (const installed of this.#fillers.values()) {
      const fill: TileFill = {
        pack,
        monsterTile: (ridx) => map.monster[ridx] ?? null,
        objectTile: (kidx) => map.object[kidx] ?? null,
        fillMonster: (ridx, tile) => {
          if (!Number.isInteger(ridx) || ridx < 0) return false;
          if (!isAtlas(tile)) {
            this.report(installed.owner, `offered a race a tile that is not a tile`);
            return false;
          }
          if (map.monster[ridx]) {
            refused += 1;
            return false;
          }
          map.monster[ridx] = { attr: tile.attr, char: tile.char };
          monsters += 1;
          return true;
        },
        fillObject: (kidx, tile) => {
          if (!Number.isInteger(kidx) || kidx < 0) return false;
          if (!isAtlas(tile)) {
            this.report(installed.owner, `offered an item a tile that is not a tile`);
            return false;
          }
          if (map.object[kidx]) {
            refused += 1;
            return false;
          }
          map.object[kidx] = { attr: tile.attr, char: tile.char };
          objects += 1;
          return true;
        },
        derive: (donor, hue) => {
          if (derive === null || !isAtlas(donor) || !Number.isFinite(hue)) return null;
          const made = derive(donor, hue);
          return made !== null && isAtlas(made) ? made : null;
        },
      };
      try {
        installed.filler(fill);
      } catch (err) {
        this.report(
          installed.owner,
          `its tile filler threw, so anything it had not supplied yet is a letter: ${message(err)}`,
        );
      }
    }

    return { fillers: this.#fillers.size, monsters, objects, refused };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The live tile door. main.ts supplies the player-visible reporter at boot. */
let reportProblem: TileFillProblem = () => undefined;
export const tileRegistry = new TileFillerRegistry((owner, problem) =>
  reportProblem(owner, problem),
);

export function setTileFillProblemReporter(reporter: TileFillProblem): void {
  reportProblem = reporter;
}
