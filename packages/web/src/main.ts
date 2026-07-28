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
 * A genuine launch (fresh visit, refresh, reopened tab) always shows the title
 * then the character-select screen - it never drops straight into a save, the
 * web analog of the original's savefile-select menu (anti-scum: a refresh
 * returns to the title, not the live game). It autosaves during play, on level
 * change, and when the tab is hidden/closed. 'S' saves on demand; 'N' rolls a
 * new character (allowed after death, reusing the same save slot - faithful to
 * the original's death flow).
 *
 * The render surface is responsive: it fills the viewport at any size. The
 * sidebar mode ('=' -> (o), SIDEBAR_MODE) picks Left (the classic status
 * column), Top (a one-line vitals header), or None; a narrow (phone / portrait)
 * screen that cannot fit the Left column falls back to Top.
 * Touch devices get tap-to-move plus an on-screen action bar.
 */

import {
  Rng,
  generateHistory,
  startGame,
  saveGame,
  loadGame,
  encodeSavedGame,
  decodeSavedGame,
  runGameLoop,
  LOOP_STATUS,
  colorCharToAttr,
  colorTextToAttr,
  colorToCss,
  getColor,
  ATTR_LIGHT,
  ATTR_DARK,
  featIsTorch,
  updateView,
  squareIsSeen,
  squareIsBelievedWall,
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
  buildLoreColorState,
  spellColorFor,
  blowColorFor,
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
  tvalIsMeleeWeapon,
  tvalIsLight,
  objCanRefill,
  objectEffect,
  objCanWear,
  objIsActivatable,
  objCanBrowse,
  objCanCastFrom,
  objCanStudy,
  playerBookHasUnlearnedSpells,
  objHasInscrip,
  objectIsIgnored,
  OF,
  sidebarModel,
  statusLineModel,
  PARITY_BASELINE,
  ENGINE_VERSION,
  createVisualsAnimator,
  animateMonsterAttr,
  RF,
  MSG,
  PF,
  spellNeedsAim,
  spellBookCountSpells,
  spellOkayToBrowse,
  playerObjectToBook,
  targetSetMonster,
  targetSetClosest,
  targetOkay,
  targetGetMonsters,
  targetIsSet,
  targetGet,
  targetSighted,
  playerIsShapechanged,
  FEAT,
  miscStringFix,
  enterStoreGuard,
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
  countChests,
  countFeats,
  squareIsDisarmableTrap,
  squareIsUnlockedDoor,
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
  historyAdd,
  historyStamp,
  HIST,
  displayFeeling,
  effectChoiceRows,
  EF,
  OBJ_PROPERTY,
  runeAutoinscribe,
  playerRandomName,
  buildProb,
  RANDNAME_TOLKIEN,
  playerCanCast,
} from "@neo-angband/core";
import type {
  GamePack,
  GameObject,
  InterruptResponse,
  MessageType,
  ObjectKind,
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
import { installController, ContentIdResolver, subscribeEvents, createModRegistryHost, VocabularyRegistry } from "@neo-angband/core";
import type { AgentController } from "@neo-angband/core";
import {
  getGraphicsMode,
  GRAPHICS_NONE,
  LIGHTING,
  tileForFeature,
  tileForMonster,
  tileForObject,
  tileForTrap,
} from "@neo-angband/core";
import type { TileAtlas, TileMap, TilePrefsDeps } from "@neo-angband/core";
import { CapabilitySet } from "@neo-angband/mod-sdk";
import { loadGamePack, loadVisualsRecord, loadMonsterColorCycles, loadUiEntryPacks, loadEnabledModRuleDecls, discoverContentModManifests, modConflictLines, presentNamespaces } from "./pack";
import {
  defaultModStore,
  buildCatalog,
  consentSatisfied,
  resolveEnabledIds,
  resolveModRules,
  FIRST_PARTY_MOD_IDS,
} from "./mod-store";
import { runModManager } from "./mods";
import { UI_TEXT, UI_DIM, UI_GOLD, UI_BG, UI_MORE, UI_CURSOR } from "./ui-colors";
import { initA11y } from "./a11y";
import { DEMO_AGENTS } from "./agents/demo";
import { discoverPlugins } from "./agents/sandbox/discover";
import { installSandboxedController } from "./agents/sandbox/host";
import { discoverTrustedPlugins } from "./agents/trusted/discover";
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
import type { TileDraw } from "./term";
import { resolveKey } from "./keymap";
import { installWebSound } from "./sound";
import {
  composeTileModes,
  coreTileModes,
  createTileRenderer,
  discoverEnabledTileModes,
  isTile,
  loadTilePrefs,
  tileCode,
  type TileBlitter,
  type TileModeEntry,
} from "./tiles";
import { LinoleumPack, loadLinoleumPack } from "./linoleum-pack";
import {
  showTextScreen,
  selectFromMenu,
  itemSelect,
  promptText,
  promptTextInline,
  getKeyInline,
  getRepDir,
  getAimDir,
  getCheck,
  AIM_STAR,
  AIM_CLOSEST,
  showLevelMap,
  menuNav,
  MENU_CLOSE,
  getChar,
  getFile,
} from "./overlay";
import type { MenuItem, ItemMenuSource, ScreenLine } from "./overlay";
import { htmlScreenshot, DUMP_HTML, DUMP_FORUM } from "./screenshot";
import { userPath, writeUserFile, downloadUserFile } from "./userdir";
import { buildOverview, panLocate, locateSectorBanner } from "./mapview";
import type { Overview } from "./mapview";
import { runBirth } from "./birth";
import { showTitleScreen } from "./news";
import type { BirthDeps } from "./birth";
import {
  gameMenuEntries,
  deathMenuEntries,
  GAME_MENU_FOOTER,
  DEATH_MENU_FOOTER,
} from "./game-menu";
import { MessageLog, messageTypeCode, paginateMessages, pushTypedMessage } from "./messages";
import {
  inventoryLines,
  equipmentLines,
  messageHistoryLines,
  historyLines,
  packMenu,
  quiverMenu,
  deviceMenu,
  deviceFailColumn,
  objLetter,
  magicBooks,
  bookSpellMenu,
  spellBrowseLines,
  targetMenu,
  objectName,
  objectColor,
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
  monsterKnowledgeGroupViews,
  capRaceName,
  tombstoneLines,
  winnerLines,
  ctimeStamp,
  monsterListScreenLines,
} from "./screens";
import { showCharacterSheet, dumpCharacterFile, dumpFileName } from "./charsheet";
import {
  showRuneKnowledge,
  showFeatureKnowledge,
  showTrapKnowledge,
  showObjectKnowledge,
  showEgoKnowledge,
  showShapeKnowledge,
  showArtifactKnowledge,
  type ObjectBrowserDeps,
} from "./knowledge";
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
import {
  advanceDeterminism,
  advanceModNoscore,
  enterScore,
  NOSCORE,
  noscoreInvalidatesScore,
  scoreGateNoscore,
  BIRTH_MESSAGE_RECALL_BANNER,
} from "@neo-angband/core";
import { markNoscore } from "@neo-angband/core";
import { ArtifactState } from "@neo-angband/core";
import {
  walkTerrainPrompt,
  itemAllowPrompt,
  keyConfirmCount,
  KEY_CONFIRM_PROMPT,
} from "@neo-angband/core";
import type { CommandCode } from "@neo-angband/core";
import { monsterIsVisible, monsterIsDestroyed } from "@neo-angband/core";
import type { WizardDeps } from "@neo-angband/core";
import { runWizardToggle, runWizardDebugMenu, runSpoilers } from "./wizard";
import type { WizardUiCtx, WizKeypress } from "./wizard";
import { runStore, sortStoreStock } from "./shop";
import type { SellPick } from "./shop";
import {
  showIgnoreItemMenu,
  ignoreItemMenuCtx,
  buildIgnoreItemMenu,
  applyIgnoreItemChoice,
} from "./ignore-menu";
import type { Store } from "@neo-angband/core";
import { runHelp } from "./help";
import { runOptionsMenu, runTileModePage } from "./options";
import type { TileModeMenu, SidebarModeMenu } from "./options";
import { loadColorPrefs } from "./colors";
import { enqueueKeys, isSynthKey } from "./input-queue";
import { keymapFind, keymapModeFor, loadKeymapPrefs } from "./keymap-store";
import { installAutoUpdate } from "./pwa";

// PWA freshness: silently reload onto a newly deployed build (a ratified
// browser-shell necessity, D2). Page chrome, independent of the game, so it
// installs first. No on-screen build stamp or network "commits behind" fetch -
// those were removed for parity (audit 05 FEAT-3): the base game shows nothing
// that upstream Angband does not.
installAutoUpdate();

const canvas = document.getElementById("game") as HTMLCanvasElement;
const term = new GlyphTerm(canvas);
// The user's saved colour edits (do_cmd_colors) are a global pref in
// localStorage; apply them to the live angband_color_table before the first
// paint so custom colours are honoured from boot.
loadColorPrefs();
// User keymaps (do_cmd_keymaps) are a global pref too; load them before the
// first keypress so a saved keymap fires from boot.
loadKeymapPrefs();
// Accessibility bridge: mirrors messages to an ARIA live region and labels the
// canvas, since the canvas itself is opaque to screen readers (a11y.ts).
const a11y = initA11y(canvas);

// Original keyset (numpad + arrows) by default, or the roguelike keyset when
// the player toggles "rogue_like_commands" on ('=' -> User interface options)
// - read live at the resolveKey() call site below so a toggle takes effect on
// the very next keypress, exactly like upstream's OPT(player,
// rogue_like_commands) check. See keymap.ts.

// Seed and depth are overridable via the URL query so a run is shareable and
// reproducible (unmodded runs are deterministic - PORT_PLAN.md decision 22).
const params = new URLSearchParams(location.search);
// A genuine new game must draw a FRESH, unpredictable master seed - the port's
// analog of C's Rand_init() (z-rand.c:131-154 mixes time()+pid once at startup,
// called from init.c:4543). Without this every new character replayed the exact
// same dungeon, flavors, and randarts. An explicit ?seed= still overrides, for
// shareable/reproducible runs and the autoplayer (PORT_PLAN.md decision 22).
const seedParam = params.get("seed");
const seed =
  seedParam !== null && seedParam !== "" && Number.isFinite(Number(seedParam))
    ? Number(seedParam)
    : crypto.getRandomValues(new Uint32Array(1))[0] || 1;
// A new character starts in town (depth 0), faithful to the original, so the
// shops are the first thing you can visit. Overridable via ?depth= (0 is
// honoured explicitly rather than falling through to a dungeon default).
const depthParam = params.get("depth");
const depth = depthParam !== null && depthParam !== "" ? Number(depthParam) : 0;

const pack: GamePack = loadGamePack();

// Saves live in localStorage as stamped bytes (decision 16b tamper
// deterrent), base64-wrapped. A genuine load shows the title + character select
// and the player chooses Continue (the web analog of the original's savefile
// menu); it never silently auto-resumes. Only an internal continuation
// (resumeSelected's SKIP_TITLE, or the ?agent autoplayer) restores directly.
// Death clears the save (decision 16: death is terminal).
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
// Post-birth RNG snapshot: ui-birth.c advances the live state.rng (* / @ / roller /
// get_history); the reload that rebuilds the character restores this state so
// startGame continues from the same stream position (Decision 6.2).
const BIRTH_RNG_KEY = "neo-angband-birth-rng";
// The boot title/news screen shows on every genuine launch (main-win.c:5475:
// the GUI ports display news.txt and wait). Internal reloads that continue an
// already-made choice (New/Switch/resume-a-slot) set this one-shot flag so the
// title is not shown again on that continuation reload.
const SKIP_TITLE_KEY = "neo-angband-skip-title";
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
  /**
   * The accepted standard-roller natural stats (BR_NORMAL); applied verbatim by
   * generatePlayer's rolledStats path (NOT the point-buy clamp) when the roller
   * method was "roller".
   */
  rolledStats?: number[];
  /** An edited character background (do_cmd_choose_history); replaces the
   * generated get_history text on the born player. */
  history?: string;
  /** birth_* options set via '=' during birth (do_cmd_options_birth), applied
   * as startGame optionOverrides so they freeze into the new character. */
  birthOptions?: Record<string, boolean>;
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

/**
 * The effective mod-rule flags for this session: every enabled mod's declared
 * rules resolved against the player's saved Fixes & tweaks choices
 * (choice ?? default). Seeds GameState.modRules at start/load so the qol /
 * bug-fixes tweaks take effect. Empty (faithful core) when no rule-declaring mod
 * is enabled or all rules sit at an off default.
 */
function activeModRules(): Record<string, boolean> {
  return resolveModRules(loadEnabledModRuleDecls(), defaultModStore().getRuleChoices());
}

/**
 * True when this load is an internal continuation rather than a genuine launch:
 * the autoplayer boot (?agent), or a reload triggered by an in-app action that
 * already passed the title (resumeSelected / switchCharacter / mod-apply set
 * SKIP_TITLE_KEY). Genuine launches - a fresh visit, a refresh, or a reopened
 * tab - are NOT continuations, so they always route through the title and the
 * character select rather than dropping straight back into a save.
 */
function isContinuation(): boolean {
  if (params.get("agent")) return true;
  try {
    return sessionStorage.getItem(SKIP_TITLE_KEY) === "1";
  } catch {
    return false;
  }
}

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
    // Auto-resume the active character ONLY on an internal continuation: the
    // player chose Continue from the title's character select (resumeSelected
    // sets SKIP_TITLE), or the autoplayer boot (?agent). A GENUINE launch - a
    // fresh visit, a refresh, or a reopened tab - never drops straight into a
    // save; it always shows the title, then the character select. That is what
    // makes every launch open fresh and reinforces the anti-scum rule that a
    // refresh returns to the title, not to the live game.
    if (stored && isContinuation()) {
      try {
        const decoded = decodeSavedGame(b64ToBytes(stored));
        if (decoded.save) {
          // Faithful: a clean resume shows no "welcome" line (the original just
          // restores the game). Only a failed integrity check - a web-storage
          // failure mode with no C analog - surfaces a warning.
          loadedNote = decoded.verified
            ? ""
            : "WARNING: save integrity check failed.";
          resumedActive = true;
          // present = core + every enabled CONTENT mod's namespace (pack.ts),
          // so loadGame reconciles the save's mod-lifecycle blocks correctly:
          // a still-enabled mod's live content is NOT quarantined, and a mod
          // that was removed since the save has its content quarantined (and
          // rehydrated if re-enabled). Hardcoding core-only here would strip a
          // content mod's world entities on the first reload after enabling it.
          return loadGame(pack, decoded.save, presentNamespaces(), {
            modRules: activeModRules(),
          });
        }
      } catch {
        loadedNote = "Could not read the save; starting a new game.";
      }
    }
    // Not resuming: if any characters are saved, the title's character select
    // (bootMenus) picks one - Continue or New; the game started here is a
    // throwaway shown behind it and must NOT claim a slot, so no active id is
    // set in that case.
    if (livingRoster().length > 0) needsSelect = true;
  }
  bootedNew = true;
  // A genuine new character (forcedNew, or an empty roster with nothing to
  // pick) gets an active slot now so its autosaves land.
  if (!needsSelect && !getActiveId()) setActiveId(newCharId());
  // Resume the main stream after the birth UI advanced it (ui-birth.c draws
  // before level gen). Absent, start from seed as a normal new game.
  let birthRngState: ReturnType<Rng["getState"]> | undefined;
  try {
    const raw = sessionStorage.getItem(BIRTH_RNG_KEY);
    if (raw) {
      birthRngState = JSON.parse(raw) as ReturnType<Rng["getState"]>;
      sessionStorage.removeItem(BIRTH_RNG_KEY);
    }
  } catch {
    /* storage disabled or corrupt: fall through to seed */
  }
  return startGame(pack, {
    seed,
    depth,
    ...(birthRngState ? { rngState: birthRngState } : {}),
    // The effective mod-rule flags (qol / bug-fixes tweaks) for this session:
    // enabled mods' declared rules resolved against the player's saved choices.
    // Empty => faithful core. Upstream OPTIONS are NOT set here - they ship in
    // core at their upstream defaults and come from the save on resume.
    modRules: activeModRules(),
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
    // The accepted standard-roller stats ride the rolledStats path (verbatim,
    // no point-buy clamp), used when no point-buy allocation was stored.
    ...(!(birthChoice?.stats && birthChoice.stats.length === 5) &&
    birthChoice?.rolledStats &&
    birthChoice.rolledStats.length === 5
      ? { roller: "roller" as const, rolledStats: birthChoice.rolledStats }
      : {}),
    // An edited character background (do_cmd_choose_history) overrides the
    // engine-generated get_history text.
    ...(birthChoice?.history ? { history: birthChoice.history } : {}),
    // birth_* options chosen via '=' during birth (do_cmd_options_birth): applied
    // as overrides and frozen into the new character's OptionState (game.ts:2115).
    ...(birthChoice?.birthOptions &&
    Object.keys(birthChoice.birthOptions).length > 0
      ? { optionOverrides: birthChoice.birthOptions }
      : {}),
  });
}

const game = bootGame();
// Strip the one-shot boot params (?new / ?seed / ?depth) from the visible URL
// once they have been consumed. They are read into `params` / `seed` / `depth`
// at module load (never re-read from location), so removing them here is safe
// and prevents a plain browser refresh from re-triggering forcedNew - which
// would reroll the active character (and clobber its slot) instead of resuming.
// A refresh now returns to the title + character select, the intended anti-scum
// behaviour. resumeSelected / switchCharacter already clear these on their own
// reloads; this covers the birth and New-Character reloads that leave ?new set.
try {
  const u = new URL(location.href);
  if (u.searchParams.has("new") || u.searchParams.has("seed") || u.searchParams.has("depth")) {
    u.searchParams.delete("new");
    u.searchParams.delete("seed");
    u.searchParams.delete("depth");
    history.replaceState(null, "", u.toString());
  }
} catch {
  /* history/URL unavailable: harmless, the params just linger */
}
const { state, registry, booted, players } = game;
/* effects.c L437-458 and ui-effect.c L34-180: the core chooser remains a
 * synchronous value seam, so the web host presents the menu before advancing
 * the command and supplies the selected row when the engine reaches EF_SELECT. */
let pendingEffectChoice: number | null = null;
const effectMenuDeps = {
  projections: booted.registries.projections ?? [],
  timedDesc: (idx: number) => players.timed.find((t) => t.index === idx)?.desc ?? "",
  statName: (idx: number) =>
    booted.registries.objects.properties.find(
      (p) => p?.type === OBJ_PROPERTY.STAT && p.propIndex === idx,
    )?.name ?? "",
  summonDesc: (idx: number) => booted.registries.monsters.summons[idx]?.desc ?? "",
  foodFull: 90 * state.z.foodValue,
  foodHungry: state.z.foodHungry,
};
state.effectChooser = (): number => {
  const choice = pendingEffectChoice;
  pendingEffectChoice = null;
  return choice ?? -1;
};

/** Present the C-shaped EF_SELECT rows through the GlyphTerm overlay seam. */
async function choosePlayerEffect(chain: Effect | null): Promise<boolean> {
  if (!chain || chain.index !== EF.SELECT || !chain.dice) return true;
  const value = chain.dice.randomValue();
  /* All live SELECT lists use a fixed count. Do not pre-roll a dynamic count:
   * that would consume the engine's later dice draw and change the seed. */
  if (value.dice !== 0 || value.sides !== 0 || value.base < 2) return true;
  const rows = effectChoiceRows(chain.next, value.base, effectMenuDeps);
  const selected = await selectFromMenu(
    term,
    "Which effect?",
    rows.map((row) => ({ label: row.label })),
    "[ a-z to choose, ESC to cancel ]",
  );
  /* Keep the engine's cancellation policy in charge: queue the command with
   * -1 so effectDo returns false exactly as the core seam specifies. */
  pendingEffectChoice = selected === null ? -1 : (rows[selected]?.choice ?? -1);
  return true;
}
// The effect interpreter (null on a worldless boot), surfaced for the trusted
// mod registry facade (?trusted=<id>, W2.2).
const effectRegistry = game.effects;
const features = booted.registries.features;
const constants = booted.registries.constants;
/**
 * build_prob over names.txt section RANDNAME_TOLKIEN, the corpus
 * player_random_name (player.c:375) draws from. Built once and memoised; null
 * when the pack ships no names.json, in which case playerRandomName no-ops.
 */
const tolkienNameProbs = ((): (() => ReturnType<typeof buildProb> | null) => {
  let cached: ReturnType<typeof buildProb> | null | undefined;
  return () => {
    if (cached === undefined) {
      const words = booted.registries.nameSections.get(RANDNAME_TOLKIEN);
      cached = words && words.length > 0 ? buildProb(words) : null;
    }
    return cached;
  };
})();
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
  uiEntryPacks: typeof uiEntryPacks;
  inspectExtras: ObjectInfoExtras;
  seedRandart: number;
  msg: (text: string) => void;
} {
  const p = state.actor.player;
  const bowSlot = p.body.slots.findIndex((s) => s.type === "BOW");
  const launcher = bowSlot >= 0 ? gearGet(state.gear, p.equipment[bowSlot] ?? 0) : null;
  return {
    numShots: state.actor.combat.numShots,
    launcher,
    onRename: renamePlayer,
    uiEntryPacks,
    // The char-dump extras ('f'): object_info_chardump blocks + [Randart seed].
    inspectExtras,
    seedRandart: game.randartSeed,
    // 'f' reports its own result (ui-player.c:1273-1275).
    msg: (text: string) => say(text),
  };
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

// do_animation increments a uint8_t `flicker` counter each animation tick.
// RF_ATTR_MULTI draws randint1(BASIC_COLORS - 1) on the MAIN game RNG
// (ui-display.c:1439-1446); Decision 6.2 requires that main-stream draw, not
// Math.random. Flicker frame itself is display-only (no RNG).
let animFrame = 0;
const displayRandint1 = (n: number): number => state.rng.randint1(n);

// --- Graphics tiles (grafmode.c) --------------------------------------------
// Tile sets are CORE content, exactly as upstream: lib/tiles/list.txt is parsed
// by grafmode.c into `graphics_modes` and every frontend builds its Graphics
// menu by walking that catalog (main-win.c:2897-2905). The port ships the
// catalog in core (visuals/grafmode) and four of the freely-licensed upstream
// packs under public/tiles/<dir>/ (see CREDITS.md), so graphics work on a stock
// install with no mod enabled - a `tiles`-shape mod ADDS sets, it is never
// needed for these. ASCII (mode 0) is the default, as in the C.
//
// A mode is chosen in the game menu (persisted to localStorage) or with
// `?graf=<id>`; `?tiles=<url>` repoints the pack base at a pack of your own
// (e.g. the deliberately-unbundled Shockbolt set). When a mode is active the
// live map blits tiles: each visible cell's entity (feature/monster/object/trap)
// is looked up in the pack's graf/flvr pref TileMap (core visuals/tile-prefs)
// and drawn from the atlas; a missing mapping or a not-yet-loaded image degrades
// to the ASCII glyph, so tiles never blank or crash the map.
//
// TWO ENGINES draw a mode, both behind the same TileBlitter + TileMap seam, so
// the render path below does not care which is active: the classic TILESHEET
// (tiles.ts - one atlas PNG addressed by row/column, what every upstream pack
// is), and LOOSE PACKS (linoleum-pack.ts - a directory of named PNGs with
// variant pools, which a mod can add). Core modes are always tilesheets.
const TILE_MODE_KEY = "neo-angband:graf";

/** buildid (buildid.c:37 = VERSION_NAME " " VERSION_STRING), for dump headers. */
const BUILD_ID = `Neo Angband ${PARITY_BASELINE}`;
// Bundled packs live at public/tiles/; a ?tiles= override points elsewhere.
const tilesBaseUrl = params.get("tiles") || "tiles";
const customTilesBase = Boolean(params.get("tiles"));
const tileDeps: TilePrefsDeps = {
  features: booted.registries.features,
  objects: booted.registries.objects,
  monsters: booted.registries.monsters,
  traps: booted.registries.traps,
};

/** The persisted/URL-selected graphics mode id (GRAPHICS_NONE = ASCII). */
function readTileMode(): number {
  const fromUrl = Number(params.get("graf"));
  if (fromUrl) return fromUrl;
  const stored = Number(localStorage.getItem(TILE_MODE_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : GRAPHICS_NONE;
}

// Every tile mode this install can offer, ASCII excluded: core's own sets (the
// upstream list.txt catalog, restricted to the art that ships unless ?tiles=
// points at a pack of your own) with the enabled `tiles`-shape mods' packs
// layered over them. Read once at boot, like the C reads list.txt once at
// startup; toggling a mod reloads the shell, so the list is rebuilt then.
const availableTileModes: readonly TileModeEntry[] = composeTileModes({
  core: coreTileModes({ customBaseUrl: customTilesBase }),
  mods: discoverEnabledTileModes(),
});

let tileset: TileBlitter | null = null;
let tileMap: TileMap | null = null;
let currentGrafID = GRAPHICS_NONE;

/**
 * Where a mode's art is fetched from: the shell's own tile base for core modes,
 * or the contributing mod's declared pack base when a mod supplied the mode, so
 * a mod's tiles come from the MOD's assets. An id nobody offers (e.g. `?graf=5`
 * with no pack) falls back to the shell base and simply 404s into ASCII.
 */
function tileBaseFor(grafID: number): string {
  const entry = availableTileModes.find((m) => m.grafID === grafID);
  return entry?.baseUrl ?? tilesBaseUrl;
}

/**
 * Load (or clear, with GRAPHICS_NONE) a graphics mode and repaint. Async and
 * best-effort - any fetch/parse/image failure leaves the map ASCII. Exposed for
 * the Options tile-mode selector; it also persists the choice.
 *
 * Either engine ends up in the same two variables: a TileBlitter that turns a
 * tile code into pixels, and the core TileMap that says which code an entity
 * draws. A tilesheet gets them from the atlas image plus the pack's graf/flvr
 * prefs; a loose pack gets both from its own manifest and target maps.
 */
async function applyTileMode(grafID: number, persist = false): Promise<void> {
  currentGrafID = grafID;
  if (persist) {
    if (grafID && grafID !== GRAPHICS_NONE) {
      localStorage.setItem(TILE_MODE_KEY, String(grafID));
    } else {
      localStorage.removeItem(TILE_MODE_KEY);
    }
  }
  const entry =
    grafID && grafID !== GRAPHICS_NONE
      ? availableTileModes.find((m) => m.grafID === grafID)
      : undefined;

  if (entry?.engine === "linoleum") {
    tileset = null;
    tileMap = null;
    renderBackground();
    const pack = await loadLinoleumPack({
      baseUrl: entry.baseUrl ?? tilesBaseUrl,
      menuname: entry.menuname,
      deps: tileDeps,
    });
    // Ignore a stale load if the mode changed while we were fetching.
    if (currentGrafID !== grafID) return;
    if (pack) {
      pack.onReady = () => renderBackground();
      tileset = pack;
      tileMap = pack.index.map;
    }
    renderBackground();
    return;
  }

  const mode =
    grafID && grafID !== GRAPHICS_NONE ? getGraphicsMode(grafID) : undefined;
  if (!mode || mode.grafID === GRAPHICS_NONE) {
    tileset = null;
    tileMap = null;
    renderBackground();
    return;
  }
  const base = tileBaseFor(grafID);
  const ts = createTileRenderer({ baseUrl: base, grafID });
  if (ts) ts.onReady = () => renderBackground();
  tileset = ts;
  tileMap = null;
  renderBackground();
  const map = await loadTilePrefs(base, mode, tileDeps);
  // Ignore a stale load if the mode changed while we were fetching.
  if (currentGrafID === grafID) {
    tileMap = map;
    renderBackground();
  }
}

/**
 * Decode a pref TileMap atlas cell into a blit callback for the terminal, or
 * undefined when there is no usable tile (no atlas entry, no/uninitialised
 * tileset, or the attr/char is an ASCII pair rather than a tile). The terminal
 * falls back to the ASCII glyph whenever this is undefined or the blit fails.
 *
 * The map grid is passed through to the blit: a tilesheet ignores it (a code is
 * a fixed atlas position), while a loose pack resolves a variant POOL against
 * it, so one selector can draw several tiles and still be identical on every
 * replay of a seed.
 */
function tileDrawFor(atlas: TileAtlas | null, x: number, y: number): TileDraw | undefined {
  const ts = tileset;
  if (!atlas || !ts || !ts.ready) return undefined;
  if (!isTile(atlas.attr, atlas.char)) return undefined;
  const code = tileCode(atlas.attr, atlas.char);
  return {
    draw: (ctx, px, py, w, h) => ts.drawTile(ctx, px, py, w, h, code, { x, y }),
  };
}

// The Graphics screen's rows: ASCII first (the C's hardcoded GRAPHICS_NONE
// entry, grafmode.c L137-146), then the composed catalog. Only a mod-supplied
// row carries modName, and only those are tagged in the menu - an untagged row
// is a tile set the game itself ships.
const tileModeMenu: TileModeMenu = {
  modes: [
    { grafID: GRAPHICS_NONE, menuname: "None (ASCII)" },
    ...availableTileModes.map((m) => ({
      grafID: m.grafID,
      menuname: m.menuname,
      ...(m.modName === undefined ? {} : { modName: m.modName }),
    })),
  ],
  current: () => currentGrafID,
  apply: (grafID: number) => applyTileMode(grafID, true),
};

// Sidebar mode (do_cmd_sidebar_mode, ui-options.c): SIDEBAR_MODE is a UI-term
// display setting (angband_term[0]->sidebar_mode), not a player option, so it
// lives here in the web layer and persists to localStorage (upstream saves it
// to a pref file, not the savefile). Left = the classic 13-column status
// column; Top = a one-line vitals header over a full-width map; None = no
// vitals furniture at all. viewport() reads this to pick the layout.
const SIDEBAR_MODE_KEY = "neo-angband:sidebar-mode";
const SIDEBAR_MODES = ["Left", "Top", "None"] as const; // SIDEBAR_LEFT/TOP/NONE
type SidebarLayout = "left" | "top" | "none";

function readSidebarMode(): number {
  const stored = Number(localStorage.getItem(SIDEBAR_MODE_KEY));
  return Number.isInteger(stored) && stored >= 0 && stored < SIDEBAR_MODES.length
    ? stored
    : 0; // default SIDEBAR_LEFT
}
let sidebarMode = readSidebarMode();

const sidebarModeMenu: SidebarModeMenu = {
  modes: SIDEBAR_MODES,
  current: () => sidebarMode,
  set: (index: number) => {
    const n = SIDEBAR_MODES.length;
    sidebarMode = ((index % n) + n) % n;
    if (sidebarMode === 0) localStorage.removeItem(SIDEBAR_MODE_KEY);
    else localStorage.setItem(SIDEBAR_MODE_KEY, String(sidebarMode));
    render();
  },
};

// Faithful: a freshly-born character enters town with a BLANK message line.
// player-birth.c (L1240-1249) clears the message buffer and pushes a five-line
// birth divider ending in " ", so nothing is shown on the top line at start;
// there is no tutorial/welcome hint in the original. loadedNote is empty on a
// clean new game or a clean resume, and carries only a web-only load-failure
// warning (corrupt/undecodable save) - a situation with no C analog - so that
// the player is told when their browser-stored save could not be trusted.
let message = loadedNote;
let messageColor = UI_TEXT;
let dead = false;

// The message log: every message the engine emits this session, for the top
// status line and the scrollable history (Ctrl-P). state.msg is the core's
// central message sink; routing it here means command/effect messages surface
// without each call site knowing about the shell.
const msglog = new MessageLog();
function say(text: string, type?: MessageType): void {
  if (!text) return;
  if (state.messages) {
    pushTypedMessage(
      msglog,
      text,
      type,
      (code) => state.messages!.typeColor(code),
      colorToCss,
    );
  } else {
    msglog.push(text, UI_TEXT);
  }
  message = msglog.latest();
  messageColor = msglog.latestEntry()?.color ?? UI_TEXT;
  // Mirror to the screen-reader live region (the canvas is invisible to AT).
  a11y.announce(text);
}
state.msg = (raw: string, type?: MessageType): void => {
  // bug-fixes mod, "bugfix.miscStrings": upstream's own cosmetic string warts.
  // Applied at the single message sink so every msg()/msgt() in core and the
  // shell is covered by one hook; identity when the flag is off, so faithful
  // core is byte-identical (docs/modding/BUG_FIXES.md).
  const text = state.modRules?.["bugfix.miscStrings"] ? miscStringFix(raw) : raw;
  const code = messageTypeCode(type);
  // Persist the message into the core's rolling log (gap 12.8, wr_messages) so
  // it survives save/load, preserving the MSG_* type used by msgt().
  state.messages?.add(text, code);
  // Route the message onto the event bus (W1.6) so mods can subscribe to
  // "message", then render it. state.events is attached below; before that
  // (early boot) the emit is simply skipped.
  state.events?.emit("message", { msg: text, type: code });
  say(text, type);
};

// BIRTH_MESSAGE_RECALL_BANNER (player-birth.c L1245-1249, 1.11/WP-7 handoff):
// at character acceptance, upstream pushes five padded lines into the message
// buffer so a new character's log opens below a visible divider. In this shell
// character acceptance IS a genuine new-game boot (bootedNew, the character
// chosen and not the roster picker). Pushed straight into the log (not via say)
// so it seeds the Ctrl-P history, leaving the top status line blank as in the
// original (the divider's last entry is a space).
if (bootedNew && !birthPending && !needsSelect) {
  for (const line of BIRTH_MESSAGE_RECALL_BANNER) msglog.push(line);
}

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
      /* An afraid player cannot land the blow: py_attack_real prints "You are
       * too afraid to attack X!" instead of a miss (player-attack.c L754). This
       * is the invisible-monster / tunnel-into-monster path; obvious monsters
       * are stopped earlier by do_cmd_walk_test (core walkAction). */
      if (blow.verb === "afraid") {
        /* msgt(MSG_AFRAID, ...) (player-attack.c L754): the type carries the
         * message.prf colour, so pass it through say() and not only to sound. */
        say(`You are too afraid to attack ${name}!`, "AFRAID");
        state.sound?.(MSG.AFRAID);
        continue;
      }
      /* msgt(MSG_MISS, ...) (player-attack.c L766). */
      say(`You miss ${name}.`, "MISS");
      state.sound?.(MSG.MISS);
      continue;
    }
    say(`You ${blow.verb} ${name}.`);
    const flavor = CRIT_FLAVOR[blow.msg];
    if (flavor) say(flavor);
    state.sound?.((MSG as Record<string, number>)[blow.msg] ?? MSG.HIT);
  }
  if (result.monsterDied) {
    /* player_kill_monster death confirmation (mon-util.c L1057-1065): an unseen
     * monster is "killed", a non-living one (skeleton/golem/...) "destroyed",
     * a living one "slain". The port previously hardcoded "slain". */
    const verb = !monsterIsVisible(mon)
      ? "killed"
      : monsterIsDestroyed(mon)
        ? "destroyed"
        : "slain";
    /* msgt(MSG_KILL, ...) (mon-util.c kill message): carry the type so the
     * message.prf colour applies, not just the sound. */
    say(`You have ${verb} ${name}.`, "KILL");
    state.sound?.(MSG.KILL);
  }
};

