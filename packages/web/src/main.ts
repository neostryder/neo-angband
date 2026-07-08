/**
 * Neo Angband web front end.
 *
 * Boots a real generated level from pack zero and renders it through the
 * engine's own systems: level generation (gen), field of view (world
 * kernel updateView), and the command/event seams for input. The player
 * explores an actual Angband dungeon - terrain, monsters, and floor
 * items - lit by their torch, with explored ground remembered.
 *
 * Still a front end in progress: no turn loop, combat, or HUD yet. It
 * exercises the whole stack end to end on one static, serverless page.
 */

import {
  CommandQueue,
  GameEvents,
  bootLevel,
  cmdGetArg,
  cmdSetArg,
  colorCharToAttr,
  colorToCss,
  makeCommand,
  loc,
  updateView,
  squareIsSeen,
  DDX,
  DDY,
} from "@neo-angband/core";
import type { ViewConstants, ViewerState } from "@neo-angband/core";
import { loadCorePack } from "./pack";
import { GlyphTerm } from "./term";
import { resolveKey } from "./keymap";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const term = new GlyphTerm(canvas);
const events = new GameEvents();
const queue = new CommandQueue();

// Original keyset (numpad + arrows) by default; see keymap.ts.
const roguelikeKeys = false;

// Boot a level. Seed and depth are overridable via the URL query, so a
// run is shareable and reproducible (seed + content fully determine it).
const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed")) || 20260708;
const depth = Number(params.get("depth")) || 1;

const pack = loadCorePack();
const level = bootLevel(pack, { seed, depth });
const chunk = level.chunk;
const features = level.registries.features;
const constants = level.registries.constants;

let px = level.playerSpot?.x ?? 1;
let py = level.playerSpot?.y ?? 1;
let message = `Level ${depth}. Numpad or arrow keys to move. (seed ${seed})`;

const Z: ViewConstants = {
  maxSight: constants.maxSight,
  feelingNeed: constants.feelingNeed,
};

function viewerState(): ViewerState {
  return {
    grid: loc(px, py),
    curLight: 2,
    blind: false,
    hasUnlight: false,
    level: depth,
  };
}

// Index placed monsters and objects by grid for quick render lookup.
function gridIndex(x: number, y: number): number {
  return y * chunk.width + x;
}
const monsterAt = new Map<number, { ch: string; css: string }>();
for (const m of level.monsters) {
  monsterAt.set(gridIndex(m.grid.x, m.grid.y), {
    ch: m.mon.race.dChar,
    css: colorToCss(m.mon.race.dAttr),
  });
}
const objectAt = new Map<number, { ch: string; css: string }>();
for (const o of level.objects) {
  objectAt.set(gridIndex(o.grid.x, o.grid.y), {
    ch: o.obj.kind.dChar,
    css: colorToCss(colorCharToAttr(o.obj.kind.dAttr)),
  });
}

// Grids the player has ever seen, rendered dim when out of view (a
// front-end map memory; the engine's knowledge layer lands later).
const explored = new Set<number>();

/** Darken a #rrggbb color for remembered-but-unseen terrain. */
function dim(css: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  if (!m) return "#3a3a44";
  const scale = (h: string): number => Math.round(parseInt(h, 16) * 0.38);
  const [r, g, b] = [scale(m[1]!), scale(m[2]!), scale(m[3]!)];
  return `rgb(${r},${g},${b})`;
}

/** Glyph and color for a grid's terrain, resolving display mimics. */
function terrainGlyph(x: number, y: number): { ch: string; css: string } {
  const f = chunk.feature(loc(x, y));
  const disp = f.mimic !== null ? features.get(f.mimic) : f;
  return { ch: disp.dChar, css: colorToCss(colorCharToAttr(disp.dAttr)) };
}

function refreshView(): void {
  updateView(chunk, viewerState(), Z);
}

queue.register("walk", (cmd) => {
  const dirArg = cmdGetArg(cmd, "direction", "direction");
  if (!dirArg) return;
  const dir = dirArg.value;
  const nx = px + (DDX[dir] ?? 0);
  const ny = py + (DDY[dir] ?? 0);
  if (nx < 0 || ny < 0 || nx >= chunk.width || ny >= chunk.height) return;
  if (!chunk.isPassable(loc(nx, ny))) {
    events.emit("message", { msg: "There is a wall in the way.", type: 0 });
    return;
  }
  px = nx;
  py = ny;
  refreshView();
  events.signal("playermoved");
});

events.on("message", (_t, data) => {
  message = data.msg;
  render();
});
events.on("playermoved", () => render());

window.addEventListener("keydown", (ev) => {
  const binding = resolveKey(ev, roguelikeKeys);
  if (!binding) return;
  ev.preventDefault();
  const cmd = makeCommand("walk", "game");
  cmdSetArg(cmd, "direction", { type: "direction", value: binding.dir });
  queue.pushCopy(cmd);
  queue.execute("game");
});

function render(): void {
  const { cols, rows } = term.size();
  term.clear();
  const viewRows = rows - 2;
  const camX = px - Math.floor(cols / 2);
  const camY = py - Math.floor(viewRows / 2);

  for (let sy = 0; sy < viewRows; sy++) {
    for (let sx = 0; sx < cols; sx++) {
      const gx = camX + sx;
      const gy = camY + sy;
      if (gx < 0 || gy < 0 || gx >= chunk.width || gy >= chunk.height) continue;
      const idx = gridIndex(gx, gy);
      const screenY = sy + 1;

      const seen = squareIsSeen(chunk, loc(gx, gy));
      if (seen) explored.add(idx);
      else if (!explored.has(idx)) continue;

      const t = terrainGlyph(gx, gy);
      if (!seen) {
        // Remembered terrain, out of view: dim, no creatures or items.
        term.put(sx, screenY, { ch: t.ch, fg: dim(t.css) });
        continue;
      }

      // In view: terrain, then any item, then any monster on top.
      let drawn = { ch: t.ch, css: t.css };
      const obj = objectAt.get(idx);
      if (obj) drawn = obj;
      const mon = monsterAt.get(idx);
      if (mon) drawn = mon;
      term.put(sx, screenY, { ch: drawn.ch, fg: drawn.css });
    }
  }

  // The player, always centered and bright.
  term.put(Math.floor(cols / 2), Math.floor(viewRows / 2) + 1, {
    ch: "@",
    fg: "#e8e8f0",
  });

  term.print(1, 0, message.slice(0, cols - 2), "#c8c8d4");
  term.print(
    1,
    rows - 1,
    "Neo Angband (engine port in progress)",
    "#5a5a66",
  );
}

refreshView();
term.onResize = () => render();
render();
