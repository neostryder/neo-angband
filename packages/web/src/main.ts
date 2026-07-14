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
 * rest of the viewport at any size. A new game opens the staged birth screen
 * (quickstart / race / class / roller / name / confirm, ui-birth.c order);
 * resuming a save goes straight back into play.
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
  invenCarryNum,
  buildObjectEffectChain,
  itemTargetRequest,
  spellByIndex,
  objNeedsAim,
  playerKnowsCurse,
  removeCurseDiceString,
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
  historyUnmaskUnknown,
  playerAbilities,
  chestCheck,
  CHEST_QUERY,
  isLockedChest,
  squareIsOpenDoor,
  squareIsDiggable,
  TF,
  COLOUR_VIOLET,
  COLOUR_WHITE,
  COLOUR_YELLOW,
  COLOUR_ORANGE,
  COLOUR_L_RED,
  COLOUR_RED,
  getLore,
  chanceOfMeleeHitBase,
  getHitChance,
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
  Monster,
  MonsterRace,
  MonsterLore,
  LoreDeps,
} from "@neo-angband/core";
import { GameEvents } from "@neo-angband/core";
import { installController, ContentIdResolver } from "@neo-angband/core";
import type { AgentController } from "@neo-angband/core";
import { CapabilitySet } from "@neo-angband/mod-sdk";
import { loadGamePack, loadVisualsRecord, loadMonsterColorCycles, loadUiEntryPacks } from "./pack";
import { DEMO_AGENTS } from "./agents/demo";
import { showAbilities } from "./abilities";
import { showEquipCmp } from "./equip-cmp";
import {
  buildCaveMenu,
  buildObjectMenu,
  buildPlayerMenu,
  buildPlayerOtherMenu,
  routeContextClick,
} from "./context-menu";
import type { CaveMenuCtx, MenuEntry, ObjectMenuCtx, PlayerMenuCtx } from "./context-menu";
import { GlyphTerm } from "./term";
import { resolveKey } from "./keymap";
import { installWebSound } from "./sound";
import { createTileRenderer } from "./tiles";
import {
  showTextScreen,
  selectFromMenu,
  promptText,
  promptDirection,
  AIM_STAR,
  showLevelMap,
} from "./overlay";
import type { MenuItem, ScreenLine } from "./overlay";
import { buildOverview, panLocate, locateSectorBanner } from "./mapview";
import type { Overview } from "./mapview";
import { runBirth } from "./birth";
import {
  gameMenuEntries,
  deathMenuEntries,
  GAME_MENU_FOOTER,
  DEATH_MENU_FOOTER,
} from "./game-menu";
import { MessageLog } from "./messages";
import {
  inventoryLines,
  equipmentLines,
  messageHistoryLines,
  historyLines,
  packMenu,
  equipmentMenu,
  magicBooks,
  bookSpellMenu,
  spellBrowseLines,
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
  monsterRecallLines,
  monsterKnowledgeMenu,
  capRaceName,
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
import { runHelp } from "./help";
import { runOptionsMenu } from "./options";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const term = new GlyphTerm(canvas);

// Original keyset (numpad + arrows) by default, or the roguelike keyset when
// the player toggles "rogue_like_commands" on ('=' -> User interface options)
// - read live at the resolveKey() call site below so a toggle takes effect on
// the very next keypress, exactly like upstream's OPT(player,
// rogue_like_commands) check. See keymap.ts.

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
// The chosen character identity (birth): race/class drive startGame; the name
// (and the roller record) are cosmetic. Persisted so a birthed character survives the reload that
// rebuilds the game as that race/class, and so the next New Game reuses it as
// defaults. A sessionStorage flag marks "birth already done this load" so the
// post-birth reload does not reopen the birth screen.
const BIRTH_KEY = "neo-angband-birth";
const BIRTH_DONE_KEY = "neo-angband-birth-done";
interface StoredBirth {
  raceName: string;
  className: string;
  name: string;
  /** Legacy field from the removed (non-upstream) sex birth stage; still read
   * from older stored choices so their metadata keeps rendering. */
  sex?: string;
  /** The chosen stat roller ("point" / "roller", ui-birth.c BIRTH_ROLLER_CHOICE);
   * absent in choices stored before the staged birth flow. */
  roller?: string;
  /**
   * The character's birth stats (STAT_MAX values): the point-based allocation
   * for a point-buy character, and - refreshed after every birth from the born
   * player's stat_birth - the save_roller_data snapshot that lets the next New
   * Game's Quick-start restore this character's stats (load_roller_data)
   * instead of regenerating them.
   */
  stats?: number[];
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
    // A stored stat array (a point-buy allocation, or the save_roller_data
    // snapshot persisted after birth) is applied via the point-based path, so
    // the character is rebuilt with exactly those stats and no stat RNG is
    // drawn. Absent it, the classic roller runs (unchanged).
    ...(birthChoice?.stats && birthChoice.stats.length === 5
      ? { roller: "point" as const, birthStats: birthChoice.stats }
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
// alone would give every character the last-birthed name. Mutable because the
// character sheet's 'c' (do_cmd_change_name) renames in place.
let playerName = ((): string => {
  const id = getActiveId();
  const metaName = id ? getMeta(id)?.name : "";
  return metaName || birthChoice?.name || "";
})();

// save_roller_data (player-birth.c): once a fresh character is actually born
// (not a throwaway shown behind the picker, and not a resume), snapshot its
// birth stats back into the stored choice so the next New Game's Quick-start
// can restore this exact character (race, class, and stats) via load_roller_data
// rather than regenerating. Refreshed for both roller methods, so even a classic
// roll becomes reproducible on the following quickstart.
if (bootedNew && !birthPending && !needsSelect) {
  try {
    const p = state.actor.player;
    const prev = readBirthChoice();
    const record: StoredBirth = {
      raceName: prev?.raceName ?? p.race.name,
      className: prev?.className ?? p.cls.name,
      name: prev?.name ?? "",
      stats: p.statBirth.slice(0, 5),
      ...(prev?.roller ? { roller: prev.roller } : {}),
    };
    localStorage.setItem(BIRTH_KEY, JSON.stringify(record));
  } catch {
    /* storage disabled: quickstart simply falls back to regeneration */
  }
}

/** do_cmd_change_name's rename side effect: the new name flows into the
 * roster metadata via the next save (metaFromState reads playerName). */
function renamePlayer(n: string): void {
  playerName = n;
  persistSave();
}

/**
 * The live deps for the character sheet: the real num_shots and the equipped
 * launcher (get_panel_combat reads both; the "BOW" slot type matches
 * calc_bonuses' own launcher pick in player/calcs.ts), plus the rename hook.
 * NOTE: the EB column still reads the calc's stat_add, which only carries
 * KNOWN-rune modifiers (full equipment stat_add is a deferred core slice), so
 * unlearned gear shows +0 there - real data, not a display bug.
 */
function charSheetOpts(): {
  numShots: number;
  launcher: GameObject | null;
  onRename: (n: string) => void;
} {
  const p = state.actor.player;
  const bowSlot = p.body.slots.findIndex((s) => s.type === "BOW");
  const launcher = bowSlot >= 0 ? gearGet(state.gear, p.equipment[bowSlot] ?? 0) : null;
  return { numShots: state.actor.combat.numShots, launcher, onRename: renamePlayer };
}

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

/** ui_entry* pack records (game/ui-entry.ts's buildUiEntryConfig input),
 * loaded once for the equip-cmp screen (equipCmpSummary memoises the built
 * UiEntryConfig itself, keyed on this same object). */
const uiEntryPacks = loadUiEntryPacks();

/** Deps showEquipCmp needs: the ui_entry packs plus the same object-info
 * extras the Inspect command uses (item comparison textblocks). */
function equipCmpDeps(): { packs: typeof uiEntryPacks; inspectExtras: ObjectInfoExtras } {
  return { packs: uiEntryPacks, inspectExtras };
}

// --- Context menus (ui-context.c) -------------------------------------------
// The right-click / long-press per-grid and per-item action menus. Entry
// construction is pure (context-menu.ts); this section only gathers the live
// game-state flags those builders need and dispatches the chosen action to
// the SAME handlers the keyboard verbs use - no command is reimplemented
// here. See context-menu.ts's header for which upstream entries are included
// disabled (no backing shell feature yet) versus omitted outright.

/** MenuEntry -> MenuItem, omitting `disabled` rather than setting it undefined
 * (exactOptionalPropertyTypes). */
function toMenuItems<A extends string>(entries: readonly MenuEntry<A>[]): MenuItem[] {
  return entries.map((e) => (e.disabled ? { label: e.label, disabled: true } : { label: e.label }));
}

function contextPlayerCtx(): PlayerMenuCtx {
  const player = state.actor.player;
  const grid = state.actor.grid;
  const floorObj = floorPile(state, grid)[0] ?? null;
  return {
    canCast: player.cls.magic.totalSpells > 0,
    onUpStairs: state.chunk.isUpstairs(grid),
    onDownStairs: state.chunk.isDownstairs(grid),
    hasFloorObject: floorObj !== null,
    canPickup: floorObj !== null,
    centerPlayerOption: false,
  };
}

async function runContextMenuPlayerOther(): Promise<void> {
  const items = buildPlayerOtherMenu();
  const idx = await selectFromMenu(
    term,
    "Other",
    toMenuItems(items),
  );
  if (idx === null) return;
  switch (items[idx]?.action) {
    case "messages":
      await showTextScreen(term, "Message history", messageHistoryLines(msglog));
      break;
    case "objects":
      await showTextScreen(term, "Objects in view", objectListLines(state));
      break;
    case "ignore-setup":
      await openIgnoreSetup();
      break;
    case "help":
      await runHelp(term);
      break;
    case "abilities":
      await showAbilities(
        term,
        playerAbilities(state, {
          properties: players.properties,
          elementNames: (booted.registries.projections ?? [])
            .slice(0, state.actor.player.race.elInfo.length)
            .map((p) => p.name),
        }),
      );
      break;
    case "equip-cmp":
      await showEquipCmp(term, state, equipCmpDeps());
      break;
    default:
      break;
  }
}

/** context_menu_player (right-click / long-press the player's own tile). */
async function runContextMenuPlayer(): Promise<void> {
  const items = buildPlayerMenu(contextPlayerCtx());
  const idx = await selectFromMenu(
    term,
    "Command for yourself",
    toMenuItems(items),
  );
  if (idx === null) return;
  switch (items[idx]?.action) {
    case "cast":
      await castSpell();
      break;
    case "go-up":
      commandBuffer.push({ code: "ascend" });
      advance();
      break;
    case "go-down":
      commandBuffer.push({ code: "descend" });
      advance();
      break;
    case "explore":
      commandBuffer.push({ code: "explore" });
      advance();
      break;
    case "rest":
      commandBuffer.push({ code: "rest" });
      advance();
      break;
    case "look":
      if (await runTargetLoop(TARGET.LOOK, false, state.actor.grid.x, state.actor.grid.y)) {
        say("Target Selected.");
      }
      break;
    case "inventory":
      await showTextScreen(term, "Inventory", inventoryLines(state));
      break;
    case "floor":
    case "pickup":
      await pickupCmd();
      break;
    case "character":
      await showCharacterSheet(term, state, playerName, charSheetOpts());
      break;
    case "other":
      await runContextMenuPlayerOther();
      break;
    default:
      break;
  }
}

/** square_monster(cave, grid): is there a live monster occupying this grid? */
function monsterAtGrid(grid: Loc): boolean {
  return state.chunk.mon(grid) > 0;
}

function contextCaveCtx(grid: Loc, adjacent: boolean): CaveMenuCtx {
  const player = state.actor.player;
  const chestObj = adjacent ? chestCheck(state, grid, CHEST_QUERY.ANY) : null;
  const trapList = state.traps.get(gridIndex(grid.x, grid.y)) ?? [];
  return {
    adjacent,
    hasMonster: monsterAtGrid(grid),
    canCast: player.cls.magic.totalSpells > 0,
    canFire: state.actor.combat.ammoTval > 0,
    chest: chestObj ? { locked: isLockedChest(chestObj) } : null,
    isDisarmableTrap: trapList.some((t) => t.flags.has(TRF.VISIBLE)),
    isOpenDoor: squareIsOpenDoor(state, grid),
    isClosedDoor: state.chunk.isClosedDoor(grid),
    isDiggable: squareIsDiggable(state, grid),
  };
}

/** motion_dir (ui-context.c L633): the keypad direction from the player toward `grid`. */
function motionDirTo(grid: Loc): number {
  const dx = Math.sign(grid.x - state.actor.grid.x);
  const dy = Math.sign(grid.y - state.actor.grid.y);
  return (1 - dy) * 3 + (dx + 2);
}

/** context_menu_cave (right-click / long-press any other grid). */
async function runContextMenuCave(grid: Loc, adjacent: boolean): Promise<void> {
  const ctx = contextCaveCtx(grid, adjacent);
  const items = buildCaveMenu(ctx);
  const idx = await selectFromMenu(
    term,
    describeLookGrid(state, grid, TARGET.LOOK).text || "Command for that grid",
    toMenuItems(items),
  );
  if (idx === null) return;
  const dir = motionDirTo(grid);
  switch (items[idx]?.action) {
    case "look":
      if (await runTargetLoop(TARGET.LOOK, false, grid.x, grid.y)) say("Target Selected.");
      break;
    case "use-on":
      await useItem("use-staff", (o) => tvalIsStaff(o.tval), "usable items");
      break;
    case "cast-on":
      await castSpell();
      break;
    case "alter":
      commandBuffer.push({ code: "alter", dir });
      advance();
      break;
    case "disarm-chest":
    case "disarm-trap":
      commandBuffer.push({ code: "disarm", dir });
      advance();
      break;
    case "open-chest":
    case "open-door":
      commandBuffer.push({ code: "open", dir });
      advance();
      break;
    case "lock":
      commandBuffer.push({ code: "disarm", dir });
      advance();
      break;
    case "close":
      commandBuffer.push({ code: "close", dir });
      advance();
      break;
    case "tunnel":
      commandBuffer.push({ code: "tunnel", dir });
      advance();
      break;
    case "walk":
      commandBuffer.push({ code: "walk", dir });
      advance();
      break;
    case "run":
      commandBuffer.push({ code: "run", dir });
      advance();
      break;
    case "pathfind":
      commandBuffer.push({ code: "pathfind", args: { dest: { x: grid.x, y: grid.y } } });
      advance();
      break;
    case "fire":
      await fireCmd();
      break;
    case "throw":
      await throwCmd();
      break;
    default:
      break;
  }
}

/** context_menu_object's use-kind classification (the tval switch at L691-722). */
function objectUseKind(obj: GameObject): ObjectMenuCtx["useKind"] {
  if (tvalIsWand(obj.tval)) return "wand";
  if (tvalIsRod(obj.tval)) return "rod";
  if (tvalIsStaff(obj.tval)) return "staff";
  if (tvalIsScroll(obj.tval)) return "scroll";
  if (tvalIsPotion(obj.tval)) return "potion";
  if (tvalIsEdible(obj.tval)) return "food";
  if (obj.activation) return "activatable";
  return "other";
}

function isObjectEquipped(obj: GameObject, handle: number): boolean {
  return state.actor.player.equipment.includes(handle);
}

/** context_menu_object: the per-item action menu (reached from the inventory/equipment picker). */
async function runContextMenuObject(handle: number): Promise<void> {
  const obj = gearGet(state.gear, handle);
  if (!obj) return;
  const isBook = playerObjectToBook(state.actor.player, obj) !== null;
  const equipped = isObjectEquipped(obj, handle);
  const ctx: ObjectMenuCtx = {
    isBook,
    canCast: state.actor.player.cls.magic.totalSpells > 0,
    canStudy: state.actor.player.upkeep.newSpells > 0,
    useKind: isBook ? "other" : objectUseKind(obj),
    canFire: !isBook && tvalIsAmmo(obj.tval) && obj.tval === state.actor.combat.ammoTval,
    canRefill: objCanRefill(state, obj),
    isEquipped: equipped,
    canWear: !equipped && tvalIsWearable(obj.tval),
    canThrow: true,
    hasInscription: objHasInscrip(obj),
  };
  const items = buildObjectMenu(ctx);
  const idx = await selectFromMenu(
    term,
    `Command for ${objectName(state, obj)}`,
    toMenuItems(items),
  );
  if (idx === null) return;
  switch (items[idx]?.action) {
    case "inspect": {
      const name = objectName(state, obj);
      const header = name.charAt(0).toUpperCase() + name.slice(1);
      const tb = objectInfoTextblock(state, obj, inspectExtras);
      await showTextScreen(term, header, wrapRuns(tb, term.size().cols));
      break;
    }
    case "cast":
      await castSpell();
      break;
    case "study":
      await studySpell();
      break;
    case "aim":
      await dispatchItemVerb("aim-wand", handle, obj);
      break;
    case "zap":
      await dispatchItemVerb("zap-rod", handle, obj);
      break;
    case "use-staff":
      await dispatchItemVerb("use-staff", handle, obj);
      break;
    case "read":
      await dispatchItemVerb("read", handle, obj);
      break;
    case "quaff":
      await dispatchItemVerb("quaff", handle, obj);
      break;
    case "eat":
      await dispatchItemVerb("eat", handle, obj);
      break;
    case "activate":
      await dispatchItemVerb("activate", handle, obj);
      break;
    case "fire":
      await fireCmd();
      break;
    case "refill":
      await refuelItem();
      break;
    case "takeoff":
      await dispatchItemVerb("takeoff", handle, obj);
      break;
    case "equip":
      await dispatchItemVerb("wield", handle, obj);
      break;
    case "drop":
      await dispatchItemVerb("drop", handle, obj);
      break;
    case "throw":
      await throwCmd();
      break;
    case "inscribe":
      await inscribeItem();
      break;
    case "uninscribe":
      await uninscribeItem();
      break;
    default:
      break;
  }
}

/** A dedicated item picker into the per-item context menu (equip+pack), the
 * discoverable home for context_menu_object until the inventory/equipment
 * viewers grow their own second-tap/Enter hook into it. */
async function openItemActionsMenu(): Promise<void> {
  const { items, handles } = packMenu(state, () => true);
  const player = state.actor.player;
  for (let i = 0; i < player.body.count; i++) {
    const handle = player.equipment[i] ?? 0;
    if (!handle) continue;
    const obj = gearGet(state.gear, handle);
    if (!obj) continue;
    items.push({ label: `${objectName(state, obj)} (worn)`, color: "#c8c8d4" });
    handles.push(handle);
  }
  if (items.length === 0) {
    say("You have nothing to act on.");
    return;
  }
  const idx = await selectFromMenu(term, "Item actions - which item?", items);
  if (idx === null) return;
  const handle = handles[idx];
  if (handle === undefined) return;
  await runContextMenuObject(handle);
}

/** routeContextClick's classification, applied to a canvas client point. */
function contextClickGrid(clientX: number, clientY: number): Loc | null {
  const rect = canvas.getBoundingClientRect();
  const { col, row } = term.cellAt(clientX - rect.left, clientY - rect.top);
  const vp = viewport();
  const sx = col - vp.mapOriginX;
  const sy = row - vp.mapTop;
  if (sx < 0 || sy < 0 || sx >= vp.mapCols || sy >= vp.mapRows) return null;
  return loc(vp.camX + sx, vp.camY + sy);
}

async function dispatchContextClick(grid: Loc): Promise<void> {
  const target = routeContextClick(state.actor.grid, grid);
  if (target === "player") await runContextMenuPlayer();
  else await runContextMenuCave(grid, target === "cave-adjacent");
}

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

/**
 * curse_menu's inclusion test (ui-curse.c L104-113): a curse is offered for
 * removal only when its (true) power is in (0,100) - power>=100 is permanent
 * - AND the player actually knows about it (player_knows_curse). Upstream
 * reads the KNOWN twin's power for the gate; the port's playerKnowsCurse is
 * exactly the condition under which the known power mirrors the true one
 * (obj/known-object.ts objectKnownShadow), so testing the true power here is
 * equivalent and avoids building the shadow object just for this menu.
 */
function removableCurses(obj: GameObject): number[] {
  const out: number[] = [];
  const player = state.actor.player;
  obj.curses?.forEach((c, i) => {
    if (i > 0 && c.power > 0 && c.power < 100 && playerKnowsCurse(player, i)) out.push(i);
  });
  return out;
}

/**
 * get_curse (curse_menu, ui-curse.c L91): pick which removable curse to lift;
 * null on ESC. Faithful label ("<name> (curse strength <power>)", the true
 * power per get_curse_display L47) and browse-hook description pane (the
 * curse's capitalized desc, curse_menu_browser L67) below the list. Pure
 * selection - no RNG; the removal roll happens once, later, in the already-
 * ported EF_REMOVE_CURSE handler.
 */
async function selectCurse(removable: number[], obj: GameObject, diceString: string | null): Promise<number | null> {
  const curseTable = booted.registries.objects.curses;
  const items: MenuItem[] = removable.map((i) => {
    const power = obj.curses?.[i]?.power ?? 0;
    const name = curseTable[i]?.name ?? `curse ${i}`;
    return { label: `${name} (curse strength ${power})` };
  });
  const header = diceString
    ? `Remove which curse (spell strength ${diceString})?`
    : "Remove which curse?";
  const detail = (idx: number): ScreenLine[] => {
    const i = removable[idx];
    const desc = (i !== undefined ? curseTable[i]?.desc : undefined) ?? "";
    if (!desc) return [];
    const capped = desc.charAt(0).toUpperCase() + desc.slice(1);
    return [{ text: `${capped}.`, color: "#c8c8d4" }];
  };
  const idx = await selectFromMenu(term, header, items, "[ a-z to choose, ESC to cancel ]", { detail });
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
    if (obj && removable.length > 1) {
      const diceString = removeCurseDiceString(chain);
      const pick = await selectCurse(removable, obj, diceString);
      if (pick === null) return "cancel";
      return { tgtitem: ref, tgtcurse: pick };
    }
  }
  return { tgtitem: ref };
}

/**
 * Dispatch `code` on an already-chosen item (aim direction if needed,
 * pre-resolve any item-target effect, then queue). Shared by useItem's own
 * picker and the context menu's per-item action, which already knows the
 * handle - it should not re-prompt for the item a second time.
 */
async function dispatchItemVerb(code: string, handle: number, obj: GameObject | null): Promise<void> {
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
  await dispatchItemVerb(code, handle, obj);
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
    "[ a-z to choose a spell, ? to toggle description, ESC to cancel ]",
    {
      detail: (i) =>
        spellBrowseLines(state, sidx[i] ?? -1, inspectExtras.projections, term.size().cols),
      detailToggleKey: "?",
    },
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
      "[ a-z to choose a spell, ? to toggle description, ESC to cancel ]",
      {
        detail: (i) =>
          spellBrowseLines(state, sidx[i] ?? -1, inspectExtras.projections, term.size().cols),
        detailToggleKey: "?",
      },
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
    "'r' shows full recall for a visible monster.",
  ];
}

/**
 * The LoreDeps the recall viewer needs (mon/lore-describe.ts), assembled
 * fresh every time it opens since player level/speed/depth change turn to
 * turn: the real per-race spell table (monster_spell.json, bound at boot),
 * the melee/monster hit-chance formulas off the live combat state
 * (mon-lore.c L1086-1094 / L1710-1715 - both pure integer math over
 * chance_of_melee_hit_base/chance_of_monster_hit_base + hit_chance, no RNG),
 * and the breath element damage table (world/projection.ts) - the one piece
 * of breath lore damage that lives outside mon/, without which breath
 * damage would render as 0. spellColor/blowColor (the player-resistance-
 * aware danger recolouring) and spellLoreDamage are left at loreDescription's
 * own documented defaults - real player-state-aware recolouring is a
 * separate, larger feature (mon-lore.c spell_color/blow_color read the
 * player's known elemental resistances/protections), tracked as a follow-up
 * rather than half-built here.
 */
function recallDeps(): LoreDeps {
  const player = state.actor.player;
  const projections = booted.registries.projections;
  return {
    playerLevel: player.lev,
    playerMaxDepth: player.maxDepth,
    playerSpeed: state.actor.speed,
    effectiveSpeed: state.options?.get("effective_speed") ?? false,
    spells: booted.registries.monsters.spells,
    meleeHitPercent: (race) =>
      getHitChance(chanceOfMeleeHitBase(state.actor.combat, state.actor.weapon), race.ac),
    monsterHitPercent: (race, effect) =>
      // chance_of_monster_hit_base (mon-attack.c): MAX(race->level, 1) * 3 + effect->power.
      getHitChance(
        Math.max(race.level, 1) * 3 + effect.power,
        state.actor.defense.ac + state.actor.defense.toA,
      ),
    breathProjection: (subtype) => projections?.[subtype],
  };
}

/**
 * The monster recall screen (ui-mon-lore.c lore_description, reached via
 * 'r' - ui-target.c aux_monster's recall toggle, L596-598): reads the
 * monster's REAL lore record (getLore(state.lore, race) - never a
 * fully-known override, so unlearned sections stay hidden) and renders
 * loreDescription's runs through the same showTextScreen + wrapRuns pattern
 * every other full-screen viewer uses.
 */
async function showRaceRecall(race: MonsterRace, lore: MonsterLore): Promise<void> {
  const lines = monsterRecallLines(race, lore, recallDeps(), term.size().cols);
  await showTextScreen(term, capRaceName(race), lines);
}

async function showMonsterRecall(mon: Monster): Promise<void> {
  await showRaceRecall(mon.race, getLore(state.lore, mon.race));
}

/**
 * The knowledge menu ('~', ui-knowledge.c do_cmd_knowledge_menu): upstream's
 * home for browsing everything the character has learned. Only the two
 * sections the port has data for are wired - monster knowledge (this task)
 * and the character history that '~' used to open directly, preserved here as
 * an entry. Object / artifact / ego / rune / feature knowledge are the larger
 * follow-up the context-menu.ts header tracks; they are omitted (not shown
 * disabled) until their per-kind knowledge registries exist.
 */
async function openKnowledgeMenu(): Promise<void> {
  const idx = await selectFromMenu(term, "Display current knowledge", [
    { label: "Display monster knowledge" },
    { label: "Display character history" },
  ]);
  if (idx === 0) await showMonsterKnowledge();
  else if (idx === 1)
    await showTextScreen(term, "Player history", historyLines(state));
}

/**
 * do_cmd_knowledge_monsters (ui-knowledge.c): a selectable list of every race
 * the player has memory of (monsterKnowledgeMenu off the live lore store);
 * picking one opens its recall through the SAME monsterRecallLines +
 * recallDeps path the look/target loop's 'r' uses (showRaceRecall). Loops
 * back to the list after a recall closes, like the upstream browser, until
 * ESC.
 */
async function showMonsterKnowledge(): Promise<void> {
  const races = booted.registries.monsters.races;
  for (;;) {
    const { items, rows } = monsterKnowledgeMenu(races, state.lore);
    if (items.length === 0) {
      say("You have not encountered any monsters yet.");
      return;
    }
    const idx = await selectFromMenu(term, "Monsters", items);
    if (idx === null) return;
    const row = rows[idx];
    if (!row) return;
    await showRaceRecall(row.race, getLore(state.lore, row.race));
  }
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
    // The visible monster (if any) the cursor is currently on, tracked by
    // paint()'s own describeLookGrid call (aux_monster only ever names an
    // obvious monster), so 'r' knows what to recall without recomputing it.
    let lastMon: Monster | null = null;

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
      lastMon = mon;
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
      if (ev.key === "r") {
        // aux_monster's recall toggle: open the full recall for the grid's
        // monster, then return to this same loop (any key closes the recall
        // screen - showTextScreen's own ESC/Enter/Space/arrows handling).
        const mon = lastMon;
        if (!mon) {
          state.sound?.(MSG.BELL);
          return;
        }
        window.removeEventListener("keydown", onKey, true);
        void showMonsterRecall(mon).then(() => {
          window.addEventListener("keydown", onKey, true);
          paint();
        });
        return;
      }
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
 * The in-game menu (Escape): the discoverable home for EVERY major screen and
 * the save/character actions, so a player who knows no keys is never stuck.
 * Row structure lives in game-menu.ts (gameMenuEntries); every row carries a
 * hint naming its keyboard shortcut and is reachable by letter, arrows+Enter,
 * or tap. New/Switch confirm first (the current hero is saved to its own slot
 * either way). Save/switch/new all either stay in play or navigate away, so
 * there is no nested-modal race. ESC resumes.
 */
async function openGameMenu(): Promise<void> {
  const entries = gameMenuEntries();
  const pick = await selectFromMenu(
    term,
    "Game menu",
    entries.map((e) => e.item),
    GAME_MENU_FOOTER,
  );
  if (pick === null) return; // ESC resumes
  switch (entries[pick]?.action) {
    case "character":
      await showCharacterSheet(term, state, playerName, charSheetOpts());
      break;
    case "inventory":
      await showTextScreen(term, "Inventory", inventoryLines(state));
      break;
    case "equipment":
      await showTextScreen(term, "Equipment", equipmentLines(state));
      break;
    case "messages":
      await showTextScreen(term, "Message history", messageHistoryLines(msglog));
      break;
    case "knowledge":
      await openKnowledgeMenu();
      break;
    case "save":
      autosave(true);
      message = "Game saved. It will resume automatically next time.";
      render();
      break;
    case "options":
      await runOptionsMenu(term, state, openIgnoreSetup);
      autosave(true); // flush any option change to the per-slot save
      break;
    case "help":
      await runHelp(term);
      break;
    case "abilities":
      await showAbilities(term, playerAbilities(state, {
        properties: players.properties,
        elementNames: (booted.registries.projections ?? []).slice(0, state.actor.player.race.elInfo.length).map((p) => p.name),
      }));
      break;
    case "equip-cmp":
      await showEquipCmp(term, state, equipCmpDeps());
      break;
    case "item-actions":
      await openItemActionsMenu();
      break;
    case "switch":
      // get_check-style confirmation (parallels ui-death.c's "Start a new
      // game?") so a stray tap never yanks the player out of a live run.
      if (await confirmYesNo("Switch character? (this hero is saved to its slot)")) {
        switchCharacter();
      }
      break;
    case "new":
      if (await confirmYesNo("Start a new character? (this hero is saved to its slot)")) {
        persistSave(); // keep the current character in its slot, then birth anew
        newGame();
      }
      break;
    default:
      break; // Resume play
  }
}

/**
 * death_screen's menu (ui-death.c L374), routed through the same shared menu
 * component: Information / Messages / View scores / New Game with the
 * upstream tag letters, looping until ESC (leave the tombstone view) or a
 * confirmed New Game. Reached after the death score screen and again from
 * Escape while dead.
 */
async function runDeathMenu(): Promise<void> {
  for (;;) {
    const entries = deathMenuEntries();
    const pick = await selectFromMenu(
      term,
      "You have died.",
      entries.map((e) => e.item),
      DEATH_MENU_FOOTER,
    );
    if (pick === null) return;
    switch (entries[pick]?.action) {
      case "info":
        await showCharacterSheet(term, state, playerName, charSheetOpts());
        break;
      case "messages":
        await showTextScreen(term, "Message history", messageHistoryLines(msglog));
        break;
      case "scores":
        await showPredictedScores(
          term,
          scoreStore,
          state.actor.player,
          { ...scoreBuildDeps("the dungeon"), deathTime: new Date() },
          scoreNames,
          true,
        );
        break;
      case "new":
        // death_new_game (ui-death.c L347): get_check("Start a new game? ").
        if (await confirmYesNo("Start a new game?")) {
          newGame();
          return;
        }
        break;
      default:
        break;
    }
  }
}

// menu_pickup_item (cmd-pickup.c L356-381): when several objects share the
// player's grid, get_item shows a lettered picker before player_pickup_aux
// runs. PickupEnv.chooseItem is synchronous (game/pickup.ts), so the menu is
// resolved BEFORE the "pickup" command is enqueued (pickupCmd below); the
// hook just hands back the already-chosen object on the next call.
let pendingPickupChoice: GameObject | null = null;

// Reinstall the pickup commands with message hooks so gold and item pickup
// report on the message line. Restores isIgnored (dropped by this reinstall
// otherwise, since ActionRegistry.register replaces rather than merges) so
// the picker below and playerPickupItem's own floor scan agree on what
// counts as pickupable.
installPickup(state, registry, {
  constants,
  env: {
    isIgnored: (obj): boolean => state.isIgnored!(obj),
    chooseItem: (list): GameObject | null => {
      const choice = pendingPickupChoice;
      pendingPickupChoice = null;
      if (choice && list.includes(choice)) return choice;
      return list[0] ?? null;
    },
    onGold: (total, name, single): void => {
      say(`You have found ${total} gold pieces worth of ${single ? name : "treasures"}.`);
    },
    onPickup: (obj): void => {
      // object_desc(ODESC_PREFIX | ODESC_FULL): flavours + knowledge-gated name.
      say(`You have ${describeObject(state, obj)}.`);
    },
  },
});

/**
 * do_cmd_pickup's menu path (cmd-pickup.c L449-470): when more than one
 * object on the grid can be (at least partially) carried, show a lettered
 * "Get which item?" picker and stash the choice for PickupEnv.chooseItem;
 * otherwise just run the plain pickup command (single object, or none/gold
 * only, all handled by playerPickupItem itself).
 */
async function pickupCmd(): Promise<void> {
  const grid = state.actor.grid;
  const canPickup = floorPile(state, grid).filter(
    (o) => !state.isIgnored?.(o) && invenCarryNum(state.gear, o, constants) > 0,
  );
  if (canPickup.length > 1) {
    const items = canPickup.map((o) => ({ label: objectName(state, o), color: "#c8c8d4" }));
    const idx = await selectFromMenu(term, "Get which item?", items);
    if (idx === null) return;
    pendingPickupChoice = canPickup[idx] ?? null;
  }
  commandBuffer.push({ code: "pickup" });
  advance();
}

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
  updateView(state.chunk, viewerState(), Z, [], soundEvents);
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

/**
 * Glyph and color for a grid's terrain, resolving display mimics. Faithful to
 * grid_get_attr (ui-map.c L108): a wall feature (TF_WALL, tested on the
 * DISPLAYED/mimic-resolved feature, exactly as upstream tests g->f_idx after
 * mimic resolution) gets a background wash when hybrid_walls or solid_walls
 * is on - hybrid first (upstream checks it first too), a dark shade behind
 * the glyph; solid, a background the same color as the glyph itself (a solid
 * block of color). Neither option is on by default (both normal: false).
 */
function terrainGlyph(x: number, y: number): { ch: string; css: string; bg?: string } {
  const f = state.chunk.feature(loc(x, y));
  const disp = f.mimic !== null ? features.get(f.mimic) : f;
  const css = colorToCss(colorCharToAttr(disp.dAttr));
  if (disp.flags.has(TF["WALL"])) {
    if (state.options?.get("hybrid_walls")) return { ch: disp.dChar, css, bg: dim(css) };
    if (state.options?.get("solid_walls")) return { ch: disp.dChar, css, bg: css };
  }
  return { ch: disp.dChar, css };
}

/**
 * The display attr for a monster at the current animation frame. Faithful to
 * grid_data_as_text (ui-map.c L248): purple_uniques (checked FIRST, so it
 * overrides multi/flicker animation for a unique) turns the monster violet;
 * otherwise do_animation (ui-display.c) applies - RF_ATTR_MULTI shimmers a
 * random color, an RF_ATTR_FLICKER monster color-cycles (race cycle, else the
 * legacy flicker cycle, else its static color), and everything else keeps its
 * static attr. animate_flicker gates the animation entirely (ui-display.c
 * L1506: do_animation returns immediately when the option is off), so with it
 * off a multi/flicker monster simply shows its static base color.
 */
function monsterAttr(mon: (typeof state.monsters)[number]): number {
  const base = mon!.race.dAttr;
  if (state.options?.get("purple_uniques") && mon!.race.flags.has(RF.UNIQUE)) {
    return COLOUR_VIOLET;
  }
  if (!animator || !(state.options?.get("animate_flicker") ?? false)) return base;
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

/**
 * The player's own '@' map glyph color. Faithful to grid_data_as_text's
 * g->is_player branch (ui-map.c L282-327): with hp_changes_color on (the
 * default, normal: true), the glyph's color tracks the player's HP decile -
 * white at 90-100%, yellow 70-80%, orange 50-60%, light-red 30-40%, red
 * 0-20%. Off, the player keeps a fixed neutral color (the shell's prior,
 * unconditional behaviour).
 */
function playerMapAttr(): string {
  if (!(state.options?.get("hp_changes_color") ?? true)) return "#e8e8f0";
  const p = state.actor.player;
  const pct10 = p.mhp > 0 ? Math.trunc((p.chp * 10) / p.mhp) : 10;
  let color: number;
  if (pct10 === 10 || pct10 === 9) color = COLOUR_WHITE;
  else if (pct10 === 8 || pct10 === 7) color = COLOUR_YELLOW;
  else if (pct10 === 6 || pct10 === 5) color = COLOUR_ORANGE;
  else if (pct10 === 4 || pct10 === 3) color = COLOUR_L_RED;
  else if (pct10 === 2 || pct10 === 1 || pct10 === 0) color = COLOUR_RED;
  else color = COLOUR_WHITE; // out-of-range (negative/>10): upstream's default
  return colorToCss(color);
}

/** True if any visible monster animates (drives the display frame timer). */
function hasAnimatedVisibleMonster(): boolean {
  if (!animator || !(state.options?.get("animate_flicker") ?? false)) return false;
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

/**
 * do_cmd_view_map's data ('M', ui-map.c display_map): the priority-resolved
 * whole-level miniature, scaled to fit the current terminal (minus the
 * 1-cell box border on each side). Reuses exactly the map-knowledge helpers
 * render() itself reads (knownFeat/knownObject/features/monsterIndex/
 * trapIndex) - buildOverview (mapview.ts) only does the scan/scale/priority
 * arithmetic; no parallel glyph pipeline is built here. A pure read: no RNG,
 * no state mutation.
 */
function buildOverviewForShell(): Overview {
  const { cols, rows } = term.size();
  const mapW = Math.min(cols - 2, state.chunk.width);
  const mapH = Math.min(rows - 2, state.chunk.height);
  const monsterAt = monsterIndex();
  const trapAt = trapIndex();
  return buildOverview({
    width: state.chunk.width,
    height: state.chunk.height,
    mapW,
    mapH,
    knownFeatAt: (x, y) => knownFeat(state, loc(x, y)),
    featureGlyph: (fidx) => {
      const f = features.get(fidx);
      const disp = f.mimic !== null ? features.get(f.mimic) : f;
      return { ch: disp.dChar, css: colorToCss(colorCharToAttr(disp.dAttr)), priority: disp.priority };
    },
    objectGlyphAt: (x, y) => {
      const mem = knownObject(state, loc(x, y));
      if (!mem) return null;
      return mem.ch === null
        ? { ch: "*", css: "#8a8a94" }
        : { ch: mem.ch, css: colorToCss(colorCharToAttr(mem.attr)) };
    },
    trapGlyphAt: (x, y) => trapAt.get(gridIndex(x, y)) ?? null,
    monsterGlyphAt: (x, y) => monsterAt.get(gridIndex(x, y)) ?? null,
    playerGrid: { x: state.actor.grid.x, y: state.actor.grid.y },
  });
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
 *
 * FLAGGED NO-OP: center_player (option, normal: false) is not read here. This
 * always recenters the camera on the player every frame, which is upstream's
 * center_player=ON behaviour; the OFF behaviour (verify_panel's panel-scroll -
 * only recenter once the player nears a panel edge) has no backing
 * implementation in this shell. The option is still listed and toggleable in
 * the '=' menu (options.ts) and persists in the save, but toggling it
 * currently has no visible effect - a real gap, not a silent one.
 */
// 'L' locate (do_cmd_locate): while set, viewport() reports this panned
// top-left instead of centering on the player - change_panel's effect on the
// camera. Named generically (not "target*") since a future look/cursor
// scroll seam can reuse the same override. null outside locate mode.
let locateCam: Loc | null = null;
// True for the duration of the 'L' loop: gates the idle animation timer
// (below) so a mid-locate repaint cannot wipe the sector banner it paints
// over row 0 after every render() call.
let locateActive = false;

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
  let camX: number, camY: number;
  if (locateCam) {
    camX = locateCam.x;
    camY = locateCam.y;
  } else {
    const center = focus ?? state.actor.grid;
    camX = center.x - Math.floor(mapCols / 2);
    camY = center.y - Math.floor(mapRows / 2);
  }
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
      let drawn: { ch: string; css: string; bg?: string } = t;
      const trap = trapAt.get(idx);
      if (trap) drawn = trap;
      const obj = objectAt.get(idx);
      if (obj) drawn = obj;
      const mon = monsterAt.get(idx);
      if (mon) drawn = mon;
      if (pathColour !== undefined) drawn = { ch: "*", css: colorToCss(pathColour) };
      // The wall shading (solid_walls/hybrid_walls) is terrain-only: any
      // trap/object/monster covering the cell (or the cursor highlight,
      // spread last below) fully overrides it, matching upstream drawing
      // whatever is "on top" of the grid without the terrain's own bg.
      term.put(screenX, screenY, {
        ch: drawn.ch,
        fg: drawn.css,
        ...(drawn.bg !== undefined ? { bg: drawn.bg } : {}),
        ...cursorBg,
      });
    }
  }

  // The player: centered and bright when the camera follows the player;
  // repositioned to its own grid (which may be off-center) while targeting,
  // or while 'L' locate has panned the camera away entirely - in which case
  // the marker is simply not drawn, exactly as a panned real-terminal panel
  // would show no player glyph when it scrolls out of the visible sector.
  const playerDx = state.actor.grid.x - camX;
  const playerDy = state.actor.grid.y - camY;
  if (playerDx >= 0 && playerDx < mapCols && playerDy >= 0 && playerDy < mapRows) {
    const playerScreenX = mapOriginX + playerDx;
    const playerScreenY = mapTop + playerDy;
    const playerIsCursor =
      !!targeting &&
      state.actor.grid.x === targeting.cursor.x &&
      state.actor.grid.y === targeting.cursor.y;
    term.put(playerScreenX, playerScreenY, {
      ch: "@",
      fg: playerMapAttr(),
      ...(playerIsCursor ? { bg: CURSOR_BG } : {}),
    });
  }

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

/**
 * do_cmd_locate ('L', ui-knowledge.c): pan the live map viewport around the
 * level in half-panel steps without moving the player, showing a "Map sector
 * [r,c]" banner (locateSectorBanner, mapview.ts), until ESC / dir 5 exits and
 * the camera recenters on the player (verify_panel). A pure read: no RNG, no
 * turn spent, state.actor.grid never changes.
 */
async function runLocate(): Promise<void> {
  const vp0 = viewport();
  const start: Loc = loc(vp0.camX, vp0.camY);
  locateCam = start;
  locateActive = true;
  const paintBanner = (): void => {
    render();
    const vp = viewport();
    const banner = locateSectorBanner(
      { x: vp.camX, y: vp.camY },
      { x: start.x, y: start.y },
      vp.mapCols,
      vp.mapRows,
    );
    term.print(vp.mapOriginX, 0, banner.slice(0, vp.mapCols - 1), "#e0c040");
  };
  const panDir = (dir: number): void => {
    const vp = viewport();
    const next = panLocate(
      { x: vp.camX, y: vp.camY },
      dir,
      vp.mapCols,
      vp.mapRows,
      state.chunk.width,
      state.chunk.height,
    );
    locateCam = loc(next.x, next.y);
    paintBanner();
  };
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      window.removeEventListener("keydown", onKey, true);
      canvas.removeEventListener("pointerdown", onTap);
      locateCam = null;
      locateActive = false;
      render(); // verify_panel: recenter on the player
      resolve();
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") {
        finish();
        return;
      }
      const arrows: Record<string, number> = {
        ArrowUp: 8, ArrowDown: 2, ArrowLeft: 4, ArrowRight: 6,
      };
      let dir: number | null = null;
      if (ev.key in arrows) dir = arrows[ev.key] ?? null;
      else if (/^[1-9]$/.test(ev.key)) dir = Number(ev.key);
      if (dir === null) return;
      if (dir === 5) {
        finish();
        return;
      }
      panDir(dir);
    };
    // Touch: faithful to do_cmd_locate's mouse edge-panning (ui-knowledge.c) -
    // a tap in the outer margin of the map pans that way; a tap on the map's
    // own center exits (there is no right-click on a touchscreen).
    const onTap = (ev: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const { col, row } = term.cellAt(ev.clientX - rect.left, ev.clientY - rect.top);
      const vp = viewport();
      const sx = col - vp.mapOriginX;
      const sy = row - vp.mapTop;
      if (sx < 0 || sy < 0 || sx >= vp.mapCols || sy >= vp.mapRows) return; // outside the map
      ev.preventDefault();
      const marginX = Math.max(1, Math.floor(vp.mapCols / 20));
      const marginY = Math.max(1, Math.floor(vp.mapRows / 20));
      let dy = 0;
      let dx = 0;
      if (sy < marginY) dy = -1;
      else if (sy >= vp.mapRows - marginY) dy = 1;
      if (sx < marginX) dx = -1;
      else if (sx >= vp.mapCols - marginX) dx = 1;
      if (dx === 0 && dy === 0) {
        finish();
        return;
      }
      panDir((1 - dy) * 3 + (dx + 2));
    };
    window.addEventListener("keydown", onKey, true);
    canvas.addEventListener("pointerdown", onTap);
    paintBanner();
  });
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
    // death_knowledge (player-util.c L309): reveal every ARTIFACT_UNKNOWN
    // history entry before the memorial/score screen, so a "Missed X" find
    // the player never identified shows its real name. 4.2.6 writes no
    // HIST_PLAYER_DEATH entry (verified: zero uses in reference/src).
    historyUnmaskUnknown(state.actor.player);
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
      // death_screen's menu follows the score display; Escape reopens it.
      void openModal(() => runDeathMenu());
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
  // Help ('?', do_cmd_help): allowed even after death, like N above - it is
  // pure display (screen_save/screen_load bracket with no state mutation,
  // ui-help.c:470-480), so a fallen hero can still read it.
  if (!ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.key === "?") {
    ev.preventDefault();
    void openModal(() => runHelp(term));
    return;
  }
  // Escape while dead reopens the death menu (death_screen loops until New
  // Game / quit upstream; here ESC parks on the tombstone map and Escape
  // brings the menu back).
  if (dead && ev.key === "Escape" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    ev.preventDefault();
    void openModal(() => runDeathMenu());
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
        showCharacterSheet(term, state, playerName, charSheetOpts()),
      );
      return;
    }
    // The knowledge menu ('~', do_cmd_knowledge_menu): monster recall plus the
    // character history '~' used to open directly. See openKnowledgeMenu.
    if (ev.key === "~") {
      ev.preventDefault();
      void openModal(openKnowledgeMenu);
      return;
    }
    if (ev.key === "I") {
      ev.preventDefault();
      void openModal(() => inspectItem());
      return;
    }
    // Full-level map ('M', do_cmd_view_map) and locate/scroll ('L',
    // do_cmd_locate). Both checked here, before resolveKey() below, so the
    // roguelike keyset's 'l'->run-east binding never shadows capital 'L'.
    if (ev.key === "M") {
      ev.preventDefault();
      void openModal(() => showLevelMap(term, buildOverviewForShell()));
      return;
    }
    if (ev.key === "L") {
      ev.preventDefault();
      void openModal(() => runLocate());
      return;
    }
    // do_cmd_options ('=', ui-options.c): the full Options Menu (interface /
    // birth toggles, ignore-setup, delay factor, hitpoint warning) - checked
    // here, before the item-use verbs below, so '=' is never shadowed by
    // ITEM_VERBS (sibling gap #51 temporarily bound '=' straight to
    // openIgnoreSetup(); this reclaims it for the full menu, which now hosts
    // ignore-setup as its own (i) sub-entry - openIgnoreSetup itself is
    // unchanged and reused verbatim, not duplicated). autosave(true) flushes
    // any option change to the per-slot save the moment the menu closes.
    if (ev.key === "=") {
      ev.preventDefault();
      void openModal(() => runOptionsMenu(term, state, openIgnoreSetup)).then(() =>
        autosave(true),
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
      void openModal(pickupCmd);
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
  const binding = resolveKey(ev, state.options?.get("rogue_like_commands") ?? false);
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
  if (scoresOpen || dead || modalDepth > 0) return; // a modal owns input
  // ui-context.c L1002: "if (!OPT(player, mouse_movement)) return;" gates
  // click-to-move specifically (not the context menu below, which upstream
  // never gates on this option). Defaults on (normal: true).
  if (!(state.options?.get("mouse_movement") ?? true)) return;
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

// ---- Context menus (ui-context.c textui_process_click's mouse routing) ----
// Desktop: the canvas 'contextmenu' event (the browser's own right-click) is
// the router - compute the tapped grid exactly as the pointerdown handler
// does, then classify and dispatch (routeContextClick, context-menu.ts).
// Touch: a long-press (pointerdown held ~450ms, cancelled by move/lift/second
// pointer) opens the same menu at the pressed cell, since a phone has no
// right-click.
canvas.addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  if (scoresOpen || dead || modalDepth > 0) return;
  const grid = contextClickGrid(ev.clientX, ev.clientY);
  if (!grid) return;
  void openModal(() => dispatchContextClick(grid));
});