// Modal gate: while a full-screen overlay (inventory, character sheet, message
// history, item/spell selection) owns the keyboard, the in-game key handler
// stands down - exactly the single-owner input model of the upstream UI.
let modalDepth = 0;

/**
 * A BACKGROUND repaint: a redraw nothing the player just did asked for, arriving
 * asynchronously - a graphics pack's atlas finishing its fetch, its prefs
 * resolving, a layout/ResizeObserver settle, the idle animation tick.
 *
 * These must stand down while a full-screen overlay owns the terminal, because
 * they can land in the middle of one and paint the map over it. That is exactly
 * how the TITLE SCREEN came to be invisible with a graphics mode selected: the
 * title was drawn, then applyTileMode's onReady/prefs render() wiped it, leaving
 * the town map on screen with the title modal still silently waiting on a key -
 * so the first keypress "mysteriously" opened character select. Upstream cannot
 * hit this at all: its UI is single-threaded and nothing repaints mid-command.
 *
 * Deliberate in-command render() calls are NOT routed through here - a modal
 * flow that means to redraw the map (targeting, locate, the level map) still
 * calls render() directly. openModal repaints once on close, so a suppressed
 * background frame is caught up as soon as the overlay closes.
 */
function renderBackground(): void {
  if (modalDepth > 0) return;
  render();
}

async function openModal(fn: () => Promise<void>): Promise<void> {
  modalDepth++;
  try {
    await fn();
  } finally {
    modalDepth--;
    /* renderBackground, not render: when modals NEST, the inner one closing must
     * not repaint the map over the outer one's screen. This was live - the
     * key_confirm_command gate opens a modal, and its close wiped the item
     * picker the confirmation had just approved, leaving a modal waiting for a
     * key with the town map on screen. The same shape as the invisible title
     * screen. The outermost close still repaints, since depth is 0 by then. */
    renderBackground();
  }
}

// --- Item-use commands (cmd-obj.c verbs) ------------------------------------
// Each verb opens a lettered selection menu over the pack (filtered by tval),
// then dispatches a PlayerCommand referencing the chosen object by args.handle
// - the live command system's object reference (obj-cmd.ts commandObject). For
// items that need aiming (wands, unknown rods, aimed effects: objNeedsAim), it
// prompts a keypad direction and passes args.dir; the engine bypasses its own
// get_aim_dir when a dir is supplied. The commands are installed with a message
// env (session/game.ts) that routes msg / activation_message / the use_aux and
// inven_wield/takeoff/drop describe lines to the log, so the shell no longer
// narrates the action itself - upstream prints no "You quaff X" wrapper, only
// the effect's own messages (cmd-obj.c use_aux L493-706).

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
 * Build the get_item sources (command_wrk lists) the request allows - Inven,
 * Equip, Floor, in upstream display order - each filtered by req.tester, with a
 * parallel ItemTargetRef list per source so the itemSelect result maps back to
 * the right handle / floor index. USE_QUIVER is its OWN list, as upstream's
 * command_wrk states are (built from `player->upkeep->quiver`, digit-tagged, and
 * reached with '|'); it used to fold into the inventory pass, which is why
 * quivered ammo appeared under Inven. `deviceFail` shows the OLIST_FAIL failure
 * column on the inventory rows (device-use pickers).
 */
function buildItemSources(
  tester: (o: GameObject) => boolean,
  mode: { inven?: boolean; quiver?: boolean; equip?: boolean; floor?: boolean },
  deviceFail = false,
): { sources: ItemMenuSource[]; refs: ItemTargetRef[][] } {
  const sources: ItemMenuSource[] = [];
  const refs: ItemTargetRef[][] = [];
  if (mode.inven) {
    const { items, handles } = deviceFail
      ? deviceMenu(state, tester, isKindAware)
      : packMenu(state, tester);
    if (items.length > 0) {
      sources.push({ label: "Inven", items });
      refs.push(handles.map((h) => ({ handle: h })));
    }
  }
  if (mode.equip) {
    const player = state.actor.player;
    const items: MenuItem[] = [];
    const eRefs: ItemTargetRef[] = [];
    for (let i = 0; i < player.body.count; i++) {
      const handle = player.equipment[i] ?? 0;
      if (!handle) continue;
      const obj = gearGet(state.gear, handle);
      if (!obj || !tester(obj)) continue;
      // gear_to_label for equipment is labels[equipped_item_slot] (obj-gear.c
      // L451-453) / build_obj_list's all_letters_nohjkl[i] over BODY SLOTS, so a
      // filtered equipment list keeps each slot's own letter.
      items.push({ label: objectName(state, obj), color: objectColor(obj, state), tag: objLetter(i), inscrip: obj.note });
      eRefs.push({ handle });
    }
    if (items.length > 0) {
      sources.push({ label: "Equip", items });
      refs.push(eRefs);
    }
  }
  if (mode.quiver) {
    const { items, handles } = quiverMenu(state, tester);
    if (items.length > 0) {
      sources.push({ label: "Quiver", items });
      refs.push(handles.map((h) => ({ handle: h })));
    }
  }
  if (mode.floor) {
    const items: MenuItem[] = [];
    const fRefs: ItemTargetRef[] = [];
    floorPile(state, state.actor.grid).forEach((obj, i) => {
      if (!tester(obj)) return;
      // build_obj_list over the floor list keeps each entry's own index letter
      // (ui-object.c:291-292), so filtering does not reletter the pile.
      items.push({ label: objectName(state, obj), color: objectColor(obj, state), tag: objLetter(i), inscrip: obj.note });
      fRefs.push({ floor: i });
    });
    if (items.length > 0) {
      sources.push({ label: "Floor", items });
      refs.push(fRefs);
    }
  }
  return { sources, refs };
}

/**
 * The keypress each item command is bound to (cmd_lookup_key_unktrl,
 * ui-game.c:461-473), per keyset: `o` is the original key, `r` the roguelike one
 * where it differs. cmd_init copies key[0] into key[1] whenever a roguelike key
 * is unset (ui-game.c:409-410), so an absent `r` means "same as `o`".
 *
 * This is the `x` an `@x<digit>` inscription is matched against (get_tag,
 * ui-object.c:735-744), so a tag follows the player's keyset exactly as
 * upstream: `@z1` is the rod on the original keyset and the wand on roguelike.
 */
const ITEM_CMD_KEYS: Record<string, { o: string; r?: string }> = {
  // cmd_item (ui-game.c:118-133).
  inscribe: { o: "{" },
  uninscribe: { o: "}" },
  wield: { o: "w" },
  takeoff: { o: "t", r: "T" },
  drop: { o: "d" },
  fire: { o: "f", r: "t" },
  "use-staff": { o: "u", r: "Z" },
  "aim-wand": { o: "a", r: "z" },
  "zap-rod": { o: "z", r: "a" },
  activate: { o: "A" },
  eat: { o: "E" },
  quaff: { o: "q" },
  read: { o: "r" },
  refill: { o: "F" },
  use: { o: "U", r: "X" },
  // cmd_action (ui-game.c:152).
  throw: { o: "v" },
  /* cmd_item_manage (ui-game.c:165). Ignore's roguelike key is KTRL('D'), and
   * cmd_lookup_key_unktrl deliberately runs control keys through UN_KTRL_CAP
   * (X + 64, ui-event.h:135-136) rather than UN_KTRL for exactly this case: the
   * latter would give 'd', which Drop already owns (ui-game.c:465-470). */
  ignore: { o: "k", r: "D" },
  // cmd_info (ui-game.c:173-176).
  browse: { o: "b", r: "P" },
  study: { o: "G" },
  cast: { o: "m" },
};

/**
 * The `@x<digit>` command letter for a picker upstream drives with CMD_NULL -
 * the effect item-targets (`get_item(&obj, q, s, 0, ...)`, e.g.
 * effect-handler-general.c:393, :1067, :1962) and Examine (ui-object.c:1679).
 *
 * It is 'A', and that is an accident of the command table rather than a design.
 * cmd_lookup_key walks converted_list[] by ascending key code and returns the
 * FIRST entry whose cmd matches (ui-game.c:451-456); many commands carry
 * CMD_NULL, so the winner is simply whichever sits at the lowest key. That is
 * "Debug mode commands" at KTRL('A') = 0x01 (cmd_hidden, ui-game.c:225 -
 * registered like any other list, cmds_all keymap 0). Being below 0x20 it then
 * goes through UN_KTRL_CAP, +64 (ui-game.c:469-470, ui-event.h:135-136), giving
 * 'A' in BOTH keysets.
 *
 * So `@A1` really does quick-select in these pickers upstream. Core keeps
 * upstream's warts, so it does here too.
 */
const EFFECT_ITEM_CMD_KEY = "A";

/** `code`'s command key under the live keyset (rogue_like_commands). */
function itemCmdKey(code: string): string | undefined {
  const keys = ITEM_CMD_KEYS[code];
  if (!keys) return undefined;
  const roguelike = state.options?.get("rogue_like_commands") ?? false;
  return roguelike ? keys.r ?? keys.o : keys.o;
}

/**
 * The faithful get_item picker (textui_get_item, ui-object.c): shows the prompt
 * and "(Inven: a-c, / for Equip, - for floor, ESC)" header over the allowed
 * sources and resolves the chosen ItemTargetRef, or null on ESC / an empty
 * menu. Used by the item-target effect chooser and the item-command pickers.
 *
 * `cmdKey` enables the `@`-inscription quick-select for this command (see
 * inscripTagRow / get_tag): pass the command's own key, or leave it out for a
 * picker that upstream drives with CMD_NULL, where only a bare `@<digit>` tag
 * can match. It is ALSO what get_item_allow matches `!<key>` against below.
 *
 * `cmdCode` is the same command as a code rather than a key, needed only for
 * cmd_verb in get_item_allow's prompt; omitted means CMD_NULL, whose verb is the
 * "do that with" fallback, which is what upstream reads there too.
 *
 * `isHarmless` is get_item's IS_HARMLESS flag: set on the pickers that only look
 * at an item (inscribe, examine, browse, the context menu, the visuals editor -
 * cmd-obj.c:196, ui-object.c:1680, ui-spell.c:341, ui-context.c:237,
 * ui-knowledge.c:4020), and it suppresses a blanket `!*` while still honouring
 * the command's own `!<key>`.
 */
async function selectItemFrom(
  prompt: string,
  tester: (o: GameObject) => boolean,
  mode: { inven?: boolean; quiver?: boolean; equip?: boolean; floor?: boolean },
  reject: string,
  cmdKey?: string,
  deviceFail = false,
  cmdCode?: string,
  isHarmless = false,
): Promise<ItemTargetRef | null> {
  const { sources, refs } = buildItemSources(tester, mode, deviceFail);
  if (sources.length === 0) {
    say(reject);
    return null;
  }
  const chosen = await itemSelect(term, prompt.trim(), sources, 0, cmdKey);
  if (chosen === null) return null;
  const ref = refs[chosen.source]?.[chosen.index] ?? null;
  if (!(await allowChosenItem(ref, cmdKey, cmdCode, isHarmless))) return null;
  return ref;
}

/**
 * get_item_allow on the chosen row (ui-object.c:958, inside get_item_action).
 *
 * Refusing cancels the whole selection rather than reopening the picker:
 * get_item_action returns false, so menu_select hands EVT_SELECT back to
 * textui_get_item with `selection` still NULL and the command aborts.
 *
 * A picker with no command key at all cannot be upstream - every get_item passes
 * a cmd_code, and even CMD_NULL resolves to 'A' (see EFFECT_ITEM_CMD_KEY) - so
 * an absent key here means a port-only picker and asks nothing.
 */
async function allowChosenItem(
  ref: ItemTargetRef | null,
  cmdKey: string | undefined,
  cmdCode: string | undefined,
  isHarmless: boolean,
): Promise<boolean> {
  if (!ref || cmdKey === undefined) return true;
  const obj = targetRefObject(ref);
  if (!obj) return true;
  /* The shell carries command codes as plain strings (commandBuffer.push takes
   * them that way), so narrow at this one boundary; cmdVerb returns null for
   * anything unknown, which lands on the "do that with" fallback either way. */
  const code = (cmdCode ?? null) as CommandCode | null;
  const ask = itemAllowPrompt(obj, cmdKey, code, isHarmless, (o) => objectName(state, o));
  if (!ask) return true;
  /* "Prompt for confirmation n times" (ui-object.c:669-674): one refusal ends it. */
  for (let i = 0; i < ask.count; i++) {
    if (!(await confirmYesNo(ask.prompt))) return false;
  }
  return true;
}

/**
 * The item-target effect chooser (cmd_get_item "tgtitem"): resolve req into an
 * ItemTargetRef through the faithful picker. The quiver rides the pack, so
 * USE_QUIVER is covered by the inventory pass.
 */
async function selectTargetItem(
  req: ItemRequest,
  cmdCode?: string,
  isHarmless = false,
): Promise<ItemTargetRef | null> {
  /* Without a command this really is a CMD_NULL picker and 'A' is the key
   * upstream matches (see EFFECT_ITEM_CMD_KEY). With one - inscribe, uninscribe -
   * it is that command's own key, which is what cmd_lookup_key returns and so
   * what both get_tag and get_item_allow use. */
  return selectItemFrom(
    req.prompt,
    req.tester,
    req.mode,
    req.reject,
    cmdCode === undefined ? EFFECT_ITEM_CMD_KEY : itemCmdKey(cmdCode),
    false,
    cmdCode,
    isHarmless,
  );
}

/**
 * store_sell get_item (ui-store.c L487 get_mode USE_INVEN|USE_EQUIP|USE_QUIVER|
 * USE_FLOOR): the faithful multi-source item pick the store screen uses, wired
 * as the runStore `sellPick` dependency - all four sources, the quiver included
 * (upstream sells ammo straight out of the quiver). Distinct
 * from selectItemFrom in that it does NOT emit the reject via the game message
 * log (invisible under the store frame): it returns "empty" so the store prints
 * the reject on its own message row, and "cancel" on ESC. A chosen floor pile
 * item is returned as the live object (game.sellFloor takes it directly).
 */
async function storeSellPick(
  prompt: string,
  tester: (o: GameObject) => boolean,
): Promise<SellPick> {
  const { sources, refs } = buildItemSources(tester, {
    inven: true,
    equip: true,
    quiver: true,
    floor: true,
  });
  if (sources.length === 0) return { kind: "empty" };
  // store_sell's get_item runs under CMD_DROP (ui-store.c:518), so the @-tag
  // command letter here is Drop's, not a sell-specific one.
  const chosen = await itemSelect(term, prompt.trim(), sources, 0, itemCmdKey("drop"));
  if (chosen === null) return { kind: "cancel" };
  const ref = refs[chosen.source]?.[chosen.index];
  if (!ref) return { kind: "cancel" };
  if ("handle" in ref) return { kind: "handle", handle: ref.handle };
  const obj = floorPile(state, state.actor.grid)[ref.floor];
  return obj ? { kind: "floor", obj } : { kind: "cancel" };
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
    centerPlayerOption: state.options?.get("center_player") ?? false,
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
    case "knowledge":
      await openKnowledgeMenu();
      break;
    case "map":
      await showLevelMap(term, buildOverviewForShell());
      break;
    case "messages":
      await showTextScreen(term, "Message history", messageHistoryLines(msglog));
      break;
    case "monsters":
      await showMonsterList();
      break;
    case "objects":
      await showTextScreen(term, "Objects in view", objectListLines(state));
      break;
    case "toggle-ignore":
      // textui_cmd_toggle_ignore (the K command): flip unignoring, then run the
      // same ignore_drop pass.
      state.ignore.unignoring = !state.ignore.unignoring;
      await applyIgnoreDrop();
      break;
    case "ignore-setup":
      await openIgnoreSetup();
      break;
    case "options":
      await runOptionsMenu(term, state, openIgnoreSetup, sidebarModeMenu);
      autosave(true);
      break;
    case "help":
      await runHelp(term);
      break;
    case "abilities":
      await showAbilitiesScreen();
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
      await restCmd();
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
    canSteal: player.cls.pflags.has(PF.STEAL),
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
    case "recall": {
      // lore_show_interactive on the grid's monster (ui-context.c L607-615).
      const mon = state.monsters[state.chunk.mon(grid)];
      if (mon) await showMonsterRecall(mon);
      break;
    }
    case "use-on": {
      // CMD_USE with DIR_TARGET (ui-context.c L639): use any usable device on
      // the target, not staves alone. This port has no single generic CMD_USE
      // command, so pick from all devices (wand/rod/staff) and dispatch each to
      // its own per-type verb (the aimDir prompt lets the player pick the grid).
      const { items, handles } = packMenu(
        state,
        (o) => tvalIsWand(o.tval) || tvalIsRod(o.tval) || tvalIsStaff(o.tval),
      );
      if (items.length === 0) {
        say("You have no usable items.");
        break;
      }
      const useIdx = await selectFromMenu(term, "Use which item? ", items);
      if (useIdx === null) break;
      const useHandle = handles[useIdx];
      if (useHandle === undefined) break;
      const useObj = gearGet(state.gear, useHandle);
      const useCode = useObj && tvalIsWand(useObj.tval)
        ? "aim-wand"
        : useObj && tvalIsRod(useObj.tval)
          ? "zap-rod"
          : "use-staff";
      await dispatchItemVerb(useCode, useHandle, useObj ?? null);
      break;
    }
    case "cast-on":
      await castSpell();
      break;
    case "steal":
      commandBuffer.push({ code: "steal", dir });
      advance();
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
    case "jump-trap":
      // Jump Onto (CMD_JUMP, ui-context.c L484): step onto and set off the trap.
      commandBuffer.push({ code: "jump", dir });
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
      void queueWalk(dir);
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
    isIgnored: objectIsIgnored(obj, state.ignore, isKindAware(obj.kind)),
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
    case "ignore": {
      // context_menu_object's CMD_IGNORE (ui-context.c:770,868): open the same
      // per-item ignore menu textui_cmd_ignore_menu shows, for this known item.
      const entries = buildIgnoreItemMenu(ignoreItemMenuCtx(obj, state, game));
      const pick = await selectFromMenu(
        term,
        "(Enter to select, ESC) Ignore:",
        entries.map((e) => ({ label: e.label })),
      );
      if (pick !== null && entries[pick]) {
        applyIgnoreItemChoice(entries[pick]!.action, obj, state, game);
        await applyIgnoreDrop();
      }
      break;
    }
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
    items.push({ label: `${objectName(state, obj)} (worn)`, color: UI_TEXT });
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
  /* textui_obj_examine asks ONCE, and its prompt has no trailing space where
   * death_examine's does (ui-object.c:1679 vs ui-death.c:309). */
  await inspectOnce("Examine which item?", {
    equip: true,
    inven: true,
    quiver: true,
    floor: true,
  });
}

/**
 * One pass of the inspect flow: choose an item from `mode`'s sources and show
 * its object_info. Returns whether an item was chosen, which is what
 * death_examine's `while (get_item(...))` tests (ui-death.c:312).
 */
async function inspectOnce(
  prompt: string,
  mode: { equip?: boolean; inven?: boolean; quiver?: boolean; floor?: boolean },
): Promise<boolean> {
  /* Both examine pickers are CMD_NULL | IS_HARMLESS (ui-object.c:1680,
   * ui-death.c:312), so a blanket `!*` does not stop a look. */
  const ref = await selectTargetItem(
    { prompt, reject: "You have nothing to examine.", tester: () => true, mode },
    undefined,
    true,
  );
  if (!ref) return false;
  const obj = targetRefObject(ref);
  if (!obj) return false;
  const name = objectName(state, obj);
  const header = name.charAt(0).toUpperCase() + name.slice(1); /* ODESC_CAPITAL */
  const tb = objectInfoTextblock(state, obj, inspectExtras);
  await showTextScreen(term, header, wrapRuns(tb, term.size().cols));
  return true;
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
    return [{ text: `${capped}.`, color: UI_TEXT }];
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
  if (obj) {
    const chain = buildObjectEffectChain((obj.effect ?? []) as EffectRecordJson[], state);
    if (!(await choosePlayerEffect(chain))) return;
  }
  commandBuffer.push({ code, args });
  advance();
  pendingEffectChoice = null;
}

/**
 * Dispatch `code` on an item chosen from ANY source (pack handle or floor pile
 * index). The floor branch queues args.floor, which resolveCommandItem
 * (game/obj-cmd.ts) turns back into the live floor object with fromFloor=true -
 * the faithful "act straight off the floor" path (USE_FLOOR, cmd-obj.c). This is
 * what the item-command '-' floor toggle selects.
 */
async function dispatchItemRef(code: string, ref: ItemTargetRef): Promise<void> {
  const obj = targetRefObject(ref);
  const args: Record<string, unknown> =
    "handle" in ref ? { handle: ref.handle } : { floor: ref.floor };
  if (obj && objNeedsAim(obj, { flavor: game.flavor })) {
    const dir = await aimDir();
    if (dir === null) return;
    args["dir"] = dir;
  }
  if (obj && !(await applyItemTarget(obj, args))) return;
  if (obj) {
    const chain = buildObjectEffectChain((obj.effect ?? []) as EffectRecordJson[], state);
    if (!(await choosePlayerEffect(chain))) return;
  }
  commandBuffer.push({ code, args });
  advance();
  pendingEffectChoice = null;
}

/** Device-use verbs whose picker shows the OLIST_FAIL failure column. */
const DEVICE_VERBS = new Set(["aim-wand", "zap-rod", "use-staff"]);

/** kind-awareness closure for the device FAIL% gate (object_effect_is_known). */
const isKindAware = (kind: ObjectKind): boolean =>
  game.flavor ? game.flavor.isAware(kind) : true;

/**
 * Select a pack item matching `filter`, then dispatch `code` for it. `prompt`
 * and `emptyMsg` are the EXACT cmd-obj.c strings for this command (the C
 * cmd_get_item prompt / "no item" message), not a generic template - so the
 * picker header and the empty-pack line read verbatim as upstream.
 */
async function useItem(
  code: string,
  filter: (obj: GameObject) => boolean,
  prompt: string,
  emptyMsg: string,
  mode: { inven?: boolean; equip?: boolean; quiver?: boolean; floor?: boolean } = {
    inven: true,
  },
): Promise<void> {
  // The item picker over the command's faithful cmd_get_item sources (cmd-obj.c):
  // most consumable / device / wield verbs include USE_FLOOR, so a floor item
  // can be chosen straight off the ground (the '-' floor toggle). The floor
  // branch dispatches args.floor rather than a gear handle.
  const ref = await selectItemFrom(
    prompt,
    filter,
    mode,
    emptyMsg,
    itemCmdKey(code),
    DEVICE_VERBS.has(code),
    code,
  );
  if (ref === null) return;
  await dispatchItemRef(code, ref);
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
    /* do_cmd_activate's item_tester is obj_is_activatable (cmd-obj.c L879):
     * wearable AND object_effect(obj). Testing obj.activation alone hid the
     * rings whose effect comes from the KIND (Flames / Acid / Ice / Lightning /
     * Open Wounds / Digging carry `effect:` and no `act:` in object.txt), so
     * those could never be activated. */
    if (!obj || !objIsActivatable(obj)) continue;
    // OLIST_FAIL failure column for activatable gear (ui-object.c L212-221).
    const fail = deviceFailColumn(state, obj, isKindAware);
    const name = describeObject(state, obj);
    const label = fail ? `${name.padEnd(40).slice(0, 40)} ${fail}` : name;
    items.push({ label, color: UI_TEXT, inscrip: obj.note });
    handles.push(handle);
  }
  if (items.length === 0) {
    say("You have no items to activate.");
    return;
  }
  const idx = await selectFromMenu(term, "Activate which item? ", items, undefined, {
    inscripCmdKey: itemCmdKey("activate"),
  });
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
  if (obj) {
    const chain = buildObjectEffectChain((obj.effect ?? []) as EffectRecordJson[], state);
    if (!(await choosePlayerEffect(chain))) return;
  }
  commandBuffer.push({ code: "activate", args });
  advance();
  pendingEffectChoice = null;
}

