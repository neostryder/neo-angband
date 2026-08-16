/**
 * Turning the agent view into something a language model can actually read.
 *
 * This is the "intuitive" half of the server, and it is not decoration. A tool
 * that returned raw `CellView` objects for a 198x66 level would hand a client
 * 13068 JSON objects to reason about; a tool that returns a small ASCII map with
 * a legend hands it a picture. Both are offered - `observe` gives the numbers,
 * `render` gives the picture - because the two failure modes are different: JSON
 * is unreadable at scale, and a rendering is a lossy interpretation. Nothing here
 * decides anything for the client.
 *
 * GLYPH CHOICE, and this file used to make it up. It carried a hand-written
 * `FEAT_GLYPHS` map - 25 feature indices, each with the character it "should"
 * draw as. Measured against the gamedata it was built from (terrain.txt, 25
 * features), here is what that was actually worth:
 *
 *   - 24 of 25 agreed. It was not obviously broken, which is why it survived.
 *   - LAVA DID NOT. The map said `~`; the gamedata says `#`. An agent was told
 *     the one terrain in the game that hurts to stand on looked different from
 *     every wall around it, when on the player's screen it does not.
 *   - It read past the x_char table, so a pref file or the knowledge browser's
 *     glyph picker changed what the PLAYER saw and not what the agent saw.
 *   - It could not resolve mimics. Today that costs nothing (a secret door and
 *     the granite it mimics both draw `#`), so this one is correctness by
 *     construction rather than a bug that was fixed - but it is the difference
 *     between a renderer that cannot leak a hidden door and one that happens
 *     not to.
 *   - And every one of those is a second source of truth for something the
 *     gamedata already states, with no test in a position to notice a drift.
 *
 * The characters now come from `CellView.glyph` / `trapGlyph` / `objectGlyph`
 * and `MonsterView.glyph` (agent API 1.1.0), which are the host's live
 * attr/char table read through the frozen facade - the same table the shell
 * draws from. There is no glyph literal left in this file.
 *
 * TRAPS were worse than the glyphs. The old loop drew `^` wherever `cell.trap`
 * was set, and `cell.trap` is "a trap pile is here", not "the player can see
 * it". Measured over 15 freshly generated levels: 74 trapped squares, 0 of them
 * detected, 74 of them drawn. An agent was handed every trap on the level the
 * moment it arrived. `trapGlyph` is present only for a trap the player can
 * actually see (TRF_VISIBLE), so the undetected ones are no longer reported.
 *
 * MONSTERS are drawn with their real race character, as the player sees them,
 * and the legend is keyed by `char at x,y` rather than by an invented label.
 * The old scheme assigned `0-9a-z` labels in map order, which read well until
 * you notice upstream draws the eight store entrances as `1`-`8`: on any town
 * map a store and a monster were the same character with different meanings.
 * The race letter is ambiguous by design (six `d`s are six different dragons)
 * and coordinates are what resolve it - which an agent needs anyway to move to
 * or target the thing.
 *
 * KNOWN vs SEEN is preserved, because it is most of what tactical play is about:
 * a remembered square renders as its own glyph and is counted in the legend, and
 * a square the player has never known renders as a space.
 */

import type { AgentView, CellView, ItemView, MonsterView, PlayerView } from "@rpgm-tools/neo-angband-core";

/**
 * What a square draws as when the view reports no glyph for it.
 *
 * Reached only when the host supplied no `glyphs` dep - this package always
 * does (session.ts), so in the server it is unreachable. It stays because a
 * renderer that quietly drew a floor for "I was not told" would be inventing
 * again, one layer down: a blank is the one mark that cannot be mistaken for
 * terrain.
 */
const NO_GLYPH = " ";

export interface RenderOptions {
  /**
   * Half-width / half-height of the window around the player. Default 20x10,
   * which is 41x21 characters - a screenful, and small enough that a client can
   * hold several in context.
   */
  radiusX?: number;
  radiusY?: number;
  /** Render the whole level instead of a window. */
  full?: boolean;
}

export interface RenderedMap {
  /** The map itself, one string per row, no trailing spaces stripped. */
  rows: string[];
  /**
   * `char at x,y = what it is`, for every monster and floor pile the map shows.
   * Keyed by coordinates because the character does not identify anything on its
   * own - that is upstream's design, not a shortcoming of this rendering.
   */
  legend: string[];
  /** The window, in level coordinates. */
  window: { x0: number; y0: number; x1: number; y1: number };
  /** Squares the player has never known, inside the window. */
  unknownCells: number;
}

/** Chebyshev distance, which is what "adjacent" means on an Angband grid. */
export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** The eight direction digits, as upstream's keypad numbers them. */
export const DIRECTION_KEYPAD: Readonly<Record<string, number>> = {
  southwest: 1,
  south: 2,
  southeast: 3,
  west: 4,
  stay: 5,
  east: 6,
  northwest: 7,
  north: 8,
  northeast: 9,
};

/** Keypad digit for a step from `from` to an adjacent `to`, or null. */
export function directionTo(
  from: { x: number; y: number },
  to: { x: number; y: number },
): number | null {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === 0) return 5;
  /* Keypad layout: 7 8 9 / 4 5 6 / 1 2 3, with y increasing DOWNWARD (south). */
  const row = dy < 0 ? 0 : dy > 0 ? 2 : 1;
  const col = dx < 0 ? 0 : dx > 0 ? 2 : 1;
  return [
    [7, 8, 9],
    [4, 5, 6],
    [1, 2, 3],
  ][row]?.[col] ?? null;
}

