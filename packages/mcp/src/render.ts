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
 * GLYPH CHOICE. Upstream's own map characters where the agent view carries enough
 * to know (`#` wall, `.` floor, `<` `>` stairs, `+` door, `@` player), and NOT
 * upstream's where it does not: `CellView` reports a feature INDEX, not a
 * `d_char`, so anything outside the small set below draws as `?` rather than as a
 * guess. Monsters are numbered with a legend instead of taking upstream's
 * per-race letter, because the letter is ambiguous by design (six `d`s on a level
 * are six different dragons) and an agent needs to name the one it is fighting.
 *
 * KNOWN vs SEEN is preserved, because it is most of what tactical play is about:
 * a remembered square renders dimmer (its own glyph in the map, but flagged in the
 * legend counts), and a square the player has never known renders as a space.
 */

import { FEAT } from "@rpgm-tools/neo-angband-core";
import type { AgentView, CellView, ItemView, MonsterView, PlayerView } from "@rpgm-tools/neo-angband-core";

/** Feature indices this renderer can name. Anything else draws as `?`. */
const FEAT_GLYPHS = new Map<number, string>([
  [FEAT.NONE, " "],
  [FEAT.FLOOR, "."],
  [FEAT.CLOSED, "+"],
  [FEAT.OPEN, "'"],
  [FEAT.BROKEN, "'"],
  [FEAT.LESS, "<"],
  [FEAT.MORE, ">"],
  [FEAT.SECRET, "#"],
  [FEAT.RUBBLE, ":"],
  [FEAT.PASS_RUBBLE, ":"],
  [FEAT.MAGMA, "%"],
  [FEAT.QUARTZ, "%"],
  [FEAT.MAGMA_K, "*"],
  [FEAT.QUARTZ_K, "*"],
  [FEAT.GRANITE, "#"],
  [FEAT.PERM, "#"],
  [FEAT.LAVA, "~"],
  [FEAT.STORE_GENERAL, "1"],
  [FEAT.STORE_ARMOR, "2"],
  [FEAT.STORE_WEAPON, "3"],
  [FEAT.STORE_BOOK, "4"],
  [FEAT.STORE_ALCHEMY, "5"],
  [FEAT.STORE_MAGIC, "6"],
  [FEAT.STORE_BLACK, "7"],
  [FEAT.HOME, "8"],
]);

/** Monster labels, in the order a legend lists them. */
const MONSTER_LABELS = "0123456789abcdefghijklmnopqrstuvwxyz";

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
  /** `label -> what it is`, for every monster and item the map shows. */
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

  /* Labels are assigned in map order (top-left to bottom-right) so the legend
   * reads in the same order as the picture, and so the same board always
   * produces the same labels - a client comparing two renders is comparing
   * like with like. */
  const labelled: Array<{ label: string; text: string }> = [];
  let nextLabel = 0;
  const takeLabel = (): string | null => {
    const label = MONSTER_LABELS[nextLabel];
    if (label === undefined) return null;
    nextLabel++;
    return label;
  };

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
      if (x === player.grid.x && y === player.grid.y) {
        row += "@";
        continue;
      }
      const monster = cell.monster !== 0 ? monsters.get(cell.monster) : undefined;
      if (monster !== undefined && monster.visible) {
        const label = takeLabel();
        if (label !== null) {
          labelled.push({ label, text: describeMonster(monster, player) });
          row += label;
          continue;
        }
        /* Out of labels: still show that SOMETHING is there rather than drawing
         * the floor it stands on. A silent omission is the one rendering error an
         * agent cannot recover from. */
        row += "&";
        continue;
      }
      if (cell.trap) {
        row += "^";
        continue;
      }
      if (cell.objectCount > 0) {
        const items = view.floorItems(x, y);
        const label = takeLabel();
        if (label !== null) {
          labelled.push({ label, text: describeFloor(items, cell.objectCount, x, y) });
          row += label;
          continue;
        }
        row += "$";
        continue;
      }
      row += FEAT_GLYPHS.get(cell.feat) ?? (cell.passable ? "." : "?");
    }
    rows.push(row);
  }

  return { rows, legend: labelled.map((l) => `${l.label} = ${l.text}`), window: { x0, y0, x1, y1 }, unknownCells };
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

function describeFloor(items: ItemView[], count: number, x: number, y: number): string {
  const head = items[0];
  const label = head === undefined ? "an object" : head.label;
  const more = count > 1 ? ` (+${String(count - 1)} more)` : "";
  return `${label}${more} on the floor at ${String(x)},${String(y)}`;
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
