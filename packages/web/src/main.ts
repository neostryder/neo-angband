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
 * rest of the viewport at any size. A new game opens the birth screen (choose
 * race / class / sex / name); resuming a save goes straight back into play.
 *
 * Live systems: movement + melee (with faithful "You hit/slay the X" messages),
 * item use (quaff/read/eat/wield/take-off/drop/devices/activate), spellcasting
 * (study 'G', cast/pray 'm'/'p' with a faithful book -> spell picker showing
 * level/mana/fail%), targeting and look ('*' target, "'" target closest, 'l'/'x'
 * look; aimed spells/devices fire at the target via DIR_TARGET), ranged attacks
 * ('f' fire ammo, 'v' throw), inventory (i), equipment (e), the character sheet
 * (C), the message history (Ctrl-P), pickup ('g'), stairs with real level
 * regeneration ('>'/'<'), and JSON save/continue.
 * The game AUTO-RESUMES the stored save on load (a plain refresh continues where
 * you left off); it autosaves during play, on level change, and when the tab is
 * hidden/closed. 'S' saves on demand; 'N' rolls a new character (allowed after
 * death, reusing the same save slot - faithful to the original's death flow).
 *
 * The render surface is responsive: it fills the viewport at any size and, on
 * narrow (phone / portrait) screens, drops the sidebar for a compact layout.
 * Touch devices get tap-to-move plus an on-screen action bar.
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
  gearGet,
  objNeedsAim,
  tvalIsPotion,
  tvalIsScroll,
  tvalIsEdible,
  tvalIsStaff,
  tvalIsWand,
  tvalIsRod,
  tvalIsWearable,
  tvalIsAmmo,
  sidebarModel,
  statusLineModel,
  createVisualsAnimator,
  animateMonsterAttr,
  RF,
  MSG,
  PF,
  spellNeedsAim,
  playerObjectToBook,
  targetSetMonster,
  targetSetClosest,
  targetOkay,
  TARGET,
} from "@neo-angband/core";
import type {
  GamePack,
  GameObject,
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
import { showTextScreen, selectFromMenu, promptDirection, AIM_STAR } from "./overlay";
import { runBirth } from "./birth";
import { MessageLog } from "./messages";
import {
  inventoryLines,
  equipmentLines,
  characterSheetLines,
  messageHistoryLines,
  packMenu,
  equipmentMenu,
  magicBooks,
  bookSpellMenu,
  targetMenu,
  lookLines,
} from "./screens";
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
// deterrent), base64-wrapped. The stored game AUTO-RESUMES on load so a plain
// refresh continues where you left off; `?new=1` (or an explicit `?seed=`, a
// request for a specific reproducible run) starts fresh, as does the in-game
// New Game action. Death clears the save (decision 16: death is terminal).
const SAVE_KEY = "neo-angband-save";
// A one-shot flag the New Game action sets before reloading (survives the
// reload via sessionStorage, then is cleared) so the reboot starts fresh
// instead of auto-resuming the save it is about to overwrite.
const FORCE_NEW_KEY = "neo-angband-force-new";
// The chosen character identity (birth): race/class drive startGame; name/sex
// are cosmetic. Persisted so a birthed character survives the reload that
// rebuilds the game as that race/class, and so the next New Game reuses it as
// defaults. A sessionStorage flag marks "birth already done this load" so the
// post-birth reload does not reopen the birth screen.
const BIRTH_KEY = "neo-angband-birth";
const BIRTH_DONE_KEY = "neo-angband-birth-done";
interface StoredBirth {
  raceName: string;
  className: string;
  name: string;
  sex: string;
}
function readBirthChoice(): StoredBirth | null {
  try {
    const raw = localStorage.getItem(BIRTH_KEY);
    return raw ? (JSON.parse(raw) as StoredBirth) : null;
  } catch {
    return null;
  }
}
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

function readStoredSave(): string | null {
  try {
    return localStorage.getItem(SAVE_KEY);
  } catch {
    return null; // storage disabled / private mode: play unsaved
  }
}

let loadedNote = "";
// True when this load started a fresh character (startGame), not a resume; the
// birth screen keys off this to appear only for a new character.
let bootedNew = false;
const birthChoice = readBirthChoice();
function bootGame(): ReturnType<typeof startGame> {
  // Start fresh only when explicitly asked: `?new`, an explicit `?seed=` (a
  // request for a specific reproducible run), or the in-game New Game action.
  // Otherwise auto-resume the stored save so a refresh continues the game.
  let forcedNew = params.has("new") || params.has("seed");
  try {
    if (sessionStorage.getItem(FORCE_NEW_KEY) === "1") forcedNew = true;
    sessionStorage.removeItem(FORCE_NEW_KEY);
  } catch {
    /* sessionStorage unavailable: fall through to the query-param decision. */
  }
  if (!forcedNew) {
    const stored = readStoredSave();
    if (stored) {
      try {
        const decoded = decodeSavedGame(b64ToBytes(stored));
        if (decoded.save) {
          loadedNote = decoded.verified
            ? "Welcome back. Your game was restored."
            : "Welcome back. (WARNING: save integrity check failed.)";
          return loadGame(pack, decoded.save);
        }
      } catch {
        loadedNote = "Could not read the save; starting a new game.";
      }
    }
  }
  bootedNew = true;
  // A birthed character supplies its race/class; otherwise the engine defaults
  // to Human Warrior (the classic quick-start).
  return startGame(pack, {
    seed,
    depth,
    ...(birthChoice
      ? { raceName: birthChoice.raceName, className: birthChoice.className }
      : {}),
  });
}

const game = bootGame();
const { state, registry, booted, players } = game;
const features = booted.registries.features;
const constants = booted.registries.constants;
// The birthed name (cosmetic: character sheet, high-score row). Empty for the
// default quick-start until the player names a character.
const playerName = birthChoice?.name ?? "";

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
  `Welcome. Move (numpad/arrows/tap); 'g' get, '>' descend, 'i' inventory, 'e' equip, 'C' character, 'S' save, 'N' new, 'V' scores. (seed ${seed})`;
let dead = false;

// The message log: every message the engine emits this session, for the top
// status line and the scrollable history (Ctrl-P). state.msg is the core's
// central message sink; routing it here means command/effect messages surface
// without each call site knowing about the shell.
const msglog = new MessageLog();
function say(text: string): void {
  if (!text) return;
  msglog.push(text);
  message = msglog.latest();
}
state.msg = (text: string): void => say(text);

// py_attack text (player-attack.c): the combat code returns HitType keys only,
// leaving the wording to the UI. Render the classic "You hit the kobold." plus
// the crit flavour and the kill line, faithful to melee_hit_types + mon_take_hit.
const CRIT_FLAVOR: Record<string, string> = {
  HIT_GOOD: "It was a good hit!",
  HIT_GREAT: "It was a great hit!",
  HIT_SUPERB: "It was a superb hit!",
  HIT_HI_GREAT: "It was a *GREAT* hit!",
  HIT_HI_SUPERB: "It was a *SUPERB* hit!",
};
function monName(mon: { race: { name: string; flags: { has: (f: number) => boolean } } }): string {
  // monster_desc 0x00: "the kobold" for a visible non-unique, the proper name
  // for a unique.
  return mon.race.flags.has(RF.UNIQUE) ? mon.race.name : `the ${mon.race.name}`;
}
state.onMelee = (mon, result): void => {
  const name = monName(mon);
  for (const blow of result.blows) {
    if (!blow.hit) {
      say(`You miss ${name}.`);
      state.sound?.(MSG.MISS);
      continue;
    }
    say(`You ${blow.verb} ${name}.`);
    const flavor = CRIT_FLAVOR[blow.msg];
    if (flavor) say(flavor);
    state.sound?.((MSG as Record<string, number>)[blow.msg] ?? MSG.HIT);
  }
  if (result.monsterDied) {
    say(`You have slain ${name}.`);
    state.sound?.(MSG.KILL);
  }
};

// Modal gate: while a full-screen overlay (inventory, character sheet, message
// history, item/spell selection) owns the keyboard, the in-game key handler
// stands down - exactly the single-owner input model of the upstream UI.
let modalDepth = 0;
async function openModal(fn: () => Promise<void>): Promise<void> {
  modalDepth++;
  try {
    await fn();
  } finally {
    modalDepth--;
    render();
  }
}

// --- Item-use commands (cmd-obj.c verbs) ------------------------------------
// Each verb opens a lettered selection menu over the pack (filtered by tval),
// then dispatches a PlayerCommand referencing the chosen object by args.handle
// - the live command system's object reference (obj-cmd.ts commandObject). For
// items that need aiming (wands, unknown rods, aimed effects: objNeedsAim), it
// prompts a keypad direction and passes args.dir; the engine bypasses its own
// get_aim_dir when a dir is supplied. The obj commands were installed without a
// message env, so the shell narrates the action here for feedback; the real
// per-effect messages arrive when the core message seam lands (task #42).
const VERB_LABEL: Record<string, string> = {
  quaff: "Quaff", read: "Read", eat: "Eat", "use-staff": "Use", "aim-wand": "Aim",
  "zap-rod": "Zap", activate: "Activate", wield: "Wear/Wield", drop: "Drop",
};
function actionLine(code: string, obj: GameObject | null): string {
  const name = obj ? describeObject(state, obj) : "the item";
  switch (code) {
    case "quaff": return `You quaff ${name}.`;
    case "read": return `You read ${name}.`;
    case "eat": return `You eat ${name}.`;
    case "use-staff": return `You use ${name}.`;
    case "aim-wand": return `You aim ${name}.`;
    case "zap-rod": return `You zap ${name}.`;
    case "activate": return `You activate ${name}.`;
    case "wield": return `You are wielding ${name}.`;
    case "takeoff": return `You take off ${name}.`;
    case "drop": return `You drop ${name}.`;
    default: return `You use ${name}.`;
  }
}

/** Select a pack item matching `filter`, then dispatch `code` for it. */
async function useItem(
  code: string,
  filter: (obj: GameObject) => boolean,
  emptyNoun: string,
): Promise<void> {
  const { items, handles } = packMenu(state, filter);
  if (items.length === 0) {
    say(`You have no ${emptyNoun}.`);
    return;
  }
  const idx = await selectFromMenu(
    term,
    `${VERB_LABEL[code] ?? "Use"} which item?`,
    items,
  );
  if (idx === null) return;
  const handle = handles[idx];
  if (handle === undefined) return;
  const obj = gearGet(state.gear, handle);
  const args: Record<string, unknown> = { handle };
  if (obj && objNeedsAim(obj, { flavor: game.flavor })) {
    const dir = await aimDir();
    if (dir === null) return;
    args["dir"] = dir;
  }
  say(actionLine(code, obj));
  commandBuffer.push({ code, args });
  advance();
}

/** Activate a worn item (A): pick from equipped items that have an activation. */
async function activateItem(): Promise<void> {
  const player = state.actor.player;
  const items = [];
  const handles: number[] = [];
  for (let i = 0; i < player.body.count; i++) {
    const handle = player.equipment[i] ?? 0;
    if (!handle) continue;
    const obj = gearGet(state.gear, handle);
    if (!obj || !obj.activation) continue;
    items.push({ label: describeObject(state, obj), color: "#c8c8d4" });
    handles.push(handle);
  }
  if (items.length === 0) {
    say("You have nothing to activate.");
    return;
  }
  const idx = await selectFromMenu(term, "Activate which item?", items);
  if (idx === null) return;
  const handle = handles[idx];
  if (handle === undefined) return;
  const obj = gearGet(state.gear, handle);
  const args: Record<string, unknown> = { handle };
  if (obj && objNeedsAim(obj, { flavor: game.flavor })) {
    const dir = await aimDir();
    if (dir === null) return;
    args["dir"] = dir;
  }
  say(actionLine("activate", obj));
  commandBuffer.push({ code: "activate", args });
  advance();
}

/** Take off an equipped item (t): pick from filled equipment slots. */
async function takeOffItem(): Promise<void> {
  const { items, handles } = equipmentMenu(state);
  if (items.length === 0) {
    say("You are not wearing anything you can take off.");
    return;
  }
  const idx = await selectFromMenu(term, "Take off which item?", items);
  if (idx === null) return;
  const handle = handles[idx];
  if (handle === undefined) return;
  say(actionLine("takeoff", gearGet(state.gear, handle)));
  commandBuffer.push({ code: "takeoff", args: { handle } });
  advance();
}

// --- Spellcasting (cmd-obj.c cast/study; player-spell.c) --------------------
// Cast (m/p) and study (G) mirror the item-use flow: pick a usable book from
// the pack, then a spell from that book. The core cast/study commands address
// the spell by its class-wide index (args.spell) and the book by gear handle
// (args.handle); this shell is the cmd_get_spell UI that resolves the choice
// before the command runs. Aimed spells prompt a keypad direction (args.dir),
// exactly like aimed items. Per-spell effect/fail messages arrive through the
// message seam (state.msg) the same way item effects do.

/** Pick one of the player's usable spellbooks, or null if none/cancelled. */
async function chooseBook(verb: string): Promise<number | null> {
  const { items, handles } = magicBooks(state);
  if (items.length === 0) {
    say("You have no books that you can use.");
    return null;
  }
  if (items.length === 1) return handles[0] ?? null;
  const idx = await selectFromMenu(term, `${verb} from which book?`, items);
  if (idx === null) return null;
  return handles[idx] ?? null;
}

/** Cast/pray (m/p): choose book, choose spell, aim if needed, dispatch cast. */
async function castSpell(): Promise<void> {
  const player = state.actor.player;
  if (!player.cls.magic.totalSpells) {
    say("You cannot cast spells.");
    return;
  }
  const handle = await chooseBook("Cast");
  if (handle === null) return;
  const bookObj = gearGet(state.gear, handle);
  if (!bookObj) return;
  const { items, sidx } = bookSpellMenu(state, bookObj, "cast");
  if (items.every((it) => it.disabled)) {
    say("You don't know any spells in that book.");
    return;
  }
  const verb = playerObjectToBook(player, bookObj)?.realm.verb ?? "cast";
  const pick = await selectFromMenu(
    term,
    `${verb[0]?.toUpperCase()}${verb.slice(1)} which spell?`,
    items,
    "[ a-z to choose a spell, ESC to cancel ]",
  );
  if (pick === null) return;
  const spell = sidx[pick];
  if (spell === undefined) return;
  const args: Record<string, unknown> = { spell };
  if (spellNeedsAim(player, spell)) {
    const dir = await aimDir();
    if (dir === null) return;
    args["dir"] = dir;
  }
  commandBuffer.push({ code: "cast", args });
  advance();
}

/** Study (G): learn a spell. Choose-spell classes pick; others learn at random. */
async function studySpell(): Promise<void> {
  const player = state.actor.player;
  if (!player.cls.magic.totalSpells) {
    say("You cannot learn spells.");
    return;
  }
  if (player.upkeep.newSpells <= 0) {
    say("You cannot learn any new spells.");
    return;
  }
  const handle = await chooseBook("Study");
  if (handle === null) return;
  const args: Record<string, unknown> = { handle };
  if (player.cls.pflags.has(PF.CHOOSE_SPELLS)) {
    const bookObj = gearGet(state.gear, handle);
    if (!bookObj) return;
    const { items, sidx } = bookSpellMenu(state, bookObj, "study");
    if (items.every((it) => it.disabled)) {
      say("You cannot learn any spells from that book yet.");
      return;
    }
    const pick = await selectFromMenu(
      term,
      "Study which spell?",
      items,
      "[ a-z to choose a spell, ESC to cancel ]",
    );
    if (pick === null) return;
    const spell = sidx[pick];
    if (spell === undefined) return;
    args["spell"] = spell;
  }
  commandBuffer.push({ code: "study", args });
  advance();
}

// --- Ranged attacks (do_cmd_fire / do_cmd_throw) ----------------------------
// Fire launches ammo matching the equipped launcher; throw hurls any pack item.
// Both pick the object, then aim (aimDir, so '*'/target/DIR_TARGET all work) and
// dispatch to the core fire/throw commands, which walk the missile's path.

/** Fire (f): pick matching ammo, aim, and loose it at the target/direction. */
async function fireCmd(): Promise<void> {
  const tval = state.actor.combat.ammoTval;
  if (!tval) {
    say("You have nothing to fire with.");
    return;
  }
  const { items, handles } = packMenu(
    state,
    (o) => tvalIsAmmo(o.tval) && o.tval === tval,
  );
  if (items.length === 0) {
    say("You have no ammunition for your weapon.");
    return;
  }
  const idx = await selectFromMenu(term, "Fire which ammunition?", items);
  if (idx === null) return;
  const handle = handles[idx];
  if (handle === undefined) return;
  const dir = await aimDir();
  if (dir === null) return;
  commandBuffer.push({ code: "fire", args: { handle, dir } });
  advance();
}

/** Throw (v): pick any pack item, aim, and hurl it. */
async function throwCmd(): Promise<void> {
  const { items, handles } = packMenu(state, () => true);
  if (items.length === 0) {
    say("You have nothing to throw.");
    return;
  }
  const idx = await selectFromMenu(term, "Throw which item?", items);
  if (idx === null) return;
  const handle = handles[idx];
  if (handle === undefined) return;
  const dir = await aimDir();
  if (dir === null) return;
  commandBuffer.push({ code: "throw", args: { handle, dir } });
  advance();
}

// --- Targeting + look (target.c; get_aim_dir) -------------------------------
// A monster target lets aimed spells / devices fire at a specific creature
// (DIR_TARGET, keypad 5) instead of a compass direction. chooseTarget lists the
// target-able monsters (target_get_monsters, sorted by distance) and sets the
// pick as state.target; the aim prompt then resolves dir 5 through the engine's
// targetOkay/targetGet, exactly as upstream's cmd_get_target does. '*' opens the
// picker mid-aim, "'" targets the closest, and 'l' looks (read-only).

/** Pick a monster to target from the target-able list; true if one was set. */
async function chooseTarget(): Promise<boolean> {
  const { items, mons } = targetMenu(state);
  if (items.length === 0) {
    say("No Available Target.");
    return false;
  }
  const idx = await selectFromMenu(
    term,
    "Target which monster?",
    items,
    "[ a-z to target, ESC to cancel ]",
  );
  if (idx === null) return false;
  const mon = mons[idx];
  if (!mon) return false;
  targetSetMonster(state, mon);
  state.healthWho = mon;
  const n = mon.race.name;
  say(`${n.charAt(0).toUpperCase()}${n.slice(1)} is targeted.`);
  return true;
}

// get_aim_dir: a keypad direction (1-9), or DIR_TARGET (5). '*' opens the target
// picker and, once a monster is chosen, fires at it (dir 5). Re-prompts if the
// player backs out of the picker without choosing.
async function aimDir(): Promise<number | null> {
  for (;;) {
    const d = await promptDirection(term);
    if (d === null) return null;
    if (d === AIM_STAR) {
      const chosen = await chooseTarget();
      render();
      if (chosen) return 5;
      continue;
    }
    return d;
  }
}

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
  try {
    localStorage.setItem(SAVE_KEY, bytesToB64(encodeSavedGame(saveGame(game))));
  } catch {
    /* Quota exceeded or storage disabled: keep playing unsaved rather than
     * crashing the turn. The next autosave retries. */
  }
}