let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressGrid: Loc | null = null;
function cancelLongPress(): void {
  if (longPressTimer !== null) clearTimeout(longPressTimer);
  longPressTimer = null;
  longPressGrid = null;
}
canvas.addEventListener("pointerdown", (ev) => {
  if (scoresOpen || dead || modalDepth > 0 || ev.pointerType !== "touch") return;
  const grid = contextClickGrid(ev.clientX, ev.clientY);
  if (!grid) return;
  longPressGrid = grid;
  longPressTimer = setTimeout(() => {
    const g = longPressGrid;
    cancelLongPress();
    if (g) void openModal(() => dispatchContextClick(g));
  }, 450);
});
canvas.addEventListener("pointerup", cancelLongPress);
canvas.addEventListener("pointercancel", cancelLongPress);
canvas.addEventListener("pointermove", (ev) => {
  if (!longPressGrid) return;
  const grid = contextClickGrid(ev.clientX, ev.clientY);
  if (!grid || grid.x !== longPressGrid.x || grid.y !== longPressGrid.y) cancelLongPress();
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
    ["Get", () => { void openModal(pickupCmd); }],
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
    ["Map", () => { void openModal(() => showLevelMap(term, buildOverviewForShell())); }],
    ["Locate", () => { void openModal(() => runLocate()); }],
    ["Insp", () => { void openModal(() => inspectItem()); }],
    ["Insc", () => { void openModal(() => inscribeItem()); }],
    ["Fuel", () => { void openModal(() => refuelItem()); }],
    ["Char", () => { void openModal(() => showCharacterSheet(term, state, playerName, charSheetOpts())); }],
    ["Hist", () => { void openModal(() => showTextScreen(term, "Player history", historyLines(state))); }],
    ["Ignore", () => { void openModal(() => openIgnoreSetup()); }],
    ["Opts", () => { void openModal(() => runOptionsMenu(term, state, openIgnoreSetup)).then(() => autosave(true)); }],
    ["Help", () => { void openModal(() => runHelp(term)); }],
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
      if (dead && label !== "New" && label !== "Help") return;
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
// Also carries the "feeling" signal (updateFov below) since GameEvents is a
// general multi-type bus, not a sound-only one.
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
// use_sound (normal: false, matching upstream's own shipped default) now has
// a real toggle via '=' -> User interface options; gate the emit on it so
// disabling the option actually silences audio, reading it live each call so
// a mid-session toggle takes effect immediately.
state.sound = (type: number): void => {
  if (!(state.options?.get("use_sound") ?? false)) return;
  soundEvents.emit("sound", { msg: "", type });
};

state.updateFov(state);
term.onResize = () => render();
render();

// --- Birth: choose a character for a new game -------------------------------
// A brand-new game opens the staged birth screen (ui-birth.c stage order). The
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
    // quickstart_allowed (ui-birth.c): offer the quick-start stage only when
    // a previous character's choices exist to reuse.
    const choice = await runBirth(term, players.races, players.classes, {
      quickstart: birthChoice
        ? {
            raceName: birthChoice.raceName,
            className: birthChoice.className,
            ...(birthChoice.stats && birthChoice.stats.length === 5
              ? { stats: birthChoice.stats }
              : {}),
          }
        : null,
    });
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

// ---- Agent controller seam (W1.5) ----------------------------------------
// A bundled in-process agent can drive the real game through the frozen
// perceive/act facade via installController - the same seam the Borg (P8)
// rides, no privileged access. Enable with ?agent=<id> (disabled by default).
// The controller is latched to yield one command per tick (runGameLoop would
// otherwise pull nextCommand until null and never return with an always-acting
// agent); the tick interval is the agent's configurable speed. Ticks wait out
// birth / menus / death (modalDepth, dead).
const agentId = params.get("agent");
const agentMake = agentId ? DEMO_AGENTS[agentId] : undefined;
if (agentId && agentMake) {
  const base = agentMake();
  const resolver = new ContentIdResolver({
    objects: booted.registries.objects,
    playerRaces: players.races,
    playerClasses: players.classes,
  });
  // A real CapabilitySet (mod-sdk) on the live path: a plugin-shape manifest
  // granting exactly perceive + act, enforced by the facades (W1.4).
  const caps = CapabilitySet.fromManifest({
    id: agentId,
    name: agentId,
    version: "1.0.0",
    shape: "plugin",
    capabilities: ["state:*.read", "command:add"],
  });
  let armed = false;
  const latched: AgentController = (view, act) => {
    if (!armed) return null; // yield until the next tick re-arms one action
    armed = false;
    return base(view, act);
  };
  installController(state, latched, {
    capabilities: caps,
    viewDeps: { resolver, reg: booted.registries.objects },
  });
  let agentTicks = 0;
  let agentLastError: string | null = null;
  const AGENT_TICK_MS = 120;
  const AGENT_TICK_CAP = 5000;
  const agentTimer = setInterval(() => {
    if (dead) {
      clearInterval(agentTimer);
      return;
    }
    if (scoresOpen || modalDepth > 0) return; // wait out birth / menus
    armed = true;
    // A buggy agent mod must not crash or hang the host: on a throw, stop the
    // runner and record the error rather than letting it escape the timer.
    try {
      advance();
    } catch (err) {
      agentLastError = err instanceof Error ? err.message : String(err);
      clearInterval(agentTimer);
      return;
    }
    agentTicks += 1;
    if (agentTicks >= AGENT_TICK_CAP) clearInterval(agentTimer);
  }, AGENT_TICK_MS);
  if (import.meta.env.DEV) {
    (window as unknown as { __neoAgent?: unknown }).__neoAgent = {
      id: agentId,
      installed: true,
      get ticks() {
        return agentTicks;
      },
      get turn() {
        return state.turn;
      },
      get lastError() {
        return agentLastError;
      },
    };
  }
}

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
  // Skip while 'L' locate owns the view: render() would erase the sector
  // banner it prints over row 0 and re-derive the player marker from the
  // panned camera every 250ms for no benefit - simplest faithful stand-in
  // for upstream's own single-threaded UI, where nothing repaints mid-command.
  if (dead || scoresOpen || locateActive) return;
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