/** Take off an equipped item (t): pick from filled equipment slots via the
 * faithful get_item picker (USE_EQUIP -> "(Equip: a-c, ESC)"). */
async function takeOffItem(): Promise<void> {
  const ref = await selectItemFrom(
    "Take off or unwield which item?",
    /* obj_can_takeoff = !OF_STICKY (obj-util.c L794), used as the item FILTER
     * upstream (cmd-obj.c L251), so a stickied item is never offered. */
    (o) => !(o.flags?.has(OF.STICKY) ?? false),
    { equip: true },
    "You have nothing to take off or unwield.",
    itemCmdKey("takeoff"),
    false,
    "takeoff",
  );
  if (ref === null || !("handle" in ref)) return;
  const handle = ref.handle;
  commandBuffer.push({ code: "takeoff", args: { handle } });
  advance();
}

// --- Inscribe / uninscribe / refuel (cmd-obj.c do_cmd_inscribe /
// do_cmd_uninscribe / do_cmd_refill) ------------------------------------
// All three route through selectTargetItem's aggregated pack+equip+floor
// picker (USE_EQUIP|USE_INVEN|USE_QUIVER|USE_FLOOR upstream); the quiver
// rides the pack in this gear model. Autoinscribe has no default key
// upstream ships it only from the object-knowledge browser's `{` action
// (ui-knowledge.c:2101-2123, wired via ObjectBrowserDeps.setAutoinscription),
// and applyAutoinscription then applies the registered notes on the
// do_cmd_autoinscribe pass.

/** Inscribe (`{`): pick any item and set its inscription text. */
async function inscribeItem(): Promise<void> {
  const ref = await selectTargetItem({
    prompt: "Inscribe which item?",
    reject: "You have nothing to inscribe.",
    tester: () => true,
    mode: { equip: true, inven: true, quiver: true, floor: true },
    /* cmd-obj.c:196 - CMD_INSCRIBE with IS_HARMLESS. Uninscribe below has no
     * IS_HARMLESS (cmd-obj.c:166); the asymmetry is upstream's. */
  }, "inscribe", true);
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
    prompt: "Uninscribe which item?",
    reject: "You have nothing you can uninscribe.",
    tester: (o) => objHasInscrip(o),
    mode: { equip: true, inven: true, quiver: true, floor: true },
  }, "uninscribe");
  if (!ref) return;
  commandBuffer.push({ code: "uninscribe", args: { ...ref } });
  advance();
}

/**
 * player_can_refuel (player-util.c L1227) via player_can_refuel_prereq (L1287),
 * the 'F' key's prereq (ui-game.c:132). Checked at the KEY, before the command
 * is pushed (ui-game.c:596), which means do_cmd_refill's own two guards below
 * are unreachable from 'F' and only fire on the context-menu Refill row
 * (ui-context.c:725, offered on any obj_can_refill fuel item regardless of what
 * is worn) - so this prereq must sit on the binding, not inside refuelItem.
 *
 * Note the message is "refuelled", not do_cmd_refill's "refilled", and that
 * player_can_refuel tests OF_TAKES_FUEL only, ignoring OF_NO_FUEL.
 */
function playerCanRefuelPrereq(): boolean {
  const player = state.actor.player;
  const lightSlot = player.body.slots.findIndex((s) => s.type === "LIGHT");
  const light =
    lightSlot >= 0 ? gearGet(state.gear, player.equipment[lightSlot] ?? 0) : null;
  if (light && light.flags.has(OF.TAKES_FUEL)) return true;
  say("Your light cannot be refuelled.");
  return false;
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
    /* cmd-obj.c:1091-1095: CMD_REFILL, no IS_HARMLESS. */
  }, "refill");
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

/**
 * get_check (textui_get_check): an inline row-0 "<prompt>[y/n] " confirmation,
 * single key, y/Y only; anything else (incl. ESC) is "No". The prompt should
 * carry its own trailing space where the reference does, since get_check
 * appends "[y/n] " verbatim.
 */
function confirmYesNo(title: string): Promise<boolean> {
  return getCheck(term, title);
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
      const yes = await confirmYesNo(`Really take off and drop ${name}? `);
      if (!yes) {
        obj.note = obj.note ? `${obj.note}!d` : "!d";
        continue;
      }
    }
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

/**
 * Pick one of the player's usable spellbooks, or null if none/cancelled. The
 * prompt is "<Verb> which book?" (ui-spell.c:388) and the empty message is the
 * per-command form (defaults to the cast wording). `cmdCode` is the command this
 * pick runs under, so `@m1` / `@G1` / `@b1` book tags resolve (get_item's cmd
 * argument: CMD_BROWSE_SPELL at ui-spell.c:340, `cmd` at ui-spell.c:391).
 */
async function chooseBook(
  verb: string,
  emptyMsg = "You have no books that you can use.",
  tester: (obj: GameObject) => boolean = () => true,
  cmdCode?: string,
): Promise<number | null> {
  const { items, handles } = magicBooks(state, tester);
  if (items.length === 0) {
    say(emptyMsg);
    return null;
  }
  // No single-book shortcut: upstream get_item (ui-object.c:1494) always renders
  // the "<Verb> which book?" selection, even for one candidate, so browse/cast/
  // study never silently jump past the book prompt. The player presses the
  // book's letter (or ESC) exactly as in the original.
  const idx = await selectFromMenu(term, `${verb} which book?`, items, undefined, {
    inscripCmdKey: cmdCode ? itemCmdKey(cmdCode) : undefined,
  });
  if (idx === null) return null;
  return handles[idx] ?? null;
}

/** Cast/pray (m/p): choose book, choose spell, aim if needed, dispatch cast. */
async function castSpell(): Promise<void> {
  const player = state.actor.player;
  /* player_can_cast_prereq (player-util.c:1246), the 'm' key's prereq
   * (ui-game.c:174): checked before the book-choose menu ever opens, matching
   * upstream's key-dispatch gate (do_cmd_cast, cmd-obj.c L1122-1124, runs this
   * before cmd_get_spell). The "cast" command itself re-checks this
   * (core/game/spell-cmd.ts), so this is belt-and-suspenders for the message
   * ordering, not a new rule. */
  if (!playerCanCast(state, { msg: say })) return;
  /* do_cmd_cast's book item_tester is obj_can_cast_from (cmd-obj.c L1129): a
   * book of this realm holding at least one LEARNED spell. */
  const handle = await chooseBook(
    "Cast",
    "There are no spells you can cast.",
    (o) => objCanCastFrom(player, o),
    "cast",
  );
  if (handle === null) return;
  const bookObj = gearGet(state.gear, handle);
  if (!bookObj) return;
  const { items, sidx } = bookSpellMenu(state, bookObj, "cast");
  if (items.every((it) => it.disabled)) {
    say("That book has no spells that you can cast.");
    return;
  }
  const realm = playerObjectToBook(player, bookObj)?.realm;
  const verb = realm?.verb ?? "cast";
  const noun = realm?.spellNoun ?? "spell";
  const pick = await selectFromMenu(
    term,
    // "%s which %s? ('?' to toggle description)" (ui-spell.c:285).
    `${verb[0]?.toUpperCase()}${verb.slice(1)} which ${noun}? ('?' to toggle description)`,
    items,
    "[ a-z to choose a spell, ? to toggle description, ESC to cancel ]",
    {
      subtitle: SPELL_HEADER,
      detail: (i) =>
        spellBrowseLines(state, sidx[i] ?? -1, inspectExtras.projections, term.size().cols),
      detailToggleKey: "?",
    },
  );
  if (pick === null) return;
  const spell = sidx[pick];
  if (spell === undefined) return;
  const spellData = spellByIndex(player.cls, spell);
  /* Verify "dangerous" spells (cmd-obj.c:1139-1152): if the spell costs more
   * mana than the player has, warn and confirm; ESC/no aborts with no turn. */
  if (spellData && spellData.mana > player.csp) {
    say(`You do not have enough mana to ${verb} this ${noun}.`);
    if (!(await confirmYesNo("Attempt it anyway? "))) return;
  }
  const args: Record<string, unknown> = { spell };
  if (spellNeedsAim(player, spell)) {
    const dir = await aimDir();
    if (dir === null) return;
    args["dir"] = dir;
  }
  /* Enchant / Identify / Brand / Remove-Curse spells pick a target item. A
   * cancelled picker aborts the whole cast (no mana, no turn - the spell's
   * effect_do returns false before any mana is spent). */
  if (spellData) {
    const chain = buildObjectEffectChain(
      spellData.effectsRaw as EffectRecordJson[],
      state,
    );
    const prep = await prepareItemTarget(chain);
    if (prep === "cancel") return;
    if (prep !== "none") Object.assign(args, prep);
    if (!(await choosePlayerEffect(chain))) return;
  }
  commandBuffer.push({ code: "cast", args });
  advance();
  pendingEffectChoice = null;
}