// Autosave keeps the session recoverable without the player thinking about it:
// throttled during active play, and forced on level change and when the tab is
// hidden/closed (pagehide / visibilitychange) so closing the tab never loses
// more than the current turn. Manual 'S' forces an immediate save too.
let lastSaveMs = -Infinity;
function autosave(force = false): void {
  if (dead) return;
  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  if (!force && now - lastSaveMs < 3000) return;
  lastSaveMs = now;
  persistSave();
}

/** Start a brand-new game: clear the save and reload with the force-new flag. */
function newGame(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
    sessionStorage.setItem(FORCE_NEW_KEY, "1");
  } catch {
    /* ignore storage errors; the reload below still starts fresh via ?new */
  }
  const url = new URL(location.href);
  url.searchParams.set("new", "1");
  location.assign(url.toString());
}

// Reinstall the pickup commands with message hooks so gold and item pickup
// report on the message line.
installPickup(state, registry, {
  constants,
  env: {
    onGold: (total, name, single): void => {
      say(`You have found ${total} gold pieces worth of ${single ? name : "treasures"}.`);
    },
    onPickup: (obj): void => {
      // object_desc(ODESC_PREFIX | ODESC_FULL): flavours + knowledge-gated name.
      say(`You have ${describeObject(state, obj)}.`);
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

/**
 * The map viewport geometry for the current terminal size. Narrow (phone /
 * portrait) viewports use a COMPACT layout: the 13-column sidebar is dropped
 * so the map fills the full width, with a one-line vitals header under the
 * message row. Roomy screens keep the classic left sidebar. Kept as a helper
 * so the touch handler maps a tapped cell back to a grid square identically.
 */
function viewport(): {
  compact: boolean;
  mapOriginX: number;
  mapTop: number;
  mapCols: number;
  mapRows: number;
  camX: number;
  camY: number;
} {
  const { cols, rows } = term.size();
  const compact = cols < 48;
  const mapOriginX = compact ? 0 : SIDEBAR_W;
  const mapTop = compact ? 2 : 1; // message row (+ a vitals row when compact)
  const mapCols = cols - mapOriginX;
  const mapRows = rows - mapTop - 1; // the last row is the status line
  const camX = state.actor.grid.x - Math.floor(mapCols / 2);
  const camY = state.actor.grid.y - Math.floor(mapRows / 2);
  return { compact, mapOriginX, mapTop, mapCols, mapRows, camX, camY };
}

/** Selected sidebar fields shown inline on the compact-layout vitals row. */
const COMPACT_VITALS_KEYS = ["level", "hp", "sp", "ac", "gold", "depth"];

/** The one-line vitals header for the compact layout (reuses sidebarModel). */
function renderCompactVitals(row: number, maxCols: number): void {
  const byKey = new Map(
    sidebarModel(state, displayDeps()).map((f) => [f.key, f]),
  );
  let x = 0;
  for (const key of COMPACT_VITALS_KEYS) {
    const f = byKey.get(key);
    if (!f) continue;
    for (const run of f.runs) {
      if (x >= maxCols - 1) return;
      const text = run.text.slice(0, maxCols - 1 - x);
      term.print(x, row, text, colorToCss(run.color));
      x += run.text.length;
    }
    x += 1; // gap between fields
  }
}

function render(): void {
  const { cols, rows } = term.size();
  term.clear();

  const { compact, mapOriginX, mapTop, mapCols, mapRows, camX, camY } =
    viewport();
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
      const screenY = mapTop + sy;

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
  term.put(
    mapOriginX + Math.floor(mapCols / 2),
    mapTop + Math.floor(mapRows / 2),
    { ch: "@", fg: "#e8e8f0" },
  );

  if (compact) renderCompactVitals(1, cols);
  else renderSidebar(rows);
  term.print(mapOriginX, 0, message.slice(0, mapCols - 1), "#c8c8d4");
  renderStatusLine(mapOriginX, rows - 1, mapCols);
}

/** Advance the engine after queuing input, then repaint. */
function advance(): void {
  const status = runGameLoop(state, registry);
  if (status === LOOP_STATUS.DEAD) {
    dead = true;
    try {
      localStorage.removeItem(SAVE_KEY); // death is terminal (decision 16)
    } catch {
      /* ignore storage errors */
    }
    message = "You have died. (Press 'N' or refresh to start a new game.)";
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
    autosave(true); // a fresh level is a natural save point
    message = `You enter a maze of staircases... (depth ${state.chunk.depth})`;
  }
  autosave(); // throttled: keep the session recoverable during active play
  render();
}

window.addEventListener("keydown", (ev) => {
  if (scoresOpen || modalDepth > 0) return; // a modal owns the keyboard
  // Ctrl-P: recall the message history (do_cmd_messages), even the same key
  // the roguelike keyset would otherwise use, since a modifier is held.
  if (ev.ctrlKey && (ev.key === "p" || ev.key === "P")) {
    ev.preventDefault();
    void openModal(() =>
      showTextScreen(term, "Message history", messageHistoryLines(msglog)),
    );
    return;
  }
  // New character (N): allowed even after death, so a fallen hero rolls a new
  // character into the same save slot (faithful to the original's death -> new
  // character flow). Confirm only while alive, since death already ends the run.
  if (!ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.key === "N") {
    ev.preventDefault();
    if (dead || window.confirm("Start a new character? Your current one will be lost.")) {
      newGame();
    }
    return;
  }
  if (dead) return;
  if (!ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    if (ev.key === "V") {
      ev.preventDefault();
      void openHallOfFame();
      return;
    }
    if (ev.key === "i") {
      ev.preventDefault();
      void openModal(() =>
        showTextScreen(term, "Inventory", inventoryLines(state)),
      );
      return;
    }
    if (ev.key === "e") {
      ev.preventDefault();
      void openModal(() =>
        showTextScreen(term, "Equipment", equipmentLines(state)),
      );
      return;
    }
    if (ev.key === "C") {
      ev.preventDefault();
      void openModal(() =>
        showTextScreen(term, "Character", characterSheetLines(state, playerName)),
      );
      return;
    }
    // Item-use verbs (original keyset: cmd-obj.c). Each opens a selection menu.
    const ITEM_VERBS: Record<string, () => Promise<void>> = {
      q: () => useItem("quaff", (o) => tvalIsPotion(o.tval), "potions"),
      r: () => useItem("read", (o) => tvalIsScroll(o.tval), "scrolls"),
      E: () => useItem("eat", (o) => tvalIsEdible(o.tval), "food"),
      u: () => useItem("use-staff", (o) => tvalIsStaff(o.tval), "staves"),
      a: () => useItem("aim-wand", (o) => tvalIsWand(o.tval), "wands"),
      z: () => useItem("zap-rod", (o) => tvalIsRod(o.tval), "rods"),
      w: () => useItem("wield", (o) => tvalIsWearable(o.tval), "items you can wear or wield"),
      d: () => useItem("drop", () => true, "items"),
      A: () => activateItem(),
      t: () => takeOffItem(),
      m: () => castSpell(),
      p: () => castSpell(),
      G: () => studySpell(),
      "*": () => chooseTarget().then(() => undefined),
      l: () => showTextScreen(term, "Look - monsters in view", lookLines(state)),
      x: () => showTextScreen(term, "Look - monsters in view", lookLines(state)),
      f: () => fireCmd(),
      v: () => throwCmd(),
    };
    const verb = ITEM_VERBS[ev.key];
    if (verb) {
      ev.preventDefault();
      void openModal(verb);
      return;
    }
    if (ev.key === "'") {
      // Target the closest target-able monster (a free action, no turn spent).
      ev.preventDefault();
      targetSetClosest(state, TARGET.KILL);
      render();
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
      autosave(true);
      message = "Game saved. It will resume automatically next time.";
      render();
      return;
    }
    if (ev.key === "N") {
      ev.preventDefault();
      if (
        window.confirm(
          "Start a new game? Your current character will be lost.",
        )
      ) {
        newGame();
      }
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

// ---- Touch input: tap a map cell to step toward it (one square) ----------
// The core game is UI-agnostic (decision 21); this is the web shell's native
// touch scheme so the game is playable on a phone or tablet with no keyboard.
// A tap resolves to the 8-way keypad direction from the player toward the
// tapped square and queues a single walk. A richer controller is a future mod
// (the "intelligent controller / mobile input" idea), not core.
canvas.addEventListener("pointerdown", (ev) => {
  if (scoresOpen || dead) return;
  const rect = canvas.getBoundingClientRect();
  const { col, row } = term.cellAt(ev.clientX - rect.left, ev.clientY - rect.top);
  const vp = viewport();
  const sx = col - vp.mapOriginX;
  const sy = row - vp.mapTop;
  if (sx < 0 || sy < 0 || sx >= vp.mapCols || sy >= vp.mapRows) return; // HUD tap
  const dx = Math.sign(vp.camX + sx - state.actor.grid.x);
  const dy = Math.sign(vp.camY + sy - state.actor.grid.y);
  if (dx === 0 && dy === 0) return; // tapped the player: no move
  ev.preventDefault();
  // Keypad direction: 7 8 9 / 4 5 6 / 1 2 3, so dir = (1-dy)*3 + (dx+2).
  commandBuffer.push({ code: "walk", dir: (1 - dy) * 3 + (dx + 2) });
  advance();
});

// On touch devices (coarse pointer), add an on-screen bar for the discrete
// actions the keyboard has, so a phone player is not stuck. Hidden on desktop,
// where the keyboard is the native scheme.
function installTouchActionBar(): void {
  const bar = document.createElement("div");
  Object.assign(bar.style, {
    position: "fixed",
    left: "0",
    right: "0",
    bottom: "0",
    display: "flex",
    gap: "6px",
    justifyContent: "center",
    padding: "6px",
    pointerEvents: "none",
    zIndex: "10",
  });
  const actions: Array<[string, () => void]> = [
    ["Get", () => { commandBuffer.push({ code: "pickup" }); advance(); }],
    ["Down >", () => { commandBuffer.push({ code: "descend" }); advance(); }],
    ["Up <", () => { commandBuffer.push({ code: "ascend" }); advance(); }],
    ["Inv", () => { void openModal(() => showTextScreen(term, "Inventory", inventoryLines(state))); }],
    ["Char", () => { void openModal(() => showTextScreen(term, "Character", characterSheetLines(state, playerName))); }],
    ["Save", () => { autosave(true); message = "Game saved."; render(); }],
    [
      "New",
      () => {
        if (window.confirm("Start a new game? Your current character will be lost.")) {
          newGame();
        }
      },
    ],
  ];
  for (const [label, fn] of actions) {
    const btn = document.createElement("button");
    btn.textContent = label;
    Object.assign(btn.style, {
      pointerEvents: "auto",
      padding: "8px 12px",
      background: "rgba(20,20,28,0.82)",
      color: "#c8c8d4",
      border: "1px solid #3a3a44",
      borderRadius: "6px",
      font: "14px system-ui, sans-serif",
      touchAction: "manipulation",
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (dead && label !== "New") return;
      fn();
    });
    bar.appendChild(btn);
  }
  document.body.appendChild(bar);
}
if (window.matchMedia?.("(pointer: coarse)").matches) installTouchActionBar();

// ---- Session continuity: force a save when the tab is hidden or closed ----
// Mobile browsers may kill a backgrounded tab without warning; pagehide and the
// hidden visibility state are the reliable last-chance hooks to flush the save.
window.addEventListener("pagehide", () => {
  if (!dead) persistSave();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && !dead) persistSave();
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
// Route the engine's sound() emits (msgt types from combat, deaths, casts,
// ranged attacks) onto the bus so a loaded pack actually plays on gameplay.
// This is the emit half of decision (b): sound is first-class and fully wired;
// audio only plays once a pack is pointed at via ?sounds=. state.sound is the
// core seam (game/context.ts); combat/ranged/monster-message code calls it.
state.sound = (type: number): void => {
  soundEvents.emit("sound", { msg: "", type });
};

state.updateFov(state);
term.onResize = () => render();
render();

// --- Birth: choose a character for a new game -------------------------------
// A brand-new game opens the birth screen (race / class / sex / name). The
// engine has already built a default Human Warrior this load; when the player
// chooses, we persist the choice and reload so startGame rebuilds as that
// race/class (its stats and starting kit differ). A one-shot sessionStorage
// flag suppresses the screen on that rebuild. Backing out (ESC) keeps whatever
// character was built. Resuming a save never births.
async function maybeBirth(): Promise<void> {
  if (!bootedNew) return;
  let justBirthed = false;
  try {
    justBirthed = sessionStorage.getItem(BIRTH_DONE_KEY) === "1";
    sessionStorage.removeItem(BIRTH_DONE_KEY);
  } catch {
    /* sessionStorage unavailable: fall through and show birth. */
  }
  if (justBirthed) return; // the choice from the previous load is already live
  await openModal(async () => {
    const choice = await runBirth(term, players.races, players.classes);
    if (!choice) {
      say("Your adventure begins.");
      return;
    }
    try {
      localStorage.setItem(BIRTH_KEY, JSON.stringify(choice));
      localStorage.removeItem(SAVE_KEY);
      sessionStorage.setItem(BIRTH_DONE_KEY, "1");
      sessionStorage.setItem(FORCE_NEW_KEY, "1");
    } catch {
      /* storage disabled: the reload still starts a fresh game via ?new */
    }
    const url = new URL(location.href);
    url.searchParams.set("new", "1");
    location.assign(url.toString());
  });
}
void maybeBirth();

// Dev-only diagnostic hook for automated verification; Vite strips this whole
// block from the production bundle (import.meta.env.DEV is false there).
if (import.meta.env.DEV) {
  (window as unknown as { __neo?: unknown }).__neo = {
    resumed: loadedNote.startsWith("Welcome back"),
    get turn() {
      return state.turn;
    },
    get grid() {
      return { x: state.actor.grid.x, y: state.actor.grid.y };
    },
    get compact() {
      return term.size().cols < 48;
    },
    get modal() {
      return modalDepth > 0;
    },
    size: () => term.size(),
    screen: () => term.snapshot(),
    messages: () => msglog.all().map((m) => m.text),
    monsters: () =>
      state.monsters
        .slice(1)
        .filter((m) => m)
        .map((m) => ({ x: m!.grid.x, y: m!.grid.y, name: m!.race.name, hp: m!.hp })),
    // Drive a raw PlayerCommand through the loop (verification aid only).
    push: (c: PlayerCommand): void => {
      commandBuffer.push(c);
      advance();
    },
    // Reposition the player (verification aid only; not a game action).
    warp: (x: number, y: number): void => {
      state.actor.grid = loc(x, y);
      state.updateFov?.(state);
      render();
    },
  };
}

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
