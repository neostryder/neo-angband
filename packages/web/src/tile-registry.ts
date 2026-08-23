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
 * THE PLAYER'S OWN CELL IS A SECOND DOOR, not a fill, and the difference is not
 * a technicality. The player is race 0 in the monster tile table, every shipped
 * tile set assigns it, so `fillMonster(0, ...)` is refused and should be: that
 * picture is the pack author's. What a mod can have instead is a provider asked
 * once per frame - given who the character is right now, is there a better
 * tile? - whose null answer is the pack's own picture. Guarantee 1 above does
 * not apply to it and cannot: the whole point is to replace an assigned tile,
 * for one cell, for as long as some condition holds. What replaces guarantee 1
 * there is that the answer is per FRAME and owns nothing - the tile map is never
 * written, so switching the condition off restores the pack's tile with no
 * rebuild, and a provider that throws costs one frame's answer.
 *
 * AND SO THERE IS NO CONFLICT ROW FOR THIS, which is deliberate and is the kind
 * of omission an audit should be able to find an answer to. `mod-conflicts.ts`
 * reports CONTESTED slots - two mods wanting the same menu, the same HUD region,
 * the same grafID - and guarantee 2 above means two fillers are never contesting
 * anything. A row saying "these two mods both supply tiles" would report a
 * contest that cannot happen. The grafID claims a tiles mod makes are still
 * reported, because those are genuinely last-wins.
 *
 * THE PLAYER DOOR IS THE FIRST TILE SEAM WHERE A CONTEST IS REAL, and it has no
 * conflict row yet. Two providers that both answer for the same character both
 * had an opinion, and load order silently picks one. It is reported nowhere,
 * which is a gap rather than a decision, and it is tracked in docs/PLANNED.md.
 * What keeps it small is that a provider is expected to answer null for
 * everything it has no opinion about, so an overlap needs both mods to care
 * about the same character in the same moment.
 */

import type {
  PlayerTileProvider,
  PlayerTileView,
  TileAtlas,
  TileFill,
  TileFillPack,
  TileFiller,
  TileMap,
  TileRegistryTarget,
  TileTransform,
} from "@rpgm-tools/neo-angband-core";

/**
 * The most colours a transform's ramp may name.
 *
 * HERE AND NOT IN CORE, because the reason for the number is this module's. The
 * engine caches one image per distinct spec, so a spec's cost is what a ramp has
 * to be bounded by - and past sixteen bands the difference between two
 * neighbouring entries is below what the eye separates at tile size, so a longer
 * ramp buys nothing to pay for. It is a cap, not a target: a five-entry ramp is
 * an ordinary one.
 */
export const TILE_RAMP_MAX = 16;

/** Report a filler's misbehaviour to the player, attributed to its mod. */
export type TileFillProblem = (owner: string | null, message: string) => void;

interface InstalledFiller {
  readonly owner: string | null;
  readonly filler: TileFiller;
}

interface InstalledProvider {
  readonly owner: string | null;
  readonly provider: PlayerTileProvider;
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

/**
 * A transform spec, validated before an engine is asked to allocate for it.
 *
 * Checked HERE rather than in the engine because the engine caches one canvas
 * per spec: a ramp with a NaN in it would key a cache entry that can never be
 * hit again, and a ramp of four thousand colours would key a large one. The
 * cap and the byte range are the two things that make a spec's cost bounded.
 */
function isTransform(value: unknown): value is TileTransform {
  if (value === null || typeof value !== "object") return false;
  const spec = value as Partial<TileTransform>;
  if (typeof spec.mirror !== "boolean") return false;
  if (!Array.isArray(spec.ramp) || spec.ramp.length > TILE_RAMP_MAX) return false;
  for (const colour of spec.ramp) {
    if (!Array.isArray(colour) || colour.length !== 3) return false;
    for (const channel of colour) {
      if (!Number.isInteger(channel) || channel < 0 || channel > 255) return false;
    }
  }
  return true;
}

export class TileFillerRegistry implements TileRegistryTarget {
  /**
   * Keyed by owner so a mod registering twice replaces its OWN filler and never
   * another mod's. Insertion order is load order, which is the order they run.
   */
  readonly #fillers = new Map<string | null, InstalledFiller>();

