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
  TRF,
  installPickup,
  describeObject,
  sidebarModel,
  statusLineModel,
  createVisualsAnimator,
  animateMonsterAttr,
  RF,
} from "@neo-angband/core";
import type {
  GamePack,
  PlayerCommand,
  ViewConstants,
  ViewerState,
  VisualsRecord,
  VisualsAnimator,
} from "@neo-angband/core";
import { GameEvents } from "@neo-angband/core";
import { loadGamePack, loadVisualsRecord, loadMonsterColorCycles } from "./pack";
import { GlyphTerm } from "./term";
import { resolveKey } from "./keymap";
import { installWebSound } from "./sound";
import { createTileRenderer } from "./tiles";
// --- High scores (task #28) ---
import {
  createLocalStorageScoreStore,
  registryNameResolver,
  showPredictedScores,
} from "./score";
import { enterScore } from "@neo-angband/core";

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
const { state, registry, booted, players } = game;
const features = booted.registries.features;
const constants = booted.registries.constants;

// --- Visuals: color-cycle + flicker animation (task #27: ui-visuals.c) -----
// The core animator turns a monster race + animation frame into the COLOUR_*
// attr to draw, faithful to do_animation. It is built from the compiled
// visuals.txt record and driven by a display-only frame counter (below). The
// game runs fine with no visuals.json (animator stays null -> static colors).
const visualsRecord = loadVisualsRecord() as VisualsRecord | null;
const animator: VisualsAnimator | null = visualsRecord
  ? createVisualsAnimator(visualsRecord)
  : null;
if (animator) {
  // parse_monster_color_cycle: assign each race's color-cycle to the animator.
  for (const { ridx, group, cycle } of loadMonsterColorCycles()) {
    animator.setCycleForRace(ridx, group, cycle);
  }
}

// do_animation increments a uint8_t `flicker` counter each animation tick. We
// drive it off a display timer so shimmering never touches the deterministic
// game RNG. RF_ATTR_MULTI's randint1 uses this DISPLAY rng (Math.random), not
// state.rng, for the same reason (see parity/ledger/graphics-visuals.yaml).
let animFrame = 0;
const displayRandint1 = (n: number): number => 1 + Math.floor(Math.random() * n);

// --- Optional tiles (task #27: grafmode.c catalog) -------------------------
// NO tile art ships with the repo (the packs carry their own, partly
// non-commercial, licenses). Point the game at your own pack with
// `?tiles=<base-url>&graf=<id>`; with nothing configured this is null and the
// map renders as pure ASCII (the default). The attr/char -> tile-atlas pref
// mapping (graf-*.prf) is a separate subsystem, so the live map stays ASCII
// for now; this proves the load path and the catalog lookup are wired.
const tileset = createTileRenderer({
  baseUrl: params.get("tiles") ?? "",
  grafID: Number(params.get("graf")) || 0,
});
let tileNoteShown = false;

let message =
  loadedNote ||
  `Welcome. Move with numpad/arrows; 'g' picks up, '>' descends, 'S' saves, 'V' shows the Hall of Fame. (seed ${seed}, depth ${depth})`;
let dead = false;

// --- High scores (task #28: score.c / ui-score.c) -------------------------
// A localStorage-backed ScoreStore (JSON) is the persistence seam; the core
// owns the scoring/ordering/gating. `scoresOpen` gates the main keyhandler
// while the Hall of Fame screen owns the keyboard.
const scoreStore = createLocalStorageScoreStore();
const scoreNames = registryNameResolver(players);
let scoresOpen = false;

/** BuildScoreDeps drawn from the live game (turn, live depth, name, uid). */
function scoreBuildDeps(diedFrom: string): {
  diedFrom: string;
  turn: number;
  depth: number;
} {
  return { diedFrom, turn: state.turn, depth: state.chunk.depth };
}

/** Open the Hall of Fame around the current character (predict_score). */
async function openHallOfFame(): Promise<void> {
  if (scoresOpen) return;
  scoresOpen = true;
  await showPredictedScores(
    term,
    scoreStore,
    state.actor.player,
    scoreBuildDeps("nobody (yet!)"),
    scoreNames,
    state.isDead,
  );
  scoresOpen = false;
  render();
}

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
      // object_desc(ODESC_PREFIX | ODESC_FULL): flavours + knowledge-gated name.
      message = `You have ${describeObject(state, obj)}.`;
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
 * The display attr for a monster at the current animation frame. Faithful to
 * do_animation (ui-display.c): RF_ATTR_MULTI shimmers a random color, an
 * RF_ATTR_FLICKER monster color-cycles (race cycle, else the legacy flicker
 * cycle, else its static color), and everything else keeps its static attr.
 */
function monsterAttr(mon: (typeof state.monsters)[number]): number {
  const base = mon!.race.dAttr;
  if (!animator) return base;
  const anim = animateMonsterAttr(animator, {
    ridx: mon!.race.ridx,
    baseAttr: base,
    attrMulti: mon!.race.flags.has(RF.ATTR_MULTI),
    attrFlicker: mon!.race.flags.has(RF.ATTR_FLICKER),
    frame: animFrame,
    randint1: displayRandint1,
  });
  return anim ?? base;
}

/** True if any visible monster animates (drives the display frame timer). */
function hasAnimatedVisibleMonster(): boolean {
  if (!animator) return false;
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    if (!mon.mflag.has(MFLAG.VISIBLE)) continue;
    if (mon.race.flags.has(RF.ATTR_MULTI) || mon.race.flags.has(RF.ATTR_FLICKER)) {
      return true;
    }
  }
  return false;
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
      css: colorToCss(monsterAttr(mon)),
    });
  }
  return map;
}

const SIDEBAR_W = 13; // classic Angband status column width.

