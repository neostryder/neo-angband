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
 * Live systems: pickup ('g'), stairs with real level regeneration ('>' and
 * '<'), and JSON save/continue ('S' saves to localStorage; ?continue=1
 * resumes, with the integrity stamp checked). Death deletes the save
 * (decision 16). Per-hit combat messages await the message-log wiring.
 */

import {
  startGame,
  saveGame,
  loadGame,
  encodeSavedGame,
  decodeSavedGame,
  runGameLoop,
  LOOP_STATUS,
  colorCharToAttr,
  colorToCss,
  updateView,
  squareIsSeen,
  noteSpots,
  knownFeat,
  knownObject,
  loc,
  MFLAG,
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

// Saves live in localStorage as stamped bytes (decision 16b tamper
// deterrent), base64-wrapped. ?continue=1 resumes; death deletes the save
// (decision 16: death is terminal).
const SAVE_KEY = "neo-angband-save";
function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let loadedNote = "";
function bootGame(): ReturnType<typeof startGame> {
  if (params.get("continue")) {
    const stored = localStorage.getItem(SAVE_KEY);
    if (stored) {
      try {
        const decoded = decodeSavedGame(b64ToBytes(stored));
        if (decoded.save) {
          loadedNote = decoded.verified
            ? "Welcome back."
            : "Welcome back. (WARNING: save integrity check failed.)";
          return loadGame(pack, decoded.save);
        }
      } catch {
        loadedNote = "Could not read the save; starting a new game.";
      }
    }
  }
  return startGame(pack, { seed, depth });
}

const game = bootGame();
const { state, registry, booted } = game;
const features = booted.registries.features;
const constants = booted.registries.constants;

let message =
  loadedNote ||
  `Welcome. Move with numpad/arrows; 'g' picks up, '>' descends, 'S' saves. (seed ${seed}, depth ${depth})`;
let dead = false;

function persistSave(): void {
  localStorage.setItem(SAVE_KEY, bytesToB64(encodeSavedGame(saveGame(game))));
}

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
    level: state.chunk.depth,
  };
}

// FOV refresh after the player moves (the loop calls this via updateFov).
// noteSpots is the engine's note_spot pass: it memorizes seen terrain and
// floor piles into state.known and refreshes monster visibility flags.
state.updateFov = (): void => {
  updateView(state.chunk, viewerState(), Z);
  noteSpots(state);
};

// Feed player commands to the loop from a small buffer; runGameLoop pulls
// through state.nextCommand and returns INPUT when the buffer empties.
const commandBuffer: PlayerCommand[] = [];
state.nextCommand = (): PlayerCommand | null => commandBuffer.shift() ?? null;

function gridIndex(x: number, y: number): number {
  return y * state.chunk.width + x;
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

/** Darken a #rrggbb color for remembered-but-unseen terrain. */
function dim(css: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  if (!m) return "#3a3a44";
  const scale = (h: string): number => Math.round(parseInt(h, 16) * 0.38);
  return `rgb(${scale(m[1]!)},${scale(m[2]!)},${scale(m[3]!)})`;
}

/** Glyph and color for a grid's terrain, resolving display mimics. */
function terrainGlyph(x: number, y: number): { ch: string; css: string } {
  const f = state.chunk.feature(loc(x, y));
  const disp = f.mimic !== null ? features.get(f.mimic) : f;
  return { ch: disp.dChar, css: colorToCss(colorCharToAttr(disp.dAttr)) };
}

/**
 * Live monster glyphs, rebuilt each frame since monsters move. Only
 * monsters the player can see (or has detected - MFLAG MARK) are drawn;
 * noteSpots maintains the flags after every FOV refresh.
 */
function monsterIndex(): Map<number, { ch: string; css: string }> {
  const map = new Map<number, { ch: string; css: string }>();
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    if (!mon.mflag.has(MFLAG.VISIBLE) && !mon.mflag.has(MFLAG.MARK)) continue;
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
      if (gx < 0 || gy < 0 || gx >= state.chunk.width || gy >= state.chunk.height) continue;
      const idx = gridIndex(gx, gy);
      const screenX = mapOriginX + sx;
      const screenY = 1 + sy;

      const seen = squareIsSeen(state.chunk, loc(gx, gy));
      if (!seen) {
        /* Remembered terrain from the engine's knowledge layer, drawn
         * dim - possibly stale, exactly as upstream memory works. */
        const kf = knownFeat(state, loc(gx, gy));
        if (kf < 0) continue;
        const f = features.get(kf);
        const disp = f.mimic !== null ? features.get(f.mimic) : f;
        term.put(screenX, screenY, {
          ch: disp.dChar,
          fg: dim(colorToCss(colorCharToAttr(disp.dAttr))),
        });
        /* Remembered / sensed objects persist on the map in full color. */
        const mem = knownObject(state, loc(gx, gy));
        if (mem) {
          term.put(
            screenX,
            screenY,
            mem.ch === null
              ? { ch: "*", fg: "#8a8a94" }
              : { ch: mem.ch, fg: colorToCss(colorCharToAttr(mem.attr)) },
          );
        }
        /* Detected monsters show even out of view - that is the point. */
        const marked = monsterAt.get(idx);
        if (marked) term.put(screenX, screenY, { ch: marked.ch, fg: marked.css });
        continue;
      }

      const t = terrainGlyph(gx, gy);
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
  const dl = state.chunk.depth;
  const status = `DL${dl} (${dl * 50} ft)   Turn ${state.turn}`;
  term.print(mapOriginX, rows - 1, status.slice(0, mapCols - 1), "#5a5a66");
}

/** Advance the engine after queuing input, then repaint. */
function advance(): void {
  const status = runGameLoop(state, registry);
  if (status === LOOP_STATUS.DEAD) {
    dead = true;
    localStorage.removeItem(SAVE_KEY); // death is terminal (decision 16)
    message = "You have died. (Refresh to start a new game.)";
  } else if (status === LOOP_STATUS.LEVEL_CHANGE) {
    // Generate the next level in place and keep playing.
    const target = state.targetDepth ?? state.chunk.depth + 1;
    game.changeLevel(target);
    state.generateLevel = false;
    persistSave();
    message = `You enter a maze of staircases... (depth ${state.chunk.depth})`;
  }
  render();
}

window.addEventListener("keydown", (ev) => {
  if (dead) return;
  if (!ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    if (ev.key === "g") {
      ev.preventDefault();
      commandBuffer.push({ code: "pickup" });
      advance();
      return;
    }
    if (ev.key === ">") {
      ev.preventDefault();
      commandBuffer.push({ code: "descend" });
      advance();
      return;
    }
    if (ev.key === "<") {
      ev.preventDefault();
      commandBuffer.push({ code: "ascend" });
      advance();
      return;
    }
    if (ev.key === "S") {
      ev.preventDefault();
      persistSave();
      message = "Game saved. (Open with ?continue=1 to resume.)";
      render();
      return;
    }
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
