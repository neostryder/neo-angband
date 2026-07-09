/**
 * Neo Angband web front end.
 *
 * Boots a real, playable game: startGame births a level-1 character on a
 * generated level, and each keypress drives the engine's own turn loop
 * (runGameLoop) so monsters take their turns, path toward the player, and
 * fight - the whole simulation stack end to end on one static page.
 *
 * Layout follows the original: a left status sidebar (faithful HUD), a
 * message line across the top, a bottom status line, and the map filling the
 * rest of the viewport at any size. Menus and a title/birth screen are the
 * next step (PORT_PLAN.md decision 21); this drives bootLevel-style defaults
 * (Human Warrior) for now.
 *
 * Still front-end-in-progress and ledgered as such: per-hit combat messages
 * (the message log is not wired yet) and stairs/level regeneration are
 * deferred. Item pickup is live: gold and auto-pickup items are collected on
 * stepping, and 'g' picks up from the pile underfoot.
 */

import {
  startGame,
  runGameLoop,
  LOOP_STATUS,
  colorCharToAttr,
  colorToCss,
  updateView,
  squareIsSeen,
  loc,
  STAT,
  TRF,
  installPickup,
} from "@neo-angband/core";
import type {
  GamePack,
  PlayerCommand,
  ViewConstants,
  ViewerState,
} from "@neo-angband/core";
import { loadGamePack } from "./pack";
import { GlyphTerm } from "./term";
import { resolveKey } from "./keymap";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const term = new GlyphTerm(canvas);

// Original keyset (numpad + arrows) by default; see keymap.ts.
const roguelikeKeys = false;

// Seed and depth are overridable via the URL query so a run is shareable and
// reproducible (unmodded runs are deterministic - PORT_PLAN.md decision 22).
const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed")) || 20260708;
const depth = Number(params.get("depth")) || 1;

const pack: GamePack = loadGamePack();
const game = startGame(pack, { seed, depth });
const { state, registry, booted } = game;
const chunk = state.chunk;
const features = booted.registries.features;
const constants = booted.registries.constants;

let message = `Welcome. Move with numpad/arrows; 'g' picks up. (seed ${seed}, depth ${depth})`;
let dead = false;

// Reinstall the pickup commands with message hooks so gold and item pickup
// report on the message line.
installPickup(state, registry, {
  constants,
  env: {
    onGold: (total, name, single): void => {
      message = `You have found ${total} gold pieces worth of ${single ? name : "treasures"}.`;
    },
    onPickup: (obj): void => {
      message = `You have ${obj.kind.name} (${obj.number}).`;
    },
  },
});

const Z: ViewConstants = {
  maxSight: constants.maxSight,
  feelingNeed: constants.feelingNeed,
};

function viewerState(): ViewerState {
  return {
    grid: state.actor.grid,
    curLight: 2,
    blind: false,
    hasUnlight: false,
    level: depth,
  };
}

// FOV refresh after the player moves (the loop calls this via updateFov).
state.updateFov = (): void => {
  updateView(chunk, viewerState(), Z);
};

// Feed player commands to the loop from a small buffer; runGameLoop pulls
// through state.nextCommand and returns INPUT when the buffer empties.
const commandBuffer: PlayerCommand[] = [];
state.nextCommand = (): PlayerCommand | null => commandBuffer.shift() ?? null;

function gridIndex(x: number, y: number): number {
  return y * chunk.width + x;
}

// Revealed traps draw under objects and monsters (upstream layer order).
function trapIndex(): Map<number, { ch: string; css: string }> {
  const map = new Map<number, { ch: string; css: string }>();
  for (const list of state.traps.values()) {
    for (const t of list) {
      if (!t.flags.has(TRF.VISIBLE) || !t.kind.glyph.trim()) continue;
      map.set(gridIndex(t.grid.x, t.grid.y), {
        ch: t.kind.glyph,
        css: colorToCss(colorCharToAttr(t.kind.color)),
      });
    }
  }
  return map;
}

// Live floor items from the engine's piles (pile head = newest, drawn on
// top exactly as upstream lists the first object).
function objectIndex(): Map<number, { ch: string; css: string }> {
  const map = new Map<number, { ch: string; css: string }>();
  for (const pile of state.floor.values()) {
    const o = pile[0];
    if (!o || !o.grid) continue;
    map.set(gridIndex(o.grid.x, o.grid.y), {
      ch: o.kind.dChar,
      css: colorToCss(colorCharToAttr(o.kind.dAttr)),
    });
  }
  return map;
}

// Grids the player has ever seen, drawn dim when out of view (a front-end
// map memory; the engine knowledge layer lands later).
const explored = new Set<number>();

/** Darken a #rrggbb color for remembered-but-unseen terrain. */
function dim(css: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  if (!m) return "#3a3a44";
  const scale = (h: string): number => Math.round(parseInt(h, 16) * 0.38);
  return `rgb(${scale(m[1]!)},${scale(m[2]!)},${scale(m[3]!)})`;
}

/** Glyph and color for a grid's terrain, resolving display mimics. */
function terrainGlyph(x: number, y: number): { ch: string; css: string } {
  const f = chunk.feature(loc(x, y));
  const disp = f.mimic !== null ? features.get(f.mimic) : f;
  return { ch: disp.dChar, css: colorToCss(colorCharToAttr(disp.dAttr)) };
}