/** Display seams the engine model needs beyond GameState (timed-effect names,
 * so the status line can label Poisoned/Afraid/Fed etc). Options the web does
 * not surface fall back to the model's defaults. */
function displayDeps() {
  return { timedEffects: players.timed };
}

/**
 * Render the left status sidebar from the engine's sidebarModel (ui-display.c),
 * one field per row in side_handlers[] order. Blank separators are inserted at
 * the original NULL-spacer positions to reproduce the classic grouping; the
 * priority culling of update_sidebar is not needed at full height.
 */
function renderSidebar(rows: number): void {
  const fields = sidebarModel(state, displayDeps());
  const spacerAfter = new Set(["con", "sp", "health"]);
  let y = 0;
  for (const f of fields) {
    if (y >= rows) break;
    let x = 0;
    for (const run of f.runs) {
      if (x >= SIDEBAR_W - 1) break;
      const text = run.text.slice(0, SIDEBAR_W - 1 - x);
      term.print(x, y, text, colorToCss(run.color));
      x += run.text.length;
    }
    y++;
    if (spacerAfter.has(f.key)) y++;
  }
}

/**
 * Render the bottom status line from statusLineModel (ui-display.c), the active
 * indicators (level feeling, timed effects, DTrap, terrain, ...) laid left to
 * right with a one-column gap, exactly the status_handlers[] order.
 */
function renderStatusLine(originX: number, row: number, maxCols: number): void {
  let x = originX;
  for (const ind of statusLineModel(state, displayDeps())) {
    for (const run of ind.runs) {
      if (x - originX >= maxCols - 1) return;
      const text = run.text.slice(0, maxCols - 1 - (x - originX));
      term.print(x, row, text, colorToCss(run.color));
      x += run.text.length;
    }
    if (ind.runs.length > 0) x += 1; // inter-indicator gap
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
  renderStatusLine(mapOriginX, rows - 1, mapCols);
}

/** Advance the engine after queuing input, then repaint. */
function advance(): void {
  const status = runGameLoop(state, registry);
  if (status === LOOP_STATUS.DEAD) {
    dead = true;
    localStorage.removeItem(SAVE_KEY); // death is terminal (decision 16)
    message = "You have died. (Refresh to start a new game.)";
    // Enter the character on the high-score table (enter_score) and show the
    // Hall of Fame. died_from is a placeholder: the engine does not yet surface
    // the killer to the shell (take-hit's onDeath hook has it; wiring it onto
    // GameState is deferred), so the cause defaults here.
    const diedFrom = "the dungeon";
    // --- OPTIONS (task #30) --- the cheat/score gate now reads the wired
    // option store (score.c L277: any OP_SCORE option set = "cheating"). A
    // clean character trips nothing, so behaviour is unchanged by default. The
    // noscore/wizard gate stays a shell concern (no wizard mode on the web).
    const outcome = enterScore(
      scoreStore,
      state.actor.player,
      { ...scoreBuildDeps(diedFrom), deathTime: new Date() },
      { diedFrom, cheated: state.options?.anyScoreSet() ?? false },
    );
    scoresOpen = true;
    void showPredictedScores(
      term,
      scoreStore,
      state.actor.player,
      { ...scoreBuildDeps(diedFrom), deathTime: new Date() },
      scoreNames,
      true,
    ).then(() => {
      scoresOpen = false;
      void outcome; // slot/rejection reason available for a future death screen
      render();
    });
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
  if (scoresOpen) return; // the Hall of Fame screen owns the keyboard
  if (dead) return;
  if (!ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    if (ev.key === "V") {
      ev.preventDefault();
      void openHallOfFame();
      return;
    }
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
  // A run binding starts a run; the engine self-continues via cmdQueue until
  // run_test stops it (runGameLoop returns INPUT), so one keypress runs.
  commandBuffer.push({ code: binding.kind, dir: binding.dir });
  advance();
});

// ---- Sound subsystem wiring (faithful to init_sound + EVENT_SOUND) ----
// The core SoundEngine subscribes to the "sound" event and plays a sample
// from the user's pack. NO audio ships with the repo: point the game at your
// own pack with `?sounds=<base-url>` (the Dubtrain pack the mapping came from
// is Creative-Commons non-commercial). With no URL the engine is silent.
// Selection uses the game RNG so it is deterministic. Once the live turn loop
// routes msgt()/sound() through this bus, in-game events will play here.
const soundEvents = new GameEvents();
const soundBase = params.get("sounds") ?? "";
installWebSound(soundEvents, {
  baseUrl: soundBase,
  randint0: (n: number): number => state.rng.randint0(n),
});

state.updateFov(state);
term.onResize = () => render();
render();

// ---- Animation timer (faithful to do_animation on EVENT_ANIMATE) ----
// A display-only tick advances the flicker frame and repaints when an animated
// monster (RF_ATTR_MULTI / RF_ATTR_FLICKER) is on screen, so shimmering and
// color-cycling monsters animate even while the player is idle - exactly what
// the upstream idle animation timer does. It never advances the game or the
// deterministic RNG. When no tile/animation data is present it simply idles.
const ANIM_INTERVAL_MS = 250;
setInterval(() => {
  if (dead || scoresOpen) return;
  // Surface tile-pack readiness once (the live map stays ASCII pending the
  // pref-file mapping; this confirms the catalog + load path are wired).
  if (tileset && tileset.ready && !tileNoteShown) {
    tileNoteShown = true;
    message = `Tile pack loaded (${tileset.mode.menuname}); map remains ASCII for now.`;
    render();
  }
  if (!hasAnimatedVisibleMonster()) return;
  animFrame = (animFrame + 1) & 0xff; // uint8_t flicker counter
  render();
}, ANIM_INTERVAL_MS);