/** Study (G): learn a spell. Choose-spell classes pick; others learn at random. */
async function studySpell(): Promise<void> {
  const player = state.actor.player;
  /* player_can_study_prereq (player-util.c:1255), the 'G' key's prereq
   * (ui-game.c:176): player_can_study (L1120) calls player_can_cast FIRST,
   * before its own new-spells check, so a blind/no_light/confused player
   * never reaches "You cannot learn any new spells!" - they get the cast
   * failure message instead. */
  if (!playerCanCast(state, { msg: say })) return;
  if (player.upkeep.newSpells <= 0) {
    say("You cannot learn any new spells!");
    return;
  }
  /* do_cmd_study_spell / do_cmd_study_book filter by obj_can_study (cmd-obj.c
   * L1187 / L1215): a book of this realm holding a spell in level range that is
   * not learned yet. */
  const handle = await chooseBook(
    "Study",
    "You cannot learn any new spells from the books you have.",
    (o) => objCanStudy(player, o),
    "study",
  );
  if (handle === null) return;
  const args: Record<string, unknown> = { handle };
  if (player.cls.pflags.has(PF.CHOOSE_SPELLS)) {
    const bookObj = gearGet(state.gear, handle);
    if (!bookObj) return;
    const { items, sidx } = bookSpellMenu(state, bookObj, "study");
    if (items.every((it) => it.disabled)) {
      say("That book has no spells that you can learn.");
      return;
    }
    const noun = playerObjectToBook(player, bookObj)?.realm.spellNoun ?? "spell";
    const pick = await selectFromMenu(
      term,
      // "Study which %s? ('?' to toggle description)" (study path, ui-spell.c).
      `Study which ${noun}? ('?' to toggle description)`,
      items,
      "[ a-z to choose a spell, ? to toggle description, ESC to cancel ]",
      {
        subtitle: SPELL_HEADER,
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

/**
 * Spell-list column header (ui-spell.c:249, m->header). Byte-faithful to the C
 * literal: "Name" then 29 spaces (Lv begins at column 33), then Lv/Mana/Fail/
 * Info. Note upstream deliberately offsets the header from the 30-wide name
 * field of the data rows (spell_menu_display, ui-spell.c:106-121), so the header
 * labels do not sit directly above their columns - reproduced here exactly.
 */
const SPELL_HEADER = `${"Name".padEnd(33)}Lv Mana Fail Info`;

/**
 * Browse (b / P, textui_spell_browse / ui-spell.c:334): a read-only view of a
 * book's spells with their descriptions shown. No spell is cast and no turn is
 * spent - ESC leaves. Any readable book qualifies (a non-caster simply has
 * "no books that you can read").
 */
async function browseCmd(): Promise<void> {
  /* textui_spell_browse filters by obj_can_browse (ui-spell.c L340) - any book
   * of one of this class's realms. */
  const handle = await chooseBook(
    "Browse",
    "You have no books that you can read.",
    (o) => objCanBrowse(state.actor.player, o),
    "browse",
  );
  if (handle === null) return;
  const bookObj = gearGet(state.gear, handle);
  if (!bookObj) return;
  const player = state.actor.player;
  /*
   * textui_book_browse / spell_menu_new (ui-spell.c:231-238, 322-324): reject
   * a book with no spell that passes spell_okay_to_browse (level < 99). Uses
   * spellBookCountSpells + spellOkayToBrowse so both sit on the live path
   * (W2-014 / W2-015). No RNG.
   */
  if (spellBookCountSpells(player, bookObj, spellOkayToBrowse) === 0) {
    say("You cannot browse that.");
    return;
  }
  const { items, sidx } = bookSpellMenu(state, bookObj, "cast");
  /* spell_menu_browse row-0 prompt (ui-spell.c:306): "Browsing %ss. ('?' to
   * toggle description)" with the realm's pluralised spell noun (priests read
   * "Browsing prayers."), not a "Browse which spell?" get_item prompt. */
  const noun = playerObjectToBook(player, bookObj)?.realm?.spellNoun ?? "spell";
  // Read-only browse: rows with level >= 99 stay disabled (illegible); all
  // other rows are viewable. Description shown from the start
  // (spell_menu_new show_description=true).
  await selectFromMenu(
    term,
    `Browsing ${noun}s. ('?' to toggle description)`,
    items.map((it, i) => ({
      ...it,
      disabled: !spellOkayToBrowse(player, sidx[i] ?? -1),
    })),
    "[ a-z or arrows to view, ? to toggle description, ESC to exit ]",
    {
      subtitle: SPELL_HEADER,
      browseOnly: true,
      detail: (i) =>
        spellBrowseLines(state, sidx[i] ?? -1, inspectExtras.projections, term.size().cols),
      detailToggleKey: "?",
      detailInitiallyShown: true,
    },
  );
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
  const ref = await selectItemFrom(
    "Fire which ammunition?",
    (o) => tvalIsAmmo(o.tval) && o.tval === tval,
    { inven: true },
    "You have no ammunition for your weapon.",
    itemCmdKey("fire"),
    false,
    "fire",
  );
  if (ref === null || !("handle" in ref)) return;
  const handle = ref.handle;
  const dir = await aimDir();
  if (dir === null) return;
  commandBuffer.push({ code: "fire", args: { handle, dir } });
  advance();
}

/**
 * Throw (v): do_cmd_throw (player-attack.c:1363). The item picker spans
 * equipment | quiver | inventory | floor, filtered by obj_can_throw
 * (obj-util.c:803) - any non-equipped item, or an equipped melee weapon that
 * can be taken off. Select the item, THEN aim; the core handler takes off a
 * wielded weapon and pulls a floor item as needed.
 */
async function throwCmd(): Promise<void> {
  const player = state.actor.player;
  const equipped = new Set<number>(
    player.equipment.filter((h): h is number => !!h),
  );
  // Reverse-map object identity to gear handle so the tester can tell an
  // equipped weapon from a pack/quiver/floor item (the pack list already holds
  // quiver items, so USE_QUIVER is covered by the inventory pass).
  const handleOf = new Map<GameObject, number>();
  for (const [h, o] of state.gear.store) handleOf.set(o, h);
  const canThrow = (o: GameObject): boolean => {
    const h = handleOf.get(o);
    const isEquipped = h !== undefined && equipped.has(h);
    // obj_can_throw: not equipped, or an equipped melee weapon that is not stuck
    // (obj_can_takeoff = !OF_STICKY, obj-util.c:795).
    if (!isEquipped) return true;
    return tvalIsMeleeWeapon(o.tval) && !(o.flags?.has(OF.STICKY) ?? false);
  };
  const ref = await selectItemFrom(
    "Throw which item?",
    canThrow,
    { inven: true, equip: true, floor: true },
    "You have nothing to throw.",
    itemCmdKey("throw"),
    false,
    "throw",
  );
  if (ref === null) return;
  const dir = await aimDir();
  if (dir === null) return;
  if ("handle" in ref) {
    commandBuffer.push({ code: "throw", args: { handle: ref.handle, dir } });
  } else {
    commandBuffer.push({ code: "throw", args: { floor: ref.floor, dir } });
  }
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
 * damage would render as 0. spellColor/blowColor recolour each listed spell /
 * blow by whether the player resists it (mon-lore.c spell_color/blow_color,
 * ported in mon/lore-describe.ts): buildLoreColorState reads the live derived
 * player_state (known resists/protections/save skill/stat_ind, already
 * rune-gated per decision 25) plus the pack and light slot, then spellColorFor
 * / blowColorFor apply the exact upstream danger buckets.
 */
function recallDeps(): LoreDeps {
  const player = state.actor.player;
  const projections = booted.registries.projections;
  const spells = booted.registries.monsters.spells;
  const colorState = buildLoreColorState(state, players.timed);
  return {
    playerLevel: player.lev,
    playerMaxDepth: player.maxDepth,
    playerSpeed: state.actor.speed,
    effectiveSpeed: state.options?.get("effective_speed") ?? false,
    spells,
    spellColor: (race, spellIndex) => spellColorFor(race, spellIndex, spells, colorState),
    blowColor: (effect) => blowColorFor(effect, colorState),
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

/** View abilities (do_cmd_abilities, ui-game.c:175 - the 'S' key). */
async function showAbilitiesScreen(): Promise<void> {
  await showAbilities(
    term,
    playerAbilities(state, {
      properties: players.properties,
      elementNames: (booted.registries.projections ?? [])
        .slice(0, state.actor.player.race.elInfo.length)
        .map((p) => p.name),
    }),
  );
}

/**
 * The knowledge menu ('~', ui-knowledge.c reset_main_knowledge_menu
 * L3593-3688): upstream's home for browsing everything the character has
 * learned. The entries appear in the exact upstream order (pre-store actions,
 * then the store contents, then the post-store actions). Browsers whose core
 * knowledge state is not yet ported are shown greyed rather than omitted, so
 * the menu keeps its faithful shape:
 *   - Object knowledge and Ego item knowledge need per-kind/ego `everseen`
 *     tracking (not modelled in core yet - obj/desc.ts L629); greyed.
 *   - Shapechange effects needs the shape-lore textblock chain (not ported);
 *     greyed.
 *   - Store/home contents (L3662-3676) pairs with Home persistence (12.1) and
 *     is out of this package's scope; omitted for now.
 * Wired: hall of fame (openHallOfFame), rune (14.10), artifact (14.11), monster, feature + trap (14.13),
 * character history, and equippable comparison. The port's interim
 * autoinscription manager (upstream lives inside the object browser via '{')
 * is retained as a trailing entry so that functionality is not lost while the
 * object browser awaits `everseen`.
 */
/**
 * Every live object find_artifact scans (ui-knowledge.c L1537): floor piles,
 * player gear, monster-held objects, store stock and stored (cached) level
 * chunks. Feeds the artifact browser's exact created-and-not-live-unidentified
 * gate (obj/artifact-known.ts).
 */
function* allWorldObjects(): Iterable<GameObject> {
  for (const pile of state.floor.values()) yield* pile;
  yield* state.gear.store.values();
  for (const mon of state.monsters) if (mon) yield* mon.heldObj;
  for (const store of state.stores ?? []) yield* store.stock;
  for (const level of state.levelCache?.values() ?? []) {
    for (const pile of level.floor.values()) yield* pile;
    for (const mon of level.monsters) if (mon) yield* mon.heldObj;
  }
}

async function openKnowledgeMenu(): Promise<void> {
  const p = state.actor.player;
  // Entries are built in the exact reference order (ui-knowledge.c:3597-3676):
  // the fixed pre-store block, then one "Display <store>'s contents" entry per
  // store, then the fixed post-store block. Each label/handler is pushed in
  // lockstep so the dynamic store entries never desync the dispatch.
  const items: MenuItem[] = [];
  const actions: (() => Promise<void>)[] = [];
  const add = (label: string, run: () => Promise<void>, disabled = false): void => {
    items.push(disabled ? { label, disabled: true } : { label });
    actions.push(run);
  };
  // Grayed unless something is known (ui-knowledge.c:3751-3799 MN_ACT_GRAYED).
  const monKnown =
    monsterKnowledgeMenu(booted.registries.monsters.races, state.lore).items.length > 0;
  const egoKnown = booted.registries.objects.egos.some((e) => game.everseen.egoSeen(e));

  // Pre-store block (pre_store_actions[], ui-knowledge.c:3597-3606).
  add("Display object knowledge", async () => {
    // textui_browse_object_knowledge (ui-knowledge.c L2139): everseen ||
    // flavoured kinds. kindName is object_kind_name (obj-desc.c L48), never
    // leaking an unidentified flavoured kind's real name.
    const objDeps: ObjectBrowserDeps = {
      isAware: (k) => game.flavor.isAware(k),
      wasTried: (k) => game.flavor.wasTried(k),
      everseen: (k) => game.everseen.kindSeen(k),
      hasFlavor: (k) => state.hasFlavor?.(k) ?? false,
      kindName: (k, aware) =>
        !aware && (state.hasFlavor?.(k) ?? false)
          ? (state.flavorText?.(k) ?? "")
          : k.name.replace(/[~&]/g, " ").trim(),
      // `{` inside the browser (ui-knowledge.c:2101-2123): "Inscribe with: "
      // sets/updates the kind's autoinscription (empty clears). Default note is
      // get_autoinscription(k, k->aware); the write is add_autoinscription with
      // the kind's aware bit.
      setAutoinscription: async (k) => {
        const registry = state.autoinscribe;
        if (!registry) return;
        const aware = game.flavor.isAware(k);
        const text = await promptText(
          term,
          "Inscribe with: ",
          registry.get(k.kidx, aware) ?? "",
          40,
          "[ type a note, Enter to accept (empty clears), ESC to cancel ]",
        );
        if (text === null) return; // ESC: leave the kind's note unchanged
        registry.set(k.kidx, text, aware);
      },
    };
    await showObjectKnowledge(
      term,
      booted.registries.objects.kinds,
      booted.registries.objects.bases,
      objDeps,
    );
  });
  add("Display rune knowledge", () =>
    /* do_cmd_knowledge_runes (ui-knowledge.c:2291) with its xtra_prompt /
     * xtra_act pair: '{' sets rune_list[i].note and runs rune_autoinscribe
     * (:2275), '}' clears it (:2252). */
    showRuneKnowledge(term, state.runeEnv, p, {
      get: (i) => state.runeNotes?.get(i),
      set: (i, note) => state.runeNotes?.set(i, note),
      autoinscribe: (i) => runeAutoinscribe(state, i),
    }),
  );
  add("Display artifact knowledge", () =>
    // do_cmd_knowledge_artifacts (ui-knowledge.c L1740). The exact
    // artifact_is_known gate (L1687): created AND no live unidentified copy.
    showArtifactKnowledge(term, {
      state,
      reg: booted.registries.objects,
      constants: booted.registries.constants,
      player: p,
      artState:
        state.artifacts ?? new ArtifactState(booted.registries.objects.artifacts.length),
      inspectExtras,
      runeEnv: state.runeEnv,
      exact: {
        worldObjects: () => allWorldObjects(),
        isCreated: (aidx: number) => state.artifacts?.isCreated(aidx) ?? false,
        wizard: wizardMode,
      },
      seedRandart: game.randartSeed,
    }),
  );
  add(
    "Display ego item knowledge",
    () =>
      // do_cmd_knowledge_ego_items (ui-knowledge.c L1827): everseen egos.
      showEgoKnowledge(
        term,
        booted.registries.objects.egos,
        booted.registries.objects.kinds,
        booted.registries.objects.bases,
        game.everseen,
      ),
    !egoKnown,
  );
  add("Display monster knowledge", () => showMonsterKnowledge(), !monKnown);
  add("Display feature knowledge", () =>
    showFeatureKnowledge(term, booted.registries.features),
  );
  add("Display trap knowledge", async () => {
    if (booted.registries.traps) await showTrapKnowledge(term, booted.registries.traps);
  });
  add("Display shapechange effects", () => {
    // do_cmd_knowledge_shapechange (ui-knowledge.c L3142).
    const shapeEnv = {
      properties: booted.registries.objects.properties,
      elementNames: (booted.registries.projections ?? []).map((pr) => pr.name),
      playerAbilities: players.properties
        .filter((pr) => pr.type === "player" && pr.code)
        .map((pr) => ({
          index: (PF as Record<string, number>)[pr.code!]!,
          desc: pr.desc,
        })),
    };
    return showShapeKnowledge(term, players.shapes, shapeEnv);
  });

  // Per-store block (ui-knowledge.c:3662-3676): "Display <store>'s contents",
  // one entry per store, with a " (N)" shortcut suffix for the first nine.
  const stores = state.stores ?? [];
  const storeStart = items.length;
  const storeCommands: Record<string, () => number> = {};
  stores.forEach((store, j) => {
    const feat = features.get(store.feat);
    const name = feat?.name ?? store.featName;
    const apos = name.endsWith("s") ? "'" : "'s";
    const shortcut = j < 9 ? ` (${j + 1})` : "";
    add(`Display ${name}${apos} contents${shortcut}`, () => showStoreKnowledge(store));
    if (j < 9) storeCommands[String(j + 1)] = () => storeStart + j;
  });

  // Post-store block (post_store_actions[], ui-knowledge.c:3609-3613).
  add("Display hall of fame", () => openHallOfFame());
  add("Display character history", () =>
    showTextScreen(term, "Player history", historyLines(state)),
  );
  add("Display equippable comparison", () => showEquipCmp(term, state, equipCmpDeps()));

  for (;;) {
    const idx = await selectFromMenu(
      term,
      "Display current knowledge",
      items,
      undefined,
      Object.keys(storeCommands).length ? { commands: storeCommands } : undefined,
    );
    if (idx === null) return;
    const run = actions[idx];
    if (run) await run();
  }
}

/**
 * do_cmd_knowledge_store (ui-knowledge.c:3522 -> textui_store_knowledge,
 * ui-store.c:1217): a read-only view of a store's stock. Reproduces the
 * store_display_frame layout - owner line, the "Store Inventory"/"Weight"/
 * "Price" header (Home shows "Home Inventory" with no Price), then the stock in
 * store_stock_list order with each item's weight and per-item buy price.
 */
async function showStoreKnowledge(store: Store): Promise<void> {
  const feat = features.get(store.feat);
  const featLabel = feat?.name ?? store.featName;
  const isHome = (feat?.code ?? store.featName).toUpperCase().includes("HOME");
  const stock = sortStoreStock(game, store);
  const lines: ScreenLine[] = [];
  lines.push({ text: isHome ? "Your Home" : store.owner.name });
  lines.push({ text: "" });
  lines.push({
    text: isHome
      ? `${"Home Inventory".padEnd(52)}Weight`
      : `${"Store Inventory".padEnd(52)}${"Weight".padEnd(10)}Price`,
  });
  if (stock.length === 0) {
    lines.push({ text: "" });
    lines.push({ text: isHome ? "  (Your home is empty.)" : "  (The shelves are bare.)" });
  }
  stock.forEach((obj, i) => {
    const name = describeObject(state, obj);
    const wgt = obj.weight;
    const weightStr = `${Math.trunc(wgt / 10)}.${wgt % 10} lb`;
    const priceStr = isHome ? "" : String(game.price(store, obj, false, 1));
    const tag = String.fromCharCode(97 + (i % 26));
    lines.push({
      text: `${tag}) ${name.padEnd(46).slice(0, 46)} ${weightStr.padStart(8)}  ${priceStr.padStart(9)}`.trimEnd(),
    });
  });
  await showTextScreen(term, featLabel, lines);
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
  const groups = monsterKnowledgeGroupViews(races, state.lore, booted.registries.monsterCategories);
  if (groups.length === 0) {
    say("You have not encountered any monsters yet.");
    return;
  }
  await runMonsterKnowledgeBrowser(groups);
}

/**
 * do_cmd_knowledge_monsters two-pane browser (ui-knowledge.c display_knowledge
 * L795): a thematic group list on the left, the selected group's members on the
 * right with the Sym / Kills / Full columns (display_monster L1170-1213) and
 * the group summary line (mon_summary L1303). Left/right (or Enter/Esc) switch
 * panes; Enter/'r' on a member opens its recall; Esc backs out then exits.
 */
function runMonsterKnowledgeBrowser(
  groups: ReturnType<typeof monsterKnowledgeGroupViews>,
): Promise<void> {
  return new Promise<void>((resolve) => {
    modalDepth++;
    let gCur = 0;
    let oCur = 0;
    let oTop = 0;
    let gTop = 0;
    let active: "group" | "member" = "group";

    const gNameLen = Math.min(20, groups.reduce((m, g) => Math.max(m, g.name.length), 0));
    const memberCol = gNameLen + 3;
    const SYM_COL = 64;
    const KILLS_COL = 68;
    const FULL_COL = 75;
    const HEADER_ROW = 2;
    const BODY_TOP = 3;

    /* mon_summary's total is over EVERY race's kills (l_list); dedupe the
       multi-membership joins by ridx so a unique is counted once. */
    const seenRidx = new Set<number>();
    let totalKills = 0;
    for (const g of groups) {
      for (const row of g.rows) {
        if (seenRidx.has(row.race.ridx)) continue;
        seenRidx.add(row.race.ridx);
        totalKills += row.lore.pkills;
      }
    }

    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      term.print(0, 0, "Knowledge - Monsters".slice(0, cols - 1), UI_GOLD);
      term.print(memberCol, HEADER_ROW, "Name", UI_TEXT);
      term.print(SYM_COL, HEADER_ROW, "Sym", UI_TEXT);
      term.print(KILLS_COL, HEADER_ROW, "Kills", UI_TEXT);
      term.print(FULL_COL, HEADER_ROW, "Full", UI_TEXT);

      const bodyRows = Math.max(1, rows - BODY_TOP - 1);
      const memRows = Math.max(1, bodyRows - 1); /* leave a row for the summary */

      if (gCur < gTop) gTop = gCur;
      if (gCur >= gTop + bodyRows) gTop = gCur - bodyRows + 1;
      for (let r = 0; r < bodyRows; r++) {
        const g = groups[gTop + r];
        if (!g) break;
        const sel = gTop + r === gCur;
        const color = sel && active === "group" ? UI_CURSOR : UI_TEXT;
        term.print(0, BODY_TOP + r, g.name.slice(0, gNameLen), color);
      }

      const members = groups[gCur]?.rows ?? [];
      if (oCur >= members.length) oCur = Math.max(0, members.length - 1);
      if (oCur < oTop) oTop = oCur;
      if (oCur >= oTop + memRows) oTop = oCur - memRows + 1;
      for (let r = 0; r < memRows; r++) {
        const row = members[oTop + r];
        if (!row) break;
        const y = BODY_TOP + r;
        const sel = oTop + r === oCur && active === "member";
        const { race, lore } = row;
        term.print(memberCol, y, race.name.slice(0, SYM_COL - memberCol - 1), sel ? UI_CURSOR : UI_TEXT);
        term.print(SYM_COL, y, race.dChar, colorToCss(race.dAttr));
        let kills: string;
        if (!race.rarity) kills = "shape";
        else if (race.flags.has(RF.UNIQUE)) kills = race.maxNum === 0 ? " dead" : "alive";
        else kills = String(lore.pkills).padStart(5);
        term.print(KILLS_COL, y, kills, UI_TEXT);
        term.print(FULL_COL, y, lore.allKnown ? "yes" : "no", UI_TEXT);
      }

      /* Group summary (mon_summary): the Uniques group shows slain uniques, the
         rest show in-group / total creatures slain. */
      const first = members[0];
      const groupKills = members.reduce((s, m) => s + m.lore.pkills, 0);
      const summary =
        gCur === 0 && first && first.race.flags.has(RF.UNIQUE)
          ? `${members.length} known uniques, ${groupKills} slain.`
          : `Creatures slain: ${groupKills}/${totalKills} (in group/in total)`;
      term.print(memberCol, rows - 2, summary.slice(0, cols - memberCol - 1), UI_CURSOR);
      term.print(
        0,
        rows - 1,
        "[ up/down: move  left/right: switch pane  Enter/r: recall  ESC: back ]".slice(0, cols - 1),
        UI_DIM,
      );
    };

    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      window.removeEventListener("keydown", onKey, true);
      term.onCellTap?.(null);
      modalDepth--;
      resolve();
    };

    const openRecall = async (): Promise<void> => {
      const row = groups[gCur]?.rows[oCur];
      if (!row) return;
      window.removeEventListener("keydown", onKey, true);
      await showRaceRecall(row.race, getLore(state.lore, row.race));
      if (done) return;
      window.addEventListener("keydown", onKey, true);
      paint();
    };

    function onKey(ev: KeyboardEvent): void {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") {
        if (active === "member") {
          active = "group";
          paint();
        } else {
          finish();
        }
        return;
      }
      if ((ev.key === "r" || ev.key === "R") && active === "member") {
        void openRecall();
        return;
      }
      const nav = menuNav(ev);
      const right = ev.key === "ArrowRight" || ev.code === "Numpad6";
      const left = ev.key === "ArrowLeft" || ev.code === "Numpad4";
      if (active === "group") {
        if (nav === "up") gCur = Math.max(0, gCur - 1);
        else if (nav === "down") gCur = Math.min(groups.length - 1, gCur + 1);
        else if (right || ev.key === "Enter") {
          if ((groups[gCur]?.rows.length ?? 0) > 0) active = "member";
        } else return;
        oCur = 0;
        oTop = 0;
        paint();
        return;
      }
      /* member pane */
      const members = groups[gCur]?.rows ?? [];
      if (nav === "up") oCur = Math.max(0, oCur - 1);
      else if (nav === "down") oCur = Math.min(members.length - 1, oCur + 1);
      else if (left) active = "group";
      else if (ev.key === "Enter") {
        void openRecall();
        return;
      } else return;
      paint();
    }

    window.addEventListener("keydown", onKey, true);
    paint();
  });
}

/**
 * do_cmd_monlist ('[', ui-mon-list.c monster_list_show_interactive L388): the
 * "list visible monsters" screen. Renders monsterListScreenLines (the faithful
 * LOS/ESP sections with counts, asleep tags, and single-monster offsets), and
 * loops on 'x' to toggle sort-by-experience (L410,456); scrolls with the
 * arrows / PageUp-Down; ESC/Enter/Space (or a footer tap) closes. Pure display.
 */
function showMonsterList(): Promise<void> {
  return new Promise<void>((resolve) => {
    let sortExp = false;
    let top = 0;
    const HEADER_ROW = 0;
    const BODY_TOP = 1;
    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      const lines = monsterListScreenLines(state, cols, sortExp);
      term.print(0, HEADER_ROW, "Visible monsters".slice(0, cols - 1), UI_TEXT);
      const bodyRows = rows - BODY_TOP - 1;
      const maxTop = Math.max(0, lines.length - bodyRows);
      if (top > maxTop) top = maxTop;
      for (let r = 0; r < bodyRows; r++) {
        const line = lines[top + r];
        if (!line) break;
        if (line.runs) {
          let x = 0;
          for (const run of line.runs) {
            if (x >= cols - 1) break;
            const chunk = run.text.slice(0, cols - 1 - x);
            term.print(x, BODY_TOP + r, chunk, run.color);
            x += chunk.length;
          }
        } else {
          term.print(0, BODY_TOP + r, line.text.slice(0, cols - 1), line.color ?? UI_TEXT);
        }
      }
      const toggle = sortExp
        ? "Press 'x' to turn OFF 'sort by exp'"
        : "Press 'x' to turn ON 'sort by exp'";
      term.print(0, rows - 1, `[ ${toggle}  ESC: back ]`.slice(0, cols - 1), UI_DIM);
    };
    const finish = (): void => {
      window.removeEventListener("keydown", onKey, true);
      term.onCellTap?.(null);
      resolve();
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const { rows } = term.size();
      const page = Math.max(1, rows - BODY_TOP - 2);
      if (ev.key === "Escape" || ev.key === "Enter" || ev.key === " ") {
        finish();
        return;
      }
      if (ev.key === "x" || ev.key === "X") {
        sortExp = !sortExp;
        top = 0;
        paint();
        return;
      }
      // Arrows AND numpad digits scroll (menuNav), so the numpad is not dead
      // in this list when NumLock is on.
      const nav = menuNav(ev);
      if (!nav) return;
      if (nav === "up") top = Math.max(0, top - 1);
      else if (nav === "down") top += 1;
      else if (nav === "pageup") top = Math.max(0, top - page);
      else if (nav === "pagedown") top += page;
      else if (nav === "home") top = 0;
      else if (nav === "end") top += page; // clamped in paint()
      paint();
    };
    window.addEventListener("keydown", onKey, true);
    term.onCellTap?.(() => finish());
    paint();
  });
}

/**
 * target_set_interactive: the interactive map-cursor browse loop. Owns the
 * keyboard like getAimDir/selectFromMenu (its own capturing keydown
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
    // The loop owns input for its lifetime: raise the modal gate so the
    // canvas tap-to-move / long-press / context handlers (all gated on
    // modalDepth) stand down and taps cannot leak through to move the player
    // or advance the game while targeting (#62).
    modalDepth++;
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
        (grid) => squareIsBelievedWall(state, grid),
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
      canvas.removeEventListener("pointerdown", onTap);
      modalDepth--; // release the input gate raised for this loop
      render();
      resolve(targetIsSet(state));
    };

    // Touch: a tap on a map cell moves the cursor there (leaving interesting
    // mode); a tap on the cell the cursor already sits on confirms, exactly as
    // target.c's mouse routing selects on a click of the current grid. Routed
    // through stepTargetLoop's 't' path so monster-vs-location selection stays
    // identical to the keyboard.
    const onTap = (ev: PointerEvent): void => {
      const grid = contextClickGrid(ev.clientX, ev.clientY);
      if (!grid) return; // tap outside the map (HUD): ignore, do not leak
      ev.preventDefault();
      const cur = currentLoopGrid(ui, targets);
      if (grid.x === cur.x && grid.y === cur.y) {
        const step = stepTargetLoop(state, targets, ui, "t");
        ui = step.ui;
        if (step.bell) state.sound?.(MSG.BELL);
        if (step.done) {
          finish();
          return;
        }
        paint();
        return;
      }
      ui = { ...ui, x: grid.x, y: grid.y, showInteresting: false };
      paint();
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
        canvas.removeEventListener("pointerdown", onTap);
        void showMonsterRecall(mon).then(() => {
          window.addEventListener("keydown", onKey, true);
          canvas.addEventListener("pointerdown", onTap);
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
    canvas.addEventListener("pointerdown", onTap);
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

// get_aim_dir (ui-input.c L1608): a keypad direction (1-9), or DIR_TARGET (5).
// '*'/<click> opens the interactive target loop; "'" targets the closest
// monster; 5/t/0/. use the current target. Re-prompts (bell) if the player
// backs out of the picker or asks for a target with none set/available.
async function aimDir(): Promise<number | null> {
  /* Every caller (throw/fire/aim-wand/zap-rod/activate/cast) reaches here from a
   * full-screen item or spell picker, whose teardown does not repaint. Restore
   * the map before the direction prompt so the player aims over the dungeon,
   * not the leftover menu (get_aim_dir runs on the main term in C, ui-game.c). */
  render();
  for (;;) {
    const d = await getAimDir(term, targetOkay(state));
    if (d === null) return null;
    if (d === AIM_STAR) {
      const chosen = await runTargetLoop(TARGET.KILL, false);
      render();
      if (chosen) return 5;
      continue;
    }
    if (d === AIM_CLOSEST) {
      const chosen = targetSetClosest(state, TARGET.KILL);
      render();
      if (chosen) return 5;
      continue; // bell(): no monster in line of sight
    }
    return d;
  }
}

// --- Open / disarm (do_cmd_open / do_cmd_disarm, chest branches - gap #49) --
// A direction prompt like aimDir, but without the '*' target-picker path (open
// and disarm are not aimed commands); 5 targets the player's own grid, for a
// chest underfoot. The core resolves door-vs-chest (open) and
// chest-vs-floor-trap (disarm) by what is actually there.

/**
 * count_feats direction inference (cmd-cave.c L250-260, L409, L874-876).
 *
 * When exactly one adjacent grid qualifies, the C fills the direction in itself
 * and never prompts. It is unconditional in 4.2.6 -- the old `easy_open` option
 * does not exist -- so a port that always asks for a direction changes the
 * keystrokes ordinary play requires, on every door and trap.
 *
 * The count has to happen shell-side because that is where the prompt lives, and
 * it mirrors the C's `cmd_get_direction(..., allow_5)` gate exactly: prompt only
 * when the candidate count is not 1. countFeats draws no RNG and reads the
 * player's remembered map, as the C does.
 */
function inferredDir(
  test: (grid: Loc) => boolean,
  extraCount = 0,
  extraGrid: Loc | null = null,
): number | null {
  const feats = countFeats(state, (_s, g) => test(g), false);
  if (feats.count + extraCount !== 1) return null;
  const grid = feats.count === 1 ? feats.grid : extraGrid;
  return grid ? motionDirTo(grid) : null;
}

/** Open (o): a door or a chest, by direction (do_cmd_open, allow_5 for a chest underfoot). */
async function openCmd(): Promise<void> {
  /* n_closed_doors + n_locked_chests == 1 -> the C infers (cmd-cave.c L250-260),
   * and otherwise allows 5 only when a chest is in reach. */
  const chests = countChests(state, CHEST_QUERY.OPENABLE);
  const auto = inferredDir(
    (g) => state.chunk.features.featHas(knownFeat(state, g), TF.DOOR_CLOSED),
    chests.count,
    chests.grid,
  );
  const dir = auto ?? (await getRepDir(term, chests.count > 0));
  if (dir === null) return;
  commandBuffer.push({ code: "open", dir });
  advance();
}

/** Disarm (D): a trapped chest or a floor trap, by direction (do_cmd_disarm, allow_5 for a chest underfoot). */
async function disarmCmd(): Promise<void> {
  /* n_traps + n_chests + n_unlocked_doors == 1 -> inferred (cmd-cave.c L874-885).
   * The C's three counts share one `grid1`, so with a total of exactly 1 the
   * single matching call supplies the grid; a combined predicate is equivalent. */
  const chests = countChests(state, CHEST_QUERY.TRAPPED);
  const auto = inferredDir(
    (g) =>
      squareIsDisarmableTrap(state, g) ||
      (state.chunk.features.featHas(knownFeat(state, g), TF.DOOR_CLOSED) &&
        squareIsUnlockedDoor(state, g)),
    chests.count,
    chests.grid,
  );
  const dir = auto ?? (await getRepDir(term, chests.count > 0));
  if (dir === null) return;
  commandBuffer.push({ code: "disarm", dir });
  advance();
}

/** Tunnel (T / ^T): dig through a wall / rubble / vein, by direction. */
async function tunnelCmd(): Promise<void> {
  const dir = await getRepDir(term);
  if (dir === null) return;
  commandBuffer.push({ code: "tunnel", dir });
  advance();
}

/** Close (c): a door, by direction (do_cmd_close, allow_5 = false). */
async function closeCmd(): Promise<void> {
  /* count_feats(square_isopendoor) == 1 -> inferred (cmd-cave.c L406-414). */
  const auto = inferredDir((g) =>
    state.chunk.features.featHas(knownFeat(state, g), TF.CLOSABLE),
  );
  const dir = auto ?? (await getRepDir(term));
  if (dir === null) return;
  commandBuffer.push({ code: "close", dir });
  advance();
}

/**
 * Alter (+ , do_cmd_alter): the one command that resolves attack-vs-tunnel-vs-
 * disarm-vs-open from the grid's live contents (do_cmd_alter_aux). A real
 * direction is required (no self).
 */
async function alterCmd(): Promise<void> {
  const dir = await getRepDir(term);
  if (dir === null) return;
  commandBuffer.push({ code: "alter", dir });
  advance();
}

/**
 * Steal (s / roguelike 's', do_cmd_steal): the rogue / PF_STEAL lift-from-
 * monster command. cmd_get_direction requires a real direction; the core
 * do_cmd_steal_aux (game/steal.ts) resolves confusion, attacks/steals from
 * the monster there, or "You spin around." on an empty grid.
 * C: cmd-cave.c:1039 do_cmd_steal, ui-game.c:216.
 */
async function stealCmd(): Promise<void> {
  const dir = await getRepDir(term);
  if (dir === null) return;
  commandBuffer.push({ code: "steal", dir });
  advance();
}

// --- Take notes (: , do_cmd_note, cmd-misc.c:88) --------------------------
// Records a note into the character history log (HIST_USER_INPUT) and echoes
// it. Two "cute" forms are honoured exactly: "/say X" -> '<name> says: "X"',
// "/me X" -> '<name> X'. Everything else becomes 'Note: X'. The stored entry
// keeps the "-- " prefix; the echoed line drops it (msg("%s", &note[3])).
async function noteCmd(): Promise<void> {
  const tmp = await promptText(
    term,
    "Note: ",
    "",
    69, // char tmp[70]: 69 chars + terminator
    "[ type a note, Enter to accept, ESC to cancel ]",
  );
  if (tmp === null) return;
  // Ignore empty notes / notes beginning with a space (cmd-misc.c:100).
  if (!tmp[0] || tmp[0] === " ") return;

  let note: string;
  if (tmp.startsWith("/say ")) {
    note = `-- ${playerName} says: "${tmp.slice(5)}"`;
  } else if (tmp.startsWith("/me")) {
    note = `-- ${playerName}${tmp.slice(3)}`;
  } else {
    note = `-- Note: ${tmp}`;
  }

  // Display the note without the "-- " prefix (cmd-misc.c:111).
  say(note.slice(3));

  // Add a history entry (the full note, with prefix). historyStamp supplies
  // history_add_with_flags's dlev/clev/turn off live state (game/history.ts).
  const stamp = historyStamp(state);
  historyAdd(state.actor.player, note, HIST.USER_INPUT, stamp.dlev, stamp.clev, stamp.turn);
  render();
}

/**
 * Fire at nearest (h / TAB, do_cmd_fire_at_nearest, player-attack.c:1412): the
 * quick-fire convenience. All the work is in the core "fire-at-nearest" action
 * (find first quiver ammo, target_set_closest, reuse do_cmd_fire with
 * DIR_TARGET); the shell only pushes the command and lets the loop run it.
 * C: ui-game.c:151.
 */
function fireAtNearestCmd(): void {
  commandBuffer.push({ code: "fire-at-nearest" });
  advance();
}

/**
 * Walk into a trap (W / -, do_cmd_jump, cmd-cave.c:1319): a deliberate step in
 * a direction that steps onto and triggers a disarmable trap instead of
 * disarming it (CMD_JUMP). Requires a real direction (cmd_get_direction).
 * C: ui-game.c:153.
 */
async function jumpCmd(): Promise<void> {
  const dir = await getRepDir(term);
  if (dir === null) return;
  commandBuffer.push({ code: "jump", dir });
  advance();
}

/**
 * Identify symbol (/, do_cmd_query_symbol, ui-knowledge.c:4467): prompt for a
 * display character (or a special list key), collect every monster race the
 * player has memory of whose glyph matches (char_matches_key), then browse the
 * matching races' recall sorted by level or kills. A free action (no turn).
 * C: ui-game.c:183.
 */
async function querySymbolCmd(): Promise<void> {
  // get_com_ex: one keypress. control+A/N/U select the full / unique-only /
  // non-unique-only lists (ui-knowledge.c:4490-4498); any other key is a
  // literal symbol to match. Captured directly so a control combo is readable.
  const sym = await new Promise<{ all: boolean; uniq: boolean; norm: boolean; ch: string } | null>(
    (resolve) => {
      const { rows, cols } = term.size();
      term.print(
        0,
        rows - 1,
        "Enter character to be identified, or control+[ANU]: ".slice(0, cols - 1),
        UI_GOLD,
      );
      const finish = (v: { all: boolean; uniq: boolean; norm: boolean; ch: string } | null): void => {
        window.removeEventListener("keydown", onKey, true);
        resolve(v);
      };
      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key === "Shift" || ev.key === "Control" || ev.key === "Alt" || ev.key === "Meta") return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (ev.key === "Escape") return finish(null);
        if (ev.ctrlKey) {
          const k = ev.key.toLowerCase();
          if (k === "a") return finish({ all: true, uniq: false, norm: false, ch: "" });
          if (k === "u") return finish({ all: true, uniq: true, norm: false, ch: "" });
          if (k === "n") return finish({ all: true, uniq: false, norm: true, ch: "" });
          return; // other control keys are ignored, awaiting a valid choice
        }
        if (ev.key.length === 1) return finish({ all: false, uniq: false, norm: false, ch: ev.key });
      };
      window.addEventListener("keydown", onKey, true);
    },
  );
  render();
  if (!sym) return;

  // Collect matching monsters: any race with memory (all_known || sights) whose
  // glyph matches, honouring the unique / non-unique filters (L4510-4528).
  const races = booted.registries.monsters.races;
  const matches: { race: MonsterRace; lore: MonsterLore }[] = [];
  for (const race of races) {
    if (!race.name) continue; // r_info[0] blank
    const lore = state.lore.get(race.ridx);
    if (!lore) continue; // never sighted
    if (!lore.allKnown && lore.sights <= 0) continue;
    if (sym.norm && race.flags.has(RF.UNIQUE)) continue;
    if (sym.uniq && !race.flags.has(RF.UNIQUE)) continue;
    if (!sym.all && race.dChar !== sym.ch) continue;
    matches.push({ race, lore: getLore(state.lore, race) });
  }

  // No monsters to recall: silent return (L4530-4535).
  if (matches.length === 0) return;

  // Prompt sort order: y = by level, k = by kills, anything else aborts
  // (L4538-4557). ESC on the menu = the "nope" branch.
  const sortIdx = await selectFromMenu(term, "Recall details?", [
    { label: "Sort by level" },
    { label: "Sort by kills" },
  ]);
  if (sortIdx === null) return;
  if (sortIdx === 1) {
    matches.sort((a, b) => a.lore.pkills - b.lore.pkills || a.race.level - b.race.level);
  } else {
    matches.sort((a, b) => a.race.level - b.race.level || strcmpName(a.race, b.race));
  }

  // Browse from the end (highest), like the upstream idx = num - 1 walk; a
  // selectable list stands in for the ESC/space paging, each pick showing that
  // race's recall (monster_race_track + lore_show).
  for (;;) {
    const items = matches.map(({ race, lore }) => ({
      label: `${capRaceName(race)}${lore.pkills > 0 ? `  (${lore.pkills} killed)` : ""}`,
    }));
    const idx = await selectFromMenu(term, "Recall which monster?", items);
    if (idx === null) return;
    const row = matches[idx];
    if (!row) return;
    await showRaceRecall(row.race, getLore(state.lore, row.race));
  }
}

/** strcmp on race names (the query-symbol level-sort tiebreak, L1258-1262). */
function strcmpName(a: MonsterRace, b: MonsterRace): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Repeat level feeling (^F, do_cmd_feeling -> display_feeling(false),
 * cmd-cave.c:1777): re-emit the current level feeling text. A free action.
 * C: ui-game.c:186.
 */
function feelingCmd(): void {
  displayFeeling(state, { feelingNeed: constants.feelingNeed });
  render();
}

/**
 * Show previous message (^O, do_cmd_message_one, ui-knowledge.c:3819): print the
 * single most recent message, prefixed "> ", on the top line. A free action.
 * C: ui-game.c:187.
 */
function showPrevMessageCmd(): void {
  const latest = msglog.latest();
  message = latest ? `> ${latest}` : "> ";
  render();
}

/**
 * Display quiver listing (|, do_cmd_quiver, ui-game.c:163): show the quiver
 * slots and their ammo. The quiver is the real computed gear.quiver view (the
 * WP-4 quiver subsystem); each slot is tagged by its digit, exactly as
 * upstream's quiver tags.
 */
function quiverLines(): ScreenLine[] {
  const lines: ScreenLine[] = [];
  const quiver = state.gear.quiver ?? [];
  quiver.forEach((handle, slot) => {
    if (!handle) return;
    const obj = gearGet(state.gear, handle);
    if (!obj) return;
    lines.push({ text: `${slot}) ${objectName(state, obj)}`, color: UI_TEXT });
  });
  if (lines.length === 0) lines.push({ text: "(quiver empty)", color: UI_DIM });
  return lines;
}

/**
 * do_cmd_inven / do_cmd_equip / do_cmd_quiver's opening guard
 * (ui-knowledge.c:4030-4033, :4076-4079, :4120-4123): an empty list says WHY
 * instead of opening a screen with nothing on it.
 */
async function listingScreen(
  title: string,
  lines: ScreenLine[],
  empty: boolean,
  why: string,
): Promise<void> {
  if (empty) {
    say(why);
    return;
  }
  await showTextScreen(term, title, lines);
}

/**
 * Retire character (Q, textui_cmd_retire, ui-command.c:162 -> do_cmd_retire,
 * cmd-misc.c:73): the faithful retire confirmation, then mark the character
 * dead with died_from "Retiring" and run the shell's death/tombstone flow (the
 * retire tombstone is retire.txt upstream; showTombstone already branches on
 * the "Retiring" cause). C: ui-game.c:200.
 */
async function retireCmd(): Promise<void> {
  const player = state.actor.player;
  if (player.totalWinner) {
    if (!(await confirmYesNo("Do you want to retire? "))) return;
  } else {
    if (!(await confirmYesNo("Do you really want to retire?"))) return;
    // Special verification: one inline keypress at row 0, proceed only on '@'
    // (ui-command.c:178-182 prt/inkey, NOT a full-screen line editor).
    const verify = await getKeyInline(
      term,
      "Please verify RETIRING THIS CHARACTER by typing the '@' sign: ",
    );
    if (verify !== "@") return;
  }
  // do_cmd_retire (cmd-misc.c:76-77): treated as dead with died_from "Retiring".
  player.diedFrom = "Retiring";
  state.isDead = true;
  advance();
}

// --- Rest (R, do_cmd_rest / textui_cmd_rest) ------------------------------
// The full N-turn / conditional rest, replacing the single-turn hold stub
// (gap 11.1). Faithful to cmd-cave.c:1619 do_cmd_rest and ui-command.c:191
// textui_cmd_rest. The rest loop drives one game turn per iteration through the
// live loop (advance), so process_world regenerates HP/SP and monsters act.
//
// RESTING STATE + THE CORE REGEN SEAMS: player_is_resting /
// player_resting_can_regenerate (loop.ts) gate rest's x2 regen bonus and the
// noise/scent-update suppression. WP-9 left those seams dormant (return false);
// they must read a live resting counter off GameState. This command sets/tracks
// that counter (state.resting) each turn; the seam reads are a core lock and are
// listed as WIRING-NEEDED (loop.ts + context.ts) in the WP-11 report. Until the
// orchestrator applies that wiring the rest still runs to completion faithfully,
// only without the x2 speed-up.

// REST_ special counts (player-util.h:53-55) and the regen threshold (:61).
const REST_COMPLETE = -2; // '&' rest until fully recovered / nothing to do
const REST_ALL_POINTS = -1; // '*' rest until HP and SP are both full
const REST_SOME_POINTS = -3; // '!' rest until HP or SP is full
const REST_REQUIRED_FOR_REGEN = 5;
// player_resting_repeat_count (player-util.c:1523): the last count entered, so
// re-issuing rest with n == 1 repeats it.
let restRepeatCount = 0;

/** player_resting_is_special (player-util.c:1381). */
function restingIsSpecial(count: number): boolean {
  return (
    count === REST_COMPLETE ||
    count === REST_ALL_POINTS ||
    count === REST_SOME_POINTS
  );
}

/**
 * GameState carries a live resting counter for the loop.ts regen seams. The
 * field is a core lock (context.ts, WP-9/WP-10 territory); this local shape
 * lets the web command set it type-safely today and is byte-compatible with the
 * WIRING-NEEDED core addition. { count } mirrors upkeep->resting; { turnsRested }
 * mirrors the file-static player_turns_rested.
 */
interface RestingState {
  count: number;
  turnsRested: number;
}
type StateWithRest = typeof state & { resting?: RestingState };

/**
 * player_resting_complete_special (player-util.c:1495): decide whether a
 * conditional rest is finished. Returns true when resting should stop.
 */
function restingCompleteSpecial(count: number): boolean {
  const p = state.actor.player;
  const t = p.timed;
  if (count === REST_ALL_POINTS) {
    return p.chp === p.mhp && p.csp === p.msp;
  }
  if (count === REST_COMPLETE) {
    return (
      p.chp === p.mhp &&
      (p.csp === p.msp || playerHasCombatRegen()) &&
      !(t[TMD.BLIND] ?? 0) &&
      !(t[TMD.CONFUSED] ?? 0) &&
      !(t[TMD.POISONED] ?? 0) &&
      !(t[TMD.AFRAID] ?? 0) &&
      !(t[TMD.TERROR] ?? 0) &&
      !(t[TMD.STUN] ?? 0) &&
      !(t[TMD.CUT] ?? 0) &&
      !(t[TMD.SLOW] ?? 0) &&
      !(t[TMD.PARALYZED] ?? 0) &&
      !(t[TMD.IMAGE] ?? 0) &&
      !p.wordRecall &&
      !p.deepDescent
    );
  }
  if (count === REST_SOME_POINTS) {
    return p.chp === p.mhp || p.csp === p.msp;
  }
  return false;
}

/** player_has(p, PF_COMBAT_REGEN): the Blackguard mana-degen class flag, read
 * off the live derived player state (calc_bonuses' pflags union). */
function playerHasCombatRegen(): boolean {
  return state.playerState?.pflags.has(PF.COMBAT_REGEN) ?? false;
}

/** Any visible monster interrupts rest (disturb on visible monster). */
function anyVisibleMonster(): boolean {
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (mon && mon.mflag.has(MFLAG.VISIBLE)) return true;
  }
  return false;
}

/**
 * textui_cmd_rest (ui-command.c:191): prompt for the rest duration, then run it.
 * The prompt string and its option letters are reproduced exactly.
 */
