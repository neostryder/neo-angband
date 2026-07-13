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
  objectInfoTextblock,
  gearGet,
  floorPile,
  buildObjectEffectChain,
  itemTargetRequest,
  spellByIndex,
  objNeedsAim,
  tvalIsPotion,
  tvalIsScroll,
  tvalIsEdible,
  tvalIsStaff,
  tvalIsWand,
  tvalIsRod,
  tvalIsWearable,
  tvalIsAmmo,
  tvalIsLight,
  objCanRefill,
  objHasInscrip,
  OF,
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
  targetGetMonsters,
  targetIsSet,
  TARGET,
  TMD,
  ignoreDropTargets,
  projectPath,
  PROJECT,
  initTargetLoopUi,
  useInterestingLoopMode,
  currentLoopGrid,
  stepTargetLoop,
  describeLookGrid,
  computePathColours,
} from "@neo-angband/core";
import type {
  GamePack,
  GameObject,
  PlayerCommand,
  ViewConstants,
  ViewerState,
  VisualsRecord,
  VisualsAnimator,
  Effect,
  EffectRecordJson,
  ItemRequest,
  ItemTargetRef,
  ObjectInfoExtras,
  Loc,
} from "@neo-angband/core";
import { GameEvents } from "@neo-angband/core";
import { loadGamePack, loadVisualsRecord, loadMonsterColorCycles } from "./pack";
import { GlyphTerm } from "./term";
import { resolveKey } from "./keymap";
import { installWebSound } from "./sound";
import { createTileRenderer } from "./tiles";
import { showTextScreen, selectFromMenu, promptText, promptDirection, AIM_STAR } from "./overlay";
import type { MenuItem } from "./overlay";
import { runBirth } from "./birth";
import { MessageLog } from "./messages";
import {
  inventoryLines,
  equipmentLines,
  messageHistoryLines,
  packMenu,
  equipmentMenu,
  magicBooks,
  bookSpellMenu,
  targetMenu,
  objectName,
  wrapRuns,
  qualityIgnoreMenu,
  qualityLevelItems,
  egoIgnoreMenu,
  svalKindMenu,
  svalCategoryItems,
  SVAL_DEPENDENT,
  objectListLines,
} from "./screens";
import { showCharacterSheet } from "./charsheet";
import { runCharacterSelect } from "./charselect";
import {
  listRoster,
  livingRoster,
  getActiveId,
  setActiveId,
  getMeta,
  readSlotSave,
  writeSlot,
  markDead,
  deleteSlot,
  newCharId,
} from "./roster";
import type { CharMeta } from "./roster";
// --- High scores (task #28) ---
import {
  createLocalStorageScoreStore,
  registryNameResolver,
  showPredictedScores,
} from "./score";
import { enterScore } from "@neo-angband/core";
import { runStore } from "./shop";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const term = new GlyphTerm(canvas);

// Original keyset (numpad + arrows) by default; see keymap.ts.
const roguelikeKeys = false;

// Seed and depth are overridable via the URL query so a run is shareable and
// reproducible (unmodded runs are deterministic - PORT_PLAN.md decision 22).
const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed")) || 20260708;
// A new character starts in town (depth 0), faithful to the original, so the
// shops are the first thing you can visit. Overridable via ?depth= (0 is
// honoured explicitly rather than falling through to a dungeon default).
const depthParam = params.get("depth");
const depth = depthParam !== null && depthParam !== "" ? Number(depthParam) : 0;

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

// Legacy single-slot saves (pre-roster) migrate into the roster on first boot
// as one character, then the old key is retired.
function migrateLegacySave(): void {
  if (listRoster().length > 0) return; // already on the roster
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(SAVE_KEY);
  } catch {
    return; // storage disabled / private mode
  }
  if (!legacy) return;
  const id = newCharId();
  const choice = readBirthChoice();
  // Minimal metadata; the first autosave after resume refreshes it to the real
  // level/depth (the character is resumed straight away, so it is never shown
  // stale in the picker).
  writeSlot(id, legacy, {
    id,
    name: choice?.name ?? "",
    race: choice?.raceName ?? "?",
    cls: choice?.className ?? "?",
    sex: choice?.sex ?? "",
    level: 1,
    depth: 0,
    maxDepth: 0,
    turn: 0,
    alive: true,
    updatedAt: Date.now(),
  });
  setActiveId(id);
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