/** Live monster glyphs, rebuilt each frame since monsters move. */
function monsterIndex(): Map<number, { ch: string; css: string }> {
  const map = new Map<number, { ch: string; css: string }>();
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    map.set(gridIndex(mon.grid.x, mon.grid.y), {
      ch: mon.race.dChar,
      css: colorToCss(mon.race.dAttr),
    });
  }
  return map;
}

const SIDEBAR_W = 13; // classic Angband status column width.

const STAT_ROWS: ReadonlyArray<readonly [string, number]> = [
  ["STR", STAT.STR],
  ["INT", STAT.INT],
  ["WIS", STAT.WIS],
  ["DEX", STAT.DEX],
  ["CON", STAT.CON],
];

/** Render the faithful left status sidebar from the live player state. */
function renderSidebar(rows: number): void {
  const p = state.actor.player;
  const c = state.actor.combat;
  const speed = state.actor.speed - 110;
  const speedStr = speed === 0 ? "Normal" : speed > 0 ? `+${speed}` : `${speed}`;
  const lines: Array<[string, string]> = [
    [p.cls.name, "#c8c8d4"],
    [p.race.name, "#9aa0b4"],
    ["", "#000000"],
    [`LEVEL ${p.lev}`, "#c8c8d4"],
    [`EXP ${p.exp}`, "#9aa0b4"],
    [`AU ${p.au}`, "#d0c060"],
    ["", "#000000"],
    ...STAT_ROWS.map(
      ([label, idx]): [string, string] => [
        `${label} ${p.statCur[idx] ?? 0}`,
        "#a8b0a0",
      ],
    ),
    ["", "#000000"],
    [`AC ${c.ac + c.toA}`, "#a8b0c8"],
    [`HP ${p.chp}/${p.mhp}`, p.chp * 2 < p.mhp ? "#e05050" : "#60c060"],
    [`SP ${p.csp}/${p.msp}`, "#6080d0"],
    ["", "#000000"],
    [`Speed ${speedStr}`, "#9aa0b4"],
  ];
  for (let y = 0; y < lines.length && y < rows; y++) {
    const [text, fg] = lines[y]!;
    if (text) term.print(0, y, text.slice(0, SIDEBAR_W - 1), fg);
  }
}

function render(): void {
  const { cols, rows } = term.size();
  term.clear();

  const mapOriginX = SIDEBAR_W;
  const mapCols = cols - mapOriginX;
  const mapRows = rows - 2; // row 0 message, last row status.
  const px = state.actor.grid.x;
  const py = state.actor.grid.y;
  const camX = px - Math.floor(mapCols / 2);
  const camY = py - Math.floor(mapRows / 2);
  const monsterAt = monsterIndex();
  const objectAt = objectIndex();
  const trapAt = trapIndex();

  for (let sy = 0; sy < mapRows; sy++) {
    for (let sx = 0; sx < mapCols; sx++) {
      const gx = camX + sx;
      const gy = camY + sy;
      if (gx < 0 || gy < 0 || gx >= chunk.width || gy >= chunk.height) continue;
      const idx = gridIndex(gx, gy);
      const screenX = mapOriginX + sx;
      const screenY = 1 + sy;

      const seen = squareIsSeen(chunk, loc(gx, gy));
      if (seen) explored.add(idx);
      else if (!explored.has(idx)) continue;

      const t = terrainGlyph(gx, gy);
      if (!seen) {
        term.put(screenX, screenY, { ch: t.ch, fg: dim(t.css) });
        continue;
      }

      let drawn = { ch: t.ch, css: t.css };
      const trap = trapAt.get(idx);
      if (trap) drawn = trap;
      const obj = objectAt.get(idx);
      if (obj) drawn = obj;
      const mon = monsterAt.get(idx);
      if (mon) drawn = mon;
      term.put(screenX, screenY, { ch: drawn.ch, fg: drawn.css });
    }
  }

  // The player, centered and bright.
  term.put(mapOriginX + Math.floor(mapCols / 2), 1 + Math.floor(mapRows / 2), {
    ch: "@",
    fg: "#e8e8f0",
  });

  renderSidebar(rows);
  term.print(mapOriginX, 0, message.slice(0, mapCols - 1), "#c8c8d4");
  const status = `DL${depth} (${depth * 50} ft)   Turn ${state.turn}`;
  term.print(mapOriginX, rows - 1, status.slice(0, mapCols - 1), "#5a5a66");
}

/** Advance the engine after queuing input, then repaint. */
function advance(): void {
  const status = runGameLoop(state, registry);
  if (status === LOOP_STATUS.DEAD) {
    dead = true;
    message = "You have died. (Refresh to start a new game.)";
  } else if (status === LOOP_STATUS.LEVEL_CHANGE) {
    // Stairs / regeneration are deferred; acknowledge and stay put.
    state.generateLevel = false;
    message = "The stairs lead down... (level change not yet wired).";
  }
  render();
}

window.addEventListener("keydown", (ev) => {
  if (dead) return;
  if (ev.key === "g" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    ev.preventDefault();
    commandBuffer.push({ code: "pickup" });
    advance();
    return;
  }
  const binding = resolveKey(ev, roguelikeKeys);
  if (!binding) return;
  ev.preventDefault();
  commandBuffer.push({ code: "walk", dir: binding.dir });
  advance();
});

state.updateFov(state);
term.onResize = () => render();
render();
