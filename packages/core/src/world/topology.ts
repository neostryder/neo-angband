/**
 * The named level graph from world.txt.
 *
 * Upstream parses this file into its global `world` list.  Its level names are
 * the stable identity for saved chunks, while the `up` / `down` names describe
 * which level a staircase reaches.  Keep that content topology separate from
 * GameState.world: the latter is a per-game hook bag, not gamedata.
 */

/** One compiled `world.json` record. */
export interface WorldRecordJson {
  level: {
    depth: number;
    name: string;
    up: string;
    down: string;
  };
}

/** One bound node in the game's level topology. */
export interface WorldLevel {
  readonly depth: number;
  readonly name: string;
  readonly up: string | null;
  readonly down: string | null;
}

/**
 * A read-only lookup table over world.txt's named level graph.
 *
 * `nextDepth()` deliberately answers the current depth when there is no link:
 * callers can use one operation for a normal step and for a boundary check.
 */
export class WorldTopology {
  readonly levels: readonly WorldLevel[];
  private readonly byDepth: ReadonlyMap<number, WorldLevel>;
  private readonly byName: ReadonlyMap<string, WorldLevel>;

  constructor(levels: readonly WorldLevel[]) {
    this.levels = levels;
    this.byDepth = new Map(levels.map((level) => [level.depth, level]));
    this.byName = new Map(levels.map((level) => [level.name, level]));
  }

  levelAtDepth(depth: number): WorldLevel | undefined {
    return this.byDepth.get(depth);
  }

  levelNamed(name: string): WorldLevel | undefined {
    return this.byName.get(name);
  }

  nameAtDepth(depth: number): string {
    return this.byDepth.get(depth)?.name ?? "";
  }

  nextDepth(depth: number, direction: 1 | -1): number {
    const level = this.byDepth.get(depth);
    const targetName = direction > 0 ? level?.down : level?.up;
    if (!targetName) return depth;
    return this.byName.get(targetName)?.depth ?? depth;
  }

  canTravel(depth: number, direction: 1 | -1): boolean {
    return this.nextDepth(depth, direction) !== depth;
  }
}

/** Bind world.json and validate the name references its links make. */
export function bindWorld(
  records: readonly WorldRecordJson[] | undefined,
  maxDepth: number,
): WorldTopology {
  if (!records) return linearWorld(maxDepth);

  const levels: WorldLevel[] = [];
  const byName = new Set<string>();
  const byDepth = new Set<number>();
  for (let index = 0; index < records.length; index++) {
    const raw = records[index]?.level;
    if (!raw || !Number.isInteger(raw.depth) || raw.depth < 0 || raw.depth >= maxDepth) {
      throw new Error(`world: record ${index}: invalid level depth`);
    }
    if (!raw.name || typeof raw.name !== "string") {
      throw new Error(`world: record ${index}: invalid level name`);
    }
    if (byName.has(raw.name)) throw new Error(`world: duplicate level name ${raw.name}`);
    if (byDepth.has(raw.depth)) throw new Error(`world: duplicate level depth ${raw.depth}`);
    const up = link(raw.up, index, "up");
    const down = link(raw.down, index, "down");
    byName.add(raw.name);
    byDepth.add(raw.depth);
    levels.push({ depth: raw.depth, name: raw.name, up, down });
  }

  for (const level of levels) {
    for (const [direction, target] of [["up", level.up], ["down", level.down]] as const) {
      if (target && !byName.has(target)) {
        throw new Error(`world: invalid ${direction} reference ${target} from ${level.name}`);
      }
    }
  }
  return new WorldTopology(levels);
}

function link(value: string, index: number, direction: "up" | "down"): string | null {
  if (value === "None") return null;
  if (!value || typeof value !== "string") {
    throw new Error(`world: record ${index}: invalid ${direction} reference`);
  }
  return value;
}

/** Compatibility topology for older partial CorePack callers. */
function linearWorld(maxDepth: number): WorldTopology {
  const levels: WorldLevel[] = [];
  for (let depth = 0; depth < maxDepth; depth++) {
    levels.push({
      depth,
      name: depth === 0 ? "Town" : `Angband ${depth}`,
      up: depth === 0 ? null : depth === 1 ? "Town" : `Angband ${depth - 1}`,
      down: depth === maxDepth - 1 ? null : `Angband ${depth + 1}`,
    });
  }
  return new WorldTopology(levels);
}