let loadedNote = "";
// True when this load started a fresh character (startGame), not a resume; the
// birth screen keys off this to appear only for a new character.
let bootedNew = false;
// resumedActive: boot resumed the active roster character (a plain refresh
// continues it). needsSelect: nothing to auto-resume but other characters are
// saved, so the select screen is shown over a throwaway game.
let resumedActive = false;
let needsSelect = false;
const birthChoice = readBirthChoice();
function bootGame(): ReturnType<typeof startGame> {
  // Start fresh only when explicitly asked: `?new`, an explicit `?seed=` (a
  // request for a specific reproducible run), or the in-game New Character
  // action. Otherwise resume the active character so a refresh continues it.
  let forcedNew = params.has("new") || params.has("seed");
  try {
    if (sessionStorage.getItem(FORCE_NEW_KEY) === "1") forcedNew = true;
    sessionStorage.removeItem(FORCE_NEW_KEY);
  } catch {
    /* sessionStorage unavailable: fall through to the query-param decision. */
  }
  migrateLegacySave();
  if (!forcedNew) {
    const activeId = getActiveId();
    const stored = activeId ? readSlotSave(activeId) : null;
    if (stored) {
      try {
        const decoded = decodeSavedGame(b64ToBytes(stored));
        if (decoded.save) {
          loadedNote = decoded.verified
            ? "Welcome back. Your game was restored."
            : "Welcome back. (WARNING: save integrity check failed.)";
          resumedActive = true;
          return loadGame(pack, decoded.save);
        }
      } catch {
        loadedNote = "Could not read the save; starting a new game.";
      }
    }
    // Nothing to auto-resume: if other characters are saved, the select screen
    // (bootMenus) picks one; the game started here is a throwaway shown behind
    // it and must NOT claim a slot, so no active id is set in that case.
    if (livingRoster().length > 0) needsSelect = true;
  }
  bootedNew = true;
  // A genuine new character (forcedNew, or an empty roster with nothing to
  // pick) gets an active slot now so its autosaves land.
  if (!needsSelect && !getActiveId()) setActiveId(newCharId());
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
// A birth is pending when this load started fresh but the character has not
// been chosen yet (the birth screen is about to show). The game running behind
// it is a throwaway default; saving it would poison the new slot (its bytes and
// its name) with the previous character, so all saving is suppressed until the
// choice is made and the reload comes back with BIRTH_DONE.
const birthPending = ((): boolean => {
  if (!bootedNew) return false;
  try {
    return sessionStorage.getItem(BIRTH_DONE_KEY) !== "1";
  } catch {
    return true;
  }
})();
// The character name (cosmetic: character sheet, high-score row). It is NOT in
// the core save - it lives per-slot in the roster metadata - so a RESUMED
// character takes its name from its own slot; only a brand-new character (no
// stored name yet) falls back to the birth choice. Deriving it from BIRTH_KEY
// alone would give every character the last-birthed name.
const playerName = ((): string => {
  const id = getActiveId();
  const metaName = id ? getMeta(id)?.name : "";
  return metaName || birthChoice?.name || "";
})();

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

// Keypad direction deltas (1-9), for resolving a walk's destination grid.
const DIR_DX = [0, -1, 0, 1, -1, 0, 1, -1, 0, 1];
const DIR_DY = [0, 1, 1, 1, 0, 0, 0, -1, -1, -1];

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

// --- Item-target effect chooser (cmd_get_item "tgtitem") --------------------
// Effects like Enchant / Recharge / Remove Curse / Identify pick a SECOND item
// to act on. The core exposes the request (itemTargetRequest, an RNG-free probe
// over the built effect chain); this shell pre-resolves the target with an async
// lettered menu BEFORE the command runs, so the effect executes exactly once
// (faithful RNG order) and the getItem seam just reads the preset. On ESC the
// pick is cancelled and the carrier is not consumed (the upstream cancel path).

/** True when the player has identified this object kind's flavour. */
function objectIsAware(obj: GameObject): boolean {
  return game.flavor ? game.flavor.isAware(obj.kind) : true;
}

/** Resolve an ItemTargetRef back to the live object (pack/equip handle or floor pile). */
function targetRefObject(ref: ItemTargetRef): GameObject | null {
  if ("handle" in ref) return gearGet(state.gear, ref.handle);
  return floorPile(state, state.actor.grid)[ref.floor] ?? null;
}

/**
 * An async lettered picker over the sources req.mode allows (inventory, worn
 * equipment, the floor pile under the player), each filtered by req.tester.
 * The quiver rides the pack in this gear model, so USE_QUIVER is covered by the
 * inventory pass. Returns the chosen ref, or null on ESC / an empty menu.
 */
async function selectTargetItem(req: ItemRequest): Promise<ItemTargetRef | null> {
  const items: MenuItem[] = [];
  const refs: ItemTargetRef[] = [];
  if (req.mode.inven || req.mode.quiver) {
    const { items: packItems, handles } = packMenu(state, req.tester);
    packItems.forEach((it, i) => {
      items.push(it);
      refs.push({ handle: handles[i]! });
    });
  }
  if (req.mode.equip) {
    const player = state.actor.player;
    for (let i = 0; i < player.body.count; i++) {
      const handle = player.equipment[i] ?? 0;
      if (!handle) continue;
      const obj = gearGet(state.gear, handle);
      if (!obj || !req.tester(obj)) continue;
      items.push({ label: objectName(state, obj), color: "#c8c8d4" });
      refs.push({ handle });
    }
  }
  if (req.mode.floor) {
    floorPile(state, state.actor.grid).forEach((obj, i) => {
      if (!req.tester(obj)) return;
      items.push({ label: `${objectName(state, obj)} (on floor)`, color: "#c8c8d4" });
      refs.push({ floor: i });
    });
  }
  if (items.length === 0) {
    say(req.reject);
    return null;
  }
  const idx = await selectFromMenu(term, req.prompt.trim(), items);
  if (idx === null) return null;
  return refs[idx] ?? null;
}

/** The registry data the object-info engine needs; stable for the session. */
const inspectExtras: ObjectInfoExtras = {
  projections: booted.registries.projections ?? [],
  constants: booted.registries.constants,
  timedDesc: (i) => players.timed[i]?.desc ?? "",
  raceOrigin: (h) => {
    const r = booted.registries.monsters.races[h];
    if (!r) return null;
    return {
      name: r.name,
      unique: r.flags.has(RF.UNIQUE),
      comma: r.flags.has(RF.NAME_COMMA),
    };
  },
};

/**
 * Inspect command ('I', textui_obj_examine): pick any inven / equip / floor
 * item, then show its combat / abilities / origin info in the scrollable
 * viewer. object_info is a pure read (no RNG), so this never advances the game.
 */
async function inspectItem(): Promise<void> {
  const ref = await selectTargetItem({
    prompt: "Inspect which item? ",
    reject: "You have nothing to examine.",
    tester: () => true,
    mode: { equip: true, inven: true, quiver: true, floor: true },
  });
  if (!ref) return;
  const obj = targetRefObject(ref);
  if (!obj) return;
  const name = objectName(state, obj);
  const header = name.charAt(0).toUpperCase() + name.slice(1); /* ODESC_CAPITAL */
  const tb = objectInfoTextblock(state, obj, inspectExtras);
  await showTextScreen(term, header, wrapRuns(tb, term.size().cols));
}

/** The removable-curse indices of an object (item_tester_uncursable membership). */
function removableCurses(obj: GameObject): number[] {
  const out: number[] = [];
  obj.curses?.forEach((c, i) => {
    if (i > 0 && c.power > 0 && c.power < 100) out.push(i);
  });
  return out;
}

/** get_curse: pick which removable curse to lift; null on ESC. */
async function selectCurse(removable: number[]): Promise<number | null> {
  const curseTable = booted.registries.objects.curses;
  const items: MenuItem[] = removable.map((i) => ({
    label: curseTable[i]?.name ?? `curse ${i}`,
  }));
  const idx = await selectFromMenu(term, "Remove which curse?", items);
  if (idx === null) return null;
  return removable[idx] ?? null;
}

/**
 * Pre-resolve the item-target effect of a chain, if any. Returns:
 *  - "none": the chain has no item-choosing effect; queue the command normally.
 *  - "cancel": the player aborted the item / curse picker.
 *  - args: the extra command args (tgtitem, optionally tgtcurse) to merge.
 */
async function prepareItemTarget(
  chain: Effect | null,
): Promise<"none" | "cancel" | { tgtitem: ItemTargetRef; tgtcurse?: number }> {
  const req = itemTargetRequest(chain, state);
  if (!req) return "none";
  const ref = await selectTargetItem(req);
  if (!ref) return "cancel";
  if (req.curses) {
    const obj = targetRefObject(ref);
    const removable = obj ? removableCurses(obj) : [];
    if (removable.length > 1) {
      const pick = await selectCurse(removable);
      if (pick === null) return "cancel";
      return { tgtitem: ref, tgtcurse: pick };
    }
  }
  return { tgtitem: ref };
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
  if (obj && !(await applyItemTarget(obj, args))) return;
  say(actionLine(code, obj));
  commandBuffer.push({ code, args });
  advance();
}

/**
 * Resolve an object's item-target effect (Enchant / Recharge / ... ) into the
 * command args before it is queued. Returns whether the command should be
 * queued. On a cancelled picker the command is queued ONLY for an unaware
 * consumable (upstream still runs it: the flavour is learned and the turn is
 * spent, but nothing is consumed); an aware carrier aborts with no turn, so we
 * return false and the caller drops the command.
 */
async function applyItemTarget(
  obj: GameObject,
  args: Record<string, unknown>,
): Promise<boolean> {
  const chain = buildObjectEffectChain(
    (obj.effect ?? []) as EffectRecordJson[],
    state,
  );
  const prep = await prepareItemTarget(chain);
  if (prep === "none") return true;
  if (prep === "cancel") return !objectIsAware(obj);
  Object.assign(args, prep);
  return true;
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
  if (obj && !(await applyItemTarget(obj, args))) return;
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

// --- Inscribe / uninscribe / refuel (cmd-obj.c do_cmd_inscribe /
// do_cmd_uninscribe / do_cmd_refill) ------------------------------------
// All three route through selectTargetItem's aggregated pack+equip+floor
// picker (USE_EQUIP|USE_INVEN|USE_QUIVER|USE_FLOOR upstream); the quiver
// rides the pack in this gear model. Autoinscribe has no default key
// upstream ships it only from the knowledge menu, whose per-kind registry
// (#24) doesn't exist yet - so it stays a core-only no-op with no shell
// entry until that lands.

/** Inscribe (`{`): pick any item and set its inscription text. */
async function inscribeItem(): Promise<void> {
  const ref = await selectTargetItem({
    prompt: "Inscribe which item? ",
    reject: "You have nothing to inscribe.",
    tester: () => true,
    mode: { equip: true, inven: true, quiver: true, floor: true },
  });
  if (!ref) return;
  const obj = targetRefObject(ref);
  if (!obj) return;
  const text = await promptText(
    term,
    `Inscribing ${objectName(state, obj)}.`,
    obj.note ?? "",
    40,
    "[ type an inscription, Enter to accept, ESC to cancel ]",
  );
  if (text === null) return;
  commandBuffer.push({ code: "inscribe", args: { ...ref, inscription: text } });
  advance();
}

/** Uninscribe (`}`): pick from items that currently carry an inscription. */
async function uninscribeItem(): Promise<void> {
  const ref = await selectTargetItem({
    prompt: "Uninscribe which item? ",
    reject: "You have nothing you can uninscribe.",
    tester: (o) => objHasInscrip(o),
    mode: { equip: true, inven: true, quiver: true, floor: true },
  });
  if (!ref) return;
  commandBuffer.push({ code: "uninscribe", args: { ...ref } });
  advance();
}

/**
 * Refuel (`F`): faithfully guard on the worn light before opening the fuel
 * picker (do_cmd_refill's own "not wielding a light" / "cannot be
 * refilled" messages, no turn spent on either), then choose a flask of oil
 * or a spare lantern (obj_can_refill).
 */
async function refuelItem(): Promise<void> {
  const player = state.actor.player;
  const lightSlot = player.body.slots.findIndex((s) => s.type === "LIGHT");
  const light =
    lightSlot >= 0 ? gearGet(state.gear, player.equipment[lightSlot] ?? 0) : null;
  if (!light || !tvalIsLight(light.tval)) {
    say("You are not wielding a light.");
    return;
  }
  if (light.flags.has(OF.NO_FUEL) || !light.flags.has(OF.TAKES_FUEL)) {
    say("Your light cannot be refilled.");
    return;
  }
  const ref = await selectTargetItem({
    prompt: "Refuel with with fuel source? ",
    reject: "You have nothing you can refuel with.",
    tester: (o) => objCanRefill(state, o),
    mode: { inven: true, quiver: true, floor: true },
  });
  if (!ref) return;
  commandBuffer.push({ code: "refill", args: { ...ref } });
  advance();
}

// --- Ignore configuration ('=') and ignore_drop (obj-ignore.c / ui-options.c) --
// The faithful quality / ego / sval ignore-setup screens (do_cmd_options_item),
// reached directly from '=' rather than through a full options screen (none
// exists yet - see the gap's shellUX note). Editing any setting marks
// ignoreConfigChanged so ESC-ing out of the top-level menu runs the
// ignore_drop pass (notice_stuff's PN_IGNORE -> ignore_drop, player-calcs.c
// L2542); the 'K' unignoring toggle sets PN_IGNORE too, so it runs the same
// pass on every press (a no-op when nothing is currently ignored).
let ignoreConfigChanged = false;

/** get_check: a plain Yes/No confirmation; ESC counts as "No". */
async function confirmYesNo(title: string): Promise<boolean> {
  const idx = await selectFromMenu(
    term,
    title,
    [{ label: "Yes" }, { label: "No" }],
    "[ a-z to choose, ESC = No ]",
  );
  return idx === 0;
}

/**
 * ignore_drop (obj-ignore.c L651): drop every gear item now eligible for
 * ignoring. An equipped item is confirmed first (verify_object); declining
 * inscribes "!d" on it (the upstream Hack to stop the same confirmation
 * firing again) instead of dropping it. Naturally skips while a store or any
 * other modal owns the keyboard, since '=' and 'K' are only reachable with
 * no modal open - the faithful stand-in for upstream's square_isshop guard.
 */
async function applyIgnoreDrop(): Promise<void> {
  let dropped = false;
  for (const target of ignoreDropTargets(state)) {
    const obj = gearGet(state.gear, target.handle);
    if (!obj) continue;
    if (target.equipped) {
      const name = objectName(state, obj);
      const yes = await confirmYesNo(`Really take off and drop ${name}?`);
      if (!yes) {
        obj.note = obj.note ? `${obj.note}!d` : "!d";
        continue;
      }
    }
    say(actionLine("drop", obj));
    commandBuffer.push({
      code: "drop",
      args: { handle: target.handle, quantity: target.number },
    });
    dropped = true;
  }
  if (dropped) advance();
}

/** quality_action's tier submenu (ui-options.c L1584-1625): pick a tier. */
async function openQualityLevelMenu(itype: number): Promise<void> {
  const items = qualityLevelItems(itype);
  const idx = await selectFromMenu(term, "Quality ignore menu", items);
  if (idx === null) return;
  state.ignore.level[itype] = idx;
  ignoreConfigChanged = true;
}

/** quality_menu (ui-options.c L1630): the 26 ignore-type rows. */
async function openQualityMenu(): Promise<void> {
  for (;;) {
    const { items, itypes } = qualityIgnoreMenu(state.ignore);
    const idx = await selectFromMenu(term, "Quality ignore menu", items);
    if (idx === null) return;
    const itype = itypes[idx];
    if (itype !== undefined) await openQualityLevelMenu(itype);
  }
}

/** ego_menu (ui-options.c L1405): the ego x ignore-type toggle list. */
async function openEgoMenu(): Promise<void> {
  for (;;) {
    const { items, choices } = egoIgnoreMenu(
      booted.registries.objects.egos,
      booted.registries.objects.kinds,
      state.ignore,
    );
    if (items.length === 0) {
      say("No known ego items to configure.");
      return;
    }
    const idx = await selectFromMenu(term, "Ego item ignore menu", items);
    if (idx === null) return;
    const choice = choices[idx];
    if (!choice) continue;
    state.ignore.egoToggle(choice.eidx, choice.itype);
    ignoreConfigChanged = true;
  }
}

/** sval_menu (ui-options.c L1823): the aware/unaware kind toggles for a tval. */
async function openSvalKindMenu(tval: number, desc: string): Promise<void> {
  for (;;) {
    const { items, rows } = svalKindMenu(
      booted.registries.objects,
      tval,
      state.ignore,
      state,
    );
    if (items.length === 0) return;
    const idx = await selectFromMenu(
      term,
      `Ignore the following ${desc}:`,
      items,
      "[ a-z toggle, ESC to go back ]",
    );
    if (idx === null) return;
    const row = rows[idx];
    if (!row) continue;
    if (row.aware) state.ignore.kindToggleAware(row.kidx);
    else state.ignore.kindToggleUnaware(row.kidx);
    ignoreConfigChanged = true;
  }
}

/**
 * do_cmd_options_item (ui-options.c L2009): titled "Item ignoring setup" (the
 * upstream options-menu row's own label). Quality and Ego lead here (there is
 * no full options screen to host them as trailing "extra options" yet); every
 * eligible sval category (ignore_tval) follows. ESC exits the whole flow and,
 * if anything changed, runs the ignore_drop pass.
 */
async function openIgnoreSetup(): Promise<void> {
  ignoreConfigChanged = false;
  for (;;) {
    const { items: catItems, tvals } = svalCategoryItems(booted.registries.objects);
    const items: MenuItem[] = [
      { label: "Quality ignoring options" },
      { label: "Ego ignoring options" },
      ...catItems,
    ];
    const idx = await selectFromMenu(term, "Item ignoring setup", items);
    if (idx === null) break;
    if (idx === 0) {
      await openQualityMenu();
      continue;
    }
    if (idx === 1) {
      await openEgoMenu();
      continue;
    }
    const tval = tvals[idx - 2];
    if (tval === undefined) continue;
    const desc = SVAL_DEPENDENT.find((d) => d.tval === tval)?.desc ?? "";
    await openSvalKindMenu(tval, desc);
  }
  if (ignoreConfigChanged) await applyIgnoreDrop();
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
  /* Enchant / Identify / Brand / Remove-Curse spells pick a target item. A
   * cancelled picker aborts the whole cast (no mana, no turn - the spell's
   * effect_do returns false before any mana is spent). */
  const spellData = spellByIndex(player.cls, spell);
  if (spellData) {
    const chain = buildObjectEffectChain(
      spellData.effectsRaw as EffectRecordJson[],
      state,
    );
    const prep = await prepareItemTarget(chain);
    if (prep === "cancel") return;
    if (prep !== "none") Object.assign(args, prep);
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

// --- Targeting + look (target_set_interactive, ui-target.c) ----------------
// The faithful interactive browse loop: cycle the interesting-grid list
// (space/+/-), free-move the cursor by direction ('o'), look at whatever
// grid is under the cursor (a monster/trap/object/terrain description on the
// message row), draw the projection path in TARGET_KILL mode, and set a
// monster or location target with 't'/'5'/'0'/'.'. '*' opens it in
// TARGET_KILL (textui_target); 'l'/'x' open it in TARGET_LOOK (do_cmd_look);
// aimDir's AIM_STAR branch opens it in TARGET_KILL and, on success, resolves
// dir 5 (DIR_TARGET) exactly as get_aim_dir does - the seam every aimed
// spell/device/fire/throw already rides. "'" stays target_set_closest.
//
// chooseTarget/targetMenu/lookLines (the prior distance-sorted list picker)
// are kept as a fallback utility, not wired into any key below.

/** target_display_help (ui-target.c), reduced to the commands this port
 * implements: pathfinding ('g'), the ignore key, and nearest-stairs/
 * unexplored ('>'/'<'/'x') are sibling gaps and stay off this banner so it
 * never promises a key that does nothing. */
function targetHelpLines(useFreeMode: boolean): string[] {
  return [
    "Arrows/numpad look around. 'p' selects player. 'q'/Esc exits.",
    useFreeMode
      ? "'m' restricts to interesting places. 't' targets the cursor."
      : "space/'+'/'-' cycle places. 'o' allows free selection. 't' targets the selection.",
  ];
}

/**
 * target_set_interactive: the interactive map-cursor browse loop. Owns the
 * keyboard like promptDirection/selectFromMenu (its own capturing keydown
 * listener) - the caller gates the main handler via openModal. Returns
 * target_is_set() once the loop finishes (selection or cancel).
 */
function runTargetLoop(
  mode: number,
  _allowPathfinding: boolean,
  startX?: number,
  startY?: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const targets = targetGetMonsters(state, mode);
    let ui = initTargetLoopUi(state, startX, startY);

    const paint = (): void => {
      const cur = currentLoopGrid(ui, targets);
      const path = projectPath(
        state.chunk,
        state.z.maxRange,
        state.actor.grid,
        cur,
        PROJECT.THRU | PROJECT.INFO,
      );
      const { text, mon } = describeLookGrid(state, cur, mode);
      // health_track / monster_race_track (aux_monster): re-tracked every
      // frame the cursor sits on an obvious monster, not just on selection.
      if (mon) state.healthWho = mon;
      render({
        cursor: cur,
        path,
        mode,
        desc: text,
        help: ui.help,
        helpLines: targetHelpLines(!useInterestingLoopMode(ui, targets)),
      });
    };

    const finish = (): void => {
      window.removeEventListener("keydown", onKey, true);
      render();
      resolve(targetIsSet(state));
    };

    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const step = stepTargetLoop(state, targets, ui, ev.key);
      ui = step.ui;
      if (step.bell) state.sound?.(MSG.BELL);
      if (step.done) {
        finish();
        return;
      }
      paint();
    };

    window.addEventListener("keydown", onKey, true);
    paint();
  });
}

// --- Targeting + look (target.c; get_aim_dir) -------------------------------
// A monster target lets aimed spells / devices fire at a specific creature
// (DIR_TARGET, keypad 5) instead of a compass direction. chooseTarget lists the
// target-able monsters (target_get_monsters, sorted by distance) and sets the
// pick as state.target; the aim prompt then resolves dir 5 through the engine's
// targetOkay/targetGet, exactly as upstream's cmd_get_target does. '*' opens the
// picker mid-aim, "'" targets the closest, and 'l' looks (read-only).
//
// Kept as a fallback utility (see the note above runTargetLoop); no key below
// wires to it any more.

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

// get_aim_dir: a keypad direction (1-9), or DIR_TARGET (5). '*' opens the
// interactive target loop and, once a monster is chosen, fires at it (dir 5).
// Re-prompts if the player backs out of the loop without choosing.
async function aimDir(): Promise<number | null> {
  for (;;) {
    const d = await promptDirection(term);
    if (d === null) return null;
    if (d === AIM_STAR) {
      const chosen = await runTargetLoop(TARGET.KILL, false);
      render();
      if (chosen) return 5;
      continue;
    }
    return d;
  }
}

// --- Open / disarm (do_cmd_open / do_cmd_disarm, chest branches - gap #49) --
// A direction prompt like aimDir, but without the '*' target-picker path (open
// and disarm are not aimed commands); 5 targets the player's own grid, for a
// chest underfoot. The core resolves door-vs-chest (open) and
// chest-vs-floor-trap (disarm) by what is actually there.

/** Open (o): a door or a chest, by direction. */
async function openCmd(): Promise<void> {
  const dir = await promptDirection(term, "Open in which direction? (5 for here)");
  if (dir === null || dir === AIM_STAR) return;
  commandBuffer.push({ code: "open", dir });
  advance();
}

/** Disarm (D): a trapped chest or a floor trap, by direction. */
async function disarmCmd(): Promise<void> {
  const dir = await promptDirection(term, "Disarm in which direction? (5 for here)");
  if (dir === null || dir === AIM_STAR) return;
  commandBuffer.push({ code: "disarm", dir });
  advance();
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

/** The roster metadata for the current character, drawn from the live game. */
function metaFromState(id: string): CharMeta {
  const p = state.actor.player;
  return {
    id,
    name: playerName || "",
    race: p.race.name,
    cls: p.cls.name,
    sex: birthChoice?.sex ?? "",
    level: p.lev,
    depth: state.chunk.depth,
    maxDepth: p.maxDepth,
    turn: state.turn,
    alive: !state.isDead,
    updatedAt: Date.now(),
  };
}

// Latched true just before a New-character reload so the OUTGOING page's
// pagehide autosave cannot write the (now throwaway) game into the freshly
// allocated slot - birthPending only guards the incoming page.
let suppressSave = false;

function persistSave(): void {
  if (suppressSave || birthPending) return; // don't let a throwaway claim a slot
  const id = getActiveId();
  if (!id) return; // no active slot (e.g. the picker is up): nothing to save
  try {
    const b64 = bytesToB64(encodeSavedGame(saveGame(game)));
    writeSlot(id, b64, metaFromState(id));
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

/** Start a brand-new character in a fresh roster slot (birth, then play). */
function newGame(): void {
  suppressSave = true; // the outgoing page must not save into the new slot
  setActiveId(newCharId()); // a fresh slot so the new character does not
  // overwrite any existing one
  try {
    sessionStorage.setItem(FORCE_NEW_KEY, "1");
  } catch {
    /* ignore storage errors; the reload below still starts fresh via ?new */
  }
  const url = new URL(location.href);
  url.searchParams.set("new", "1");
  location.assign(url.toString());
}

/** Switch characters: flush the current one, then show the picker on reload. */
function switchCharacter(): void {
  persistSave();
  setActiveId(null); // boot finds no active character -> shows the select screen
  const url = new URL(location.href);
  url.searchParams.delete("new");
  url.searchParams.delete("seed");
  location.assign(url.toString());
}

/**
 * The in-game menu (Escape): the discoverable home for the save/character
 * actions whose keys a new player will not know. Save and switch and new all
 * either stay in play or navigate away, so there is no nested-modal race.
 */
async function openGameMenu(): Promise<void> {
  const pick = await selectFromMenu(
    term,
    "Game menu",
    [
      { label: "Resume play" },
      { label: "Save game" },
      { label: "Ignore setup" },
      { label: "Switch character" },
      { label: "New character" },
    ],
    "[ a-z to choose, ESC to resume ]",
  );
  switch (pick) {
    case 1:
      autosave(true);
      message = "Game saved. It will resume automatically next time.";
      render();
      break;
    case 2:
      await openIgnoreSetup();
      break;
    case 3:
      switchCharacter();
      break;
    case 4:
      persistSave(); // keep the current character in its slot, then birth anew
      newGame();
      break;
    default:
      break; // Resume play / ESC
  }
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
    curLight: state.actor.light,
    blind: (state.actor.player.timed[TMD.BLIND] ?? 0) > 0,
    hasUnlight: state.actor.unlight,
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

// Touch open/disarm: tapping the "Open"/"Disarm" action-bar button arms this,
// so the NEXT canvas tap resolves to a direction for that command instead of
// a walk (open/close cancel it without spending it on an unrelated tap).
let pendingChestAction: "open" | "disarm" | null = null;

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
  return { timedEffects: players.timed, unignoring: state.ignore.unignoring };
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
function viewport(focus?: Loc): {
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
  const center = focus ?? state.actor.grid;
  const camX = center.x - Math.floor(mapCols / 2);
  const camY = center.y - Math.floor(mapRows / 2);
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

/**
 * The '*'/'l' interactive loop's overlay: a cursor grid the camera follows,
 * the projected path to it (drawn in TARGET_KILL mode), the current look
 * description (shown on the message row in place of `message`), and the
 * '?' help banner/text (shown on the status row in place of the normal
 * status line).
 */
interface TargetingOverlay {
  cursor: Loc;
  path: Loc[];
  mode: number;
  desc: string;
  help: boolean;
  helpLines: string[];
}

/** The cursor cell's highlight background, so the described grid is obvious. */
const CURSOR_BG = "#3a4a6a";

function render(targeting?: TargetingOverlay): void {
  const { cols, rows } = term.size();
  term.clear();

  const { compact, mapOriginX, mapTop, mapCols, mapRows, camX, camY } =
    viewport(targeting?.cursor);
  const monsterAt = monsterIndex();
  const objectAt = objectIndex();
  const trapAt = trapIndex();

  // draw_path (ui-target.c): the projection path's per-grid colour, only in
  // TARGET_KILL mode. Folded into the same per-cell pass below rather than a
  // separate overlay pass, since the next render() always repaints from
  // scratch (no save/restore of the underlying glyph is needed).
  const pathColourAt = new Map<number, number>();
  if (targeting && targeting.mode & TARGET.KILL) {
    const colours = computePathColours(state, targeting.path);
    targeting.path.forEach((g, i) => {
      const c = colours[i];
      if (c !== undefined) pathColourAt.set(gridIndex(g.x, g.y), c);
    });
  }

  for (let sy = 0; sy < mapRows; sy++) {
    for (let sx = 0; sx < mapCols; sx++) {
      const gx = camX + sx;
      const gy = camY + sy;
      if (gx < 0 || gy < 0 || gx >= state.chunk.width || gy >= state.chunk.height) continue;
      const idx = gridIndex(gx, gy);
      const screenX = mapOriginX + sx;
      const screenY = mapTop + sy;
      const isCursor = !!targeting && gx === targeting.cursor.x && gy === targeting.cursor.y;
      const cursorBg = isCursor ? { bg: CURSOR_BG } : {};
      const pathColour = pathColourAt.get(idx);

      const seen = squareIsSeen(state.chunk, loc(gx, gy));
      if (!seen) {
        /* Remembered terrain from the engine's knowledge layer, drawn
         * dim - possibly stale, exactly as upstream memory works. */
        const kf = knownFeat(state, loc(gx, gy));
        if (kf < 0) {
          if (pathColour !== undefined) {
            term.put(screenX, screenY, { ch: "*", fg: colorToCss(pathColour), ...cursorBg });
          } else if (isCursor) {
            term.put(screenX, screenY, { ch: " ", fg: "#101014", ...cursorBg });
          }
          continue;
        }
        const f = features.get(kf);
        const disp = f.mimic !== null ? features.get(f.mimic) : f;
        term.put(screenX, screenY, {
          ch: disp.dChar,
          fg: dim(colorToCss(colorCharToAttr(disp.dAttr))),
          ...cursorBg,
        });
        /* Remembered / sensed objects persist on the map in full color. */
        const mem = knownObject(state, loc(gx, gy));
        if (mem) {
          term.put(
            screenX,
            screenY,
            mem.ch === null
              ? { ch: "*", fg: "#8a8a94", ...cursorBg }
              : { ch: mem.ch, fg: colorToCss(colorCharToAttr(mem.attr)), ...cursorBg },
          );
        }
        /* Detected monsters show even out of view - that is the point. */
        const marked = monsterAt.get(idx);
        if (marked) term.put(screenX, screenY, { ch: marked.ch, fg: marked.css, ...cursorBg });
        if (pathColour !== undefined) {
          term.put(screenX, screenY, { ch: "*", fg: colorToCss(pathColour), ...cursorBg });
        }
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
      if (pathColour !== undefined) drawn = { ch: "*", css: colorToCss(pathColour) };
      term.put(screenX, screenY, { ch: drawn.ch, fg: drawn.css, ...cursorBg });
    }
  }

  // The player: centered and bright when the camera follows the player;
  // repositioned to its own grid (which may be off-center) while targeting.
  const playerScreenX = mapOriginX + (state.actor.grid.x - camX);
  const playerScreenY = mapTop + (state.actor.grid.y - camY);
  const playerIsCursor =
    !!targeting &&
    state.actor.grid.x === targeting.cursor.x &&
    state.actor.grid.y === targeting.cursor.y;
  term.put(playerScreenX, playerScreenY, {
    ch: "@",
    fg: "#e8e8f0",
    ...(playerIsCursor ? { bg: CURSOR_BG } : {}),
  });

  if (compact) renderCompactVitals(1, cols);
  else renderSidebar(rows);

  if (targeting) {
    // The look description takes the message row; the bottom status row
    // becomes the help prompt/text, exactly as target_set_interactive owns
    // both while it runs.
    term.print(mapOriginX, 0, targeting.desc.slice(0, mapCols - 1), "#e0c040");
    if (targeting.help) {
      const n = targeting.helpLines.length;
      targeting.helpLines.forEach((line, i) => {
        term.print(mapOriginX, rows - n + i, line.slice(0, mapCols - 1), "#c8c8d4");
      });
    } else {
      term.print(mapOriginX, rows - 1, "Press '?' for help.".slice(0, mapCols - 1), "#8a8a94");
    }
  } else {
    term.print(mapOriginX, 0, message.slice(0, mapCols - 1), "#c8c8d4");
    renderStatusLine(mapOriginX, rows - 1, mapCols);
  }
}

/** Advance the engine after queuing input, then repaint. */
function advance(): void {
  const status = runGameLoop(state, registry);
  if (status === LOOP_STATUS.DEAD) {
    dead = true;
    // Death is terminal (decision 16): the character's slot becomes a
    // tombstone - its save bytes are dropped so it can never be resumed, but
    // its record stays in the roster for the memorial. Clearing the active id
    // sends the next boot to the picker (or birth if no one else is left).
    const activeId = getActiveId();
    if (activeId) markDead(activeId);
    setActiveId(null);
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
    // New character. With the roster this is non-destructive: the current
    // character is flushed to its own slot first, so it stays playable via the
    // select screen; no "you will lose your character" prompt is needed.
    ev.preventDefault();
    if (!dead) persistSave();
    newGame();
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
    if (ev.key === "]") {
      ev.preventDefault();
      void openModal(() =>
        showTextScreen(term, "Objects in view", objectListLines(state)),
      );
      return;
    }
    if (ev.key === "C") {
      ev.preventDefault();
      void openModal(() =>
        showCharacterSheet(term, state, playerName, {
          numShots: state.actor.combat.numShots,
        }),
      );
      return;
    }
    if (ev.key === "I") {
      ev.preventDefault();
      void openModal(() => inspectItem());
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
      "{": () => inscribeItem(),
      "}": () => uninscribeItem(),
      F: () => refuelItem(),
      m: () => castSpell(),
      p: () => castSpell(),
      G: () => studySpell(),
      // textui_target: the interactive '*' loop in TARGET_KILL mode.
      "*": async () => {
        if (await runTargetLoop(TARGET.KILL, true)) say("Target Selected.");
        else say("Target Aborted.");
      },
      // do_cmd_look: the same loop in TARGET_LOOK mode (read-only browse
      // that can still 't'-target); only messages on a successful pick.
      l: async () => {
        if (await runTargetLoop(TARGET.LOOK, true)) say("Target Selected.");
      },
      x: async () => {
        if (await runTargetLoop(TARGET.LOOK, true)) say("Target Selected.");
      },
      f: () => fireCmd(),
      v: () => throwCmd(),
      o: () => openCmd(),
      D: () => disarmCmd(),
      "=": () => openIgnoreSetup(),
    };
    const verb = ITEM_VERBS[ev.key];
    if (verb) {
      ev.preventDefault();
      void openModal(verb);
      return;
    }
    // Toggle ignoring off (K, textui_cmd_toggle_ignore): a free action, then
    // the same ignore_drop pass PN_IGNORE would trigger upstream (a no-op
    // re-enabling ignoring surfaces nothing new to drop; disabling it while
    // gear is already flagged ignored has nothing to do either way).
    if (ev.key === "K") {
      ev.preventDefault();
      state.ignore.unignoring = !state.ignore.unignoring;
      void openModal(() => applyIgnoreDrop());
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
    if (ev.key === "Escape") {
      // The game menu: the discoverable home for save / switch / new character
      // (so a player who does not know the keys is never stuck).
      ev.preventDefault();
      void openModal(openGameMenu);
      return;
    }
  }
  const binding = resolveKey(ev, roguelikeKeys);
  if (!binding) return;
  ev.preventDefault();
  // Walking into a store entrance enters the shop (do_cmd_store) rather than
  // moving - the town's shops are non-passable store-feature tiles.
  if (binding.kind === "walk") {
    const dx = DIR_DX[binding.dir] ?? 0;
    const dy = DIR_DY[binding.dir] ?? 0;
    const dest = loc(state.actor.grid.x + dx, state.actor.grid.y + dy);
    const store = state.stores?.find((s) => s.feat === state.chunk.feat(dest));
    if (store) {
      void openModal(() => runStore(term, game, store, say));
      return;
    }
  }
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
  if (dx === 0 && dy === 0) {
    // Tapped the player's own tile: no move, but a pending open/disarm
    // resolves to dir 5 (a chest underfoot).
    if (pendingChestAction) {
      ev.preventDefault();
      commandBuffer.push({ code: pendingChestAction, dir: 5 });
      pendingChestAction = null;
      advance();
    }
    return;
  }
  ev.preventDefault();
  // Keypad direction: 7 8 9 / 4 5 6 / 1 2 3, so dir = (1-dy)*3 + (dx+2).
  const dir = (1 - dy) * 3 + (dx + 2);
  if (pendingChestAction) {
    commandBuffer.push({ code: pendingChestAction, dir });
    pendingChestAction = null;
  } else {
    commandBuffer.push({ code: "walk", dir });
  }
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
    ["Open", () => {
      pendingChestAction = "open";
      message = "Tap a direction (or yourself) to open.";
      render();
    }],
    ["Disarm", () => {
      pendingChestAction = "disarm";
      message = "Tap a direction (or yourself) to disarm.";
      render();
    }],
    ["Inv", () => { void openModal(() => showTextScreen(term, "Inventory", inventoryLines(state))); }],
    ["Objs", () => { void openModal(() => showTextScreen(term, "Objects in view", objectListLines(state))); }],
    ["Insp", () => { void openModal(() => inspectItem()); }],
    ["Insc", () => { void openModal(() => inscribeItem()); }],
    ["Fuel", () => { void openModal(() => refuelItem()); }],
    ["Char", () => { void openModal(() => showCharacterSheet(term, state, playerName, { numShots: state.actor.combat.numShots })); }],
    ["Ignore", () => { void openModal(() => openIgnoreSetup()); }],
    ["Save", () => { autosave(true); message = "Game saved."; render(); }],
    ["Switch", () => { switchCharacter(); }],
    ["New", () => { if (!dead) persistSave(); newGame(); }],
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
// The core SoundEngine subscribes to the "sound" event and plays a sample from
// the pack. The Dubtrain pack (CC-BY 4.0) ships in public/sounds/ as the
// default, so combat, spells, deaths and ranged attacks play out of the box;
// override it with `?sounds=<base-url>`. Selection uses the game RNG so it is
// deterministic. The live turn loop routes sound() through this bus (state.sound).
const soundEvents = new GameEvents();
// Default to the bundled Dubtrain pack (public/sounds/, CC-BY 4.0) so sound
// plays out of the box; a user/mod can override the pack with ?sounds=<url>.
const soundBase = params.get("sounds") ?? "sounds/";
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

/** Reload to resume the chosen character (clears the fresh-start params). */
function resumeSelected(id: string): void {
  setActiveId(id);
  const url = new URL(location.href);
  url.searchParams.delete("new");
  url.searchParams.delete("seed");
  location.assign(url.toString());
}

// Boot-time flow: a resumed character plays immediately; otherwise pick from
// the roster (when other characters are saved) or birth a brand-new one.
async function bootMenus(): Promise<void> {
  if (resumedActive) return;
  if (needsSelect) {
    await openModal(async () => {
      for (;;) {
        const res = await runCharacterSelect(term, listRoster());
        if (res.action === "delete") {
          deleteSlot(res.id);
          if (livingRoster().length === 0) return newGame();
          continue;
        }
        if (res.action === "resume") return resumeSelected(res.id);
        return newGame();
      }
    });
    return;
  }
  await maybeBirth();
}
void bootMenus();

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