export function renderMap(view: AgentView, opts: RenderOptions = {}): RenderedMap {
  const bounds = view.mapBounds();
  const player = view.player();
  const rx = opts.radiusX ?? 20;
  const ry = opts.radiusY ?? 10;
  const x0 = opts.full === true ? 0 : Math.max(0, player.grid.x - rx);
  const y0 = opts.full === true ? 0 : Math.max(0, player.grid.y - ry);
  const x1 = opts.full === true ? bounds.width - 1 : Math.min(bounds.width - 1, player.grid.x + rx);
  const y1 = opts.full === true ? bounds.height - 1 : Math.min(bounds.height - 1, player.grid.y + ry);

  const monsters = new Map<number, MonsterView>();
  for (const m of view.monsters()) monsters.set(m.id, m);

  /* The legend is built in map order (top-left to bottom-right) so it reads in
   * the same order as the picture, and so the same board always produces the
   * same legend - a client comparing two renders is comparing like with like. */
  const legend: string[] = [];

  const rows: string[] = [];
  let unknownCells = 0;

  for (let y = y0; y <= y1; y++) {
    let row = "";
    for (let x = x0; x <= x1; x++) {
      const cell = view.cell(x, y);
      if (cell === null || !cell.known) {
        if (cell !== null) unknownCells++;
        row += " ";
        continue;
      }
      /* Upstream's layer order (grid_data_as_text, ui-map.c:180-331): terrain,
       * then a visible trap, then the top object, then a monster, then the
       * player - each drawing over the one before. */
      if (x === player.grid.x && y === player.grid.y) {
        row += "@";
        continue;
      }
      const monster = cell.monster !== 0 ? monsters.get(cell.monster) : undefined;
      if (monster !== undefined && monster.visible) {
        const char = monster.glyph ?? NO_GLYPH;
        legend.push(`${char} at ${String(x)},${String(y)} = ${describeMonster(monster, player)}`);
        row += char;
        continue;
      }
      if (cell.objectCount > 0) {
        const char = cell.objectGlyph ?? NO_GLYPH;
        const items = view.floorItems(x, y);
        legend.push(
          `${char} at ${String(x)},${String(y)} = ${describeFloor(items, cell.objectCount)}`,
        );
        row += char;
        continue;
      }
      if (cell.trapGlyph !== undefined) {
        row += cell.trapGlyph;
        continue;
      }
      row += cell.glyph ?? NO_GLYPH;
    }
    rows.push(row);
  }

  return { rows, legend, window: { x0, y0, x1, y1 }, unknownCells };
}

function describeMonster(m: MonsterView, player: PlayerView): string {
  const states = [
    m.asleep ? "asleep" : null,
    m.afraid ? "afraid" : null,
    m.confused ? "confused" : null,
    m.stunned ? "stunned" : null,
  ].filter((s): s is string => s !== null);
  const dir = directionTo(player.grid, m.grid);
  const near = distance(player.grid, m.grid);
  return (
    `${m.race} (id ${String(m.id)}) ${String(m.hp)}/${String(m.maxHp)} hp, ` +
    `${String(near)} away${near === 1 && dir !== null ? ` (dir ${String(dir)}, adjacent)` : ""}` +
    (states.length > 0 ? `, ${states.join(" ")}` : "")
  );
}

function describeFloor(items: ItemView[], count: number): string {
  const head = items[0];
  const label = head === undefined ? "an object" : head.label;
  const more = count > 1 ? ` (+${String(count - 1)} more)` : "";
  return `${label}${more} on the floor`;
}

/** The one-screen status line set: what a player reads without opening anything. */
export function renderStatus(view: AgentView): string[] {
  const p = view.player();
  const out = [
    `${p.race} ${p.cls}, level ${String(p.level)} (exp ${String(p.exp)}, gold ${String(p.gold)})`,
    `HP ${String(p.hp)}/${String(p.maxHp)}   SP ${String(p.sp)}/${String(p.maxSp)}   AC ${String(p.ac)}   speed ${String(p.speed)}`,
    `depth ${depthLabel(p.depth)} (deepest ${depthLabel(p.maxDepth)})   turn ${String(view.turn())}   at ${String(p.grid.x)},${String(p.grid.y)}`,
  ];
  const afflictions = Object.entries(p.status)
    .filter(([name, value]) => name !== "food" && typeof value === "number" && value > 0)
    .map(([name, value]) => `${name} ${String(value)}`);
  out.push(
    `food ${String(p.status.food)}` +
      (afflictions.length > 0 ? `   AFFLICTED: ${afflictions.join(", ")}` : ""),
  );
  if (p.dead) out.push("*** DEAD ***");
  return out;
}

/** "the town" or "1250 ft (level 25)", as upstream's status bar words it. */
export function depthLabel(depth: number): string {
  return depth === 0 ? "the town" : `${String(depth * 50)} ft (level ${String(depth)})`;
}

/** A compact item line: the label plus whatever a client needs to act on it. */
export function renderItem(item: ItemView, index: number): string {
  const handle = item.handle !== 0 ? ` [handle ${String(item.handle)}]` : "";
  return `${String(index)}. ${item.label}${handle}`;
}

/** A whole cell, for a client that asked about one square rather than the map. */
export function renderCell(cell: CellView): string {
  const bits = [
    cell.passable ? "passable" : "blocked",
    cell.inView ? "in view" : cell.known ? "remembered" : "unknown",
    cell.glow ? "lit" : null,
    cell.trap ? "TRAP" : null,
    cell.monster !== 0 ? `monster ${String(cell.monster)}` : null,
    cell.objectCount > 0 ? `${String(cell.objectCount)} object(s)` : null,
  ].filter((b): b is string => b !== null);
  const code = cell.featCode === undefined ? `feat ${String(cell.feat)}` : cell.featCode;
  return `${String(cell.x)},${String(cell.y)}: ${code} - ${bits.join(", ")}`;
}