async function restCmd(): Promise<void> {
  // textui_cmd_rest (ui-command.c:191-198) asks with get_string, i.e. askfor_aux
  // at row 0 over the LIVE MAP - the map, sidebar and status line stay on
  // screen. It does not open a screen of its own.
  const input = await promptTextInline(
    term,
    "Rest (0-9999, '!' for HP or SP, '*' for HP and SP, '&' as needed): ",
    "&",
    4, // char out_val[5]: 4 chars + terminator
  );
  if (input === null) return;
  const first = input[0];
  let n: number;
  if (first === "&") n = REST_COMPLETE;
  else if (first === "*") n = REST_ALL_POINTS;
  else if (first === "!") n = REST_SOME_POINTS;
  else {
    const turns = parseInt(input, 10);
    if (!Number.isFinite(turns) || turns <= 0) return;
    n = Math.min(turns, 9999);
  }
  await driveRest(n);
}

/**
 * do_cmd_rest (cmd-cave.c:1619) driven turn by turn. Each iteration is one call
 * to do_cmd_rest: player_resting_step_turn (spend a turn, decrement the count,
 * bump the rested counter) then process_world via advance(); the loop continues
 * while player_is_resting, mirroring the engine's cmdq_push(CMD_REST) self-
 * continuation. disturb() equivalents (a visible monster, damage taken, a
 * level/death transition) cancel the rest, matching player_resting_cancel.
 */