  /**
   * Player-tile providers, keyed by owner for the same reason the fillers are.
   * Separate map because the two are asked at different times: a filler runs
   * once per built map, a provider once per frame the player is drawn.
   */
  readonly #players = new Map<string | null, InstalledProvider>();

  constructor(private readonly report: TileFillProblem) {}

  register(filler: TileFiller, owner?: string): void {
    if (typeof filler !== "function") {
      throw new Error("tile registry: a filler must be a function");
    }
    this.#fillers.set(owner ?? null, { filler, owner: owner ?? null });
  }

  player(provider: PlayerTileProvider, owner?: string): void {
    if (typeof provider !== "function") {
      throw new Error("tile registry: a player-tile provider must be a function");
    }
    this.#players.set(owner ?? null, { provider, owner: owner ?? null });
  }

  /** Bind registration attribution to one mod. */
  forOwner(owner: string): TileRegistryTarget {
    return {
      register: (filler): void => this.register(filler, owner),
      player: (provider): void => this.player(provider, owner),
    };
  }

  /** Whether anything would run, so a caller can skip building the door. */
  get size(): number {
    return this.#fillers.size;
  }

  /** Whether any mod has an opinion about the player's own tile. */
  get playerProviders(): number {
    return this.#players.size;
  }

  /** Test/session teardown: no installed mod means no filler survives. */
  clear(): void {
    this.#fillers.clear();
    this.#players.clear();
  }

  /**
   * The tile a mod wants the player's own cell to draw, or null for the pack's.
   *
   * FIRST NON-NULL IN LOAD ORDER, which is the only composition rule that lets
   * two such mods coexist: a provider with no opinion returns null and the next
   * one is asked, so "my mod draws the player differently while polymorphed" and
   * "my mod draws the player differently in the town" are not in conflict unless
   * both conditions hold at once, and then load order decides, visibly.
   *
   * A provider that throws is skipped for this frame and reported once per
   * throw. It runs inside the render loop, so it cannot be allowed to take the
   * frame down: the cost of a bad provider is the pack's own player tile, which
   * is what the game drew before any of this existed.
   */
  playerTile(view: PlayerTileView): TileAtlas | null {
    for (const installed of this.#players.values()) {
      let answer: TileAtlas | null;
      try {
        answer = installed.provider(view);
      } catch (err) {
        this.report(
          installed.owner,
          `its player-tile provider threw, so the tile set's own player picture is drawn: ${message(err)}`,
        );
        continue;
      }
      if (answer === null) continue;
      if (!isAtlas(answer)) {
        this.report(installed.owner, `offered the player a tile that is not a tile`);
        continue;
      }
      return { attr: answer.attr, char: answer.char };
    }
    return null;
  }

  /**
   * Run every registered filler over a freshly built map.
   *
   * `derive` is the engine's own capability - synthesise a tile drawing a
   * donor's asset with its hue rotated - or null on an engine that cannot,
   * which is every fixed atlas: its tiles are cells of a sheet and there is no
   * spare cell to put a variant in.
   *
   * `transform` is the same capability for the other kind of variant, mirrored
   * and/or palette-swapped, and is null on the same engines for the same reason.
   * It defaults to null so a caller that has neither passes neither.
   */
  run(
    map: TileMap,
    pack: TileFillPack,
    derive: ((donor: TileAtlas, hue: number) => TileAtlas | null) | null,
    transform:
      | ((donor: TileAtlas, spec: TileTransform) => TileAtlas | null)
      | null = null,
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
        transform: (donor, spec) => {
          if (transform === null || !isAtlas(donor) || !isTransform(spec)) return null;
          const made = transform(donor, spec);
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