async function driveRest(nArg: number): Promise<void> {
  let n = nArg;
  const p = state.actor.player;

  // Sanity: only the specified negative values are valid (cmd-cave.c:1628).
  if (n < 0 && !restingIsSpecial(n)) return;

  // First-turn upkeep (cmd-cave.c:1632-1642): remember an entered count, or
  // reuse the remembered one when repeating (n == 1).
  if (n > 1) restRepeatCount = n;
  else if (n === 1) n = restRepeatCount;

  // player_resting_set_count + the "stop if told to" guard (cmd-cave.c:1645).
  if (n === 0 || (n < 0 && !restingIsSpecial(n))) return;

  // cmd-cave.c:1662-1664: every self-continuation of a SPECIAL rest ('&', '*',
  // '!') calls player_set_resting_repeat_count(player, 0), so a conditional rest
  // wipes the remembered count. Since n never changes across a special rest's
  // turns, doing it once here is equivalent to upstream's per-turn clear - and
  // it happens even when the rest ends on its very first turn, because upstream
  // reaches that branch whenever n is special regardless of the count.
  if (restingIsSpecial(n)) restRepeatCount = 0;

  const rest: RestingState = { count: Math.min(n, 9999), turnsRested: 0 };
  (state as StateWithRest).resting = rest;

  // Any keypress interrupts the rest (upstream flushes input -> disturb). The
  // main key handler is gated by the modal wrapper, so this capturing listener
  // is what catches the stop key while resting.
  let interrupted = false;
  const onStopKey = (ev: KeyboardEvent): void => {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    interrupted = true;
  };
  window.addEventListener("keydown", onStopKey, true);
  // Transient status only (upstream shows a "Rest" state flag, not a message);
  // set the top line directly rather than logging it into message history.
  message = "Resting... (press any key to stop)";
  render();

  try {
    for (;;) {
      // Interruptions before spending the turn (a keypress, a monster already
      // in view, or the world moved us off the level): disturb().
      if (dead || interrupted || anyVisibleMonster()) {
        // Only the keypress arm reports it: "Cancelled." comes from
        // check_for_player_interrupt (ui-game.c:663), and the monster /
        // damage disturbs are silent. Said here rather than through the engine
        // hook because this loop, not the engine, drives the rest (WP-11).
        if (interrupted && !dead) say("Cancelled.");
        break;
      }

      const hpBefore = p.chp;
      const spBefore = p.csp;

      // player_resting_step_turn (player-util.c:1472): decrement the timed
      // count, bump the rested counter; the seams read these during advance().
      if (rest.count > 0) rest.count -= 1;
      rest.turnsRested += 1;

      // Take the turn: one hold action drives one player turn plus the world
      // catching up (process_world regenerates; monsters act).
      commandBuffer.push({ code: "hold" });
      advance();

      if (dead || state.generateLevel) break;

      // Damage taken this turn disturbs the rest (take_hit's disturb()).
      if (p.chp < hpBefore || p.csp < spBefore) break;

      // A monster that just came into view disturbs the rest.
      if (anyVisibleMonster()) break;

      // Conditional-rest completion (player_resting_complete_special).
      if (restingIsSpecial(rest.count) && restingCompleteSpecial(rest.count)) break;

      // Timed rest exhausted (player_resting_count == 0, not special).
      if (rest.count === 0 && !restingIsSpecial(rest.count)) break;

      // Yield so the render/animation loop can paint between turns.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  } finally {
    window.removeEventListener("keydown", onStopKey, true);
    delete (state as StateWithRest).resting;
    void REST_REQUIRED_FOR_REGEN; // seam threshold; read by loop.ts (WIRING-NEEDED)
    render();
  }
}

// --- High scores (task #28: score.c / ui-score.c) -------------------------
// A localStorage-backed ScoreStore (JSON) is the persistence seam; the core
// owns the scoring/ordering/gating. `scoresOpen` gates the main keyhandler
// while the Hall of Fame screen owns the keyboard.
// highscore_write's eight failure messages (score.c L126-190) go to the
// message line, exactly as upstream: a table that could not be written says so.
const scoreStore = createLocalStorageScoreStore(undefined, {
  msg: (text) => say(text),
});
const scoreNames = registryNameResolver(players);
let scoresOpen = false;

/** BuildScoreDeps drawn from the live game (turn, live depth, name, uid). */
function scoreBuildDeps(diedFrom: string): {
  diedFrom: string;
  turn: number;
  depth: number;
  fullName: string;
} {
  // score.c buildScore's `who` column is player->full_name (12.4/WP-10). It is
  // "" until death sets it; fall back to the shell's cosmetic name so a
  // predicted (still-alive) Hall-of-Fame row is not blank.
  const fullName = state.actor.player.fullName || playerName || "";
  return { diedFrom, turn: state.turn, depth: state.chunk.depth, fullName };
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

// ---- Wizard / debug mode (WP-14, gaps 15.1-15.3) -------------------------
// Wizard mode is a per-session client flag (upstream arg_wizard / player->wizard
// is a launch/runtime toggle, not part of the save); the noscore cheat bits it
// sets DO persist on player.noscore (WP-10 save) and gate the score (WP-12).
let wizardMode = false;

/**
 * Assemble the WizardDeps the debug menu dispatches through. markNoscore is the
 * WP-10 handoff hook: it ORs the NOSCORE_* bits into the live player.noscore
 * (persisted by save.ts, read by the score gate via noscoreInvalidatesScore).
 *
 * The engine bundles (makeDeps with its real generation foils, expDeps with the
 * real onLevelChange/onGainLevel, the effect interpreter, TrapDeps and the live
 * MonPlaceDeps) come straight from game.wizardBundles - assembled once inside
 * session/game.ts wireGame, the single source of truth for that wiring, so the
 * web shell never re-derives them. The shell only adds the wizard flag, the
 * message sink, the markNoscore hook and the pure registry data.
 */
function buildWizardDeps(): WizardDeps {
  const reg = booted.registries;
  const player = state.actor.player;
  return {
    wizard: wizardMode,
    msg: say,
    // WP-10 handoff: OR the cheat bits into the live, persisted player.noscore.
    markNoscore: (bits: number): void => {
      player.noscore = markNoscore(player.noscore, bits);
    },
    // The real engine bundles (effect / expDeps / trapDeps / monPlace / makeDeps).
    ...game.wizardBundles,
    ...(game.flavor ? { flavor: game.flavor } : {}),
    races: reg.monsters.races,
    egos: reg.objects.egos,
    artifacts: reg.objects.artifacts,
    curses: reg.objects.curses,
  };
}

/** The runtime context the wizard UI needs (state + deps + shell callbacks). */
function wizardCtx(): WizardUiCtx {
  return {
    term,
    state,
    deps: buildWizardDeps(),
    say,
    refresh: () => render(),
    changeLevel: (depth: number): void => {
      game.changeLevel(depth);
      state.generateLevel = false;
      panelCam = null; // new level: recentre the camera on the player
    },
    // do_cmd_wiz_teleport_to's cmd_get_point: reuse the interactive look/target
    // loop (target_set_interactive) to pick a destination grid, then read it
    // back via targetGet. Returns null when the loop is cancelled.
    pickGrid: async () => {
      const ok = await runTargetLoop(
        TARGET.LOOK,
        false,
        state.actor.grid.x,
        state.actor.grid.y,
      );
      return ok ? targetGet(state) : null;
    },
    // wiz_hack_map (cmd-wizard.c:319): the debug query commands hand us the
    // grids their probe selected, each with the colour that probe chose, and we
    // overlay one glyph per grid on the visible panel exactly as print_rel
    // does - '@' on the player, '*' where the grid is passable, '#' otherwise.
    hackMap: (marks): void => {
      const { mapOriginX, mapTop, mapCols, mapRows, camX, camY } = viewport();
      for (const mark of marks) {
        const { x, y } = mark.grid;
        if (x < camX || x >= camX + mapCols || y < camY || y >= camY + mapRows) continue;
        if (x < 1 || y < 1 || x >= state.chunk.width - 1 || y >= state.chunk.height - 1) {
          continue; // square_in_bounds_fully
        }
        const here = x === state.actor.grid.x && y === state.actor.grid.y;
        const ch = here ? "@" : state.chunk.isPassable(mark.grid) ? "*" : "#";
        term.print(mapOriginX + x - camX, mapTop + y - camY, ch, colorToCss(mark.color));
      }
    },
    // lookup_monster (mon-util.c:119), for the "Which monster? " prompts.
    raceByName: (name: string) => booted.registries.monsters.raceByName(name),
    // keylog[] for wiz_display_keylog, oldest first (ui-term.c:317).
    keylog: () => KEYLOG,
    // projections[] for wiz_proj_demo's "PROJ_ types display" (project.c).
    projections: booted.registries.projections ?? [],
    // The static content the four do_cmd_spoilers generators walk.
    pack,
  };
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

/**
 * savefile_save / save_game_checked (ui-game.c:1052, :1173): write the game and
 * report whether it worked. A `true` return with nothing written is not possible
 * here - the only ways out are the "nothing to save" short-circuits, which
 * upstream does not have and which are not failures.
 *
 * The port used to swallow every failure silently, so a quota-exceeded
 * localStorage write left the player playing on believing they were saved.
 */
function persistSave(): boolean {
  if (suppressSave || birthPending) return true; // a throwaway claims no slot
  const id = getActiveId();
  if (!id) return true; // no active slot (e.g. the picker is up): nothing to save
  try {
    const b64 = bytesToB64(encodeSavedGame(saveGame(game)));
    /* writeSlot's own verdict, not just "we did not throw": the storage write
     * itself is where a quota failure shows up. */
    return writeSlot(id, b64, metaFromState(id));
  } catch {
    /* Encoding threw (a corrupt state), or storage is unreachable. */
    return false;
  }
}

/**
 * close_game's save loop (ui-game.c:1152-1166): retry the save for as long as
 * the player says to, and on giving up announce it - "death save failed!" for a
 * dead hero (:1156), silence for a living one (the alive branch at :1161-1166
 * has no message).
 *
 * `prompt` is upstream's prompt_failed_save: false skips the retry offer
 * entirely, which is what the unload hooks need (a beforeunload handler cannot
 * wait on a modal).
 */
async function closeGameSave(prompt: boolean): Promise<void> {
  let prompting = prompt;
  while (!persistSave()) {
    if (!prompting || !(await confirmYesNo("Saving failed.  Try again? "))) {
      if (dead) say("death save failed!");
      return;
    }
  }
}

// Autosave keeps the session recoverable without the player thinking about it:
// throttled during active play, and forced on level change and when the tab is
// hidden/closed (pagehide / visibilitychange) so closing the tab never loses
// more than the current turn. Manual 'S' forces an immediate save too.
let lastSaveMs = -Infinity;
/**
 * Whether the player has already been told the autosave is failing. Upstream has
 * no autosave, so it has no counterpart for this; what it does have is the
 * principle that a failed save is never silent (ui-game.c:1152-1166). Reported
 * once per run of failures rather than every three seconds.
 */
let autosaveFailed = false;
function autosave(force = false): void {
  if (dead) return;
  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  if (!force && now - lastSaveMs < 3000) return;
  lastSaveMs = now;
  if (persistSave()) {
    autosaveFailed = false;
    return;
  }
  if (!autosaveFailed) {
    autosaveFailed = true;
    say("Saving failed.");
  }
}

/** Start a brand-new character in a fresh roster slot (birth, then play). */
function newGame(): void {
  suppressSave = true; // the outgoing page must not save into the new slot
  setActiveId(newCharId()); // a fresh slot so the new character does not
  // overwrite any existing one
  try {
    sessionStorage.setItem(FORCE_NEW_KEY, "1");
    sessionStorage.setItem(SKIP_TITLE_KEY, "1"); // already past the title
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
  try {
    sessionStorage.setItem(SKIP_TITLE_KEY, "1"); // already past the title
  } catch {
    /* storage disabled: the title simply shows again, which is harmless */
  }
  const url = new URL(location.href);
  url.searchParams.delete("new");
  url.searchParams.delete("seed");
  location.assign(url.toString());
}

/**
 * Save and exit (^X, textui_quit, ui-game.c:199): flush the save, then LEAVE
 * play for the title screen.
 *
 * Upstream quits to the OS, and the next launch shows news.txt and then waits
 * for New/Open from the File menu (main-win.c:5475). A browser tab has no OS to
 * quit to, so the web analog reloads WITHOUT the continuation flag - which is
 * exactly what routes boot through the title screen and then the character
 * select (isContinuation / bootGame), where this hero is waiting to be resumed.
 * Nothing is lost: the save is written before the reload.
 */
async function exitToTitle(): Promise<void> {
  /* close_game(prompt_failed_save = true) (ui-game.c:1173): a deliberate exit
   * offers the retry, because leaving on a failed save loses the session. */
  await closeGameSave(true);
  try {
    // Next boot is a genuine launch, not a continuation, so BOTH skip-the-title
    // flags have to be clear or the title would be skipped on the way out.
    sessionStorage.removeItem(SKIP_TITLE_KEY);
    sessionStorage.removeItem(BIRTH_DONE_KEY);
  } catch {
    /* storage disabled: boot then has nothing to read, so the title shows */
  }
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
/**
 * The in-app mod manager (W2.4). Builds a live catalog from the three discovery
 * sources + the persisted store, and reloads on Apply so content re-composes
 * (pack.ts) and enabled plugins re-install (boot). Content-mod enablement and
 * plugin consent both persist through defaultModStore.
 */
async function openModManager(): Promise<void> {
  const store = defaultModStore();
  await runModManager(term, {
    store,
    listCatalog: () =>
      buildCatalog({
        content: discoverContentModManifests(),
        sandbox: [...discoverPlugins().values()].map((p) => p.manifest),
        trusted: [...discoverTrustedPlugins().values()].map((p) => p.manifest),
        enabled: store.getEnabled(),
        consents: store.getConsents(),
      }),
    conflictLines: () => modConflictLines(store.getEnabled()),
    // Fixes & tweaks: the enabled mods' declared rules, and a live-apply that
    // writes the running game's GameState.modRules so a toggle takes effect at
    // once (no reload). modRuleEnabled reads `=== true`, so a false value is off.
    ruleDecls: () => loadEnabledModRuleDecls(),
    applyRuleLive: (flag, on) => {
      (game.state.modRules ??= {})[flag] = on;
    },
    // Same parse as pack.ts/tile-mods.ts: ?mods= present (even empty) is an
    // override; absent is null. Only used to caption the screen honestly.
    urlModsOverride: () => {
      try {
        const raw = new URLSearchParams(location.search).get("mods");
        return raw === null
          ? null
          : raw.split(",").map((s) => s.trim()).filter(Boolean);
      } catch {
        return null;
      }
    },
    isModNoscore: () => game.manifest.modNoscore,
    advanceSaveRatchets: (mod) => {
      game.manifest.determinism = advanceDeterminism(game.manifest.determinism, mod.nondeterministic);
      game.manifest.modNoscore = advanceModNoscore(game.manifest.modNoscore, mod.affectsGameplay);
    },
    requestReload: () => {
      try {
        autosave(true); // keep the live hero before the page re-composes
        // Applying mods mid-game is a continuation, not a genuine launch: skip
        // the title and resume the same character once the page re-composes.
        sessionStorage.setItem(SKIP_TITLE_KEY, "1");
      } catch {
        /* best-effort */
      }
      location.reload();
    },
  });
}

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
      message = "Saving game... done.";
      render();
      break;
    case "options":
      await runOptionsMenu(term, state, openIgnoreSetup, sidebarModeMenu);
      autosave(true); // flush any option change to the per-slot save
      break;
    case "graphics":
      // Tile-set selection: upstream picks graphics in the frontend menu bar,
      // not in '=' (do_cmd_options). The web analog lives here in the game menu.
      await runTileModePage(term, tileModeMenu);
      break;
    case "mods":
      await openModManager();
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
    case "exit":
      // Confirmed like Switch/New: the save is written first, so this loses
      // nothing, but a stray tap should not throw the player out of a live run.
      if (await confirmYesNo("Save and exit to the title screen?")) {
        await exitToTitle();
      }
      break;
    default:
      break; // Resume play
  }
}

/**
 * display_winner + display_exit_screen (ui-death.c L374-387): the winner crown
 * (total_winner only) then the tombstone epitaph, each a press-to-continue
 * screen. Shown once when the character dies, before the death menu.
 */
async function showTombstone(diedFrom: string): Promise<void> {
  const p = state.actor.player;
  if (p.totalWinner) {
    await showTextScreen(
      term,
      "",
      winnerLines(term.size().cols),
      "[ Press ESC to continue ]",
    );
  }
  const title = p.cls.titles[Math.trunc((p.lev - 1) / 5)] ?? "";
  const retired = diedFrom === "Retiring";
  const lines = tombstoneLines({
    fullName: p.fullName || playerName || "",
    title,
    className: p.cls.name,
    level: p.lev,
    exp: p.exp,
    gold: p.au,
    depth: state.chunk.depth,
    diedFrom,
    totalWinner: p.totalWinner,
    retired,
    deathTime: ctimeStamp(new Date()),
  });
  await showTextScreen(term, "", lines, "[ Press ESC to continue ]");
}

/**
 * death_screen's menu (ui-death.c L374-421), routed through the same shared menu
 * component, with upstream's rows and tag letters.
 *
 * Its loop (L401-418) has four exits, and they do NOT agree on confirming:
 * KTRL('X') breaks out at once, KTRL('N') restarts at once, while both the Quit
 * row (an EVT_SELECT, reaching death_screen only because Quit's action pointer
 * is NULL - menu_action_handle, ui-menu.c:98-112) and EVT_ESCAPE ask
 * get_check("Do you want to quit? ") and go back round the loop on "no".
 *
 * So Escape does not leave here, which is a real behaviour change: upstream
 * gives a dead character no way back to the map, and the port used to treat
 * Escape as "park on the tombstone".
 */
async function runDeathMenu(): Promise<void> {
  /* Held in an object so the ctrlCommands closures below can set it without
   * TypeScript narrowing the reads back to null. */
  const chord: { hit: "quit" | "new" | null } = { hit: null };
  for (;;) {
    const entries = deathMenuEntries();
    const pick = await selectFromMenu(
      term,
      "You have died.",
      entries.map((e) => e.item),
      DEATH_MENU_FOOTER,
      {
        /* death_menu->flags = MN_CASELESS_TAGS (ui-death.c:397). */
        caselessTags: true,
        ctrlCommands: {
          /* KTRL('X') (L406): `break` - no get_check, unlike the Quit row. */
          x: () => {
            chord.hit = "quit";
            return MENU_CLOSE;
          },
          /* KTRL('N') (L407): play_again = true, and unlike the New Game row
           * (L349) it does not ask "Start a new game? " first. */
          n: () => {
            chord.hit = "new";
            return MENU_CLOSE;
          },
        },
      },
    );
    if (chord.hit === "quit") return quitAfterDeath();
    if (chord.hit === "new") {
      newGame();
      return;
    }
    if (pick === null) {
      /* EVT_ESCAPE (L413-417). terms_disconnecting - the front end tearing
       * down, which breaks out unasked - has no browser counterpart: a closing
       * tab runs the pagehide save, not this menu. */
      if (await confirmYesNo("Do you want to quit? ")) return quitAfterDeath();
      continue;
    }
    switch (entries[pick]?.action) {
      case "info":
        // death_info (ui-death.c L193-278): the final character sheet, then the
        // OLIST_DEATH gear walk (equipment, inventory) as press-to-continue
        // screens. Quiver/home pages are the remaining pieces of L227-275.
        await showCharacterSheet(term, state, playerName, charSheetOpts());
        await showTextScreen(term, "You are using:", equipmentLines(state));
        await showTextScreen(term, "You are carrying:", inventoryLines(state));
        break;
      case "messages":
        await showTextScreen(term, "Message history", messageHistoryLines(msglog));
        break;
      case "dump": {
        // death_file (ui-death.c L162-188): get_file over the suggested
        // player_safe_name + ".txt", then dump_save, then the result message.
        // The full write_character_dump extras (flag grids, per-item object
        // info, last messages, killer, randart seed) go in for the death dump.
        const file = await getFile(term, dumpFileName(playerName));
        if (file === null) break;
        const ok = dumpCharacterFile(
          state,
          playerName,
          file,
          {
            uiEntryPacks,
            inspectExtras,
            messages: msglog.all().map((m) => m.text),
            diedFrom: state.actor.player.diedFrom || "the dungeon",
            seedRandart: game.randartSeed,
          },
          say,
        );
        say(ok ? "Character dump successful." : "Character dump failed!");
        break;
      }
      case "scores":
        await showPredictedScores(
          term,
          scoreStore,
          state.actor.player,
          {
            ...scoreBuildDeps(state.actor.player.diedFrom || "the dungeon"),
            deathTime: new Date(),
          },
          scoreNames,
          true,
        );
        break;
      case "examine":
        // death_examine (ui-death.c L303-325): get_item over inventory, quiver
        // and equipment - NOT the floor, which textui_obj_examine includes -
        // looping until the picker is cancelled. Its prompt carries a trailing
        // space where textui_obj_examine's does not; both are verbatim.
        while (await inspectOnce("Examine which item? ", { equip: true, inven: true, quiver: true }));
        break;
      case "history":
        // death_history (ui-death.c L331): history_display.
        await showTextScreen(term, "Player history", historyLines(state));
        break;
      case "spoilers":
        // death_spoilers (ui-death.c L339): do_cmd_spoilers, the same four-row
        // menu the debug menu reaches.
        await runSpoilers(term, pack, say);
        break;
      case "new":
        // death_new_game (ui-death.c L349): get_check("Start a new game? "),
        // trailing space included - get_check appends "[y/n] " verbatim.
        if (await confirmYesNo("Start a new game? ")) {
          newGame();
          return;
        }
        break;
      case "quit":
        // The Quit row's NULL action is what lets EVT_SELECT escape menu_select
        // and reach L409-412's get_check.
        if (await confirmYesNo("Do you want to quit? ")) return quitAfterDeath();
        break;
      default:
        break;
    }
  }
}

/**
 * What death_screen returning means here. Upstream falls back into close_game,
 * which saves the dead player (ui-game.c:1150-1158) and then quits the process;
 * the port's dead save is markDead at the moment of death (decision 16), and it
 * has already run and already cleared the active slot - so exitToTitle's own
 * close_game save is the no-active-slot no-op, and what is left is leaving play
 * for the title screen and character list.
 */
async function quitAfterDeath(): Promise<void> {
  await exitToTitle();
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
    onPickup: (msg): void => {
      // The core builds the full inven_carry line from the merged pack stack
      // ("You have 5 Potions of Cure Light Wounds (a)."), obj-gear.c:893-921.
      say(msg);
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
    const items = canPickup.map((o) => ({ label: objectName(state, o), color: UI_TEXT }));
    const idx = await selectFromMenu(term, "Get which item?", items);
    if (idx === null) return;
    pendingPickupChoice = canPickup[idx] ?? null;
  }
  commandBuffer.push({ code: "pickup" });
  advance();
}

/**
 * see_floor_items (ui-display.c L2581), fired by EVENT_SEEFLOOR from
 * do_cmd_autopickup (cmd-pickup.c L484) after every step and do_cmd_hold
 * (cmd-cave.c L1610): announce what remains on the player's grid once autopickup
 * has taken what it will. A single object gets the "You see X." message; a pile
 * defers to the floor list screen. Ignored objects are skipped, matching
 * scan_floor's OFLOOR_SENSE | OFLOOR_VISIBLE (ignore_item_ok). A pending screen
 * is returned so advance() can open it after this turn's messages are paged.
 */
let pendingFloorPile: GameObject[] | null = null;
/** Set before a hold turn so advance() runs the floor look (do_cmd_hold). */
let seeFloorRequested = false;

function seeFloorItems(): void {
  const grid = state.actor.grid;
  const pile = floorPile(state, grid).filter((o) => !state.isIgnored?.(o));
  if (pile.length === 0) return;
  const blind = (state.actor.player.timed[TMD.BLIND] ?? 0) > 0;
  const canPickup = pile.some((o) => invenCarryNum(state.gear, o, constants) > 0);
  if (pile.length === 1) {
    const obj = pile[0]!;
    // p = "see" (or "feel" when blind, "have no room for" when the pack is full),
    // ui-display.c L2589/L2612-L2615. describeObject is ODESC_PREFIX | ODESC_FULL.
    const verb = !canPickup ? "have no room for" : blind ? "feel" : "see";
    say(`You ${verb} ${describeObject(state, obj)}.`);
  } else {
    // Multiple objects: upstream shows the show_floor screen; defer it.
    pendingFloorPile = pile;
  }
}

/** show_floor for the pile under the player (ui-display.c L2637-L2647): the
 * "You see:" list shown when more than one object is on the grid. */
async function showFloorPileScreen(pile: GameObject[]): Promise<void> {
  const blind = (state.actor.player.timed[TMD.BLIND] ?? 0) > 0;
  const canPickup = pile.some((o) => invenCarryNum(state.gear, o, constants) > 0);
  const header = !canPickup
    ? "You have no room for the following objects:"
    : blind
      ? "You feel something on the floor:"
      : "You see:";
  const lines: ScreenLine[] = pile.map((o, i) => ({
    text: `${objLetter(i)}) ${objectName(state, o)}`,
    color: objectColor(o, state),
  }));
  await showTextScreen(term, header, lines);
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
// CMD_REPEAT memory (cmd-core.c:247-258): the last non-repeat command handed to
// the loop, so 'n' / ^V can re-dispatch it with its stored args (direction,
// item, target). Recorded as the loop consumes commands so it survives the
// async prompt each shell command runs before pushing.
let lastRepeatCmd: PlayerCommand | null = null;
state.nextCommand = (): PlayerCommand | null => {
  const cmd = commandBuffer.shift() ?? null;
  if (cmd && cmd.code !== "repeat") lastRepeatCmd = cmd;
  return cmd;
};

/* --- check_for_player_interrupt (ui-game.c:645), hosted ------------------- */
/* A key arrived while the loop was driving a run / repeat / rest. The keydown
 * handler sets this instead of executing the key, which IS upstream's
 * EVENT_INPUT_FLUSH: the key that stops a run is discarded, not obeyed. */
let interruptKey = false;
/* True while a self-continuing command (a run, a pathfind, an auto-repeated
 * dig) is being pumped one step per event-loop turn - see advance(). */
let pumping = false;
state.checkInterrupt = (): InterruptResponse => {
  /* The resting arm of the C's gate is answered by driveRest, which owns the
   * rest lifecycle in this port (WP-11) and already yields - and pauses - once
   * per rest turn. Pausing here as well would strand the {hold} it has queued
   * in commandBuffer and double-count that turn. */
  if (state.resting) return "go";
  if (interruptKey) {
    interruptKey = false;
    return "cancel";
  }
  /* The browser cannot be asked "was a key pressed?" without letting the event
   * loop run, so always hand control back and answer on the next pump. */
  return "pause";
};

/**
 * Repeat previous command (n / ^V, CMD_REPEAT, cmd-core.c:283-316): re-run the
 * last command with its stored arguments. Does nothing (like cmdq_push's silent
 * error) when there is no remembered command. C: ui-game.c:223.
 */
function repeatLastCommand(): void {
  if (!lastRepeatCmd) return;
  commandBuffer.push({ ...lastRepeatCmd });
  advance();
}

/**
 * Use an item (U original / X roguelike, CMD_USE, cmd-obj.c do_cmd_use /
 * ui-game.c:133): pick any usable item, then run the type-appropriate command
 * (aim a wand, zap a rod, use a staff, read, quaff, eat, or activate a worn
 * item). This is the single generic verb the original keyset binds to 'U'.
 */
async function useGenericCmd(): Promise<void> {
  /* do_cmd_use's dispatch order, cmd-obj.c:961-996. Ammo and refillables are
   * part of it: obj_is_useable (obj-util.c:867-879) admits ammo matching
   * ammo_tval, anything with an object_effect, and obj_can_refill's flasks, so
   * 'U' offers those too - the port used to list only the six device and
   * consumable tvals. */
  const codeFor = (o: GameObject): string | null => {
    if (tvalIsAmmo(o.tval)) {
      return o.tval === state.actor.combat.ammoTval ? "fire" : null;
    }
    if (tvalIsPotion(o.tval)) return "quaff";
    if (tvalIsEdible(o.tval)) return "eat";
    if (tvalIsRod(o.tval)) return "zap-rod";
    if (tvalIsWand(o.tval)) return "aim-wand";
    if (tvalIsStaff(o.tval)) return "use-staff";
    if (tvalIsScroll(o.tval)) return "read";
    if (objCanRefill(state, o)) return "refill";
    /* obj_is_activatable but NOT equipped: upstream offers it and then says
     * so (cmd-obj.c:993). "unequipped-activatable" is not a command code -
     * dispatch below turns it into that message. */
    if (objIsActivatable(o)) return "unequipped-activatable";
    /* object_effect but none of the above: obj_is_useable still admits it, and
     * do_cmd_use's final else says so (cmd-obj.c:996). */
    if (objectEffect(o)) return "unusable-now";
    return null;
  };
  const rows: MenuItem[] = [];
  const picks: { code: string; handle: number }[] = [];
  // Usable pack items (devices + consumables), then worn activatables. The
  // faithful obj_can_use tester (cmd-obj.c) admits exactly these.
  const { items, handles } = packMenu(state, (o) => codeFor(o) !== null);
  for (let i = 0; i < items.length; i++) {
    const handle = handles[i];
    const obj = handle === undefined ? null : gearGet(state.gear, handle);
    const code = obj ? codeFor(obj) : null;
    if (handle === undefined || !obj || !code) continue;
    rows.push(items[i]!);
    picks.push({ code, handle });
  }
  const player = state.actor.player;
  for (let i = 0; i < player.body.count; i++) {
    const handle = player.equipment[i] ?? 0;
    if (!handle) continue;
    const obj = gearGet(state.gear, handle);
    /* obj_is_useable admits an equipped item with an object_effect, and
     * do_cmd_use routes it to do_cmd_activate (cmd-obj.c L987) - the kind-effect
     * rings included, not just items with an `act:`. */
    if (!obj || !objIsActivatable(obj)) continue;
    rows.push({ label: describeObject(state, obj), color: UI_TEXT, inscrip: obj.note });
    picks.push({ code: "activate", handle });
  }
  if (rows.length === 0) {
    say("You have no items to use.");
    return;
  }
  const idx = await selectFromMenu(term, "Use which item? ", rows, undefined, {
    inscripCmdKey: itemCmdKey("use"),
  });
  if (idx === null) return;
  const pick = picks[idx];
  if (!pick) return;
  if (pick.code === "unequipped-activatable") {
    /* cmd-obj.c:993 - the item is usable, just not where it needs to be. */
    say("Equip the item to use it.");
    return;
  }
  if (pick.code === "unusable-now") {
    say("The item cannot be used at the moment");
    return;
  }
  await dispatchItemVerb(pick.code, pick.handle, gearGet(state.gear, pick.handle));
}

/**
 * Swap weapon (x, original keyset only): the default pref.prf keymap maps 'x'
 * to the macro "w0" - i.e. wield the pack item inscribed @0 / @w0. Wields the
 * first matching item; falls back to the wield picker when none is tagged.
 */
async function swapWeaponCmd(): Promise<void> {
  const player = state.actor.player;
  const equipped = new Set<number>();
  for (let i = 0; i < player.body.count; i++) {
    const h = player.equipment[i] ?? 0;
    if (h) equipped.add(h);
  }
  for (const [handle, obj] of state.gear.store) {
    if (equipped.has(handle) || !tvalIsWearable(obj.tval)) continue;
    const note = obj.note ?? "";
    if (/@w?0/.test(note)) {
      commandBuffer.push({ code: "wield", args: { handle } });
      advance();
      return;
    }
  }
  // No @0-tagged item: fall back to the normal wield selection.
  await useItem(
    "wield",
    (o) => objCanWear(state, o),
    "Wear or wield which item?",
    "You have nothing to wear or wield.",
    { inven: true, floor: true, quiver: true },
  );
}

/**
 * Queue a single walk step, first running move_player's damaging-terrain confirm
 * (walkTerrainPrompt -> cmd-cave.c L1156-1180): a deliberate step into lava that
 * would cost more than a third of current HP prompts "Really step in?" and, on
 * "no", cancels the move with no turn spent (step=false, energy_use=0). Every
 * keyboard/mouse/touch walk routes through here so the confirm is consistent; a
 * non-fiery (or cheap) step queues immediately. The confirm runs inside a modal
 * so the main key handler stands down and getCheck owns the single keypress.
 */
async function queueWalk(dir: number): Promise<void> {
  const prompt = walkTerrainPrompt(state, dir);
  if (prompt !== null) {
    let ok = false;
    await openModal(async () => {
      ok = await confirmYesNo(prompt);
    });
    if (!ok) {
      render(); // clear the [y/n] prompt row; no move, no turn
      return;
    }
  }
  commandBuffer.push({ code: "walk", dir });
  advance();
}

/** Walk one step (;, CMD_WALK, cmd_hidden): prompt a direction, then step. */
async function walkStepCmd(): Promise<void> {
  const dir = await getRepDir(term);
  if (dir === null) return;
  await queueWalk(dir);
}

/** Start running (CMD_RUN): prompt a direction, then run until run_test stops. */
async function runDirCmd(): Promise<void> {
  const dir = await getRepDir(term);
  if (dir === null) return;
  commandBuffer.push({ code: "run", dir });
  advance();
}

/** Stand still (CMD_HOLD, cmd_hidden): spend a turn in place. do_cmd_hold
 * (cmd-cave.c L1610) then looks at the floor, so request the see-floor pass. */
function holdCmd(): void {
  commandBuffer.push({ code: "hold" });
  seeFloorRequested = true;
  advance();
}

/** Start exploring (p, CMD_EXPLORE, cmd_hidden): the auto-explore command. */
function exploreCmd(): void {
  commandBuffer.push({ code: "explore" });
  advance();
}

/**
 * Center the map on the player (^L / @, do_cmd_center_map, cmd_hidden:221).
 * Clears any locate-mode pan so the camera snaps back to the player.
 */
function centerMapCmd(): void {
  locateCam = null;
  panelCam = null; // center_panel: force the next verify to recentre on player
  render();
}

/** Redraw the screen (^R, do_cmd_redraw, cmd_util:201). */
function redrawCmd(): void {
  render();
}

/**
 * Save and quit (^X, textui_quit, cmd_util:199): confirm, then save and leave
 * play for the title screen (exitToTitle). This used to save and merely reopen
 * the game menu, which was not "quit" in any sense the player could see; the
 * same action is now on the game menu's own "Save and exit" row, and both go
 * through the one confirm-then-exitToTitle path.
 */
function saveQuitCmd(): void {
  void openModal(async () => {
    if (await confirmYesNo("Save and exit to the title screen?")) {
      await exitToTitle();
    }
  });
}

/**
 * Save a screen dump (')', do_cmd_save_screen, ui-command.c:540-561).
 *
 * Upstream asks which of two TEXT formats to write and dumps the terminal cell
 * by cell (html_screenshot); the port used to hand over a PNG of the canvas with
 * an invented message, which is neither format and cannot be pasted into a forum
 * post or a ladder entry - the reason the command exists.
 *
 * The other_term half (a monster-list subwindow dumped beside the main terminal)
 * has no counterpart: the port has no subwindows, so find_first_subwindow returns
 * NULL and the "Include monster list? " branch cannot be reached. Recorded as a
 * divergence rather than answered with something else.
 */
function screenDumpCmd(): void {
  void openModal(async () => {
    const ch = await getChar(term, "Dump as (H)TML or (F)orum text? ", "hf", " ");
    const mode = ch === "h" ? DUMP_HTML : ch === "f" ? DUMP_FORUM : -1;
    if (mode < 0) return; // default: return (L553-554)

    /* get_file's suggested name, mode by mode (ui-command.c:501). */
    const file = await getFile(term, mode === DUMP_HTML ? "dump.html" : "dump.txt");
    if (file === null) return;

    const text = htmlScreenshot(term.snapshotColored(), mode, userPath(file), BUILD_ID);
    if (!writeUserFile(file, text)) {
      /* html_screenshot's only failure: it could not open the file (L322-325). */
      say(`Cannot write the '${userPath(file)}' file!`);
      return;
    }
    downloadUserFile(file, text, mode === DUMP_HTML ? "text/html" : "text/plain");
    say(`${mode ? "Forum text" : "HTML"} screen dump saved.`);
  });
}

/**
 * Ignore an item (k original / ^D both, CMD_IGNORE, cmd_item_manage:165):
 * picks an item then opens the faithful per-item ignore menu. Body wired to
 * ./ignore-menu (task 155).
 */
async function ignoreItemCmd(): Promise<void> {
  await showIgnoreItemMenu(term, state, game, say, applyIgnoreDrop);
}

/**
 * Load a single pref line (", do_cmd_pref, cmd_hidden:213): prompts for a raw
 * pref-file command. The web build configures via the '=' options menu rather
 * than a pref-file grammar, so unrecognized lines are reported rather than
 * silently dropped, keeping the key live and faithful in shape.
 */
async function prefLineCmd(): Promise<void> {
  const line = await promptText(term, "Pref:", "", 80, "[ enter a pref command, ESC to cancel ]");
  if (line === null || line.trim() === "") return;
  say("Pref command not recognized.");
}

/** Version info (V, do_cmd_version, cmd_hidden:212). Pure display. */
function versionCmd(): void {
  void openModal(() =>
    showTextScreen(term, "Version", [
      { text: "" },
      { text: `  Neo Angband ${ENGINE_VERSION}` },
      { text: `  A faithful port of Angband ${PARITY_BASELINE}.` },
      { text: "" },
      { text: "  Credits: neostryder / RPGM Tools." },
      { text: "  Angband is maintained by the Angband development team." },
    ]),
  );
}

/**
 * The remembered object glyph at a grid, minus anything the player ignores.
 *
 * map_info re-walks the KNOWN pile every frame and skips ignored objects
 * ("Item stays hidden", cave-map.c:162), so ignoring a kind hides it from the
 * map at once - it is not merely dropped from the pack. The port stores the
 * memory as one glyph, so the live pile is consulted here instead: when every
 * object still on that grid is ignored, there is nothing to remember.
 */
function knownObjectShown(x: number, y: number): ReturnType<typeof knownObject> {
  const mem = knownObject(state, loc(x, y));
  if (!mem) return null;
  const pile = state.floor.get(gridIndex(x, y));
  if (pile && pile.length > 0 && !pile.some((o) => !state.isIgnored?.(o))) return null;
  return mem;
}

// Touch open/disarm: tapping the "Open"/"Disarm" action-bar button arms this,
// so the NEXT canvas tap resolves to a direction for that command instead of
// a walk (open/close cancel it without spending it on an unrelated tap).
let pendingChestAction: "open" | "disarm" | null = null;

function gridIndex(x: number, y: number): number {
  return y * state.chunk.width + x;
}

/** A composed map cell: an ASCII glyph plus an optional graphics tile. */
interface CellGlyph {
  ch: string;
  css: string;
  bg?: string;
  tile?: TileDraw;
}

// Revealed traps draw under objects and monsters (upstream layer order).
function trapIndex(): Map<number, CellGlyph> {
  const map = new Map<number, CellGlyph>();
  for (const list of state.traps.values()) {
    for (const t of list) {
      if (!t.flags.has(TRF.VISIBLE) || !t.kind.glyph.trim()) continue;
      const tile = tileMap
        ? tileDrawFor(tileForTrap(tileMap, t.kind.tidx, LIGHTING.LOS), t.grid.x, t.grid.y)
        : undefined;
      map.set(gridIndex(t.grid.x, t.grid.y), {
        ch: t.kind.glyph,
        css: colorToCss(colorCharToAttr(t.kind.color)),
        ...(tile ? { tile } : {}),
      });
    }
  }
  return map;
}

// Live floor items from the engine's piles (pile head = newest, drawn on
// top exactly as upstream lists the first object).
function objectIndex(): Map<number, CellGlyph> {
  const map = new Map<number, CellGlyph>();
  for (const pile of state.floor.values()) {
    // map_info's object loop (cave-map.c:156-170) skips an ignored object
    // ("Item stays hidden") and takes the first one that is NOT ignored, so a
    // kind the player has ignored disappears from the map instead of being
    // dropped from the pack and left visible on the ground.
    const o = pile.find((obj) => obj.grid && !state.isIgnored?.(obj));
    if (!o || !o.grid) continue;
    const tile = tileMap
      ? tileDrawFor(tileForObject(tileMap, o.kind), o.grid.x, o.grid.y)
      : undefined;
    // object_kind_attr / object_kind_char (ui-object.c:87-112): a flavoured kind
    // draws with its flavour glyph+colour (use_flavor_glyph) until identified -
    // for a scroll, only while unaware. Without this an unidentified potion
    // renders in the kind's black placeholder colour (a black square on the
    // floor). The flavour attr is a colour NAME (colorTextToAttr); the kind attr
    // is a colour CHAR (colorCharToAttr).
    const flavor = state.flavorGlyph?.(o.kind);
    const useFlavor =
      !!flavor && !(tvalIsScroll(o.kind.tval) && (game.flavor?.isAware(o.kind) ?? false));
    map.set(gridIndex(o.grid.x, o.grid.y), {
      ch: useFlavor ? flavor.char : o.kind.dChar,
      css: useFlavor
        ? colorToCss(colorTextToAttr(flavor.attr))
        : colorToCss(colorCharToAttr(o.kind.dAttr)),
      ...(tile ? { tile } : {}),
    });
  }
  return map;
}

/**
 * Darken a #rrggbb color for remembered-but-unseen terrain. This is map
 * lighting, not UI chrome: it deliberately produces an off-palette rgb() tint
 * (the browser analogue of the darkness/torchlight remap). A faithful pass
 * would route this through getColor(attr, ATTR_DARK) instead; tracked as map
 * work, not REND-2. palette-exempt: computed tint + defensive fallback.
 */
function dim(css: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  if (!m) return "#3a3a44"; // palette-exempt: unreachable defensive fallback
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
function terrainGlyph(
  x: number,
  y: number,
  lighting: number = LIGHTING.LOS,
): CellGlyph {
  const f = state.chunk.feature(loc(x, y));
  const disp = f.mimic !== null ? features.get(f.mimic) : f;
  /*
   * grid_get_attr (ui-map.c:108-125): torch-flag terrain brightens under
   * torchlight and darkens out of LoS / UNLIGHT. featIsTorch is the live
   * classifier (W2-016; cave-square.c:148). No RNG.
   */
  let attr = colorCharToAttr(disp.dAttr);
  if (featIsTorch(features, disp.fidx)) {
    if (lighting === LIGHTING.TORCH) attr = getColor(attr, ATTR_LIGHT, 1);
    else if (lighting === LIGHTING.LIT) attr = getColor(attr, ATTR_DARK, 1);
    else if (lighting === LIGHTING.DARK) attr = getColor(attr, ATTR_DARK, 2);
  }
  const css = colorToCss(attr);
  // A terrain tile (per the pack's feat mapping at this lighting) takes over
  // the cell; when the pack does not map this feat, the ASCII glyph shows.
  const tile = tileMap
    ? tileDrawFor(tileForFeature(tileMap, disp.fidx, lighting), x, y)
    : undefined;
  if (disp.flags.has(TF["WALL"])) {
    if (state.options?.get("hybrid_walls"))
      return { ch: disp.dChar, css, bg: dim(css), ...(tile ? { tile } : {}) };
    if (state.options?.get("solid_walls"))
      return { ch: disp.dChar, css, bg: css, ...(tile ? { tile } : {}) };
  }
  return { ch: disp.dChar, css, ...(tile ? { tile } : {}) };
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
  if (!(state.options?.get("hp_changes_color") ?? true)) return UI_TEXT;
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
function monsterIndex(): Map<number, CellGlyph> {
  const map = new Map<number, CellGlyph>();
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    if (!mon.mflag.has(MFLAG.VISIBLE) && !mon.mflag.has(MFLAG.MARK)) continue;
    const tile = tileMap
      ? tileDrawFor(tileForMonster(tileMap, mon.race.ridx), mon.grid.x, mon.grid.y)
      : undefined;
    map.set(gridIndex(mon.grid.x, mon.grid.y), {
      ch: mon.race.dChar,
      css: colorToCss(monsterAttr(mon)),
      ...(tile ? { tile } : {}),
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
      const mem = knownObjectShown(x, y);
      if (!mem) return null;
      return mem.ch === null
        ? { ch: "*", css: UI_DIM }
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
  return {
    timedEffects: players.timed,
    unignoring: state.ignore.unignoring,
    /* prt_study (ui-display.c L1235) colours the "Study" indicator L_DARK when
     * the player has spell slots but no book holding a studiable spell. The dep
     * defaulted to true, so the indicator was always WHITE. */
    bookHasUnlearnedSpells: playerBookHasUnlearnedSpells(state),
  };
}

/**
 * Render the left status sidebar from the engine's sidebarModel (ui-display.c),
 * one field per row in side_handlers[] order. Blank separators are inserted at
 * the original NULL-spacer positions to reproduce the classic grouping; the
 * priority culling of update_sidebar is not needed at full height.
 */
function renderSidebar(rows: number): void {
  const fields = sidebarModel(state, displayDeps());
  const spacerAfter = new Set(["con", "sp"]);
  // The sidebar starts at row 1 (ui-display.c:866 `for (i = 0, row = 1; ...)`),
  // leaving row 0 as the full-width message line and aligning the first field
  // with the map's top row (ROW_MAP = row_top_map[SIDEBAR_LEFT] = 1, ui-term.c).
  let y = 1;
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
    // side_handlers[] has TWO NULL spacer slots between prt_health and prt_speed
    // (ui-display.c:823-832, indices 20 and 22), so the health bar is separated
    // from Speed/Depth by two blank rows, not one.
    if (f.key === "health") y += 2;
  }
}

/**
 * Render the bottom status line from statusLineModel (ui-display.c), the active
 * indicators (level feeling, timed effects, DTrap, terrain, ...) laid left to
 * right in status_handlers[] order. Segments render back-to-back with NO extra
 * gap: each segment's text already bakes exactly one trailing gap column, so
 * its width equals the reference handler's return value (update_statusline_aux
 * advances col by that width). Idle prt_state reserves one blank column, which
 * statusLineModel emits as a single-space run.
 *
 * update_statusline (ui-display.c:1316) is the event handler that picks the row
 * and calls update_statusline_aux; here the caller passes the row. KNOWN
 * DIVERGENCE, recorded not fixed by W1-CITED
 * (parity/phase3-2026-07-25/findings/W1-CITED.md): upstream moves the status
 * line to row 3 when Term->sidebar_mode is SIDEBAR_TOP; the only call site here
 * always passes rows - 1, including in the "top" sidebar layout.
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
  }
}

/**
 * The map viewport geometry for the current terminal size and sidebar mode
 * (SIDEBAR_MODE, set via '=' -> (o)). Left keeps the classic 13-column status
 * column; Top drops it for a full-width map with a one-line vitals header under
 * the message row; None drops all vitals furniture for a full-width, full-height
 * map. A narrow (phone / portrait) screen cannot fit the Left column, so a Left
 * choice falls back to Top there. Kept as a helper so the touch handler maps a
 * tapped cell back to a grid square identically.
 *
 * Camera model: verifyPanel() (verify_panel / modify_panel, ui-output.c
 * L529-670) owns the persistent map offset panelCam. center_player=OFF (the
 * normal default) panel-scrolls - the offset holds until the player comes
 * within 3 grids of an edge, then it re-centres by half a screen; ON re-centres
 * every turn. Both clamp to the level bounds (modify_panel). viewport() below
 * is a pure reader of that offset (plus the 'L' locate pan and an explicit
 * focus centre); verifyPanel() is the sole mutator, called once per render().
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
// The persistent map viewport top-left (upstream term offset_y/offset_x). null
// before the first verifyPanel() and after a level change / center-map command,
// so the next verify centres on the player. verifyPanel() is the only writer.
let panelCam: Loc | null = null;

function viewport(focus?: Loc): {
  layout: SidebarLayout;
  compact: boolean;
  mapOriginX: number;
  mapTop: number;
  mapCols: number;
  mapRows: number;
  camX: number;
  camY: number;
} {
  const { cols, rows } = term.size();
  // The user's sidebar mode ('=' -> (o), SIDEBAR_MODE) picks the layout: Left =
  // the classic 13-column column, Top = a one-line vitals header, None = no
  // furniture. A 13-column column needs a roomy width, so on a genuinely narrow
  // (phone / portrait) screen a Left choice falls back to Top - a browser
  // necessity upstream's fixed terminal never faces. Top/None hold at any width.
  const tiny = cols < 48;
  const mode = SIDEBAR_MODES[sidebarMode] ?? "Left";
  const layout: SidebarLayout =
    mode === "None" ? "none" : mode === "Top" ? "top" : tiny ? "top" : "left";
  const compact = layout !== "left";
  const mapOriginX = layout === "left" ? SIDEBAR_W : 0;
  const mapTop = layout === "top" ? 2 : 1; // Top adds a vitals row under the msg row
  // SCREEN_WID reserves the rightmost column (ui-term.h: (wid - COL_MAP - 1)),
  // so the visible map is 66 cols in Left mode / 79 in Top/None, matching C.
  const mapCols = cols - mapOriginX - 1;
  const mapRows = rows - mapTop - 1; // the last row is the status line
  let camX: number, camY: number;
  if (locateCam) {
    // 'L' locate: report the panned sector top-left (change_panel).
    camX = locateCam.x;
    camY = locateCam.y;
  } else if (focus) {
    // Explicit centre (e.g. targeting focus): centre on the given grid.
    camX = focus.x - Math.floor(mapCols / 2);
    camY = focus.y - Math.floor(mapRows / 2);
  } else if (panelCam) {
    // Normal play: the offset verifyPanel() maintains (verify_panel).
    camX = panelCam.x;
    camY = panelCam.y;
  } else {
    // No offset yet (pre-first-verify coordinate lookups): centre on player.
    camX = state.actor.grid.x - Math.floor(mapCols / 2);
    camY = state.actor.grid.y - Math.floor(mapRows / 2);
  }
  return { layout, compact, mapOriginX, mapTop, mapCols, mapRows, camX, camY };
}

/**
 * verify_panel (ui-output.c L563-670): keep the map offset (panelCam) so the
 * player stays on screen. center_player=OFF (normal) panel-scrolls - the offset
 * only moves once the player is within 3 grids of an edge, then re-centres by
 * half a screen; ON re-centres whenever the player leaves the exact centre.
 * modify_panel (L529) then clamps the offset to the level bounds. Called once
 * per render() so every viewport() reader in a frame sees the same offset.
 */
function verifyPanel(): void {
  const vp = viewport(); // for mapCols / mapRows / layout; camX/camY ignored
  const { mapCols, mapRows } = vp;
  const py = state.actor.grid.y;
  const px = state.actor.grid.x;
  const panelH = Math.floor(mapRows / 2);
  const panelW = Math.floor(mapCols / 2);
  const centered = state.options?.get("center_player") ?? false;
  let wy = panelCam ? panelCam.y : py - panelH;
  let wx = panelCam ? panelCam.x : px - panelW;

  // Scroll vertically: recentre when centered and off-centre, else only when
  // within 3 grids of the top/bottom edge (verify_panel_int).
  if (centered && py !== wy + panelH) wy = py - panelH;
  else if (py < wy + 3 || py >= wy + mapRows - 3) wy = py - panelH;

  if (centered && px !== wx + panelW) wx = px - panelW;
  else if (px < wx + 3 || px >= wx + mapCols - 3) wx = px - panelW;

  // modify_panel clamp: keep the offset inside the level.
  wy = Math.max(0, Math.min(wy, Math.max(0, state.chunk.height - mapRows)));
  wx = Math.max(0, Math.min(wx, Math.max(0, state.chunk.width - mapCols)));
  panelCam = { x: wx, y: wy };
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

/**
 * The look/target cursor cell's highlight background, so the described grid is
 * obvious. This is the browser analogue of the terminal hardware cursor (a
 * cell highlight), not text chrome; a faithful reverse-video/box-outline pass
 * is tracked as cursor-rendering work, not REND-2.
 */
const CURSOR_BG = "#3a4a6a"; // palette-exempt: map cursor highlight background

function render(targeting?: TargetingOverlay): void {
  // verify_panel before drawing so every viewport() reader in this frame sees
  // the same offset. Skipped in 'L' locate mode, where locateCam pans instead.
  if (!locateCam) verifyPanel();
  const { cols, rows } = term.size();
  term.clear();

  const { layout, mapOriginX, mapTop, mapCols, mapRows, camX, camY } =
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
            term.put(screenX, screenY, { ch: " ", fg: UI_BG, ...cursorBg });
          }
          continue;
        }
        const f = features.get(kf);
        const disp = f.mimic !== null ? features.get(f.mimic) : f;
        // Remembered (out-of-view) terrain is the LIT lighting variant
        // (cave-map.c map_info: the default for known, non-in-view grids). A
        // mapped tile shows at full brightness (upstream does not dim tiles);
        // absent a tile, the ASCII glyph is drawn dim as before.
        const memTile = tileMap
          ? tileDrawFor(tileForFeature(tileMap, disp.fidx, LIGHTING.LIT), gx, gy)
          : undefined;
        term.put(screenX, screenY, {
          ch: disp.dChar,
          fg: dim(colorToCss(colorCharToAttr(disp.dAttr))),
          ...cursorBg,
          ...(memTile ? { tile: memTile } : {}),
        });
        /* Remembered / sensed objects persist on the map in full color. */
        const mem = knownObjectShown(gx, gy);
        if (mem) {
          term.put(
            screenX,
            screenY,
            mem.ch === null
              ? { ch: "*", fg: UI_DIM, ...cursorBg }
              : { ch: mem.ch, fg: colorToCss(colorCharToAttr(mem.attr)), ...cursorBg },
          );
        }
        /* Detected monsters show even out of view - that is the point. */
        const marked = monsterAt.get(idx);
        if (marked)
          term.put(screenX, screenY, {
            ch: marked.ch,
            fg: marked.css,
            ...cursorBg,
            ...(marked.tile ? { tile: marked.tile } : {}),
          });
        if (pathColour !== undefined) {
          term.put(screenX, screenY, { ch: "*", fg: colorToCss(pathColour), ...cursorBg });
        }
        continue;
      }

      const t = terrainGlyph(gx, gy, LIGHTING.LOS);
      let drawn: CellGlyph = t;
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
      // whatever is "on top" of the grid without the terrain's own bg. A
      // graphics tile (drawn.tile), when present and loaded, blits over the
      // cell; the terminal falls back to ch/fg if the atlas is not ready.
      term.put(screenX, screenY, {
        ch: drawn.ch,
        fg: drawn.css,
        ...(drawn.bg !== undefined ? { bg: drawn.bg } : {}),
        ...cursorBg,
        ...(drawn.tile ? { tile: drawn.tile } : {}),
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

  if (layout === "top") renderCompactVitals(1, cols);
  else if (layout === "left") renderSidebar(rows);
  // layout === "none": no vitals furniture at all - a full-width, full-height
  // map (vitals still reachable via the 'C' character screen / status line).

  if (targeting) {
    // The look description takes the message row; the bottom status row
    // becomes the help prompt/text, exactly as target_set_interactive owns
    // both while it runs.
    term.print(0, 0, targeting.desc.slice(0, cols - 1), UI_GOLD);
    if (targeting.help) {
      const n = targeting.helpLines.length;
      targeting.helpLines.forEach((line, i) => {
        term.print(mapOriginX, rows - n + i, line.slice(0, mapCols - 1), UI_TEXT);
      });
    } else {
      term.print(mapOriginX, rows - 1, "Press '?' for help.".slice(0, mapCols - 1), UI_DIM);
    }
  } else {
    // The message line owns the full width of row 0 from col 0 (c_prt at 0,0),
    // above the sidebar (which starts at row 1) - not indented to the map.
    term.print(0, 0, message.slice(0, cols - 1), messageColor);
    renderStatusLine(mapOriginX, rows - 1, mapCols);

    // show_target / highlight_player: the between-turns map cursor. Upstream
    // places it just before waiting for a command and repeats the same block at
    // four sites (ui-display.c:2486 refresh, ui-game.c:678 pre_turn_refresh,
    // ui-command.c:105 do_cmd_redraw, ui-input.c:1899 highlight_player in
    // inkey) - target if show_target and target_sighted(), else the player.
    // Painted LAST because repainting a cell erases the frame, exactly as
    // Term_gotoxy-before-inkey does. The interactive '*' / 'l' loop owns the
    // cursor itself, hence the targeting branch above.
    const showTarget = state.options?.get("show_target") ?? false;
    const cursorGrid =
      showTarget && targetSighted(state)
        ? targetGet(state)
        : (state.options?.get("highlight_player") ?? false)
          ? state.actor.grid
          : null;
    if (cursorGrid) {
      const cx = mapOriginX + (cursorGrid.x - camX);
      const cy = mapTop + (cursorGrid.y - camY);
      if (cx >= mapOriginX && cy >= mapTop && cx < mapOriginX + mapCols && cy < mapTop + mapRows) {
        term.setCursor(cx, cy);
      } else {
        term.hideCursor();
      }
    } else {
      term.hideCursor();
    }
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
    // do_cmd_locate -> get_com_ex (ui-input.c): the sector banner is a row-0
    // command prompt, drawn full-width from col 0 in white (prt), not offset by
    // the sidebar (REND-5) nor gold.
    const cols = term.size().cols;
    term.print(0, 0, banner.slice(0, cols - 1), UI_TEXT);
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
// -more- prompt subsystem (ui-input.c msg_flush / display_message L385-595).
// A turn's messages share the top line until the running column would pass
// (width - 8); paginateMessages (messages.ts) splits them into the pages
// upstream would each cap with the L_BLUE "-more-" prompt. auto_more (the core
// option, list-options.h) suppresses the waits (msg_flush's anykey() guard,
// L395), so the pager shows only the final page. The final page always just
// persists on the top line (no trailing -more-), exactly as the last message
// does in normal play.
const MORE_COLOR = UI_MORE; // COLOUR_L_BLUE (#00ffff)

/** Wait for any keypress or tap (anykey, ui-input.c) - the -more- gate. */
function waitAnyKey(): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = (ev: Event): void => {
      ev.preventDefault();
      if (ev.type === "keydown") (ev as KeyboardEvent).stopImmediatePropagation();
      window.removeEventListener("keydown", done, true);
      window.removeEventListener("pointerdown", done, true);
      resolve();
    };
    window.addEventListener("keydown", done, true);
    window.addEventListener("pointerdown", done, true);
  });
}

/**
 * Page the messages logged during the turn that started at log length `preLen`,
 * pausing with "-more-" between pages unless auto_more is set. A single page
 * (the common case) needs no pause - render() has already put it on the top
 * line - so this returns immediately. Runs inside a modal so the game key
 * handler stands down while the player reads.
 */
async function pumpMessages(preLen: number, force = false): Promise<void> {
  const fresh = msglog.all().slice(preLen);
  const pages = paginateMessages(fresh, term.size().cols);
  if (fresh.length > 0) {
    messageColor = fresh[fresh.length - 1]?.color ?? UI_TEXT;
  }
  /* `force` is msg_flush proper (ui-input.c L565-595): the caller is about to
   * replace the screen, so even a single page has to be READ first - it gets
   * the "-more-" prompt and waits, exactly as on_new_level's
   * EVENT_MESSAGE_FLUSH does before EVENT_NEW_LEVEL_DISPLAY. Without a key to
   * wait for, the last thing that happened on the old level is wiped unread. */
  if (force && pages.length === 1 && !(state.options?.get("auto_more") ?? false)) {
    const page = pages[0] ?? "";
    message = page;
    render();
    term.print(page.length + 1, 0, "-more-", MORE_COLOR);
    await waitAnyKey();
    return;
  }
  if (pages.length <= 1) {
    // display_message packs the whole turn's messages onto row 0 (ui-input.c
    // L570-590), so a turn with several short messages ("You are covered in
    // acid!" + "You feel your life draining away!") shows them concatenated -
    // not just msglog.latest(), which is all render() drew. Put the single
    // packed page on the top line so no earlier message is dropped.
    if (pages.length === 1) {
      message = pages[0] ?? message;
      render();
    }
    return;
  }
  const last = pages[pages.length - 1] ?? "";
  if (state.options?.get("auto_more")) {
    message = last;
    render();
    return;
  }
  await openModal(async () => {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i] ?? "";
      message = page;
      render();
      if (i < pages.length - 1) {
        // msg_flush(message_column + split + 1) (ui-input.c L575): the -more-
        // prompt sits one column after the message text, which now starts at
        // col 0 (REND-5), so no sidebar offset.
        term.print(page.length + 1, 0, "-more-", MORE_COLOR);
        await waitAnyKey();
      }
    }
  });
  message = last;
  render();
}

/**
 * Open the shop screen for the store whose entrance the player is standing on
 * (do_cmd_store via EVENT_ENTER_STORE). Faithful entry is a post-move / hold
 * consequence, not a keypress: the caller detects the player landed on (or is
 * holding on) a shop tile. Because shop tiles carry no objects, the sell picker's
 * USE_FLOOR source is naturally empty here.
 */
/**
 * Run an item command while inside a store (cmdq_pop CTX_STORE, ui-store.c:1159):
 * execute the registered action directly so the pack/equipment change and its
 * messages apply, but NO world turn passes - monsters do not act while the
 * player is shopping. Returns the message(s) the engine emitted (already logged
 * via state.msg), for the store to mirror onto its row 0.
 */
function runStoreItemCmd(code: string, args: Record<string, unknown>): string | null {
  const before = msglog.all().length;
  game.registry.get(code)?.(state, { code, args });
  const fresh = msglog.all().slice(before).map((m) => m.text);
  return fresh.length ? fresh.join(" ") : null;
}

function enterStoreModal(store: Store): Promise<void> {
  // enter_store's own guard (ui-store.c:1257-1262): re-resolve store_at from the
  // grid, because the screen opens a tick after the step that triggered it.
  const refusal = enterStoreGuard(storeAtPlayer());
  if (refusal) {
    say(refusal);
    return Promise.resolve();
  }
  const feat = features.get(store.feat);
  return openModal(() =>
    runStore(term, game, store, say, constants, {
      // Each do_cmd_buy / _sell / _retrieve / _stash calls store_at(cave,
      // player->grid) AFRESH (store.c:1665, :1795, :1872, :2014); the shop
      // screen must not trust the Store it was opened with.
      storeAt: storeAtPlayer,
      featureName: feat?.name ?? store.featName,
      rogueLike: state.options?.get("rogue_like_commands") ?? false,
      // store_examine (ui-store.c L749): the object_info screen for a fully
      // known store item, header capitalised as ODESC_CAPITAL does.
      examine: async (obj) => {
        const name = objectName(state, obj);
        const header = name.charAt(0).toUpperCase() + name.slice(1);
        const tb = objectInfoTextblock(state, obj, inspectExtras);
        await showTextScreen(term, header, wrapRuns(tb, term.size().cols));
      },
      sellPick: storeSellPick,
      // store_process_command_key (ui-store.c:823-863): wear/wield, take off, and
      // view inventory / equipment / quiver while shopping. wield/takeoff run
      // through the engine with no world turn (runStoreItemCmd); the viewers are
      // the same faithful screens the 'i'/'e'/'|' dungeon commands show.
      manageItem: {
        wield: async () => {
          const ref = await selectItemFrom(
            "Wear or wield which item?",
            (t) => tvalIsWearable(t.tval),
            { inven: true, quiver: true },
            "You have nothing to wear or wield.",
            itemCmdKey("wield"),
            false,
            "wield",
          );
          if (ref === null || !("handle" in ref)) return null;
          return runStoreItemCmd("wield", { handle: ref.handle });
        },
        takeOff: async () => {
          const ref = await selectItemFrom(
            "Take off or unwield which item?",
            () => true,
            { equip: true },
            "You have nothing to take off or unwield.",
            itemCmdKey("takeoff"),
            false,
            "takeoff",
          );
          if (ref === null || !("handle" in ref)) return null;
          return runStoreItemCmd("takeoff", { handle: ref.handle });
        },
        inventory: () => showTextScreen(term, "Inventory", inventoryLines(state)),
        equipment: () => showTextScreen(term, "Equipment", equipmentLines(state)),
        quiver: () => showTextScreen(term, "Quiver", quiverLines()),
      },
    }),
  );
}

/** The store the player is currently standing on (square_shopnum), or null. */
function storeAtPlayer(): Store | null {
  return (
    state.stores?.find((s) => s.feat === state.chunk.feat(state.actor.grid)) ?? null
  );
}

/**
 * Re-enter the loop on the next macrotask to take the next step of a
 * self-continuing command (a run, a pathfind, an auto-repeated dig). The engine
 * already holds the continuation on its cmdQueue, so this consumes nothing and
 * decides nothing - it exists because the browser can only deliver the keypress
 * that ABORTS a run (check_for_player_interrupt, ui-game.c:645) when the event
 * loop turns. Upstream redraws every step of a run too (Term_fresh in
 * process_player's refresh), so stepping through advance() is also what makes a
 * run visible instead of a teleport from start to finish.
 */
function pumpStep(): void {
  // Keys arriving during the wait are the abort, not commands (see the keydown
  // handler); set the flag before yielding so none is missed.
  pumping = true;
  setTimeout(() => {
    // A -more- prompt, a floor pile or a store screen may have taken the
    // terminal in this step's tail: let it finish before stepping again.
    if (modalDepth > 0) {
      pumpStep();
      return;
    }
    if (dead || !state.playing) {
      pumping = false;
      return;
    }
    advance();
  }, 0);
}

function advance(): void {
  // A key held over from a pump that ended some other way (a level change, a
  // death) must not abort the NEXT run.
  if (!pumping) interruptKey = false;
  pumping = false;
  const preLen = msglog.all().length; // messages before this turn, for -more-
  const beforeX = state.actor.grid.x;
  const beforeY = state.actor.grid.y;
  const seeFloorReq = seeFloorRequested; // do_cmd_hold requested a floor look
  seeFloorRequested = false;
  // Clear the top message line when the player commits a turn-taking command,
  // mirroring C erasing row 0 on the next command (ui-input.c prt("",0,0) in
  // textui_get_rep_dir L1586 + msg_flag=false in textui_get_command L1893). Any
  // message this turn emits re-fills `message` via say() during runGameLoop
  // (before render below), so new messages still show; a message-less move
  // leaves row 0 blank instead of stranding the previous line (e.g. "You have
  // killed a rat.") across every subsequent step. Free-action/prompt commands
  // that set `message` directly do not call advance(), so they are unaffected.
  message = "";
  const status = runGameLoop(state, registry);
  if (status === LOOP_STATUS.DEATH_CONFIRM) {
    /* take_hit suspended after the C-order died_from assignment and before
     * either final death or EVENT_CHEAT_DEATH. Keep this an in-terminal prompt
     * on the GlyphTerm grid; the answer resumes the same live chain. */
    render();
    void openModal(async () => {
      const pending = state.pendingDeath;
      if (!pending) return;
      const die = await getCheck(term, "Die? ");
      pending.resolve(die);
      advance();
    });
    return;
  }
  if (status === LOOP_STATUS.DEAD) {
    dead = true;
    // Death is terminal (decision 16): the character's slot becomes a
    // tombstone - its save bytes are dropped so it can never be resumed, but
    // its record stays in the roster for the memorial. Clearing the active id
    // sends the next boot to the picker (or birth if no one else is left).
    const activeId = getActiveId();
    // close_game's dead branch (ui-game.c:1152-1158): the tombstone IS the
    // port's dead-player save (decision 16 drops the resumable bytes), so a
    // failed metadata write loses the memorial and gets upstream's message.
    if (activeId && !markDead(activeId)) say("death save failed!");
    setActiveId(null);
    // death_knowledge (player-util.c L309): reveal every ARTIFACT_UNKNOWN
    // history entry before the memorial/score screen, so a "Missed X" find
    // the player never identified shows its real name. 4.2.6 writes no
    // HIST_PLAYER_DEATH entry (verified: zero uses in reference/src).
    historyUnmaskUnknown(state.actor.player);
    message = "You have died. (Press 'N' or refresh to start a new game.)";
    // Enter the character on the high-score table (enter_score). died_from is
    // the real killer recorded on the player at take-hit (12.5/WP-10); it falls
    // back only if the engine never set it.
    const player = state.actor.player;
    const diedFrom = player.diedFrom || "the dungeon";
    // enter_score gating (score.c L272-302): a cheater (any OP_SCORE option
    // set), a wizard/debug character (noscore bits, 15.3/WP-10), and a
    // non-winning interrupted/retiring death are not scored. noscoreInvalidates-
    // Score reads the persisted Player.noscore bits; fullName feeds the score's
    // `who` column.
    const outcome = enterScore(
      scoreStore,
      state.actor.player,
      { ...scoreBuildDeps(diedFrom), deathTime: new Date() },
      {
        diedFrom,
        cheated: state.options?.anyScoreSet() ?? false,
        noscore: scoreGateNoscore(
          noscoreInvalidatesScore(player.noscore),
          game.manifest.modNoscore,
        ),
        /* score.c:291: the Borg gets its own line. The bit is set by the borg
         * mod's activation gate (cmd-misc.c:140) when that mod is mounted. */
        borg: (player.noscore & NOSCORE.BORG) !== 0,
        totalWinner: player.totalWinner,
      },
    );
    /* score.c:282/289/292/300/303: each rejection tells the player which rule
     * cost them the entry, msg() then EVENT_MESSAGE_FLUSH - so it is read
     * before the tombstone below. The reason was computed and discarded. */
    if (!outcome.entered) {
      say(
        outcome.reason === "cheater"
          ? "Score not registered for cheaters."
          : outcome.reason === "wizard"
            ? "Score not registered for wizards."
            : outcome.reason === "borg"
              ? "Score not registered for borgs."
              : outcome.reason === "interrupted"
                ? "Score not registered due to interruption."
                : "Score not registered due to retiring.",
      );
    }
    // death_screen (ui-death.c L374): the winner crown + tombstone first, then
    // the death menu (whose "View scores" opens the Hall of Fame). Escape
    // reopens the menu.
    void openModal(async () => {
      await showTombstone(diedFrom);
      await runDeathMenu();
    });
  } else if (status === LOOP_STATUS.LEVEL_CHANGE) {
    // on_new_level (game-world.c:1027-1031): EVENT_MESSAGE_FLUSH *then*
    // EVENT_NEW_LEVEL_DISPLAY. The stair message ("You enter a maze of down
    // staircases.", cmd-cave.c:134/87) is read on the OLD screen behind a
    // "-more-" prompt; only after a key does the new level appear. Doing the
    // change first wiped the message unread.
    const target = state.targetDepth ?? state.chunk.depth + 1;
    void openModal(async () => {
      await pumpMessages(preLen, true);
      game.changeLevel(target);
      state.generateLevel = false;
      autosave(true); // a fresh level is a natural save point
      render();
    });
    return; // the modal owns the rest of this turn's tail
  }
  // EVENT_SEEFLOOR (cmd-pickup.c L484 after a step; cmd-cave.c L1610 on hold):
  // announce the floor pile once autopickup has run. Detect a step by the grid
  // change; the explicit hold request covers standing still on items. Skipped on
  // death and level change (arrival on a new level is not a step onto its floor).
  const moved = state.actor.grid.x !== beforeX || state.actor.grid.y !== beforeY;
  // EVENT_ENTER_STORE (player_handle_post_move, player-util.c:1602; do_cmd_hold,
  // cmd-cave.c:1592): stepping onto - or standing still on - a shop door opens
  // the store. Gate on the step/hold this turn (not merely "on a shop tile") so
  // it fires once from the move, exactly like upstream, and does not re-open every
  // turn the player idles on the door after leaving.
  // (A level change returned above, so these no longer need to exclude it.)
  // do_cmd_hold's shapechange gate (cmd-cave.c:1592-1598): a shapechanged
  // player cannot enter a shop at all, and a non-Home shopkeeper screams. The
  // port had the shop entry but not the gate, so a bat could go shopping.
  const shopHere = !dead && (moved || seeFloorReq) ? storeAtPlayer() : null;
  let enterShop = shopHere;
  if (shopHere && playerIsShapechanged(state)) {
    if (shopHere.feat !== FEAT.HOME) {
      say("There is a scream and the door slams shut!");
    }
    enterShop = null;
  }
  if (!dead && (moved || seeFloorReq) && !enterShop) {
    seeFloorItems();
  }
  autosave(); // throttled: keep the session recoverable during active play
  render();
  // -more- gating: page this turn's messages, pausing between screenfuls unless
  // auto_more is set. Skipped on death (the tombstone/menu modal owns the flow).
  if (!dead) {
    void pumpMessages(preLen).then(() => {
      // Entering a store is the post-move consequence; it takes precedence over a
      // floor look (shop tiles hold no objects, so there is no pile anyway).
      if (enterShop) return enterStoreModal(enterShop);
      // A multi-object pile shows the floor list after its message is paged.
      const pile = pendingFloorPile;
      pendingFloorPile = null;
      if (pile) return openModal(() => showFloorPileScreen(pile));
      return undefined;
    });
  }
  // The engine handed control back mid-run/repeat so a keypress can reach it.
  if (status === LOOP_STATUS.PAUSE) pumpStep();
}

/**
 * keylog[] / log_i / log_size (ui-term.c:317-319): the ring of recent keypresses
 * wiz_display_keylog shows, KEYLOG_SIZE deep, oldest first. Upstream fills it
 * inside inkey_ex, so it sees every key the game reads; here the overlays own
 * their own listeners, so this records the keys the GAME handler sees - which is
 * what the screen is for (working out what a keymap or a stuck key just sent).
 *
 * `code` is the browser's key, not upstream's keycode_t: this host has no
 * keycode space of its own, so a single character logs its code point and a
 * named key logs 0. `text` is keypress_to_text's rendering of the modifiers.
 */
const KEYLOG: WizKeypress[] = [];
const KEYLOG_MAX = 8;

/** keypress_to_text (ui-event.c:233) over a browser KeyboardEvent. */
function logKeypress(ev: KeyboardEvent): void {
  if (ev.key === "Shift" || ev.key === "Control" || ev.key === "Alt" || ev.key === "Meta") {
    return; // a modifier alone is not a keypress upstream would log
  }
  const mods =
    (ev.ctrlKey ? 0x01 : 0) | (ev.shiftKey ? 0x02 : 0) | (ev.altKey ? 0x04 : 0) |
    (ev.metaKey ? 0x08 : 0);
  const named = ev.key.length > 1;
  const body = named ? `[${ev.key}]` : ev.key;
  let text: string;
  if (!mods) text = body;
  else if (mods === 0x01) text = `^${body}`; // control alone gets the caret form
  else {
    let braces = "{";
    if (ev.ctrlKey) braces += "^";
    if (ev.shiftKey) braces += "S";
    if (ev.altKey) braces += "A";
    if (ev.metaKey) braces += "M";
    text = `${braces}}${body}`;
  }
  KEYLOG.push({ text, code: named ? 0 : ev.key.codePointAt(0) ?? 0, mods });
  if (KEYLOG.length > KEYLOG_MAX) KEYLOG.shift();
}

window.addEventListener("keydown", (ev) => {
  logKeypress(ev);
  if (scoresOpen || modalDepth > 0) return; // a modal owns the keyboard
  // While a run / pathfind / repeated command is being pumped, ANY key is the
  // abort and nothing else: check_for_player_interrupt flushes the input and
  // disturbs (ui-game.c:658-663), so the key is swallowed rather than obeyed.
  // The engine says "Cancelled." on the next step.
  if (pumping) {
    ev.preventDefault();
    interruptKey = true;
    return;
  }
  // Ctrl-P: recall the message history (do_cmd_messages), even the same key
  // the roguelike keyset would otherwise use, since a modifier is held.
  if (ev.ctrlKey && (ev.key === "p" || ev.key === "P")) {
    ev.preventDefault();
    void openModal(() =>
      showTextScreen(term, "Message history", messageHistoryLines(msglog)),
    );
    return;
  }
  // New character (N): a web affordance in the ORIGINAL keyset, where N is
  // otherwise unbound. In the ROGUELIKE keyset N is run-SE (pref.prf:327-328,
  // keymap dir 3), so it must fall through to resolveKey there instead of
  // starting a new character. Allowed even after death, so a fallen hero rolls
  // a new character into the same save slot (faithful to the death -> new
  // character flow).
  if (
    !ev.ctrlKey &&
    !ev.altKey &&
    !ev.metaKey &&
    ev.key === "N" &&
    !(state.options?.get("rogue_like_commands") ?? false)
  ) {
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
  // A re-entry, not part of the flow: death_screen's loop only ends by quitting
  // or starting a new game, and both navigate away, so the death modal normally
  // owns the keyboard from death onwards and this never fires. It is here so a
  // modal that dies on an exception still leaves the menu reachable rather than
  // stranding a dead character on the map.
  if (dead && ev.key === "Escape" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    ev.preventDefault();
    void openModal(() => runDeathMenu());
    return;
  }
  if (dead) return;
  // The active keyset (rogue_like_commands). Every command below resolves its
  // key through this exactly like cmd_info's key[0] (original) / key[1]
  // (roguelike) pair, so no binding differs from the reference.
  const roguelike = state.options?.get("rogue_like_commands") ?? false;
  // User keymaps (keymap_find, applied in inkey before command interpretation):
  // a modifier-free character trigger with a keymap expands into its action
  // sequence, fed through the input queue so any sub-menu the action opens
  // consumes the following keys exactly as upstream. Synthetic keys (a keymap's
  // own expanded output) are skipped so a keymap never recurses. Checked here,
  // after the ^-aliases guard's siblings above (N / ? / death), so those web
  // affordances keep priority; every ordinary command key is keymappable.
  if (!ev.ctrlKey && !ev.altKey && !ev.metaKey && !isSynthKey(ev) && ev.key.length === 1) {
    const action = keymapFind(keymapModeFor(roguelike), ev.key);
    if (action) {
      ev.preventDefault();
      enqueueKeys([...action].map((ch) => ({ key: ch })));
      return;
    }
  }
  // Ctrl-key command aliases (cmd_action / cmd_util faithful bindings that use a
  // control modifier). Checked before the modifier-free block below.
  if (ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    // Dig a tunnel (^T): the roguelike-keyset alias of Tunnel, whose original
    // key is the plain 'T' (ui-game.c:146 { 'T', KTRL('T') }). Roguelike 'T' is
    // Take off, so tunnel moves to ^T there; in the original keyset ^T is unbound.
    if (roguelike && (ev.key === "t" || ev.key === "T")) {
      ev.preventDefault();
      void openModal(tunnelCmd);
      return;
    }
    // Save (^S, cmd_util "Save and don't quit"): same autosave 'S' triggers.
    if (ev.key === "s" || ev.key === "S") {
      ev.preventDefault();
      autosave(true);
      message = "Saving game... done.";
      render();
      return;
    }
    // Toggle wizard mode (^W, do_cmd_wizard / ui-game.c L222). First entry
    // confirms and marks player.noscore |= NOSCORE_WIZARD (15.1 / cmd-misc.c).
    if (ev.key === "w" || ev.key === "W") {
      ev.preventDefault();
      void openModal(async () => {
        wizardMode = await runWizardToggle(wizardCtx(), wizardMode);
        /* player->wizard for take_hit's cheat-death gate (W2-009). */
        state.wizard = wizardMode;
      });
      return;
    }
    // Debug command menu (^A, "Debug mode commands" / ui-game.c L225). Only
    // available in wizard mode; first use runs the debug confirm + NOSCORE_DEBUG
    // marking (15.2 / player_can_debug_prereq).
    if (ev.key === "a" || ev.key === "A") {
      ev.preventDefault();
      void openModal(() => runWizardDebugMenu(wizardCtx()));
      return;
    }
    // Repeat level feeling (^F, do_cmd_feeling / ui-game.c:186): a free action.
    if (ev.key === "f" || ev.key === "F") {
      ev.preventDefault();
      feelingCmd();
      return;
    }
    // Show previous message (^O, do_cmd_message_one / ui-game.c:187): free.
    if (ev.key === "o" || ev.key === "O") {
      ev.preventDefault();
      showPrevMessageCmd();
      return;
    }
    // Do autopickup (^G, CMD_AUTOPICKUP / ui-game.c:224): pick up everything on
    // the grid that needs no action - gold, plus =g / pickup_always items - a
    // single key active in both keysets. Distinct from 'g' (interactive pickup);
    // the core doAutopickup path is registered as the "autopickup" command.
    if (ev.key === "g" || ev.key === "G") {
      ev.preventDefault();
      commandBuffer.push({ code: "autopickup" });
      advance();
      return;
    }
    // Repeat previous command (^V): the roguelike-keyset alias of Repeat, whose
    // original key is the plain 'n' (ui-game.c:223 { 'n', KTRL('V') }). Roguelike
    // 'n' is a movement key, so repeat moves to ^V; original-keyset ^V is unbound.
    if (roguelike && (ev.key === "v" || ev.key === "V")) {
      ev.preventDefault();
      repeatLastCommand();
      return;
    }
    // Save and quit (^X, textui_quit / cmd_util:199). The browser reserves some
    // Ctrl combos, but the game takes ownership so its bindings never differ.
    if (ev.key === "x" || ev.key === "X") {
      ev.preventDefault();
      saveQuitCmd();
      return;
    }
    // Redraw the screen (^R, do_cmd_redraw / cmd_util:201).
    if (ev.key === "r" || ev.key === "R") {
      ev.preventDefault();
      redrawCmd();
      return;
    }
    // Center map on the player (^L original keyset, do_cmd_center_map /
    // cmd_hidden:221). In the roguelike keyset ^L is alter-east, so ^L centers
    // only in the original keyset; the roguelike center-map key is '@' (below).
    if (!roguelike && (ev.key === "l" || ev.key === "L")) {
      ev.preventDefault();
      centerMapCmd();
      return;
    }
    // Ignore an item (^D): the roguelike-keyset alias of Ignore, whose original
    // key is the plain 'k' (ui-game.c:165 { 'k', KTRL('D') }). Roguelike 'k' is a
    // movement key, so ignore moves to ^D; in the original keyset ^D is unbound.
    if (roguelike && (ev.key === "d" || ev.key === "D")) {
      ev.preventDefault();
      void openModal(ignoreItemCmd);
      return;
    }
    return;
  }
  if (!ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    // TAB never moves focus off the game canvas (it is a roguelike command key).
    if (ev.key === "Tab") ev.preventDefault();
    // The full command table, faithful to ui-game.c's cmd_info arrays. Each row
    // carries its original-keyset key (`o`) and, where the roguelike keyset
    // differs, its roguelike key (`r`). `r: null` means the command has no plain
    // roguelike key (it moves to a control key, handled above), so that letter
    // stays free for roguelike movement; `o: null` means original has no binding
    // (a roguelike-only key). This mirrors cmd_lookup exactly - no key differs.
    const COMMANDS: { o?: string | null; r?: string | null; act: () => void }[] = [
      // Item commands (cmd_item, ui-game.c:118-133).
      { o: "{", act: () => void openModal(inscribeItem) },
      { o: "}", act: () => void openModal(uninscribeItem) },
      // do_cmd_wield's item_tester is obj_can_wear = wield_slot(obj) >= 0
      // (cmd-obj.c L284, obj-util.c L810) - the slot lookup, not the tval set.
      { o: "w", act: () => void openModal(() => useItem("wield", (t) => objCanWear(state, t), "Wear or wield which item?", "You have nothing to wear or wield.", { inven: true, floor: true, quiver: true })) },
      { o: "t", r: "T", act: () => void openModal(takeOffItem) },
      { o: "I", act: () => void openModal(() => inspectItem()) },
      { o: "d", act: () => void openModal(() => useItem("drop", () => true, "Drop which item?", "You have nothing to drop.")) },
      { o: "f", r: "t", act: () => void openModal(fireCmd) },
      { o: "u", r: "Z", act: () => void openModal(() => useItem("use-staff", (t) => tvalIsStaff(t.tval), "Use which staff? ", "You have no staves to use.", { inven: true, floor: true })) },
      { o: "a", r: "z", act: () => void openModal(() => useItem("aim-wand", (t) => tvalIsWand(t.tval), "Aim which wand? ", "You have no wands to aim.", { inven: true, floor: true })) },
      { o: "z", r: "a", act: () => void openModal(() => useItem("zap-rod", (t) => tvalIsRod(t.tval), "Zap which rod? ", "You have no rods to zap.", { inven: true, floor: true })) },
      { o: "A", act: () => void openModal(activateItem) },
      { o: "E", act: () => void openModal(() => useItem("eat", (t) => tvalIsEdible(t.tval), "Eat which food? ", "You have no food to eat.", { inven: true, floor: true })) },
      { o: "q", act: () => void openModal(() => useItem("quaff", (t) => tvalIsPotion(t.tval), "Quaff which potion? ", "You have no potions from which to quaff.", { inven: true, floor: true })) },
      { o: "r", act: () => void openModal(() => useItem("read", (t) => tvalIsScroll(t.tval), "Read which scroll? ", "You have no scrolls to read.", { inven: true, floor: true })) },
      // player_can_refuel_prereq gates 'F' (ui-game.c:132) before CMD_REFILL.
      { o: "F", act: () => { if (playerCanRefuelPrereq()) void openModal(refuelItem); else render(); } },
      { o: "U", r: "X", act: () => void openModal(useGenericCmd) },
      // General actions (cmd_action, ui-game.c:141-153).
      { o: "D", act: () => void openModal(disarmCmd) },
      { o: "R", act: () => void openModal(restCmd) },
      { o: "l", r: "x", act: () => void openModal(async () => { if (await runTargetLoop(TARGET.LOOK, true)) say("Target Selected."); }) },
      // Swap weapon: the original keyset maps 'x' to the pref.prf "w0" macro
      // (wield the item inscribed @0). The roguelike keyset uses 'x' for Look
      // (the look row above), so this binds 'x' only in the original keyset.
      { o: "x", r: null, act: () => void openModal(swapWeaponCmd) },
      { o: "*", act: () => void openModal(async () => { if (await runTargetLoop(TARGET.KILL, true)) say("Target Selected."); else say("Target Aborted."); }) },
      { o: "'", act: () => { targetSetClosest(state, TARGET.KILL); render(); } },
      // Tunnel: 'T' in the original keyset; the roguelike keyset uses ^T (handled
      // above) since roguelike 'T' is Take off.
      { o: "T", r: null, act: () => void openModal(tunnelCmd) },
      { o: "<", act: () => { commandBuffer.push({ code: "ascend" }); advance(); } },
      { o: ">", act: () => { commandBuffer.push({ code: "descend" }); advance(); } },
      { o: "o", act: () => void openModal(openCmd) },
      { o: "c", act: () => void openModal(closeCmd) },
      { o: "h", r: "Tab", act: () => fireAtNearestCmd() },
      { o: "v", act: () => void openModal(throwCmd) },
      { o: "W", r: "-", act: () => void openModal(jumpCmd) },
      // Item management (cmd_item_manage, ui-game.c:161-165).
      /* do_cmd_equip / do_cmd_inven / do_cmd_quiver open with an emptiness
       * check that says why rather than showing an empty screen
       * (ui-knowledge.c:4030-4033, :4076-4079, :4120-4123). */
      { o: "e", act: () => void openModal(() => listingScreen("Equipment", equipmentLines(state), state.actor.player.equipment.every((h) => !h), "You are not wielding or wearing anything.")) },
      { o: "i", act: () => void openModal(() => listingScreen("Inventory", inventoryLines(state), (state.gear.inven ?? []).filter(Boolean).length === 0, "You have nothing in your inventory.")) },
      { o: "|", act: () => void openModal(() => listingScreen("Quiver", quiverLines(), (state.gear.quiver ?? []).filter(Boolean).length === 0, "You have nothing in your quiver.")) },
      { o: "g", act: () => void openModal(pickupCmd) },
      // Ignore: 'k' in the original keyset; roguelike uses ^D (handled above) so
      // roguelike 'k' stays free for movement.
      { o: "k", r: null, act: () => void openModal(ignoreItemCmd) },
      // Information commands (cmd_info, ui-game.c:173-185).
      { o: "b", r: "P", act: () => void openModal(browseCmd) },
      { o: "G", act: () => void openModal(studySpell) },
      { o: "S", act: () => void openModal(showAbilitiesScreen) },
      { o: "m", act: () => void openModal(castSpell) },
      { o: "M", act: () => void openModal(() => showLevelMap(term, buildOverviewForShell())) },
      { o: "K", r: "O", act: () => { state.ignore.unignoring = !state.ignore.unignoring; void openModal(() => applyIgnoreDrop()); } },
      { o: "]", act: () => void openModal(() => showTextScreen(term, "Objects in view", objectListLines(state))) },
      { o: "[", act: () => void openModal(showMonsterList) },
      { o: "L", r: "W", act: () => void openModal(() => runLocate()) },
      { o: "/", act: () => void openModal(querySymbolCmd) },
      { o: "C", act: () => void openModal(() => showCharacterSheet(term, state, playerName, charSheetOpts())) },
      { o: "~", act: () => void openModal(openKnowledgeMenu) },
      // Utility/assorted (cmd_util, ui-game.c:196-203).
      { o: "=", act: () => { void openModal(() => runOptionsMenu(term, state, openIgnoreSetup, sidebarModeMenu)).then(() => autosave(true)); } },
      { o: "Q", act: () => void openModal(retireCmd) },
      { o: ")", act: () => screenDumpCmd() },
      // Hidden commands (cmd_hidden, ui-game.c:211-223).
      { o: ":", act: () => void openModal(noteCmd) },
      { o: "V", act: () => versionCmd() },
      { o: '"', act: () => void openModal(prefLineCmd) },
      { o: "+", act: () => void openModal(alterCmd) },
      { o: "s", act: () => void openModal(stealCmd) },
      { o: ";", act: () => void openModal(walkStepCmd) },
      // Run/stand: the two keys swap between keysets (CMD_RUN {'.',','} and
      // CMD_HOLD {',','.'}), so '.' runs and ',' stands in the original keyset,
      // and the reverse in the roguelike keyset.
      { o: ".", r: ",", act: () => void openModal(runDirCmd) },
      { o: ",", r: ".", act: () => holdCmd() },
      // Numpad 5 is the stay-still key in both keysets (do_cmd_hold): standing
      // still on a shop door re-enters the store (EVENT_ENTER_STORE,
      // cmd-cave.c:1592), and it is the canonical "wait one turn" command.
      { o: "5", r: "5", act: () => holdCmd() },
      { o: "p", act: () => exploreCmd() },
      // Repeat: 'n' in the original keyset; roguelike uses ^V (handled above).
      { o: "n", r: null, act: () => repeatLastCommand() },
      // Center map: roguelike '@' (original uses ^L, handled above).
      { o: null, r: "@", act: () => centerMapCmd() },
    ];
    for (const c of COMMANDS) {
      const key = roguelike ? (c.r === undefined ? c.o : c.r) : c.o;
      if (key != null && ev.key === key) {
        ev.preventDefault();
        /* key_confirm_command (ui-input.c:1995) at ui-game.c:562-565's exact
         * position: the key has resolved to a real command, and the WORN
         * equipment's `^*` / `^<key>` inscriptions get to veto it before the
         * command runs. Refusing drops the key entirely - upstream sets cmd to
         * NULL, so nothing is queued and no turn passes.
         *
         * The command runs AFTER this modal closes, not inside it: c.act opens
         * its own modal, and running it nested meant this one's close repainted
         * over it. */
        const owed = keyConfirmCount(state.actor.player, state.gear, key);
        if (owed > 0) {
          let allowed = false;
          void openModal(async () => {
            for (let i = 0; i < owed; i++) {
              if (!(await confirmYesNo(KEY_CONFIRM_PROMPT))) return;
            }
            allowed = true;
          }).then(() => {
            if (allowed) c.act();
          });
          return;
        }
        c.act();
        return;
      }
    }
    // The game menu: the discoverable home for save / switch / new character
    // (so a player who does not know the keys is never stuck).
    if (ev.key === "Escape") {
      ev.preventDefault();
      void openModal(openGameMenu);
      return;
    }
  }
  const binding = resolveKey(ev, state.options?.get("rogue_like_commands") ?? false);
  if (!binding) return;
  ev.preventDefault();
  // Shops are PASSABLE store-feature tiles (terrain.txt): walking into one steps
  // the player ONTO the door (move_player -> monster_swap, cmd-cave.c:1184), and
  // the store opens as a post-move consequence (player_handle_post_move ->
  // EVENT_ENTER_STORE, player-util.c:1602). That entry trigger lives in advance()
  // so it fires from the step, not this handler - the walk flows to the core like
  // any other move. Because shop tiles never carry objects (no OBJECT flag), the
  // player stands on an empty grid inside the store, which is why store_sell's
  // USE_FLOOR source is always empty (there is no selling of floor items).
  //
  // A run binding starts a run; the engine self-continues via cmdQueue until
  // run_test stops it (runGameLoop returns INPUT), so one keypress runs.
  // A plain walk routes through queueWalk so a step into lava gets move_player's
  // "Really step in?" confirm before the turn is spent (cmd-cave.c L1156-1180).
  if (binding.kind === "walk" && typeof binding.dir === "number") {
    void queueWalk(binding.dir);
    return;
  }
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
    advance();
  } else {
    void queueWalk(dir); // lava confirm on a tap-to-step, like the keyboard walk
  }
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
    ["Opts", () => { void openModal(() => runOptionsMenu(term, state, openIgnoreSetup, sidebarModeMenu)).then(() => autosave(true)); }],
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
      // palette-exempt: DOM coarse-pointer touch button (D2 browser affordance,
      // a translucent HTML overlay, not a terminal glyph).
      background: "rgba(20,20,28,0.82)",
      color: UI_TEXT,
      border: "1px solid #3a3a44", // palette-exempt: DOM touch-button border
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

// ---- Session continuity + anti-scum: force a save on every exit path -------
// A refresh, navigation, tab-hide or close all force-flush the in-progress game
// to its slot BEFORE the page unloads, so reloading resumes the exact same
// state instead of an earlier one - you cannot refresh your way out of a bad
// turn (decision 16: no save-scumming; death is terminal). beforeunload is the
// canonical refresh/navigation hook; pagehide and the hidden visibility state
// are the last-chance hooks for mobile browsers that may kill a backgrounded
// tab without firing beforeunload. All three route through persistSave, which
// is a no-op for a throwaway pre-birth game (birthPending) and a dead hero.
function flushSaveOnExit(): void {
  if (!dead) persistSave();
}
window.addEventListener("beforeunload", flushSaveOnExit);
window.addEventListener("pagehide", flushSaveOnExit);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushSaveOnExit();
});

// ---- Sound subsystem wiring (faithful to init_sound + EVENT_SOUND) ----
// The core SoundEngine subscribes to the "sound" event and plays a sample from
// the pack. The Dubtrain pack (CC-BY 4.0) ships bundled in public/sounds/ as the
// default pack, so combat, spells, deaths and ranged attacks have samples ready;
// they are only heard when the use_sound option is ON (OFF by default, faithful
// to upstream - see the use_sound gate below). Override the pack with
// `?sounds=<base-url>`. Selection uses the game RNG so it is
// deterministic. The live turn loop routes sound() through this bus (state.sound).
// Also carries the "feeling" signal (updateFov below) since GameEvents is a
// general multi-type bus, not a sound-only one.
const soundEvents = new GameEvents();
// The single game event bus lives on GameState (W1.6): sound() emits "sound"
// here, msg() emits "message" (above), and mods subscribe through the
// capability-gated subscribeEvents seam. One bus, many event types.
state.events = soundEvents;
// Default to the bundled Dubtrain pack (public/sounds/, CC-BY 4.0); samples are
// heard only when use_sound is enabled (off by default). Override with ?sounds=<url>.
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

/* First FOV after birth/load: clear only_partial left sticky by startGame
 * when updateFov was not yet wired (ui-display.c:2556-2557). */
state.updateFov(state);
state.chunk.onlyPartial = false;
// A resize/reflow is a background repaint (the ResizeObserver in term.ts also
// fires once on observe, and again whenever the embed's layout settles), so it
// must not paint the map over a boot overlay - see renderBackground.
term.onResize = () => renderBackground();
render();

// Boot the persisted/URL-selected graphics mode (ASCII if none). Async and
// best-effort: fetches the pack image + prefs and repaints when ready, leaving
// the map ASCII on any failure.
void applyTileMode(readTileMode());

// --- Birth: choose a character for a new game -------------------------------
// A brand-new game opens the staged birth screen (ui-birth.c stage order). The
// engine has already built a default Human Warrior this load; when the player
// chooses, we persist the choice and reload so startGame rebuilds as that
// race/class (its stats and starting kit differ). A one-shot sessionStorage
// flag suppresses the screen on that rebuild. Backing out (ESC) keeps whatever
// character was built. Resuming a save never births.
async function maybeBirth(): Promise<void> {
  if (!bootedNew) return;
  // An autoplayer (the Borg, ?agent=) boots straight into play: skip the modal
  // birth screen and let it drive the default (or last-birthed) character, so it
  // never stalls waiting for a human to click through character creation.
  if (params.get("agent")) {
    say("The Borg awakens.");
    return;
  }
  let justBirthed = false;
  try {
    justBirthed = sessionStorage.getItem(BIRTH_DONE_KEY) === "1";
    sessionStorage.removeItem(BIRTH_DONE_KEY);
  } catch {
    /* sessionStorage unavailable: fall through and show birth. */
  }
  if (justBirthed) return; // the choice from the previous load is already live
  // Registry-backed data for the birth informational panels (race/class help
  // blocks + the full display_player(0) sheet), plus get_history for the
  // background stage. The birth screen holds neither the bodies/history charts
  // nor the player_property list, so the shell supplies them.
  const elementNames = (booted.registries.projections ?? []).map((p) => p.name);
  const birthDeps: BirthDeps = {
    bodyFor: (raceName) => {
      const race = players.raceByName(raceName);
      return race ? players.bodies[race.body] ?? null : null;
    },
    historyChartFor: (raceName) => {
      const race = players.raceByName(raceName);
      return race ? players.historyChart(race) : null;
    },
    properties: players.properties,
    elementNames,
  };
  // Birth UI advances the live game stream (ui-birth.c L465/678/696/842 +
  // get_history L746-750): the same Rand that store_reset / seed_randart /
  // seed_flavor / level gen continue. The throwaway startGame already advanced
  // state.rng through init; reseed to the world seed so birth draws start at
  // the C birth-UI position, then snapshot after accept for the post-birth
  // reload (Decision 6.2). PREVIEW_SEED throwaways in birth.ts stay separate.
  state.rng.setState(new Rng(seed).getState());
  const historyFor = (raceName: string): string => {
    const race = players.raceByName(raceName);
    if (!race) return "";
    return generateHistory(players.historyChart(race), state.rng);
  };
  await openModal(async () => {
    // BIRTH_RESET (ui-birth.c:1615-1626 + 1661-1666): stepping back off the FIRST
    // birth stage is NOT an exit. Upstream maps that BIRTH_BACK to the stage
    // before, which is BIRTH_QUICKSTART, and then remaps THAT to BIRTH_RESET, so
    // it re-pushes CMD_BIRTH_RESET and starts creation over; and in the quickstart
    // prompt itself a bare ESCAPE is simply ignored (textui_birth_quickstart
    // loops until Y/N/C/=). Birth has no ESC exit at all - only KTRL('X'), which
    // quits the program.
    //
    // runBirth returns null for exactly that first-stage step-back, so the
    // faithful handling is to run it AGAIN (a fresh call is what CMD_BIRTH_RESET
    // amounts to here: cursors and stat work discarded, the shared RNG stream
    // continuing). Accepting the null and playing on instead is what made ESC
    // look like it "instantly creates a character with default settings" - the
    // hero it kept was the throwaway one startGame had already rolled behind the
    // birth screen, which the player never chose.
    let choice: Awaited<ReturnType<typeof runBirth>> = null;
    // quickstart_allowed (ui-birth.c): offer the quick-start stage only when
    // a previous character's choices exist to reuse.
    while (!choice) {
      choice = await runBirth(term, players.races, players.classes, {
        // ui-birth.c draws random race/class/*/@/roller from the main game RNG.
        rng: state.rng,
        quickstart: birthChoice
          ? {
              raceName: birthChoice.raceName,
              className: birthChoice.className,
              ...(birthChoice.stats && birthChoice.stats.length === 5
                ? { stats: birthChoice.stats }
                : {}),
            }
          : null,
        deps: birthDeps,
        historyFor,
        // player_random_name (player.c:375) for the name field's '*' key and the
        // name finish_with_random_choices fills in. Draws on the same game RNG.
        randomName: () => playerRandomName(state.rng, tolkienNameProbs()),
        // Seed the '=' birth-options editor with the previous character's choices
        // so a New Game defaults to them (as upstream keeps the last birth opts).
        ...(birthChoice?.birthOptions ? { birthOptions: birthChoice.birthOptions } : {}),
      });
    }
    try {
      localStorage.setItem(BIRTH_KEY, JSON.stringify(choice));
      sessionStorage.setItem(BIRTH_DONE_KEY, "1");
      sessionStorage.setItem(FORCE_NEW_KEY, "1");
      // Persist the advanced stream so the post-birth reload's startGame
      // continues from this position (store_reset / seeds / level gen).
      sessionStorage.setItem(BIRTH_RNG_KEY, JSON.stringify(state.rng.getState()));
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
  try {
    sessionStorage.setItem(SKIP_TITLE_KEY, "1"); // already past the title
  } catch {
    /* storage disabled: the title simply shows again, which is harmless */
  }
  const url = new URL(location.href);
  url.searchParams.delete("new");
  url.searchParams.delete("seed");
  location.assign(url.toString());
}

/**
 * The title / news screen (news.txt), shown once per genuine launch before any
 * game interaction - the faithful stand-in for the GUI ports displaying
 * news.txt and waiting on "[Choose 'New' or 'Open' from the 'File' menu]"
 * (main-win.c:5475). Skipped only on internal continuation reloads: an
 * autoplayer boot (?agent), the post-birth rebuild (BIRTH_DONE peeked, not
 * cleared - maybeBirth still owns clearing it), and New/Switch/resume-a-slot
 * (SKIP_TITLE, set by those actions and cleared here).
 */
async function maybeTitle(): Promise<void> {
  if (params.get("agent")) return;
  try {
    if (sessionStorage.getItem(SKIP_TITLE_KEY) === "1") {
      sessionStorage.removeItem(SKIP_TITLE_KEY);
      return;
    }
    if (sessionStorage.getItem(BIRTH_DONE_KEY) === "1") return; // post-birth rebuild
  } catch {
    /* sessionStorage unavailable: fall through and show the title */
  }
  await openModal(() => showTitleScreen(term));
}

// Boot-time flow: the title screen first, then a resumed character plays
// immediately; otherwise pick from the roster (when other characters are saved)
// or birth a brand-new one.
async function bootMenus(): Promise<void> {
  await maybeTitle();
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
// perceive/act facade via installController - no privileged access. Enable
// with ?agent=<id> (disabled by default). Controllers are registered in
// DEMO_AGENTS (and later, mods); the port ships no built-in autoplayer.
// The controller is latched to yield one command per tick (runGameLoop would
// otherwise pull nextCommand until null and never return with an always-acting
// agent); the tick interval is the agent's configurable speed. Ticks wait out
// birth / menus / death (modalDepth, dead).
const agentId = params.get("agent");
const agentMake = agentId ? DEMO_AGENTS[agentId] : undefined;
if (agentId && agentMake) {
  const base: AgentController = agentMake();
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
    capabilities: ["state:*.read", "command:add", "event:message", "event:sound"],
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
  // Event hook (W1.6): the same agent subscribes to the game event bus through
  // the capability-gated seam - proving mods can REACT to events, not only
  // perceive/act. event:message / event:sound are granted above.
  let agentMsgCount = 0;
  if (state.events) {
    const sub = subscribeEvents(state.events, caps);
    sub.on("message", () => {
      agentMsgCount += 1;
    });
  }
  let agentTicks = 0;
  let agentLastError: string | null = null;
  // Configurable speed. Accepts ?speed=fast|normal|slow or a raw millisecond
  // interval; defaults to normal (120ms).
  const AGENT_TICK_MS = ((): number => {
    const raw = (params.get("speed") ?? "").toLowerCase();
    if (raw === "fast") return 40;
    if (raw === "normal") return 120;
    if (raw === "slow") return 400;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 10 && n <= 5000) return n;
    return 120;
  })();
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
      get msgCount() {
        return agentMsgCount;
      },
    };
  }
}

// ---- Scripted-plugin sandbox seam (W2.1) ---------------------------------
// A scripted plugin runs as UNTRUSTED code in a Web Worker and drives the game
// through the same frozen perceive/act facade - but across a thread boundary,
// so it can never touch GameState directly. The host serializes only the
// capability-granted view domains (serialize.ts), the worker neuters network
// globals unless granted, and every returned command flows back through the
// live capability-gated act facade. This is the SYSTEM-modding tier's runtime.
// Enable with ?plugin=<id> (disabled by default). Same latch-free pump as the
// agent seam:
// the async bridge yields null until the worker replies, then the next tick
// executes the pending command (host.ts).
// Tracks which plugin ids are already installed (URL param wins) so the
// persisted-enable pass (W2.4) does not double-install one.
const installedPluginIds = new Set<string>();

function installSandbox(pluginId: string): void {
  const found = discoverPlugins().get(pluginId);
  if (!found) {
    console.warn(`[plugins] "${pluginId}" not found; skipping`);
  } else {
    installedPluginIds.add(pluginId);
    const resolver = new ContentIdResolver({
      objects: booted.registries.objects,
      playerRaces: players.races,
      playerClasses: players.classes,
    });
    const caps = CapabilitySet.fromManifest(found.manifest);
    let pluginTicks = 0;
    let pluginReady = false;
    let pluginLastError: string | null = null;
    const sb = installSandboxedController(state, found.createWorker(), {
      caps,
      capabilityStrings: found.manifest.capabilities ?? [],
      pluginUrl: pluginId,
      viewDeps: { resolver, reg: booted.registries.objects },
      onReady: () => {
        pluginReady = true;
      },
      onError: (phase, msg) => {
        pluginLastError = `${phase}: ${msg}`;
      },
    });
    const PLUGIN_TICK_MS = 120;
    const PLUGIN_TICK_CAP = 5000;
    const pluginTimer = setInterval(() => {
      if (dead) {
        clearInterval(pluginTimer);
        sb.uninstall();
        return;
      }
      if (scoresOpen || modalDepth > 0) return; // wait out birth / menus
      // A crashing pump must not wedge the host: stop and record on a throw.
      try {
        advance();
      } catch (err) {
        pluginLastError = err instanceof Error ? err.message : String(err);
        clearInterval(pluginTimer);
        sb.uninstall();
        return;
      }
      pluginTicks += 1;
      if (pluginTicks >= PLUGIN_TICK_CAP) {
        clearInterval(pluginTimer);
        sb.uninstall();
      }
    }, PLUGIN_TICK_MS);
    if (import.meta.env.DEV) {
      (window as unknown as { __neoPlugin?: unknown }).__neoPlugin = {
        id: pluginId,
        installed: true,
        capabilities: found.manifest.capabilities ?? [],
        get ready() {
          return pluginReady;
        },
        get ticks() {
          return pluginTicks;
        },
        get turn() {
          return state.turn;
        },
        get lastError() {
          return pluginLastError;
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// W2.2: trusted in-process plugin. Where the Worker sandbox (?plugin=) is the
// untrusted reactive tier, a trusted plugin overrides game SYSTEMS - effect
// handlers, room builders, player-command actions, monster AI - through the
// capability-gated ModRegistryHost. It runs in-process because those handlers
// execute synchronously with live rng/chunk/player access the Worker boundary
// cannot carry. Trust is explicit: it only gets the registry:* domains its
// manifest declares (CapabilitySet gates each facade). Enable via ?trusted=<id>
// or by enabling it (with consent) in the mod manager (W2.4).
function installTrusted(trustedId: string): void {
  const found = discoverTrustedPlugins().get(trustedId);
  if (!found) {
    console.warn(`[trusted] "${trustedId}" not found; skipping`);
  } else {
    installedPluginIds.add(trustedId);
    const caps = CapabilitySet.fromManifest(found.manifest);
    let trustedError: string | null = null;
    const logs: string[] = [];
    // This mod's own vocabulary (W2.3): declared terms + per-entity values. A
    // real host restores it from / persists it to the mod's save bag; here it
    // starts empty each boot and the mod repopulates it in register().
    const trustedVocab = new VocabularyRegistry();
    try {
      const host = createModRegistryHost(
        {
          effects: effectRegistry,
          rooms: booted.registries.rooms,
          commands: registry,
          state,
          vocab: trustedVocab,
        },
        caps,
      );
      found.plugin.register(host, {
        state,
        id: trustedId,
        log: (msg) => {
          logs.push(msg);
          console.info(`[trusted:${trustedId}] ${msg}`);
        },
      });
    } catch (err) {
      trustedError = err instanceof Error ? err.message : String(err);
      console.error(`[trusted:${trustedId}] install failed:`, err);
    }
    if (import.meta.env.DEV) {
      (window as unknown as { __neoTrusted?: unknown }).__neoTrusted = {
        id: trustedId,
        installed: trustedError === null,
        capabilities: found.manifest.capabilities ?? [],
        get logs() {
          return [...logs];
        },
        get turn() {
          return state.turn;
        },
        get monsterHook() {
          return typeof state.monsterTurnHook === "function";
        },
        get lastError() {
          return trustedError;
        },
        // W2.3: the mod's declared vocabulary + stored values (its bag content).
        get vocab() {
          return trustedVocab.toJSON();
        },
      };
    }
  }
}

// URL params install a specific plugin for one-off testing (they win).
const pluginId = params.get("plugin");
if (pluginId) installSandbox(pluginId);
const trustedId = params.get("trusted");
if (trustedId) installTrusted(trustedId);

// W2.4: install every mod the player enabled in the manager whose capabilities
// they consented to. Content mods take effect through pack.ts (composed at load
// from the same neo:enabledMods key); this is the plugin half - a persisted,
// consented enable installs the plugin at boot without a URL param. A plugin
// enabled but not yet consented is skipped (the manager gates consent on enable,
// but this second-checks so a hand-edited store can never bypass it).
try {
  const modStore = defaultModStore();
  const sandboxMods = discoverPlugins();
  const trustedMods = discoverTrustedPlugins();

  // First run (no saved enabled-set): materialize DEFAULT_ENABLED_MODS so the
  // mod manager reflects them, and pre-consent any first-party bundled plugin to
  // its declared caps so a default-on trusted/sandbox bundled mod actually
  // installs. pack.ts already composed content with the same defaults this load;
  // this persists them + the consent so later manager edits (including
  // disabling) stick. Third-party plugins still require explicit consent.
  //
  // NOTE: DEFAULT_ENABLED_MODS is EMPTY by the parity mandate (see mod-store.ts),
  // so today this loop persists an empty set and NO mod is on out of the box -
  // the fresh-install experience is faithful 4.2.6 with no QoL tweak and no bug
  // fix applied. The machinery is kept for the case where a future bundled mod
  // is genuinely meant to default on.
  if (!modStore.hasStoredEnabled()) {
    const discovered = [
      ...discoverContentModManifests().map((m) => m.id),
      ...sandboxMods.keys(),
      ...trustedMods.keys(),
    ];
    const defaults = resolveEnabledIds({ url: null, stored: null, discovered });
    modStore.setEnabled(defaults);
    for (const id of defaults) {
      if (!FIRST_PARTY_MOD_IDS.includes(id)) continue;
      const caps =
        sandboxMods.get(id)?.manifest.capabilities ??
        trustedMods.get(id)?.manifest.capabilities ??
        [];
      if (caps.length > 0) modStore.setConsent(id, caps);
    }
  }

  const enabledIds = modStore.getEnabled();
  if (enabledIds.length > 0) {
    const consents = modStore.getConsents();
    for (const id of enabledIds) {
      if (installedPluginIds.has(id)) continue;
      const sb = sandboxMods.get(id);
      if (sb) {
        if (consentSatisfied(sb.manifest.capabilities ?? [], consents[id] ?? [])) {
          installSandbox(id);
        } else {
          console.warn(`[mods] "${id}" enabled but capabilities not consented; skipping`);
        }
        continue;
      }
      const tr = trustedMods.get(id);
      if (tr) {
        if (consentSatisfied(tr.manifest.capabilities ?? [], consents[id] ?? [])) {
          installTrusted(id);
        } else {
          console.warn(`[mods] "${id}" enabled but capabilities not consented; skipping`);
        }
      }
    }
  }
} catch (err) {
  console.warn("[mods] persisted-enable auto-install failed:", err);
}

// Dev-only diagnostic hook for automated verification; Vite strips this whole
// block from the production bundle (import.meta.env.DEV is false there).
if (import.meta.env.DEV) {
  (window as unknown as { __neo?: unknown }).__neo = {
    resumed: resumedActive,
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
    // Appearance-parity snapshot: glyph + CSS colour per cell, for the UI /
    // colour parity harness to diff against a captured C html_screenshot dump.
    screenColored: () => term.snapshotColored(),
    // Tile-rendering diagnostics (task C1): the active mode, whether its atlas
    // and pref map are loaded, and how many cells the last render blitted as
    // tiles (proves the map render chose tiles, not ASCII).
    tiles: () => ({
      grafID: currentGrafID,
      mode: tileset?.menuname ?? null,
      // Which engine is drawing, and for a loose pack how much of it has
      // streamed in so far (a tilesheet has one image, hence null).
      engine: tileset instanceof LinoleumPack ? "linoleum" : tileset ? "tilesheet" : null,
      assets:
        tileset instanceof LinoleumPack
          ? {
              slots: tileset.index.slots.length,
              requested: tileset.requestedAssets,
              loaded: tileset.loadedAssets,
              skipped: tileset.index.skipped,
            }
          : null,
      atlasReady: !!tileset && tileset.ready,
      mapLoaded: !!tileMap,
      tileCells: term.tileCellCount(),
    }),
    setTileMode: (id: number): Promise<void> => applyTileMode(id, true),
    // OPT(player, name) as the game sees it - so a verification pass can check
    // that an options screen actually reached the live option store.
    option: (name: string): boolean => state.options?.get(name) ?? false,
    // option_set through the live store, then a repaint - the verification aid
    // for an option whose effect is visual (center_player, solid_walls, ...).
    setOption: (name: string, value: boolean): boolean => {
      const ok = state.options?.set(name, value) ?? false;
      render();
      return ok;
    },
    // The live map offset verifyPanel maintains (verify_panel), for checking
    // the panel/centring behaviour without pixel-scraping.
    camera: (): { x: number; y: number } => {
      const vp = viewport();
      return { x: vp.camX, y: vp.camY };
    },
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
    // Emit a message through the live sink (verification aid): exercises the
    // W1.6 routing state.msg -> event bus -> subscribers.
    msg: (text: string): void => state.msg?.(text),
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
  if (!hasAnimatedVisibleMonster()) return;
  animFrame = (animFrame + 1) & 0xff; // uint8_t flicker counter
  // Background: an overlay (title, character select, birth, any menu) owns the
  // terminal, and a flicker frame must not paint the map over it.
  renderBackground();
}, ANIM_INTERVAL_MS);
