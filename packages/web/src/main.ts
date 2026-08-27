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
  type LoopStatus,
  DEFAULT_DELAY_FACTOR,
  colorCharToAttr,
  colorTextToAttr,
  colorToCss,
  getColor,
  ATTR_LIGHT,
  ATTR_DARK,
  featIsTorch,
  squareIsSeen,
  squareIsBelievedWall,
  knownFeat,
  knownObject,
  type KnownObjectMemory,
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
  banishSymbolRequest,
  effectAimDirRequest,
  spellByIndex,
  objNeedsAim,
  playerKnowsCurse,
  removeCurseDiceString,
  tvalIsPotion,
  tvalIsScroll,
  tvalIsEdible,
  tvalIsStaff,
  tvalIsWand,
  tvalIsRing,
  tvalIsRod,
  tvalIsWearable,
  tvalIsAmmo,
  wieldRingChoice,
  wieldSlot,
  wieldTakeoffConfirm,
  tvalIsMeleeWeapon,
  tvalIsLight,
  objCanRefill,
  objectEffect,
  objectWeightOne,
  objCanWear,
  objIsActivatable,
  objCanBrowse,
  objCanCastFrom,
  objCanStudy,
  playerBookHasUnlearnedSpells,
  objHasInscrip,
  objectIsIgnored,
  objectKnownView,
  OF,
  panelContains,
  sidebarModel,
  sidebarLayout,
  statusLineModel,
  playerRestingIsSpecial,
  PARITY_BASELINE,
  ENGINE_VERSION,
  createVisualsAnimator,
  animateMonsterAttr,
  RF,
  MSG,
  messageSound,
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
  playerCanRead,
  FEAT,
  enterStoreGuard,
  TARGET,
  TMD,
  cmdDisableRepeat,
  ignoreDrop,
  liveUiEntryDeps,
  ignoreDropQueue,
  floorDisplay,
  repeatDirSlots,
  repeatPrevAllowed,
  withRepeatDir,
  projectPath,
  PROJECT,
  initTargetLoopUi,
  useInterestingLoopMode,
  currentLoopGrid,
  stepTargetLoop,
  describeLookGrid,
  computePathColours,
  deathKnowledge,
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
  COLOUR_WHITE,
  COLOUR_L_DARK,
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
} from "@rpgm-tools/neo-angband-core";
import type {
  DisplayRun,
  GamePack,
  GameObject,
  InterruptResponse,
  MessageType,
  ObjectKind,
  PlayerCommand,
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
  HistoryAddEntry,
} from "@rpgm-tools/neo-angband-core";
import { GameEvents, useFlavorGlyph, makeShapeLoreEnv } from "@rpgm-tools/neo-angband-core";
import type { BoltEventData, ExplosionEventData } from "@rpgm-tools/neo-angband-core";
import { registerLocale, setLocale, t } from "@rpgm-tools/neo-angband-core";
import type { LocaleBundle } from "@rpgm-tools/neo-angband-core";
import { describeLoadFailure, describeMigration, describePackMismatch } from "./save-recovery.js";
import { installCrashScreen } from "./crash-screen.js";
import { showSafeModeScreen } from "./safe-mode.js";
import { installController, ContentIdResolver, subscribeEvents, createModRegistryHost, effectInfoRegistry, randartRegistry, runeRegistry, tvalRegistry, VocabularyRegistry } from "@rpgm-tools/neo-angband-core";
import type { AgentController, AgentSession } from "@rpgm-tools/neo-angband-core";
import {
  getGraphicsMode,
  GlyphTable,
  GRAPHICS_NONE,
  hallucinateGrid,
  hallucinatoryMonster,
  hallucinatoryObject,
  type HallucinationRandom,
  LIGHTING,
  monsterGlyph,
  monsterIsCamouflaged,
  monsterIsShapeUnique,
  playerGlyph,
  tileForFeature,
  tileForMonster,
  tileForShownObject,
  tileForTrap,
} from "@rpgm-tools/neo-angband-core";
import type {
  JsonValue,
  MonsterGlyphInput,
  PrefExprVars,
  TileAtlas,
  TileMap,
  TilePrefsDeps,
} from "@rpgm-tools/neo-angband-core";
import { buildUiEntryConfig, setColorChannel, uiEntryRendererCustomize, uiEntryRendererRows } from "@rpgm-tools/neo-angband-core";
import { host, setHost } from "@rpgm-tools/neo-angband-core";
import { BrowserHost } from "./host-browser";
import { menuRegistry, setMenuTransformProblemReporter } from "./menu-registry";
import { tileRegistry, setTileFillProblemReporter } from "./tile-registry";
import {
  glyphWorldFrameSink,
} from "./world-view";
import {
  coreFrontendCandidate,
  coreOnlyFrontend,
  frontendWorldFrameSink,
  installFrontend,
  type FrontendMapStream,
  type InstalledFrontend,
} from "./frontend-runtime";
import {
  coreHudCandidate,
  coreOnlyHud,
  hudFrameSink,
  installHud,
  type InstalledHud,
} from "./hud-runtime";
import {
  projectLiveWorld,
  type HallucinatedCell,
  type HallucinationPresence,
  type ResolvedGlyph,
} from "./world-render-data";
import type { WorldLayer } from "./world-view";
import { detectDesktopBridge, makeDesktopHost } from "./host-electron";
import { initLaunchArgsFromHost } from "./launch";
import {
  combineDiskReports,
  diskPacks,
  loadDiskPacks,
  sessionPacks,
  setDiskPacks,
} from "./disk-packs";
import {
  installModFromRepo,
  installedMeta,
  installedMods,
  loadInstalledMods,
  uninstallMod,
} from "./mod-install";
import { dropSessionMods, loadSessionMods } from "./mod-session";
import type { ModUpgradeDeps } from "./mod-browse";
import { pendingUpgrades, refreshInstalledMods, type ModUpgrade } from "./mod-refresh";
import { zipImportDeps } from "./mod-zip-source";
import { DEFAULT_AUTHORS_URL, fetchAuthors } from "./mod-authors";
import { readConsent, writeConsent } from "./mod-consent";
import { DEFAULT_REGISTRY_URL, fetchRegistry } from "./mod-curated";
import { discoverMod, type DiscoverEnv } from "./mod-discover";
import {
  activeModCode,
  folderPluginManifests,
  loadModCode,
  type LoadedModPlugin,
  mergePluginManifests,
  setModCode,
} from "./mod-code";
import { hideAutoplayerBanner, showAutoplayerBanner } from "./autoplayer-banner";
import {
  modOwnFiles,
  modPluginContext,
  setModComposedRecords,
  setModDisplayControl,
  setModInstallDoor,
  setModRegistries,
  setModDebugDoor,
  type ModSessionFacts,
} from "./mod-context";
import type { ModDisplay, ModPluginContext } from "./mod-plugin";
import { migrateModBags } from "./mod-bags";
import {
  folderPickingSupported,
  forgetModFolder,
  loadPickedModFolder,
  pickModFolder,
  savedModFolder,
  folderPermission,
} from "./mod-folder";
import type { PrefsUiCtx } from "./prefs-ui";
import { applyPrefText } from "./prefs-ui";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import { loadGamePack, loadVisualsRecord, loadMonsterColorCycles, loadUiEntryPacks, loadEnabledModRuleDecls, discoverContentModManifests, presentNamespaces, presentPackDigests, prefetchInstalledPackDigests, diskPackStatus, enabledModIds, composedRecords } from "./pack";
import { liveConflictLines } from "./mod-conflicts";
import { composedObjects, hasFacet, resolveSectionState, sortModOrder } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  defaultModStore,
  buildCatalog,
  consentSatisfied,
  resolveEnabledIds,
  resolveModRules,
  FIRST_PARTY_MOD_IDS,
  type AutoplayerSpeed,
} from "./mod-store";
import { activeModHooks, resolveModRuleFlagsByMod } from "./mod-hooks";
import { faultMessage, reportModFault } from "./mod-problems";
import { teardownModPlugins } from "./mod-teardown";
import {
  closeAllModPanels,
  installPanelKeyboardOwner,
  revokeModPanels,
  setPanelGameSurface,
} from "./panel-runtime";
import { onSessionTaint, sessionTaint, taintNotice, taintSession } from "./mod-taint";
import { runModManager, runModOptionsBrowser, type ModManagerDeps } from "./mods";

/* A menu rewrite is optional mod decoration. Attribute a refusal to its owner,
 * but never turn a screen the player needs into a failed plugin install. */
setMenuTransformProblemReporter((owner, problem) => reportModFault(owner ?? "mods", problem));

/* Same shape for the same reason: a tile a mod could not supply is a letter,
 * which the player can still read and play with. Attributed, because a mod that
 * silently drew nothing is the bug this reporter exists to make visible. */
setTileFillProblemReporter((owner, problem) => reportModFault(owner ?? "mods", problem));
import { showModUpgrades } from "./mod-browse";
import { UI_TEXT, UI_DIM, UI_GOLD, UI_GOOD, UI_BAD, UI_BG, UI_MORE } from "./ui-colors";
import { initA11y } from "./a11y";
import { DEMO_AGENTS } from "./agents/demo";
import { discoverPlugins } from "./agents/sandbox/discover";
import { installSandboxedController } from "./agents/sandbox/host";
import { discoverTrustedPlugins } from "./agents/trusted/discover";
import { enabledModSummary } from "./mod-summary";
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
import type { GridPointerInput, GridSurface, RenderAssetRef } from "./term";
import { screenRegions, type ScreenRegions } from "./regions";
import {
  liveRegionStack,
  onStackChanged,
  paintRegionStack,
  popRegion,
  pushRegion,
  regionInputAt,
  regionSurface,
  relayoutStack,
} from "./ui-stack";
import {
  buildHudFrame,
  glyphHudSectionSink,
  renderHudFrame,
  type HudFrame,
  type HudFrameSink,
  type HudModel,
} from "./hud-view";
import { resolveKey, DIRS_ROGUELIKE } from "./keymap";
import { installWebSound } from "./sound";
import {
  composeTileModes,
  coreTileModes,
  createTileRenderer,
  discoverEnabledTileModes,
  isTile,
  loadTilePrefs,
  setTileScalingMode,
  tileCode,
  type ModPrefText,
  type TileBlitter,
  type TileModeEntry,
} from "./tiles";
import { LinoleumPack, loadLinoleumPack } from "./linoleum-pack";
import { ensureLinoleumTilesheetPack } from "./linoleum-cache";
import { hideTileConversionBanner, showTileConversionBanner } from "./tile-conversion-banner";
import { urlBaseResolver, type PackFileResolver } from "./pack-files";
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
  showFloorList,
  showLevelMap,
  MENU_CLOSE,
  getChar,
  getFile,
  getQuantity,
  getString,
  setUiFaultReporter,
  screenFault,
  screenRegionSpec,
  menuNav,
} from "./overlay";
import type { MenuItem, ItemMenuSource, ObjListRow, ScreenLine } from "./overlay";
import { installMenu, setMenuPresenter } from "./menu-runtime";
import {
  installScreen,
  setScreenPresenter,
  showThroughPresenter,
  withTerminal,
  ScreenAbandoned,
} from "./screen-runtime";
import { promptRequest } from "./prompt-view";
import { installRegions } from "./region-runtime";
import type { ScreenHost, ScreenView } from "./screen-view";
import { showMonsterList } from "./monster-list";
import { htmlScreenshot, DUMP_HTML, DUMP_FORUM } from "./screenshot";
import { downloadUserFile, pickTextFile } from "./userdir";
import { userPath, userWrite, exportUserFile, FileType } from "./user-io";
import { loadLoreFile, saveLoreFile } from "./lore-file";
import { LORE_FILE } from "@rpgm-tools/neo-angband-core";
import { buildGraphicsOverview, buildOverview, panLocate, locateSectorBanner } from "./mapview";
import type { BuildOverviewParams, LevelOverview, OverviewGlyph } from "./mapview";
import { runBirth } from "./birth";
import { paintTitleArt, setSplashArt, showTitleScreen } from "./news";
import { startLoading } from "./loading";
import type { TitleChoice } from "./news";
import type { BirthDeps } from "./birth";
import {
  gameMenuEntries,
  deathMenuEntries,
  gameMenuFooter,
  deathMenuFooter,
} from "./game-menu";
import { MessageLog, messageTypeCode, packMessages, pushTypedMessage } from "./messages";
import {
  inventoryScreen,
  equipmentScreen,
  quiverScreen,
  messageHistoryScreen,
  playerHistoryScreen,
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
  objectRecallScreen,
  qualityIgnoreMenu,
  qualityLevelItems,
  egoIgnoreMenu,
  svalKindMenu,
  svalCategoryItems,
  SVAL_DEPENDENT,
  objectListScreen,
  monsterRecallScreen,
  knownMonsterEntries,
  monsterKnowledgeGroupViews,
  capRaceName,
  tombstoneScreen,
  winnerScreen,
  ctimeStamp,
  storeKnowledgeScreen,
  updateScreen,
  reportScreen,
  UPDATE_TITLE,
  REPORT_TITLE,
  UPDATE_ACTION_KEYS,
  REPORT_ACTION_KEYS,
  screenPromptFor,
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
  showMonsterKnowledge as showMonsterKnowledgeBrowser,
  type ObjectRecallDeps,
  type FakeRecallDeps,
} from "./knowledge";
import { runCharacterSelect } from "./charselect";
import {
  durabilityNotice,
  ensureDurableStorage,
  storageDurability,
} from "./storage-persist";
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
  lineageOf,
  listDeaths,
} from "./roster";
import type { CharMeta } from "./roster";
/* WHERE A SAVE GOES, which is this page's own answer and not the roster's.
 * `getActiveId` names the character to OFFER on the next launch and is shared by
 * every tab on the origin; `attachedSlot` names the one this page may write, and
 * no other page can see it. Reading the wrong one of those two is the bug
 * slot-attach.ts exists to close, so every save path below reads the second. */
import {
  attachSlot,
  attachedSlot,
  detachSlot,
  onSlotLost,
  slotHeldElsewhere,
} from "./slot-attach";
import { SAVE_CODEC, SAVE_CODECS } from "./save-codec";
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
} from "@rpgm-tools/neo-angband-core";
import { markNoscore } from "@rpgm-tools/neo-angband-core";
import { ArtifactState } from "@rpgm-tools/neo-angband-core";
import {
  walkTerrainPrompt,
  itemAllowPrompt,
  keyConfirmCount,
  KEY_CONFIRM_PROMPT,
} from "@rpgm-tools/neo-angband-core";
import { monsterIsVisible, monsterIsDestroyed } from "@rpgm-tools/neo-angband-core";
import type { WizardDeps } from "@rpgm-tools/neo-angband-core";
import {
  confirmDebugGate,
  runWizardToggle,
  runWizardDebugMenu,
  runWizardDebugCommand,
  runSpoilers,
  DEBUG_MENU,
} from "./wizard";
import type { WizardUiCtx, WizKeypress } from "./wizard";
import { runStore, sortStoreStock } from "./shop";
import type { SellPick } from "./shop";
import {
  showIgnoreItemMenu,
  ignoreItemMenuCtx,
  buildIgnoreItemMenu,
  applyIgnoreItemChoice,
} from "./ignore-menu";
import type { Store } from "@rpgm-tools/neo-angband-core";
import { helpLinesFromText, runHelp, setModHelpPages } from "./help";
import {
  installModResources,
  modArtLines,
  modFontData,
  modHelpResources,
  modLocaleResources,
  modPrefResources,
  modSoundBase,
} from "./mod-resources";
import { readStoredLocale } from "./locale-store";
import { chooseCommand, groupCommands, keyForKeyset, transformKeypressCommandTable } from "./command-menu";
import type { CommandCategory } from "./command-menu";
import { runOptionsMenu, runTileModePage } from "./options";
import type { TileModeMenu, SidebarModeMenu } from "./options";
import { loadColorPrefs, saveColorPrefs } from "./colors";
import {
  dispatchUiInput,
  inputEvents,
  setAutoplayerInterruptOwner,
  setKeymapResolver,
} from "./input-door";
import { enqueueKeys } from "./input-queue";
import {
  decodeActionTokens,
  isBindableTriggerKey,
  keymapFind,
  keymapModeFor,
  loadKeymapPrefs,
} from "./keymap-store";
import {
  applyWebUpdate,
  canPromptInstall,
  captureInstallPrompt,
  installAutoUpdate,
  refreshStaleDesktopShell,
  isStandalone,
  promptInstall,
  webUpdateReady,
} from "./pwa";
import {
  UPDATE_CHANNELS,
  UPDATE_REPO,
  checkForUpdate,
  readChannel,
  updaterBridge,
  writeChannel,
} from "./update";
import type { UpdateChannel, UpdateCheck, UpdaterBridge } from "./update";
import { checkPhase, updateFooter, updateLines } from "./update-ui";
import type { UpdateHow, UpdateLine, UpdateView } from "./update-ui";
import { installLines, offerInstall, type InstallLine } from "./install-local";
import { installChoiceLines } from "./install-choice";
import { installLogSinks, log, setLogLevel } from "./logging";
import { formatLogLine, LOG_LEVELS, LOG_RING_DEFAULT } from "@rpgm-tools/neo-angband-core/log";
import { WEB_BUILD_ID } from "./build-id";
import {
  REPORT_DESCRIPTION_LINES,
  REPORT_LOG_LINES,
  reportDestinations,
  reportFooter,
  reportLines,
  reportText,
} from "./report";
import type {
  ReportCharacter,
  ReportInput,
  ReportLine,
  ReportModOrigin,
  ReportShell,
  ReportView,
} from "./report";
import { openExternalUrl } from "./external-link";
import {
  TRANSFER_EXT,
  MAX_TRANSFER_TEXT_BYTES,
  decodeTransfer,
  encodeTransfer,
  transferFilename,
  type TransferMeta,
} from "./save-transfer";
import { backupFilename, notifyBackupSinks } from "./mod-backup";
import { decideImport } from "./transfer-gate";
import { storageLines, type StorageTone } from "./storage-page";

// PWA freshness: silently reload onto a newly deployed build (a ratified
// browser-shell necessity, D2). Page chrome, independent of the game, so it
// installs first. No on-screen build stamp or network "commits behind" fetch -
// those were removed for parity (audit 05 FEAT-3): the base game shows nothing
// that upstream Angband does not.
/*
 * The log, before the first thing that could want to write to it.
 *
 * FIRST, ahead of the host layer and the update check, because the records that
 * explain a boot failure are written during boot: a log attached afterwards
 * would be attached after everything interesting had already happened. The level
 * is chosen from ENGINE_VERSION inside logging.ts and is already right here;
 * nothing corrects it later.
 */
const flushLog = installLogSinks();
log.info("boot", `Neo Angband ${ENGINE_VERSION}`, { level: log.level });

/** True only while the title screen is the thing on the screen. */
let titleUp = false;
/* A NEW BUILD IS TAKEN SILENTLY ONLY WHERE THE PLAYER CANNOT TELL. At the title
 * screen a reload is invisible; mid-dungeon it is a screen flash, a lost message
 * log and a resumed turn nobody asked for. Everywhere else the update waits
 * behind the title screen's (U)pdate row. */
installAutoUpdate(() => titleUp);
/* And on the desktop, where the new build is already on the disk and only this
 * app's own worker is still serving the old one, take it without asking. */
void refreshStaleDesktopShell();
/* Before anything else can miss it: beforeinstallprompt fires early and once, so
 * the (I)nstall locally page cannot go looking for it when the player asks. */
captureInstallPrompt();

// Install the host layer before anything reads or writes a file.
//
// One bundle, two platforms - which is upstream's arrangement, where main-sdl2,
// main-gcu and main-win are different front ends over one z-file.c. Under the
// Electron shell there is a real filesystem and a real command line, so the
// full-capability host goes in. In a browser tab there is not, so the REDUCED
// adapter goes in and SAYS so: realFiles/argv/signals false, one term. Either
// way a screen asks the host what the platform can do instead of assuming, which
// is what stops a platform limit editing the game (parity/PLATFORM.md).
const desktopBridge = detectDesktopBridge();
setHost(desktopBridge ? makeDesktopHost(desktopBridge) : new BrowserHost());

// main()'s option loop (main.c:380-491), which is where every arg_* global comes
// from. Run BEFORE anything is drawn, as upstream does. The usage/quit paths are
// already handled by whoever owns the console - the desktop main process quits
// without opening a window - so by the time this runs the only outcome that
// matters is "run". On the web build argv is empty and everything keeps its
// default, which is the reduced front end behaving correctly rather than a
// special case.
initLaunchArgsFromHost();

// Mods from the user's mods DIRECTORY, before anything composes content.
//
// The one top-level await in this module, and it is here for the same reason the
// host layer is synchronous everywhere else: content composition (loadGamePack,
// below) and the whole load path are synchronous, so the choice is one awaited
// HTTP round trip before the game exists, or `await` pushed down into the
// composer for a fetch that happens once. This is the boot equivalent of
// init.c reading its directories before init_angband.
//
// The shell's own mods folder first. A browser tab has none, so loadDiskPacks
// resolves to NO_DISK_PACKS immediately and the picked-folder path below takes
// over: a directory the player chose once (mod-folder.ts), read through the very
// same validator, so a mod behaves identically on both platforms.
//
// The shell's folder WINS when both exist. The desktop build's folder is the one
// beside the game that an external mod manager deploys into, and a stale handle
// picked in some earlier browser session must not shadow it.
//
// INSTALLED mods are not an alternative to having a folder, so they are COMBINED
// rather than chosen between. Until this line existed, loadInstalledMods had no
// caller anywhere in the app: a mod could be downloaded, digest-checked and stored,
// and then reach nothing at all. The folder is listed first, so a mod a player put
// there deliberately outranks a downloaded copy of the same id (and the loser is
// reported, not dropped in silence). combineDiskReports routes each mod's file
// resolvers to the source that actually holds its bytes.
/**
 * Read every mod source and publish the combined report.
 *
 * A FUNCTION RATHER THAN A BOOT BLOCK because it has a second caller: the mod
 * manager, right after it downloads one. Until it did, an installed mod was
 * stored, verified and then invisible - the manager's list is built from
 * diskPacks(), which was latched once at boot, so a player installed neo-linoleum,
 * pressed ESC back to the list, and found the mod they had just downloaded was
 * not in it. The only way to see it was to reload, which the screen had not asked
 * them to do yet.
 *
 * Re-running this makes the mod APPEAR and be switchable. It does not make it
 * take effect: content composes and plugin code imports at boot, so a reload is
 * still what applies it, and the manager still says so.
 */
async function rediscoverModSources(): Promise<void> {
  /* The session tier first, and through its OWN latch rather than into the report
   * below (mod-session.ts). A mod staged for this session has to survive this
   * function running again - the manager calls it after every download - and
   * diskPacks() fuses the two latches with the session one in front, so a staged
   * copy shadows an installed mod of the same id and the collision is reported. */
  await loadSessionMods();
  const shellPacks = await loadDiskPacks();
  const folder = shellPacks.available ? shellPacks : await loadPickedModFolder();
  const installed = await loadInstalledMods();
  setDiskPacks(combineDiskReports([folder, installed]));

  /* `presentPackDigests()` has to be synchronous because `bootGame()` is. Read
   * IndexedDB's provenance records here, while boot is still awaiting setup,
   * then give pack.ts only the enabled content mods whose installed copy is the
   * one that can actually compose. A folder or session copy may shadow the
   * installed id, and bundled packs always win too; caching one of those hashes
   * would falsely describe bytes the game is not using. */
  const shadowed = new Set([
    ...folder.packs.map((pack) => pack.manifest.id),
    ...sessionPacks().packs.map((pack) => pack.manifest.id),
  ]);
  const enabled = new Set(enabledModIds());
  const installedContentIds = new Set(
    installed.packs
      .filter(
        (pack) =>
          enabled.has(pack.manifest.id) &&
          hasFacet(pack.manifest, "content") &&
          !shadowed.has(pack.manifest.id),
      )
      .map((pack) => pack.manifest.id),
  );
  await prefetchInstalledPackDigests(
    (await installedMods()).filter((meta) => installedContentIds.has(meta.id)),
  );
}

{
  await rediscoverModSources();

  /* And their CODE. Until this existed, a folder could contribute records and
   * never a line of behaviour - the whole SDK (patches, conflicts, the five
   * capability-gated registries) was reachable only from mods compiled INTO the
   * app, because the only route to a mod's code was a build-time glob.
   *
   * Awaited here, beside the records, because both have to be settled before
   * content composes and the game exists; latched, because everything downstream
   * is synchronous. Every gate - enabled, shape, ABI version, consent - is applied
   * before a plugin is imported (mod-code.ts), so this call cannot run code the
   * player has not agreed to run. */
  const disk = diskPacks();
  const store = defaultModStore();
  setModCode(
    await loadModCode({
      packs: disk.packs,
      codeUrl: disk.codeUrl,
      enabled: (id) => enabledModIds().includes(id),
      consented: (id) => store.getConsent(id),
    }),
  );
}

const canvas = document.getElementById("game") as HTMLCanvasElement;
const term = new GlyphTerm(canvas);
/* THE PANEL LAYER, wired here rather than beside the mod boot, because both of
 * these are about the page and neither depends on a game existing. A mod's DOM
 * panel needs the input door to stand down for the field the player is typing
 * into, and it needs the door to know which element is the GAME so a keystroke
 * aimed at the dungeon is never mistaken for one aimed at a mod - see
 * panel-runtime.ts. Installed unconditionally: with no panel open the owner
 * answers no to every question, which is what the game did before it existed. */
setPanelGameSurface(canvas);
installPanelKeyboardOwner();
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

/**
 * The recovery action has to disable the EFFECTIVE set, not merely empty
 * neo:enabledMods. A deployed folder's load-order.json is unioned back in on
 * the next boot unless every enabled id also has an explicit off choice; staged
 * session mods are forced on, so they must be dropped too. A URL ?mods= override
 * has the same precedence and is removed before reloading.
 */
function disableAllModsAndRestart(): void {
  let enabled: string[] = [];
  try {
    enabled = enabledModIds();
  } catch {
    /* Still clear the persisted set below. Recovery must make its best effort
     * even when the broken combination also made the enabled-set reader fail. */
  }
  try {
    const store = defaultModStore();
    store.setEnabled([]);
    for (const id of enabled) store.setModChoice(id, false);
  } catch {
    /* ModStore is storage-tolerant; this protects the recovery UI against a
     * host implementation that is not. */
  }
  try {
    dropSessionMods();
  } catch {
    /* A staged mod is session-only. If its storage is unavailable there is no
     * durable selection to clear, so continue to the reload. */
  }
  try {
    const next = new URL(location.href);
    next.searchParams.delete("mods");
    history.replaceState(null, "", next.toString());
  } catch {
    /* The persisted off choices still cover ordinary browser launches. */
  }
  location.reload();
}

/**
 * `loadGamePack` is the last synchronous content-composition boundary before
 * the engine, menus, and crash handler exist. Do not let an unforeseen
 * combination leave an uncaught module-evaluation error and a blank page.
 *
 * The safe-mode screen owns the only next step. Keeping this promise pending
 * stops the rest of main.ts from attempting to bind an absent GamePack while
 * the player chooses it; the button persists safe mode and reloads this page.
 */
async function loadPackForBoot(): Promise<GamePack> {
  try {
    return loadGamePack();
  } catch (error) {
    showSafeModeScreen(error, { disableModsAndRestart: disableAllModsAndRestart });
    return await new Promise<never>(() => {});
  }
}

const pack: GamePack = await loadPackForBoot();

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
// One-shot: "the reload that just happened enabled a tile mod, so open the
// Graphics screen when the game is back". A tiles mod's rows are composed at
// boot, which makes enabling one correctly invisible until the player goes
// looking - and a player who does not go looking concludes the mod is broken.
// Set by the mod manager's apply-and-reload, consumed once at boot.
const SHOW_GRAPHICS_KEY = "neo-angband-show-graphics";
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

/**
 * A save this build could not load stays exactly as it is on disk.
 *
 * Dropping the active id is the whole mechanism. The boot below starts a
 * throwaway game behind the character select, and a throwaway game with an
 * active id autosaves INTO that id - so the slot holding the character just
 * failed to read would be overwritten by an empty level-1 nobody asked for,
 * within one turn, with no prompt. Clearing the id sends those autosaves to a
 * fresh slot instead and leaves the original byte-for-byte intact, which is
 * what makes "try again on the next build" and "export it and send it in"
 * both still possible.
 */
function keepSaveUntouched(): void {
  /* Both halves, because they answer different questions. Not attaching is what
   * actually stops this page writing (persistSave reads the attachment); clearing
   * the shared id is what stops the next launch offering a character this build
   * cannot open. The detach is belt and braces for a caller reached after an
   * attach has already happened. */
  detachSlot();
  setActiveId(null);
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
    const stored = activeId !== null ? readSlotSave(activeId) : null;
    // Auto-resume the active character ONLY on an internal continuation: the
    // player chose Continue from the title's character select (resumeSelected
    // sets SKIP_TITLE), or the autoplayer boot (?agent). A GENUINE launch - a
    // fresh visit, a refresh, or a reopened tab - never drops straight into a
    // save; it always shows the title, then the character select. That is what
    // makes every launch open fresh and reinforces the anti-scum rule that a
    // refresh returns to the title, not to the live game.
    if (activeId !== null && stored && isContinuation()) {
      try {
        const decoded = decodeSavedGame(
          b64ToBytes(stored),
          undefined,
          SAVE_CODECS,
        );
        if (decoded.unknownCodec) {
          /* A save from a NEWER build than this one. The bytes are fine, so say
           * that rather than anything that sounds like damage - a player told
           * their character is corrupt may well delete it. */
          loadedNote = `Save written by a newer version (${decoded.unknownCodec}); update to load it.`;
          keepSaveUntouched();
        } else if (decoded.save) {
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
          const loadHooks = activeModHooks();
          const loaded = loadGame(pack, decoded.save, presentNamespaces(), {
            modRules: activeModRules(),
            /* The behaviour every enabled mod contributes, recomputed on load for
             * the same reason the flags are: which mods are on is a client
             * setting, not part of the save. */
            ...(loadHooks ? { modHooks: loadHooks } : {}),
            /* issue #20: the digest of every present session or installed pack
             * this host can measure right now (see presentPackDigests), so
             * loadGame can tell a pack that PATCHED a record apart from one
             * that only added content: the patch leaves no orphan behind when
             * it changes, because the record still resolves under its own,
             * still-present namespace. */
            currentPacks: presentPackDigests(),
          });
          /* An older save format was converted forward on the way in
           * (core session/save-migrate.ts). Say so - silently changing a
           * character's file is how a player finds out too late - and say
           * loudest whatever could not be carried across. */
          if (loaded.saveMigration) {
            loadedNote = describeMigration(loaded.saveMigration);
          }
          /* issue #20: a still-present pack's composed content no longer
           * matches what this save was written with - most often a session or
           * installed mod that patched a core record differently, or is simply
           * gone, since dropping it stops it composing but does not touch a
           * character it already changed (mods.ts's dropSession says the same
           * thing at the point a player drops one). Said after the migration
           * note rather than instead of it, so neither silently wins. */
          if (loaded.mismatchedPacks.length > 0) {
            const mismatchNote = describePackMismatch(loaded.mismatchedPacks);
            loadedNote = loadedNote ? `${loadedNote} ${mismatchNote}` : mismatchNote;
          }
          /* THE MOMENT THIS PAGE BECOMES THIS CHARACTER'S WRITER, and the only
           * one on the resume path. Everything above this line is reading; from
           * here the autosave has somewhere to land. The cross-page hold is
           * asked for in the background, and a tab that is refused it - the
           * duplicated tab, which carries sessionStorage across and so resumes
           * without ever passing the character select - is detached again and
           * told (onSlotLost, below). */
          attachSlot(activeId);
          return loaded;
        }
      } catch (err) {
        /* THE SAVE IS NOT DELETED AND NOT OVERWRITTEN. Whatever went wrong, the
         * bytes that are already on disk are the player's character, and this
         * build failing to read them is not evidence they are worthless: a
         * later build may read them, and the export in the character select
         * still works on the raw slot. So drop the active id - that is what
         * stops the throwaway game booted behind the character select from
         * autosaving over the slot - and say what happened. */
        keepSaveUntouched();
        loadedNote = describeLoadFailure(err);
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
  //
  // AND THE GAME BEHIND THE PICKER GETS NOTHING, which is the case this used to
  // get wrong. `needsSelect` means a throwaway is running behind the character
  // select and must claim no slot; it already minted no id, but a leftover id in
  // the shared key (a legacy migration, or the character this tab last played)
  // was still what the save path read, so the throwaway could write itself over
  // a real character as soon as birthPending stopped covering for it. Attaching
  // is now the only thing that grants a write, and it does not happen here.
  if (!needsSelect) {
    let id = getActiveId();
    if (!id) {
      id = newCharId();
      setActiveId(id);
    }
    attachSlot(id);
  }
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
  const startHooks = activeModHooks();
  return startGame(pack, {
    seed,
    depth,
    ...(birthRngState ? { rngState: birthRngState } : {}),
    // The effective mod-rule flags (qol / bug-fixes tweaks) for this session:
    // enabled mods' declared rules resolved against the player's saved choices.
    // Empty => faithful core. Upstream OPTIONS are NOT set here - they ship in
    // core at their upstream defaults and come from the save on resume.
    modRules: activeModRules(),
    /* The behaviour every enabled mod contributes, folded into one object
     * (mod-hooks.ts). Undefined => the field stays absent => core is faithful
     * 4.2.6. Spread rather than assigned because exactOptionalPropertyTypes
     * forbids handing an optional property an explicit undefined. */
    ...(startHooks ? { modHooks: startHooks } : {}),
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

/* BEFORE THE GAME EXISTS, not after.
 *
 * `bootGame()` on the next line runs at module top level, so a throw inside it
 * takes the whole module with it and the player is left with a canvas that
 * never paints - no message, nothing in the UI to report, and on the desktop
 * build no obvious way to open a console and find out why. Installing the
 * handlers first means that failure arrives as a screen with the stack on it
 * and a button that copies it. Every later error - a rejected promise in a
 * menu, a renderer fault - lands there too. See crash-screen.ts. */
installCrashScreen(ENGINE_VERSION);
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
/* Every plugin context built from here on reports these as `ctx.registries`.
 *
 * HERE, not at each of the seven places that build a context: the note below
 * already says `booted.registries` is whichever set this launch built, and this
 * is the one line that sees it on both boot paths. A mod asking what a monster it
 * is TRACKING can do had no way to ask before this, and neither did a tile pack
 * asking what content the session actually contains. */
setModRegistries(booted.registries);
/* And the UNBOUND half of the same composition, as `ctx.composedRecords`.
 *
 * ON THIS LINE rather than anywhere else, because the two are one composition
 * seen twice: `booted.registries` is what the binder produced and this is what it
 * read. Setting one without the other would hand an authoring tool a peer table
 * drawn from a different game than its registry lookups answer about.
 *
 * `composedObjects` is the SDK's own narrowing, so the host and the authoring
 * functions cannot disagree about which elements of a passthrough file are
 * records. */
setModComposedRecords(composedObjects(composedRecords()));
/* And where a mod holding `mod:install` may land an archive. The env is the same
 * one every other install path is given (`modBrowseDeps`), and the consent switch
 * is read at the MOMENT OF USE rather than captured here, so a player turning
 * third-party mods off mid-session turns this door off with it.
 *
 * `reload` is `ctx.reloadGame`, and it is the game's OWN mod-change sequence
 * rather than a bare `location.reload()`: every plugin's uninstall() runs, the
 * autoplayer hands the keyboard back, the live character is written down, and the
 * session resumes that character instead of landing on the title screen. A mod
 * that installed something has to be able to apply it, and the four steps above
 * are the ones it cannot do for itself. */
setModInstallDoor({
  env: {
    fetch: (url: string) => fetch(url),
    subtle: crypto.subtle,
    scope: globalThis,
    now: () => new Date().toISOString(),
  },
  allowed: () => readConsent(channelStore()),
  reload: () => {
    reloadAfterModChange();
  },
});
/* A shop line no item answers is one mod's fault, not a failed launch.
 *
 * `bindStore` used to throw on it, from inside `startGame`/`loadGame` at module
 * top level - so installCrashScreen above caught it and the player got a stack
 * trace instead of a game. The combination that reaches it needs no mistake at
 * all from the player: mod A appends an item mod B defines to a store's stock
 * table (samples/tutorials/tutorial-02-add-an-item does exactly this), the
 * player disables mod B, and the appended line now names nothing. Core drops
 * that line and records it; this is the one place that turns the record into an
 * answer on the offending mod's row in the manager. Core's OWN bad data still
 * throws and still lands on the crash screen, which is where it belongs.
 *
 * Both boot paths are covered by reading the registry rather than the call: the
 * resume path binds its own registries inside `loadGame`, and `booted.registries`
 * is whichever set this launch actually built.
 *
 * The object registry is read for the same reason and reports the same way: an
 * ego's `item:` line names a specific base kind, a mod can append to it, and
 * that list had the identical defect. One loop over both, because a fault is a
 * fault to the mod manager and which binder found it is not the player's
 * business. */
for (const dropped of [
  ...(booted.registries.stores?.refused ?? []),
  ...(booted.registries.objects?.refused ?? []),
]) {
  reportModFault(dropped.id, dropped.why);
}
/* lore.txt over the store the save (or the birth) just produced, which is
 * upstream's order: lore_parser runs at startup and the savefile then supplies
 * only pkills and thefts. This is what makes monster memory outlive a character,
 * so a new hero inherits what their ancestors learned. See lore-file.ts. */
loadLoreFile(booted.registries.monsters.races, state.lore);
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
    "core:effect-choice",
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
  /* The slot THIS page took up, not the one the origin last offered: a throwaway
   * running behind the character select is attached to nothing, and reading the
   * shared key there would name it after whichever character this tab happened to
   * play last. */
  const id = attachedSlot();
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
 * KNOWN-rune modifiers, which is what calcBonuses computes into statAdd, so
 * unlearned gear shows +0 there - real data, not a display bug.
 */
function charSheetOpts(): {
  numShots: number;
  launcher: GameObject | null;
  onRename: (n: string) => void;
  uiEntryPacks: typeof uiEntryPacks;
  inspectExtras: ObjectInfoExtras;
  seedRandart: number;
  mods: { id: string; version: string }[];
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
    /* The dump's [Mods enabled] block - the same list the diagnostics report
     * carries, from the same source, so the two can never disagree. Empty with
     * no mods on, which writes no block at all and leaves a vanilla dump
     * identical to upstream's. */
    mods: enabledModSummary(),
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

/**
 * ANGBAND_SYS (init.c L84, set per front end in main.c L508). The C's values name
 * its terminal modules - gcu, sdl, sdl2, x11, win - and none of them is this one,
 * so the port takes its own. Only lib/customize/font.prf tests $SYS, and that is
 * a font/keymap file no tile pack loads; the tile packs test $RACE and $CLASS.
 */
const ANGBAND_SYS = "web";

/**
 * The `?:` expression variables for a pref-file parse: upstream's $SYS, $RACE and
 * $CLASS (ui-prefs.c L553-560), read from the LIVE character.
 *
 * This is what selects a pack's "special player pictures" - every bundled pack
 * ships an xtra-*.prf whose `monster:<player>` lines sit behind
 * `[AND [EQU $CLASS ...] [EQU $RACE ...] ]`. Upstream re-reads the pref file with
 * these in hand at reset_visuals(true), which runs after birth (ui-display.c
 * L2703) and again on every graphics-mode change (main-win.c L1769).
 *
 * Returns nothing at all before a character exists, which is the correct
 * pre-birth state: every conditional block bypasses and the pack's unconditional
 * player line stands.
 */
function playerPrefVars(): PrefExprVars {
  try {
    const p = state.actor.player;
    return { SYS: ANGBAND_SYS, RACE: p.race.name, CLASS: p.cls.name };
  } catch {
    return { SYS: ANGBAND_SYS };
  }
}

/**
 * The x_attr/x_char tables (ui-prefs.c L46-56), allocated and seeded from
 * gamedata exactly as textui_prefs_init does at startup (L1427-1452, ending in
 * reset_visuals(false)). EVERY ASCII draw of a monster, object, flavour, trap
 * or terrain glyph reads this table rather than the gamedata record, because
 * that is the only place a pref file or the knowledge browser's glyph picker
 * can write to. See packages/core/src/visuals/glyph-table.ts for why this is a
 * layer and not a lookup.
 */
const glyphs = new GlyphTable({
  features: booted.registries.features.allFeatures(),
  kinds: booted.registries.objects.kinds,
  races: booted.registries.monsters.races,
  traps: booted.registries.traps,
  flavors: booted.registries.objects.flavors,
});

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
 * Bumped on every linoleum selection that may need a first-time conversion,
 * so a stale attempt's own banner timer or cleanup never touches a newer
 * attempt's banner - `currentGrafID` alone is not enough, because switching
 * away and straight back to the SAME grafID while a conversion is still in
 * flight would make the stale check pass for the wrong attempt (#124).
 */
let linoleumConversionSeq = 0;
/** How long a conversion may run before the "still working" banner appears -
 * short enough to catch a real Shockbolt-sized wait, long enough that an
 * already-cached pack's near-instant resolve never flashes it at all. */
const LINOLEUM_BANNER_DELAY_MS = 400;
/* Read once while resources install - the file AND everything its `%:` lines
 * include (#278). Every pack-map rebuild replays this in enabled load order; a
 * graphics-mode switch never needs to resolve mod files. */
let modTilePrefTexts: readonly ModPrefText[] = [];

/**
 * How a mode's files are reached: the contributing mod's own resolver when a mod
 * supplied the mode, so a mod's tiles come from the MOD's assets wherever they
 * physically live (a site path, a picked folder's blob, an installed mod's
 * IndexedDB bytes); otherwise the shell's own tile base, which is right for a core
 * mode and for a mod that only re-registers art already there. An id nobody offers
 * (e.g. `?graf=5` with no pack) falls back to the shell base and simply 404s into
 * ASCII.
 */
function tileResolverFor(entry: TileModeEntry | undefined): PackFileResolver {
  return entry?.resolve ?? urlBaseResolver(tilesBaseUrl);
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
/**
 * Redraw the map AND tell the terminal to distrust every pixel it has.
 *
 * For the one class of change the terminal's frame diff cannot see: a tileset
 * finishing its load, or the player choosing a different one. The grid is the
 * same grid - same codes, same positions - but the PICTURE those codes draw is
 * different, so a diff over glyph data concludes nothing changed and leaves the
 * old tiles (or the ASCII fallback) on screen. Everything else can rely on the
 * diff, which is the point of having one.
 */
function repaintEverything(): void {
  term.invalidate();
  renderBackground();
}

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
    repaintEverything();
    const sourceResolver = tileResolverFor(entry);
    const menuname = entry.menuname;

    const applyLoaded = async (resolve: PackFileResolver): Promise<void> => {
      const pack = await loadLinoleumPack({
        resolve,
        menuname,
        deps: { ...tileDeps, vars: playerPrefVars() },
        modPrefTexts: modTilePrefTexts,
      });
      // Ignore a stale load if the mode changed during the fetch.
      if (currentGrafID !== grafID) return;
      if (pack) {
        pack.onReady = () => repaintEverything();
        tileset = pack;
        tileMap = pack.index.map;
        // Warm the ground around the player before the first frame draws it -
        // a fresh load's cache is completely cold, which is exactly when the
        // flash (#290) is most visible.
        precacheTilesNear(state.actor.grid.x, state.actor.grid.y, PRECACHE_RADIUS);
      }
      repaintEverything();
    };

    if (entry.tilesheet === undefined || entry.modId === undefined) {
      // No conversion possible for this row - the pack is already loose
      // files, so there is nothing to background.
      await applyLoaded(sourceResolver);
      return;
    }

    // A first-time selection converts the whole source atlas before the pack
    // is usable, which can run long enough to look like a hang (#124). Rather
    // than block the menu on it, hand the player back to the game now and let
    // a banner - shown only if it is still running after a short grace period,
    // so an already-cached pack never flashes one - name what is happening.
    const modId = entry.modId;
    const tilesheet = entry.tilesheet;
    const seq = ++linoleumConversionSeq;
    void (async () => {
      const bannerTimer = setTimeout(() => {
        if (linoleumConversionSeq === seq) showTileConversionBanner(menuname);
      }, LINOLEUM_BANNER_DELAY_MS);
      try {
        const resolve = await ensureLinoleumTilesheetPack({
          modId,
          source: tilesheet,
          resolve: sourceResolver,
        });
        await applyLoaded(resolve);
      } finally {
        clearTimeout(bannerTimer);
        if (linoleumConversionSeq === seq) hideTileConversionBanner();
      }
    })();
    return;
  }

  const mode =
    grafID && grafID !== GRAPHICS_NONE ? getGraphicsMode(grafID) : undefined;
  if (!mode || mode.grafID === GRAPHICS_NONE) {
    tileset = null;
    tileMap = null;
    repaintEverything();
    return;
  }
  const resolve = tileResolverFor(entry);
  const ts = createTileRenderer({ resolve, grafID });
  if (ts) ts.onReady = () => repaintEverything();
  tileset = ts;
  tileMap = null;
  repaintEverything();
  const map = await loadTilePrefs(resolve, mode, {
    ...tileDeps,
    vars: playerPrefVars(),
  }, modTilePrefTexts);
  // Ignore a stale load if the mode changed during the fetch.
  if (currentGrafID === grafID) {
    tileMap = map;
    repaintEverything();
  }
}

/**
 * How much darker "remembered" is than "seen".
 *
 * ONE constant for both halves of the same decision: dim() scales an ASCII
 * colour by it, and tileDrawFor multiplies globalAlpha by it. They used to be
 * one hardcoded 0.38 and no tile treatment at all, so a remembered object was
 * dim in ASCII and fully lit in a tile set - the same grid, two verdicts.
 */
const DIM_SCALE = 0.38;

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
function tileDrawFor(
  atlas: TileAtlas | null,
  x: number,
  y: number,
  /**
   * Draw it as REMEMBERED rather than seen, at the same 0.38 the ASCII path's
   * dim() scales a colour by.
   *
   * Terrain does not need this - a pref file carries feat_x_attr per lighting
   * variant, so a pack supplies its own darker art for LIGHTING_LIT. An OBJECT
   * has no lighting variant anywhere (kind_x_attr is one entry, and
   * grid_data_as_text overwrites the feature's lit attr with
   * object_kind_attr's), so upstream draws a remembered item at exactly the
   * brightness of one you are standing next to. In ASCII that is invisible;
   * with tiles it is a lit square in the middle of a dim corridor, which reads
   * as "you can see this" when the whole point is that you cannot. The port
   * already dims remembered terrain rather than relying on a palette swap
   * (see dim()), so this is that same deviation applied consistently, not a
   * new one.
   */
  dimmed = false,
): RenderAssetRef | undefined {
  const ts = tileset;
  if (!atlas || !ts || !ts.ready) return undefined;
  if (!isTile(atlas.attr, atlas.char)) return undefined;
  const code = tileCode(atlas.attr, atlas.char);
  return {
    /* The identity the terminal's frame diff needs - see RenderAssetRef.key. It has to
     * carry the map grid as well as the code, because a loose pack resolves a
     * variant POOL against the position, so the same code at two grids is two
     * different pictures. Which is also why this cannot be `${code}` alone. And
     * it has to carry `dimmed`: the same code at the same grid is two different
     * pictures either side of a grid leaving view, and a diff that could not see
     * that would leave the lit one on screen. */
    kind: "canvas-tile",
    key: `${String(code)}@${String(x)},${String(y)}${dimmed ? "~" : ""}`,
    data: { blitter: ts, code, grid: { x, y }, dimScale: dimmed ? DIM_SCALE : 1 },
    /* Double-height (is_dh_tile, grafmode.c L241): without it every such tile is
     * cropped into one cell, which is what #241 fixed and #243 found still true
     * on the other engine. THE ENGINE IS ASKED, because only the engine knows
     * what a code means. This used to run the core catalog lookup itself, and
     * that answered "never" for every mod-supplied mode - so no linoleum pack
     * ever drew a tall tile, Guardian naga included. */
    ...(ts.isTall(code, { x, y }) ? { tall: true } : {}),
  };
}

/**
 * Warm a loose pack's per-asset cache for known terrain within `radius` of
 * (cx, cy), so a tile the player is about to walk up to has already started
 * loading rather than racing its own Image() load the first frame it is
 * actually drawn.
 *
 * LinoleumPack has no single atlas to wait for - `ready` flips true as soon as
 * its maps parse, independent of any one asset - so the FIRST time any given
 * asset is requested, that frame draws the ASCII glyph and the tile only
 * appears once the image's `load` event fires and the coalesced repaint runs.
 * That is invisible for common terrain warmed in the first few frames near
 * spawn, but a distinctive, rare feature (a staircase) can go unrequested
 * until the player is already standing next to it - a fresh cold boot, whose
 * cache starts empty, is exactly when this is most likely to be noticed
 * (#290). TileSet (the tilesheet engine) has no such seam and exposes no
 * `preload`, so this is a no-op there.
 *
 * Only KNOWN terrain is warmed, mirroring the same knownFeat gate the
 * `remembered` render callback uses - there is nothing to precache for a grid
 * the player has never seen, and asking would just be extra work every call.
 */
function precacheTilesNear(cx: number, cy: number, radius: number): void {
  const ts = tileset;
  if (!ts?.preload || !ts.ready || !tileMap) return;
  const x0 = Math.max(0, cx - radius);
  const x1 = Math.min(state.chunk.width - 1, cx + radius);
  const y0 = Math.max(0, cy - radius);
  const y1 = Math.min(state.chunk.height - 1, cy + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const kf = knownFeat(state, loc(x, y));
      if (kf < 0) continue;
      const f = features.get(kf);
      const disp = f.mimic !== null ? features.get(f.mimic) : f;
      const atlas = tileForFeature(tileMap, disp.fidx, LIGHTING.LOS);
      if (!atlas || !isTile(atlas.attr, atlas.char)) continue;
      ts.preload(tileCode(atlas.attr, atlas.char), { x, y });
    }
  }
}

/**
 * How far ahead of the viewport precacheTilesNear warms - comfortably past a
 * full map viewport (SIDEBAR_W-trimmed 80x24 leaves roughly 66x22) so a run in
 * any direction stays inside already-warm ground, plus slack for however far
 * a single command can move the player (e.g. running down a corridor).
 */
const PRECACHE_RADIUS = 40;

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
/**
 * The selected front end. Never absent: core's glyph renderer is candidate zero
 * and holds the slot from module init - through the title screen and every
 * frame before mod code loads - until `installFrontend` re-selects over the
 * loaded plugins below.
 */
const coreWorldSink = glyphWorldFrameSink(term);
/**
 * The HUD's owners, one per region. Core's glyph terminal is candidate zero for
 * all three and holds them until `installHud` re-selects over the loaded
 * plugins, exactly as the map's slot works - the difference being that the
 * message line, the vitals and the status line are separately ownable.
 */
const coreHudSink = glyphHudSectionSink(term);
const coreFrontend = coreFrontendCandidate(coreWorldSink);
const coreHud = coreHudCandidate(coreHudSink);
const coreFrontendSlot: InstalledFrontend = coreOnlyFrontend(coreWorldSink);
const coreHudSlot: InstalledHud = coreOnlyHud(coreHudSink);
let installedFrontend: InstalledFrontend = coreFrontendSlot;
let installedHud: InstalledHud = coreHudSlot;

/**
 * One mod-facing display fault, reported to the player and logged.
 *
 * Shared by both seams because the two recoveries read identically from the
 * outside: something a mod drew stopped working, the game took that part of the
 * screen back, and the player is told which mod and which part.
 */
function reportDisplayFault(id: string, problem: string, error: unknown): void {
  reportModFault(id, `${problem}: ${faultMessage(error)}`);
  log.error(`mod:${id}`, `${problem}:`, error);
}

/**
 * The two live display sinks, built ONCE per installed selection rather than per
 * frame.
 *
 * That is load-bearing, not tidiness. Both sinks remember a replacement that
 * faulted and stop calling it for the rest of the session; a sink rebuilt inside
 * `render()` forgets on the next repaint, so a persistently throwing mod would
 * be re-entered - and re-reported - on every single frame. These are reassigned
 * where the selection is, and nowhere else.
 */
let liveWorldSink: FrontendMapStream = frontendWorldFrameSink(coreFrontendSlot, reportDisplayFault);
let liveHudSink: HudFrameSink = hudFrameSink(coreHudSlot, reportDisplayFault);

// The message log: every message the engine emits this session, for the top
// status line and the scrollable history (Ctrl-P). state.msg is the core's
// central message sink; routing it here means command/effect messages surface
// without each call site knowing about the shell.
const msglog = new MessageLog();
/**
 * The port's `message_column`, expressed as a cursor rather than a column: the
 * first raw message event that has NOT yet been flushed past a "-more-". Reset
 * when a player command is read (upstream's `msg_flag = false`,
 * ui-input.c:1824) and carried across the steps of a self-continuing command,
 * so the top line fills up over a long run or dig exactly as upstream's does.
 */
let msgPending = 0;
/**
 * How many characters of the message at `msgPending` were already shown on an
 * earlier, already-"-more-"'d page - 0 unless that message was itself split
 * across pages (packMessages' `pendingOffset`). Reset alongside `msgPending`
 * whenever it snaps to a message boundary, so a resumed message's still-unread
 * tail is what gets re-packed rather than the whole message from its start.
 */
let msgPendingOffset = 0;
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
  /* The messageText seam (mod/hooks.ts), applied at the single message sink so
   * every msg()/msgt() in core and the shell passes through one point. With no mod
   * loaded the hook is absent and this is `raw` - faithful 4.2.6, warts included.
   *
   * This used to read the mod's flag directly and call core's own miscStringFix,
   * which meant a mod's rewriter shipped inside core and core knew that mod's
   * name. The rewriter is now the bug-fixes mod's code and arrives as this hook.
   *
   * A hook here may only RESTATE a message. Changing what one MEANS would put text
   * on screen that upstream never wrote, and no census could see it - the slot is
   * filled, so it never reads as absent. */
  const text = state.modHooks?.messageText?.(raw) ?? raw;
  const code = messageTypeCode(type);
  // Persist the message into the core's rolling log (gap 12.8, wr_messages) so
  // it survives save/load, preserving the MSG_* type used by msgt().
  state.messages?.add(text, code);
  // Route the message onto the event bus (W1.6) so mods can subscribe to
  // "message", then render it. state.events is attached below; before that
  // (early boot) the emit is simply skipped.
  state.events?.emit("message", { msg: text, type: code });
  say(text, type);
  /* msgt's OTHER HALF (message.c:428-445): a typed message plays the sound bound
   * to its type. This sink is the port's msgt, and it is the only place that can
   * be, because it is the one point every msg()/msgt() in core and the shell
   * passes through.
   *
   * ONLY WHEN A TYPE WAS GIVEN. msg() (message.c:405-419) does message_add plus
   * EVENT_MESSAGE and stops; sound() is reached from msgt() alone. So an untyped
   * line stays silent here, which keeps `state.msg(text)` next to a separate
   * `state.sound(MSG_X)` - obj-pile's drop, the ambient timer - meaning exactly
   * what it means upstream.
   *
   * Without this, EVERY message whose only sound was its type was silent: all 27
   * msgt types in player_timed.txt among them, which is what #239 measured. The
   * sites that did sound did it by hand, one paired `state.sound` call at a time,
   * and a site that forgot the pair had nothing to notice it. Sound draws no RNG,
   * so this changes no stream.
   *
   * The msg-vs-msgt decision is core's `messageSound`, not a condition written
   * here, because nothing can import this file to check it. */
  const cue = messageSound(type);
  if (cue !== null) state.sound?.(cue);
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
     * a living one "slain". The port previously hardcoded "slain".
     *
     * Three WHOLE sentences rather than one sentence with the verb interpolated,
     * which is how this was written first. Two reasons, and neither is style.
     * The text census matches upstream literals against the port's source, and a
     * verb spliced into a template leaves no "You have destroyed " anywhere to
     * find - it read as a missing message, and was only ever "present" because
     * packages/borg happened to carry the string in its message-PARSING table.
     * When the Borg left for its own repository the census noticed immediately.
     * The same splitting also defeats translation, which needs the sentence. */
    const line = !monsterIsVisible(mon)
      ? `You have killed ${name}.`
      : monsterIsDestroyed(mon)
        ? `You have destroyed ${name}.`
        : `You have slain ${name}.`;
    /* msgt(MSG_KILL, ...) (mon-util.c kill message): carry the type so the
     * message.prf colour applies, not just the sound. */
    say(line, "KILL");
    state.sound?.(MSG.KILL);
  }
};

// Modal gate: while a full-screen overlay (inventory, character sheet, message
// history, item/spell selection) owns the keyboard, the in-game key handler
// stands down - exactly the single-owner input model of the upstream UI.
let modalDepth = 0;

/**
 * Whether the MAP is what should be on screen.
 *
 * False from module scope until boot settles on a game, and it is what stops
 * the player's town being painted over the loading screen and then over the
 * title art. Measured on the shipped Windows build (2026-08-13): a generated
 * town sat on screen from 6.9s to 12.7s after launch, belonging to a character
 * nobody had chosen yet.
 *
 * A SEPARATE gate from modalDepth, not a bigger one. modalDepth answers "is
 * something else using the terminal right now", which is a question about the
 * next few keystrokes; this answers "is there a game to draw at all", which is
 * a question about the whole session. Boot's earlier attempt at this painted
 * the title art first and lost, because a ResizeObserver settle came through
 * renderBackground a moment later with modalDepth still 0 and put the map
 * straight back.
 */
let gameScreenLive = false;

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
  if (modalDepth > 0 || !gameScreenLive) return;
  render();
}

async function openModal<T>(fn: () => Promise<T>): Promise<T> {
  modalDepth++;
  try {
    return await fn();
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
      sources.push({ label: t("main.item-source.inven", "Inven"), items, kind: "inven" });
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
      sources.push({ label: t("main.item-source.equip", "Equip"), items, kind: "equip" });
      refs.push(eRefs);
    }
  }
  if (mode.quiver) {
    const { items, handles } = quiverMenu(state, tester);
    if (items.length > 0) {
      sources.push({ label: t("main.item-source.quiver", "Quiver"), items, kind: "quiver" });
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
      sources.push({ label: t("main.item-source.floor", "Floor"), items, kind: "floor" });
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

/**
 * The live `rogue_like_commands` option, which decides which keyset every
 * key-naming screen is describing.
 *
 * Named because the help browser needs it and there is no game state on the
 * other side of that call: help.ts reaches into the engine for the build version
 * and the translator and nothing else, so the keyset arrives as an argument. The
 * option is OFF before any character exists, which is also the default upstream
 * ships.
 */
function rogueLikeKeys(): boolean {
  return state.options?.get("rogue_like_commands") ?? false;
}

/** `code`'s command key under the live keyset (rogue_like_commands). */
function itemCmdKey(code: string): string | undefined {
  const keys = ITEM_CMD_KEYS[code];
  if (!keys) return undefined;
  return rogueLikeKeys() ? keys.r ?? keys.o : keys.o;
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
 * ui-knowledge.c:3908 GET_ITEM_PARAMS), and it suppresses a blanket `!*` while still honouring
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
  /**
   * Which listing to OPEN in - upkeep->command_wrk, which do_cmd_inven /
   * do_cmd_equip / do_cmd_quiver each set before the shared get_item
   * (ui-knowledge.c:3924, 3970, 4019). It selects the starting tab only; every
   * source in `mode` stays reachable from inside the picker.
   */
  startIn?: "inven" | "equip" | "quiver" | "floor",
): Promise<ItemTargetRef | null> {
  const { sources, refs } = buildItemSources(tester, mode, deviceFail);
  /* bell() for a refused tab switch (ui-object.c:975). */
  const bell = (): void => state.sound?.(MSG.BELL);
  if (sources.length === 0) {
    say(reject);
    return null;
  }
  /* buildItemSources emits them in this order, and only for the enabled modes,
   * so the index has to be looked up rather than assumed. */
  const initial = startIn ? Math.max(0, sources.findIndex((s) => s.kind === startIn)) : 0;
  const chosen = await itemSelect(
    term,
    prompt.trim(),
    sources,
    initial,
    cmdKey,
    bell,
    state.options?.get("rogue_like_commands") ?? false,
  );
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
   * them that way) and so does itemAllowPrompt, because a mod's command code IS
   * one. state.commandVerbs is what makes it answer for that code: core's verbs
   * seeded per game, plus whatever a "registry:command" mod named. Anything with
   * no verb at all still lands on the "do that with" fallback. */
  const ask = itemAllowPrompt(
    obj,
    cmdKey,
    cmdCode ?? null,
    isHarmless,
    (o) => objectName(state, o),
    state.commandVerbs,
  );
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
  const chosen = await itemSelect(
    term,
    prompt.trim(),
    sources,
    0,
    itemCmdKey("drop"),
    () => state.sound?.(MSG.BELL),
    state.options?.get("rogue_like_commands") ?? false,
  );
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
  /* summon_desc(idx) (mon-summon.c:258), for EFINFO_SUMM. Unsupplied, the
   * effect text formats an empty string into its "%s" and an item that summons
   * reads "it summons ." - the same shape as the missing timedDesc, and now
   * reachable from the object-knowledge recall as well as from Inspect. The
   * effect MENU has always had it (effectMenuDeps); this list did not. */
  summonDesc: (i) => booted.registries.monsters.summons[i]?.desc ?? "",
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

/** Deps showEquipCmp needs: the ui_entry packs, the same object-info extras the
 * Inspect command uses (item comparison textblocks), and the character name for
 * the 'd' dump's suggested "<name>_equip.txt". */
function equipCmpDeps(): {
  packs: typeof uiEntryPacks;
  entryDeps: ReturnType<typeof liveUiEntryDeps>;
  inspectExtras: ObjectInfoExtras;
  playerName: string;
} {
  return {
    packs: uiEntryPacks,
    /* player_flags_timed / get_timed_element_effect (ui-entry.c L928, L1064).
     * This returned no entryDeps at all, so both seams took their harness
     * defaults and the timed-flag column and temporary-resist row read empty for
     * every character in every game - PORT_TODO 3.7 and 3.8. Rebuilt per call, so
     * it reflects the buffs active right now rather than at boot. */
    entryDeps: liveUiEntryDeps(state),
    inspectExtras,
    playerName,
  };
}

/**
 * The pref-file screens' context (ui-options.c's get_pref_path / dump_pref_file /
 * do_cmd_pref_file_hack / do_cmd_visuals). Built lazily so it always reads the
 * live `state`, and only after boot - `state` and `glyphs` both exist by then.
 */
function prefsUiCtx(): PrefsUiCtx {
  return {
    term,
    say: (text) => say(text),
    playerName: () => playerName,
    glyphs,
    prefDeps: {
      features: booted.registries.features,
      objects: booted.registries.objects,
      monsters: booted.registries.monsters,
      traps: booted.registries.traps,
    },
    dumpDeps: () => ({
      table: glyphs,
      objects: booted.registries.objects,
      features: booted.registries.features,
      monsters: booted.registries.monsters,
      /* get_autoinscription(kind, true): only AWARE notes go to a pref file. */
      autoinscription: (kidx) => state.autoinscribe?.get(kidx, true) ?? null,
      /* The SAME config object every screen uses - `buildUiEntryConfig` memoises
       * on (packs, registry), and `uiEntryRendererCustomize` below mutates the
       * palettes in place, so a build that omitted the registry would dump and
       * customise a second copy nobody draws from. */
      entryRenderers: uiEntryRendererRows(buildUiEntryConfig(uiEntryPacks, state.uiEntry)),
    }),
    extraSink: {
      addAutoinscription: (kidx, text) => state.autoinscribe?.set(kidx, text, true),
      messageColor: (msgIndex, attr) => state.messages?.colorDefine(msgIndex, attr),
      colorTable: (idx, k, r, g, b) => {
        setColorChannel(idx, 0, k);
        setColorChannel(idx, 1, r);
        setColorChannel(idx, 2, g);
        setColorChannel(idx, 3, b);
      },
      entryRenderer: (name, colors, labelColors, symbols) => {
        uiEntryRendererCustomize(
          buildUiEntryConfig(uiEntryPacks, state.uiEntry),
          name,
          colors,
          labelColors,
          symbols,
        );
      },
      /* window: the port is one terminal, so a subwindow flag has no target -
       * see options.ts on the dropped 'w' row. keymap-input is deliberately
       * absent too: the port's keymaps live in keymap-store.ts's own persisted
       * store, which the keymap editor writes; letting a pref file write them
       * would need that store's user/default split, which it does not have. */
    },
    afterLoad: () => {
      /* Term_xtra(TERM_XTRA_REACT) + Term_redraw_all (ui-options.c L866-867). */
      saveColorPrefs();
      render();
    },
  };
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
  return entries.map((e) => ({
    label: e.label,
    ...(e.disabled ? { disabled: true } : {}),
    id: `core:context:${e.action}`,
    semantic: { kind: "command", ref: e.action },
  }));
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
    "core:context-player-other",
    "Other",
    toMenuItems(items),
  );
  if (idx === null) return;
  switch (items[idx]?.action) {
    case "knowledge":
      await openKnowledgeMenu();
      break;
    case "map":
      await showLevelMapForShell();
      break;
    case "messages":
      await showTextScreen(term, messageHistoryScreen(msglog));
      break;
    case "monsters":
      await showMonsterList(term, state);
      break;
    case "objects":
      await showTextScreen(term, objectListScreen(state));
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
      await runOptionsMenu(term, state, openIgnoreSetup, sidebarModeMenu, prefsUiCtx(), openModOptions);
      autosave(true);
      break;
    case "help":
      await runHelp(term, rogueLikeKeys());
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
    "core:context-player",
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
      /* do_cmd_look always starts interactive-cycling mode, -1,-1
       * (ui-knowledge.c:4057-4064) - passing this grid forced free-cursor
       * mode instead (initTargetLoopUi treats any in-bounds start coords as
       * "stay put"), so cycling never engaged and a floor object standing
       * right here was never offered (#290). */
      if (await runTargetLoop(TARGET.LOOK, false)) {
        say("Target Selected.");
      }
      break;
    case "inventory":
      await showTextScreen(term, inventoryScreen(state));
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
    "core:context-grid",
    describeLookGrid(state, grid, TARGET.LOOK).text || "Command for that grid",
    toMenuItems(items),
  );
  if (idx === null) return;
  const dir = motionDirTo(grid);
  switch (items[idx]?.action) {
    case "look":
      /* Same as the player context menu's "look" (#290): do_cmd_look always
       * starts interactive-cycling mode regardless of entry point, so this
       * must not pin the cursor to the clicked grid either. */
      if (await runTargetLoop(TARGET.LOOK, false)) say("Target Selected.");
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
      const useIdx = await selectFromMenu(term, "core:context-use-item", "Use which item? ", items);
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

/**
 * context_menu_object's return value (ui-context.c:654-899), which its callers
 * loop on. It had been dropped - the port returned void - so both loops were
 * gone: cancelling the menu ended the whole command instead of going back to the
 * item picker, and inspecting an item threw you out instead of returning to its
 * menu.
 */
type ContextMenuResult = 1 | 2 | 3;
/** A command was queued, or the action is finished. Both loops end. */
const CTX_DONE: ContextMenuResult = 1;
/** It showed a screen (Inspect, Browse): reopen this menu on the same object. */
const CTX_REOPEN: ContextMenuResult = 2;
/** The user escaped the menu: go back to the item picker. */
const CTX_CANCELLED: ContextMenuResult = 3;

/** context_menu_object: the per-item action menu (reached from the inventory/equipment picker). */
async function runContextMenuObject(handle: number): Promise<ContextMenuResult> {
  const obj = gearGet(state.gear, handle);
  if (!obj) return CTX_DONE;
  const isBook = playerObjectToBook(state.actor.player, obj) !== null;
  const equipped = isObjectEquipped(obj, handle);
  const ctx: ObjectMenuCtx = {
    isBook,
    canCast: state.actor.player.cls.magic.totalSpells > 0,
    canStudy: state.actor.player.upkeep.newSpells > 0,
    useKind: isBook ? "other" : objectUseKind(obj),
    canFire: !isBook && tvalIsAmmo(obj.tval) && obj.tval === state.actor.combat.ammoTval,
    canRefill: objCanRefill(state, obj),
    canBrowse: isBook && playerCanRead(state, {}, false),
    isEquipped: equipped,
    canWear: !equipped && tvalIsWearable(obj.tval),
    canThrow: true,
    hasInscription: objHasInscrip(obj),
    isIgnored: objectIsIgnored(
      obj,
      objectKnownView(state, obj),
      state.ignore,
      isKindAware(obj.kind),
    ),
  };
  const items = buildObjectMenu(ctx);
  const idx = await selectFromMenu(
    term,
    "core:context-object",
    `Command for ${objectName(state, obj)}`,
    toMenuItems(items),
  );
  /* selected == -1: "User cancelled the menu." (ui-context.c:809-810) */
  if (idx === null) return CTX_CANCELLED;
  switch (items[idx]?.action) {
    case "inspect": {
      const name = objectName(state, obj);
      const header = name.charAt(0).toUpperCase() + name.slice(1);
      const tb = objectInfoTextblock(state, obj, inspectExtras);
      await showTextScreen(term, objectRecallScreen(header, tb));
      /* MENU_VALUE_INSPECT returns 2 (L821): the caller reopens this menu on the
       * same object, so reading an item's info does not throw you out of it. */
      return CTX_REOPEN;
    }
    case "cast":
      await castSpell();
      break;
    case "study":
      await studySpell();
      break;
    case "browse":
      /* CMD_BROWSE_SPELL returns 2 (ui-context.c:871-876), like Inspect: you
       * come back to the item's menu after reading the book. */
      await browseBookObject(handle);
      return CTX_REOPEN;
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
        "core:ignore-item",
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
  return CTX_DONE;
}

/**
 * do_cmd_inven / do_cmd_equip / do_cmd_quiver (ui-knowledge.c:3913, 3959, 4008).
 *
 * These three keys - i, e and | - are not passive listings upstream. Each one
 * opens the listing as a get_item PICKER and runs the chosen object's context
 * menu, in a two-level loop the return code drives:
 *
 *   while (ret == 3)                       // the menu was cancelled: pick again
 *     if (!get_item(...)) { ret = -1 }      // the picker was cancelled: leave
 *     else while ((ret = context_menu_object(obj)) == 2);  // it showed a screen:
 *                                                          // reopen the menu
 *
 * The port had all three as read-only screens, and then reached the context menu
 * through an invented "Item actions" row on the game menu whose picker offered
 * only the pack and worn gear and whose prompt was written here rather than
 * transcribed. So the three most-used inventory keys had lost their whole
 * purpose, and the replacement was both less capable and unfaithful.
 *
 * `mode` is which listing it OPENS in (command_wrk), not what it can reach:
 * GET_ITEM_PARAMS is EQUIP|INVEN|QUIVER|FLOOR|SHOW_QUIVER|SHOW_EMPTY|IS_HARMLESS
 * in all three cases (L4019-4020), so you can switch to any of them from inside.
 */
async function doCmdItemListing(mode: "inven" | "equip" | "quiver"): Promise<void> {
  /* Each opens with its own emptiness guard and message (L4030-4033). */
  const empty = {
    inven: [(state.gear.inven ?? []).filter(Boolean).length === 0, "You have nothing in your inventory."],
    equip: [state.actor.player.equipment.every((h) => !h), "You are not wielding or wearing anything."],
    quiver: [(state.gear.quiver ?? []).filter(Boolean).length === 0, "You have nothing in your quiver."],
  }[mode] as [boolean, string];
  if (empty[0]) {
    say(empty[1]);
    return;
  }

  let ret: ContextMenuResult = CTX_CANCELLED;
  while (ret === CTX_CANCELLED) {
    const ref = await selectItemFrom(
      "Select Item:",
      () => true,
      { inven: true, equip: true, quiver: true, floor: true },
      empty[1],
      undefined,
      false,
      undefined,
      /* IS_HARMLESS: this picker runs no command itself, so the "really use
       * that?" confirmation for an unknown item does not belong here. */
      true,
      mode,
    );
    if (ref === null || !("handle" in ref)) return; /* get_item false -> ret = -1 */
    /* player_is_shapechanged gates the menu, not the picker (L4053-4055). */
    if (playerIsShapechanged(state)) return;
    do {
      ret = await runContextMenuObject(ref.handle);
    } while (ret === CTX_REOPEN);
  }
}

/** routeContextClick's classification, applied to a canvas client point. */
function contextClickGrid(clientX: number, clientY: number): Loc | null {
  const cell = term.cellAt(clientX, clientY);
  if (!cell) return null;
  const { col, row } = cell;
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
  await showTextScreen(term, objectRecallScreen(header, tb));
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
    return {
      label: t("main.curse-removal.item-label", "{name} (curse strength {power})", {
        name,
        power,
      }),
    };
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
  const idx = await selectFromMenu(term, "core:curse-removal", header, items, "[ a-z to choose, ESC to cancel ]", { detail });
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
 * do_cmd_wield's two remaining questions (cmd-obj.c:296-330), asked here because
 * the core command path cannot block on UI. Returns false when the player backed
 * out, in which case NOTHING is queued and no turn is spent - which is the whole
 * point of asking before the command runs rather than after.
 *
 *   1. "Replace which ring? " - the SECOND cmd_get_item (cmd-obj.c:298-311), over
 *      USE_EQUIP filtered to rings, reached only when both hands are full (see
 *      wieldRingChoice). The chosen slot rides along as args.slot, exactly as
 *      upstream caches the answer in the command's "replace" argument.
 *   2. the "!t" get_check loop (cmd-obj.c:321-330), on whatever occupies the slot
 *      that was just settled - so it must run AFTER the ring question.
 *
 * The order is upstream's; swapping them would ask about the wrong hand's ring.
 */
async function wieldPrompts(
  obj: GameObject | null,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (!obj) return true;
  const player = state.actor.player;
  const choice = wieldRingChoice(state, obj);
  let slot = wieldSlot(player.body, obj.tval, player.equipment);
  if (choice) {
    const ref = await selectItemFrom(
      choice.prompt,
      (o) => tvalIsRing(o.tval),
      { equip: true },
      choice.error,
      itemCmdKey("wield"),
      false,
      "wield",
      false,
      "equip",
    );
    /* cmd_get_item != CMD_OK -> return (cmd-obj.c:305-306): ESC abandons the
     * whole wield, it does not fall back to a hand of the port's choosing. */
    if (ref === null || !("handle" in ref)) return false;
    /* equipped_item_slot(player->body, equip_obj) (cmd-obj.c:309). */
    const chosen = player.equipment.findIndex((h) => h === ref.handle);
    if (chosen < 0) return false;
    slot = chosen;
    args["slot"] = chosen;
  }
  if (slot < 0 || slot >= player.body.count) return true;
  const ask = wieldTakeoffConfirm(state, slot);
  if (ask) {
    /* `while (n--)` (cmd-obj.c:323-330): asked once per "!t", any refusal returns. */
    for (let i = 0; i < ask.count; i++) {
      if (!(await confirmYesNo(ask.prompt))) return false;
    }
  }
  return true;
}

/**
 * The item verbs that reach use_aux (cmd-obj.c:407), which is the ONLY place
 * upstream asks for a direction on an item command.
 *
 * do_cmd_wield, do_cmd_takeoff and do_cmd_drop never aim. This shell asked
 * obj_needs_aim for WHATEVER code it was dispatching, so an item whose effect
 * happens to be aimed made every verb aim: putting on a Ring of Flames
 * (`effect:BALL:FIRE:2` in object.txt, with no `act:` line) opened
 * "Direction ('*' or <click> to target...)" before the ring would go on a hand.
 * Acid, Ice, Lightning, Open Wounds and Digging are the same shape, and taking
 * one off or dropping it asked as well.
 *
 * A SET rather than a `code !== "wield"` test: the direction question belongs to
 * a known list of commands, and everything outside it - including whatever verb
 * is added next - is outside it by default. do_cmd_use (cmd-obj.c:938) is not a
 * code here; it picks one of these by tval before use_aux is reached.
 */
const AIMED_VERBS = new Set([
  "read",
  "quaff",
  "eat",
  "use-staff",
  "aim-wand",
  "zap-rod",
  "activate",
]);

/**
 * Dispatch `code` on an already-chosen item (aim direction if needed,
 * pre-resolve any item-target effect, then queue). Shared by useItem's own
 * picker and the context menu's per-item action, which already knows the
 * handle - it should not re-prompt for the item a second time.
 */
async function dispatchItemVerb(code: string, handle: number, obj: GameObject | null): Promise<void> {
  const args: Record<string, unknown> = { handle };
  if (obj && AIMED_VERBS.has(code) && objNeedsAim(obj, { flavor: game.flavor })) {
    const dir = await aimDir();
    if (dir === null) return;
    args["dir"] = dir;
  }
  if (obj && !(await applyEffectPrompts(obj, args))) return;
  if (obj && !(await choosePlayerEffect(usedEffectChain(obj)))) return;
  if (code === "wield" && !(await wieldPrompts(obj, args))) return;
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
  if (obj && AIMED_VERBS.has(code) && objNeedsAim(obj, { flavor: game.flavor })) {
    const dir = await aimDir();
    if (dir === null) return;
    args["dir"] = dir;
  }
  if (obj && !(await applyEffectPrompts(obj, args))) return;
  if (obj && !(await choosePlayerEffect(usedEffectChain(obj)))) return;
  if (code === "wield" && !(await wieldPrompts(obj, args))) return;
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
 * Pre-resolve EF_BANISH's get_com glyph, if the chain will ask for one. Returns
 * "none" when it will not, "cancel" on ESC (upstream's `if (!get_com(...))
 * return false`), or the extra command arg. The probe is RNG-free, so asking
 * here and running the effect once keeps the draw order upstream's.
 */
async function prepareBanishSymbol(
  chain: Effect | null,
): Promise<"none" | "cancel" | { tgtsymbol: string }> {
  const prompt = banishSymbolRequest(chain, state);
  if (!prompt) return "none";
  const key = await getKeyInline(term, prompt);
  /* get_com returns false on ESCAPE (ui-input.c:1443); every other key is the
   * chosen char, and a non-printing one simply matches no monster glyph. */
  if (key === "Escape" || key.length !== 1) return "cancel";
  return { tgtsymbol: key };
}

/**
 * Pre-resolve the get_aim_dir a HANDLER asks for itself - Dimension Door
 * (EF_TELEPORT_TO with no coordinates, effect-handler-general.c:2770-2778).
 * The command's own aim prompt never covers it, because TELEPORT_TO is not an
 * `aim` effect. Returns "none" when the chain has no such handler, "cancel" on
 * ESC (upstream's `if (!get_aim_dir(&dir)) return false`), or the extra arg.
 */
async function prepareEffectAimDir(
  chain: Effect | null,
): Promise<"none" | "cancel" | { tgtdir: number }> {
  if (!effectAimDirRequest(chain, state)) return "none";
  const dir = await aimDir();
  if (dir === null) return "cancel";
  return { tgtdir: dir };
}

/**
 * The chain a USE will actually run. use_aux takes it from object_effect(obj)
 * (cmd-obj.c:410), so an artifact's activation REPLACES its kind's effect -
 * reading obj.effect here made every activation-only prompt (Banishment on
 * activation.txt:628) invisible to the shell's probes.
 */
function usedEffectChain(obj: GameObject): Effect | null {
  return buildObjectEffectChain((objectEffect(obj) ?? []) as EffectRecordJson[], state);
}

/**
 * Pre-resolve the prompts an object's effect chain will ask for - the
 * item-target pick (Enchant / Recharge / ... ) and EF_BANISH's monster glyph -
 * into the command args before it is queued. Returns whether the command should
 * be queued. On a cancelled prompt the command is queued ONLY for an unaware
 * consumable (upstream still runs it: the flavour is learned and the turn is
 * spent, but nothing is consumed); an aware carrier aborts with no turn, so this
 * returns false and the caller drops the command.
 */
async function applyEffectPrompts(
  obj: GameObject,
  args: Record<string, unknown>,
): Promise<boolean> {
  const chain = usedEffectChain(obj);
  const prep = await prepareItemTarget(chain);
  if (prep === "cancel") return !objectIsAware(obj);
  if (prep !== "none") Object.assign(args, prep);
  const banish = await prepareBanishSymbol(chain);
  if (banish === "cancel") return !objectIsAware(obj);
  if (banish !== "none") Object.assign(args, banish);
  const aim = await prepareEffectAimDir(chain);
  if (aim === "cancel") return !objectIsAware(obj);
  if (aim !== "none") Object.assign(args, aim);
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
  const idx = await selectFromMenu(term, "core:activate-item", "Activate which item? ", items, undefined, {
    inscripCmdKey: itemCmdKey("activate"),
  });
  if (idx === null) return;
  const handle = handles[idx];
  if (handle === undefined) return;
  const obj = gearGet(state.gear, handle);
  const args: Record<string, unknown> = { handle };
  /* No AIMED_VERBS gate: this screen IS do_cmd_activate, one of the seven that
   * reach use_aux, so the question is owed unconditionally here. */
  if (obj && objNeedsAim(obj, { flavor: game.flavor })) {
    const dir = await aimDir();
    if (dir === null) return;
    args["dir"] = dir;
  }
  if (obj && !(await applyEffectPrompts(obj, args))) return;
  if (obj && !(await choosePlayerEffect(usedEffectChain(obj)))) return;
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

/**
 * Drop an item (d): do_cmd_drop, cmd-obj.c L360-388.
 *
 * Two things this has to get right that a bare useItem() call cannot.
 *
 * The sources are USE_EQUIP | USE_INVEN | USE_QUIVER (L374) - upstream drops
 * worn gear and quivered ammo straight from the same prompt, and there is no
 * USE_FLOOR (dropping what is already on the floor is meaningless), so the
 * chosen ref is always a gear handle.
 *
 * And the amount is asked for: cmd_get_quantity(cmd, "quantity", &amt,
 * obj->number) at L383, i.e. get_quantity(NULL, obj->number) ->
 * "Quantity (0-N, *=all): " over the current screen. A max of 1 answers 1
 * silently (ui-input.c L1211), so a single item never prompts. An answer of 0 -
 * which ESCAPE gives - is CMD_ARG_ABORTED (cmd-core.c L1097): no drop, no
 * message, and no energy.
 *
 * Ordering note: upstream's stuck-item check (L378) runs BEFORE the quantity
 * prompt, while the port's lives in the core "drop" handler (obj-cmd.c) and so
 * runs after. That is unobservable, because obj_can_takeoff only ever fails on
 * an EQUIPPED object and an equipment slot holds a single item, so max is 1 and
 * the prompt is skipped. Duplicating the gate in the UI would be a second copy
 * of a C function, which is worse.
 */
async function dropItem(): Promise<void> {
  const ref = await selectItemFrom(
    "Drop which item?",
    () => true,
    { equip: true, inven: true, quiver: true },
    "You have nothing to drop.",
    itemCmdKey("drop"),
    false,
    "drop",
  );
  if (ref === null || !("handle" in ref)) return;
  const handle = ref.handle;
  const obj = gearGet(state.gear, handle);
  if (!obj) return;
  const quantity = await getQuantity(term, null, obj.number);
  if (quantity <= 0) return;
  commandBuffer.push({ code: "drop", args: { handle, quantity } });
  advance();
}

// --- Inscribe / uninscribe / refuel (cmd-obj.c do_cmd_inscribe /
// do_cmd_uninscribe / do_cmd_refill) ------------------------------------
// All three route through selectTargetItem's aggregated pack+equip+floor
// picker (USE_EQUIP|USE_INVEN|USE_QUIVER|USE_FLOOR upstream); the quiver
// rides the pack in this gear model. Autoinscribe has no default key
// upstream ships it only from the object-knowledge browser's `{` action
// (o_xtra_act, ui-knowledge.c:1999-2061, wired via ObjectBrowserDeps.setAutoinscription),
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
  /* The unequipped half, the "!d"/"!*" skips, the square_isshop guard and the
   * PN_COMBINE tail are core's (game/ignore-cmd.ts ignoreDrop) - the same
   * function notice_stuff calls, so there is one copy of the policy. What comes
   * back is the equipped targets, which need upstream's inline verify_object
   * (obj-ignore.c L666) and are therefore the only part that lives here. */
  const { needConfirm, queued } = ignoreDrop(state);
  let dropped = queued > 0;
  for (const target of needConfirm) {
    const obj = gearGet(state.gear, target.handle);
    if (!obj) continue;
    const name = objectName(state, obj);
    const yes = await confirmYesNo(`Really take off and drop ${name}? `);
    if (!yes) {
      /* The upstream Hack: inscribe "!d" so the same question stops being
       * asked. Only ever written after a real refusal - which is why core
       * cannot do this half. */
      obj.note = obj.note ? `${obj.note}!d` : "!d";
      continue;
    }
    /* Queued through core, onto state.cmdQueue - upstream's single cmdq - so
     * this drop carries the same background_command = 2 as the unequipped ones.
     * It used to go onto the shell's own commandBuffer without the flag, which
     * both lost the bloodlust exemption and put one upstream mechanism's
     * commands in two different queues. */
    ignoreDropQueue(state, target);
    dropped = true;
  }
  if (dropped) advance();
}

/** quality_action's tier submenu (ui-options.c L1584-1625): pick a tier. */
async function openQualityLevelMenu(itype: number): Promise<void> {
  const items = qualityLevelItems(itype);
  const idx = await selectFromMenu(term, "core:ignore-quality-level", "Quality ignore menu", items);
  if (idx === null) return;
  state.ignore.level[itype] = idx;
  ignoreConfigChanged = true;
}

/** quality_menu (ui-options.c L1630): the 26 ignore-type rows. */
async function openQualityMenu(): Promise<void> {
  for (;;) {
    const { items, itypes } = qualityIgnoreMenu(state.ignore);
    const idx = await selectFromMenu(term, "core:ignore-quality", "Quality ignore menu", items);
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
      /* ego->everseen (ui-options.c:1427). */
      (ego) => state.everseen?.egoSeen(ego) ?? true,
    );
    if (items.length === 0) {
      say("No known ego items to configure.");
      return;
    }
    const idx = await selectFromMenu(term, "core:ignore-ego", "Ego item ignore menu", items);
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
      "core:ignore-sval",
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
      { label: t("main.ignore-setup.quality", "Quality ignoring options") },
      { label: t("main.ignore-setup.ego", "Ego ignoring options") },
      ...catItems,
    ];
    const idx = await selectFromMenu(
      term,
      "core:ignore-setup",
      t("main.ignore-setup.title", "Item ignoring setup"),
      items,
    );
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
  const idx = await selectFromMenu(term, "core:spell-book", `${verb} which book?`, items, undefined, {
    inscripCmdKey: cmdCode ? itemCmdKey(cmdCode) : undefined,
    /* item_menu draws a box over the level, it does not blank it (ui-object.c
     * L1198-1215). Casting a spell was clearing the terminal and printing a list
     * on an empty screen, so the one thing a player wants while choosing what to
     * cast - the monster they are casting it at - was gone. */
    overlay: true,
  });
  /* screen_load (textui_get_item wraps the picker in screen_save/screen_load):
   * put the map back before anything else draws. It matters between two pickers -
   * book then spell - which are different widths, so the second does not cover
   * the first and the leftovers would sit on the map until the modal closed. */
  render();
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
    "core:cast-spell",
    // "%s which %s? ('?' to toggle description)" (ui-spell.c:285).
    `${verb[0]?.toUpperCase()}${verb.slice(1)} which ${noun}? ('?' to toggle description)`,
    items,
    "[ ESC to cancel ]",
    {
      subtitle: SPELL_HEADER,
      detail: (i) =>
        spellBrowseLines(state, sidx[i] ?? -1, inspectExtras.projections, term.size().cols),
      detailToggleKey: "?",
      /* spell_menu_new's region is `{ 0 - width, 1, width, -99 }` (ui-spell.c:229)
       * - right-aligned, one row down, over the map. */
      overlay: true,
    },
  );
  render(); // screen_load, as in chooseBook
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
    /* Banishment (class.txt:429) asks get_com for a monster glyph. Cancelling
     * aborts the cast for the same reason: effect_do returns false before any
     * mana is spent. */
    const banish = await prepareBanishSymbol(chain);
    if (banish === "cancel") return;
    if (banish !== "none") Object.assign(args, banish);
    /* Dimension Door (class.txt:396) asks get_aim_dir from inside the handler,
     * so the command's own aim prompt never fires for it. */
    const aim = await prepareEffectAimDir(chain);
    if (aim === "cancel") return;
    if (aim !== "none") Object.assign(args, aim);
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
      "core:study-spell",
      // "Study which %s? ('?' to toggle description)" (study path, ui-spell.c).
      `Study which ${noun}? ('?' to toggle description)`,
      items,
      "[ ESC to cancel ]",
      {
        subtitle: SPELL_HEADER,
        detail: (i) =>
          spellBrowseLines(state, sidx[i] ?? -1, inspectExtras.projections, term.size().cols),
        detailToggleKey: "?",
        overlay: true, // ui-spell.c:229, as in castSpell
      },
    );
    render(); // screen_load
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
  await browseBookObject(handle);
}

/**
 * textui_book_browse's body, for an ALREADY-CHOSEN book.
 *
 * Split out because context_menu_object reaches the same screen without a
 * get_item of its own (ui-context.c:871-876, "copied from textui_spell_browse"),
 * and the port had no way in: its object context menu was missing the Browse row
 * entirely, so a spellbook there offered Cast and Study and no way to read it.
 */
async function browseBookObject(handle: number): Promise<void> {
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
    "core:browse-spell",
    `Browsing ${noun}s. ('?' to toggle description)`,
    items.map((it, i) => ({
      ...it,
      disabled: !spellOkayToBrowse(player, sidx[i] ?? -1),
    })),
    "[ ESC to exit ]",
    {
      subtitle: SPELL_HEADER,
      browseOnly: true,
      detail: (i) =>
        spellBrowseLines(state, sidx[i] ?? -1, inspectExtras.projections, term.size().cols),
      detailToggleKey: "?",
      detailInitiallyShown: true,
      overlay: true, // ui-spell.c:229 - the same region the cast menu uses
    },
  );
  render(); // screen_load (ui-spell.c:305, screen_save round the browse menu)
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
    /* obj_can_fire (obj-util.c:816) is `obj->tval == player->state.ammo_tval`
     * alone; the extra tvalIsAmmo conjunct is redundant while ammo_tval is an
     * ammo tval and would silently diverge if a mod made it anything else. */
    (o) => o.tval === tval,
    /* USE_INVEN | USE_QUIVER | USE_FLOOR (player-attack.c:1327). The quiver and
     * the floor were both missing, so the one list a player keeps their arrows in
     * was the one place this could not see them. */
    { inven: true, quiver: true, floor: true },
    "You have no suitable ammunition to fire.",
    itemCmdKey("fire"),
    false,
    "fire",
    false,
    /* QUIVER_TAGS (player-attack.c:1327) makes get_item open on the QUIVER for any
     * cmd != CMD_USE (ui-object.c:1477-1478). Without it this opened on the
     * inventory whenever the pack also held matching ammo - so the list the arrows
     * actually live in was not the one that came up. Math.max(0, findIndex) inside
     * selectItemFrom reproduces upstream's fallback when the quiver has none. */
    "quiver",
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
  // equipped weapon from a pack/quiver/floor item.
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
    /* USE_EQUIP | USE_QUIVER | USE_INVEN | USE_FLOOR (player-attack.c:1388). The
     * quiver was missing: its comment claimed the inventory pass covered it,
     * which stopped being true when the quiver became its own command_wrk list
     * (buildItemSources), so quivered ammo could not be thrown at all. */
    { inven: true, quiver: true, equip: true, floor: true },
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

/**
 * target_display_help (ui-target.c:169), in upstream's own words and upstream's
 * own order.
 *
 * WHAT IS OMITTED AND WHY. Upstream builds this sentence from the commands the
 * loop is actually offering, so a clause it never reaches is not a clause it
 * prints: pathfinding ('g') is off here, which is upstream's own
 * `!allow_pathfinding` case, and the object-ignore clause needs a selected
 * object to ignore. Both are sibling gaps and stay off the banner rather than
 * promising a key that does nothing.
 *
 * TWO KNOWING SUBSTITUTIONS. Upstream writes "<dir> and <click> look around":
 * this build's click route is a tap on the canvas rather than upstream's mouse
 * buttons (runTargetLoop's own onTap, wired independently of the modalDepth-
 * gated tap-to-move handler - #62), so the banner says "tap" for it rather
 * than naming a button this build does not have. "<dir>" is a convention from
 * a manual that ships beside the game rather than something a keyboard shows
 * you, so the banner names the keys this port binds. Escape joins 'q' because
 * Escape is the back-out every other screen here takes.
 */
function targetHelpLines(useFreeMode: boolean): string[] {
  /* THREE LINES, because HELP_HEIGHT is 3 (ui-target.c:164) and any more would
   * cover the health bar the loop keeps visible. Upstream writes one sentence
   * and lets text_out fold it; the banner is hand-laid here, so the clauses are
   * split where they fit an 80-column row in upstream's order rather than
   * reordered to make the split tidy. */
  return useFreeMode
    ? [
        "Arrows/numpad/tap look around. 'p' selects player. 'q'/Esc exits.",
        "'r' displays details. 'm' restricts to interesting places.",
        "'t'/tap targets selection.",
      ]
    : [
        "Arrows/numpad/tap look around. 'p' selects player. 'q'/Esc exits.",
        "'r' displays details. '+' and '-' cycle through places.",
        "'o' allows free selection. 't'/tap targets selection.",
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
    purpleUniques: state.options?.get("purple_uniques") ?? false,
    /* monster_x_attr / monster_x_char[ridx] (ui-mon-lore.c L47/L51): the same
     * override table the map draw reads, so the recall title cannot disagree
     * with the glyph on screen. */
    monsterGlyph: (race) => glyphs.monsterGlyph(race.ridx),
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
 * loreDescription's runs as a `text` block, so a presenter is offered the
 * paragraphs unwrapped and the terminal draws the wrap it always had.
 */
async function showRaceRecall(race: MonsterRace, lore: MonsterLore): Promise<void> {
  await showTextScreen(term, monsterRecallScreen(race, lore, recallDeps()));
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
 * then the store contents, then the post-store actions).
 *
 * THIS NOTE USED TO LIST THREE GREYED BROWSERS AND WAS WRONG ABOUT ALL THREE.
 * It said object and ego knowledge "need per-kind/ego `everseen` tracking (not
 * modelled in core yet)" and that shapechange effects "needs the shape-lore
 * textblock chain (not ported)". `everseen` has been modelled and wired for
 * long enough that neither row is greyed on the everseen count alone (ego is
 * greyed when nothing is seen, which is upstream's own MN_ACT_GRAYED), and
 * `shapeLoreLines` is a full port of shape_lore driving the shape browser. A
 * deferral note is evidence about the day it was written; left standing, it
 * sends the next reader off to build something that already exists.
 *
 * What is still true: store/home contents (L3662-3676) pairs with Home
 * persistence (12.1) and is omitted, and the trailing autoinscription-manager
 * entry is this port's own addition kept from before '{' worked inside the
 * object browser.
 */
/**
 * Every live object find_artifact scans (ui-knowledge.c L1460): floor piles,
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
  // The live rogue_like_commands option; every browser below shares it so j/k
  // navigate like every other roguelike-keyset menu (menuNav).
  const roguelike = state.options?.get("rogue_like_commands") ?? false;
  // Entries are built in the exact reference order (ui-knowledge.c:3487-3503):
  // the fixed pre-store block, then one "Display <store>'s contents" entry per
  // store, then the fixed post-store block. Each label/handler is pushed in
  // lockstep so the dynamic store entries never desync the dispatch.
  const items: MenuItem[] = [];
  const actions: (() => Promise<void>)[] = [];
  const add = (label: string, run: () => Promise<void>, disabled = false): void => {
    items.push(disabled ? { label, disabled: true } : { label });
    actions.push(run);
  };
  // Grayed unless something is known (ui-knowledge.c:3646-3689 MN_ACT_GRAYED).
  const monKnown =
    knownMonsterEntries(booted.registries.monsters.races, state.lore).length > 0;
  const egoKnown = booted.registries.objects.egos.some((e) => game.everseen.egoSeen(e));
  /* The live handles desc_obj_fake / object_info_ego need to run object_info on
   * a throwaway object. Built fresh per browse so a knowledge screen opened
   * after the player's state moved on describes the state it is looking at. */
  const fakeRecallDeps = (): FakeRecallDeps => ({
    state,
    reg: booted.registries.objects,
    constants: booted.registries.constants,
    player: p,
    inspectExtras,
    runeEnv: state.runeEnv,
  });

  // Pre-store block (pre_store_actions[], ui-knowledge.c:3487-3496).
  add("Display object knowledge", async () => {
    // textui_browse_object_knowledge (ui-knowledge.c L2062): everseen ||
    // flavoured kinds. kindName is object_kind_name (obj-desc.c L48), never
    // leaking an unidentified flavoured kind's real name.
    const objDeps: ObjectRecallDeps = {
      isAware: (k) => game.flavor.isAware(k),
      wasTried: (k) => game.flavor.wasTried(k),
      everseen: (k) => game.everseen.kindSeen(k),
      hasFlavor: (k) => state.hasFlavor?.(k) ?? false,
      kindName: (k, aware) =>
        !aware && (state.hasFlavor?.(k) ?? false)
          ? (state.flavorText?.(k) ?? "")
          : k.name.replace(/[~&]/g, " ").trim(),
      // `{` inside the browser (o_xtra_act, ui-knowledge.c:1999-2061): "Inscribe with: "
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
      // desc_obj_fake's object_info(OINFO_FAKE) body (ui-knowledge.c L1889).
      recall: fakeRecallDeps(),
    };
    await showObjectKnowledge(
      term,
      booted.registries.objects.kinds,
      booted.registries.objects.bases,
      objDeps,
    );
  });
  add("Display rune knowledge", () =>
    /* do_cmd_knowledge_runes (ui-knowledge.c:2214) with its xtra_prompt /
     * xtra_act pair: '{' sets rune_list[i].note and runs rune_autoinscribe
     * (:2275), '}' clears it (:2252). */
    showRuneKnowledge(
      term,
      state.runeEnv,
      p,
      {
        get: (i) => state.runeNotes?.get(i),
        set: (i, note) => state.runeNotes?.set(i, note),
        autoinscribe: (i) => runeAutoinscribe(state, i),
      },
      roguelike,
    ),
  );
  add("Display artifact knowledge", () =>
    // do_cmd_knowledge_artifacts (ui-knowledge.c L1663). The exact
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
      // do_cmd_knowledge_ego_items (ui-knowledge.c L1750): everseen egos.
      showEgoKnowledge(
        term,
        booted.registries.objects.egos,
        booted.registries.objects.kinds,
        booted.registries.objects.bases,
        game.everseen,
        // desc_ego_fake's object_info_ego body (ui-knowledge.c L1723).
        fakeRecallDeps(),
      ),
    !egoKnown,
  );
  add("Display monster knowledge", () => showMonsterKnowledge(), !monKnown);
  add("Display feature knowledge", () =>
    showFeatureKnowledge(term, booted.registries.features, roguelike),
  );
  add("Display trap knowledge", async () => {
    if (booted.registries.traps) {
      await showTrapKnowledge(term, booted.registries.traps, roguelike);
    }
  });
  add("Display shapechange effects", () => {
    // do_cmd_knowledge_shapechange (ui-knowledge.c L3063).
    /* makeShapeLoreEnv rather than an object literal: the three table fields
     * are trivial and the two tails are not, and hand-assembly here is exactly
     * what left shape_lore_append_change_effects and
     * shape_lore_append_triggering_spells off the page (PORT_TODO 3.21). */
    const shapeEnv = makeShapeLoreEnv(state, {
      properties: booted.registries.objects.properties,
      playerAbilities: players.properties
        .filter((pr) => pr.type === "player" && pr.code)
        .map((pr) => ({
          index: (PF as Record<string, number>)[pr.code!]!,
          desc: pr.desc,
        })),
      classes: players.classes,
      bookKindName: (tvalIdx, sval) =>
        booted.registries.objects.lookupKind(tvalIdx, sval)?.name ?? null,
      inspect: inspectExtras,
    });
    return showShapeKnowledge(term, players.shapes, shapeEnv, roguelike);
  });

  // Per-store block (reset_main_knowledge_menu, ui-knowledge.c:3483-3598): "Display <store>'s contents",
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

  // Post-store block (post_store_actions[], ui-knowledge.c:3499-3503).
  add("Display hall of fame", () => openHallOfFame());
  add("Display character history", () =>
    showTextScreen(term, playerHistoryScreen(state)),
  );
  add("Display equippable comparison", () => showEquipCmp(term, state, equipCmpDeps()));

  for (;;) {
    const idx = await selectFromMenu(
      term,
      "core:knowledge-group",
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
 * do_cmd_knowledge_store (ui-knowledge.c:3412 -> textui_store_knowledge,
 * ui-store.c:1217): a read-only view of a store's stock. Reproduces the
 * store_display_frame layout - owner line, the "Store Inventory"/"Weight"/
 * "Price" header (Home shows "Home Inventory" with no Price), then the stock in
 * store_stock_list order with each item's weight and per-item buy price.
 *
 * The listing is a MODEL now (`storeKnowledgeScreen`, screens.ts) rather than a
 * padded string per row: it is the same shape as `core:inventory`, so a mod that
 * draws a pack listing as sprites draws a shop's shelves the same way. This
 * function is left with the two facts only the shell knows - which feature this
 * is, and what the game charges for each item.
 */
async function showStoreKnowledge(store: Store): Promise<void> {
  const feat = features.get(store.feat);
  const featLabel = feat?.name ?? store.featName;
  const isHome = (feat?.code ?? store.featName).toUpperCase().includes("HOME");
  const stock = sortStoreStock(game, store);
  await showTextScreen(
    term,
    storeKnowledgeScreen(state, stock, {
      title: featLabel,
      owner: store.owner.name,
      isHome,
      /* price_item(store, obj, false, 1); the home sells nothing, and passing a
       * pricer for it would put a column on the screen upstream does not draw. */
      ...(isHome ? {} : { price: (obj: GameObject): number => game.price(store, obj, false, 1) }),
    }),
  );
}

/**
 * do_cmd_knowledge_monsters (ui-knowledge.c L1309-1378): the thematic browser -
 * the ui_knowledge.txt categories on the left, the chosen category's known
 * races on the right with display_monster's Sym / Kills / Full columns and
 * mon_summary underneath. Picking one opens its recall through the SAME
 * monsterRecallScreen + recallDeps path the look/target loop's 'r' uses
 * (showRaceRecall).
 *
 * The screen itself is showMonsterKnowledge in knowledge.ts, on the shared
 * runGroupedBrowser every other knowledge browser uses; this had a second
 * renderer of its own here, which is how it came to be the only one of them
 * missing display_knowledge's Group label, `=` rule and `|` divider.
 */
async function showMonsterKnowledge(): Promise<void> {
  const races = booted.registries.monsters.races;
  const views = monsterKnowledgeGroupViews(races, state.lore, booted.registries.monsterCategories);
  if (views.length === 0) {
    say("You have not encountered any monsters yet.");
    return;
  }
  await showMonsterKnowledgeBrowser(
    term,
    views,
    state.options?.get("purple_uniques") ?? false,
    async (row) => {
      await showRaceRecall(row.race, getLore(state.lore, row.race));
    },
    state.options?.get("rogue_like_commands") ?? false,
  );
}

/**
 * target_set_interactive: the interactive map-cursor browse loop. Owns the
 * keyboard like getAimDir/selectFromMenu (its own capturing keydown
 * listener) - the caller gates the main handler via openModal. Returns
 * target_is_set() once the loop finishes (selection or cancel).
 *
 * `allowPathfinding` is accepted for call-site parity with
 * target_set_interactive's own parameter (every call site above passes the
 * value upstream's matching call site would) but is not wired to anything:
 * CMD_PATHFIND's 'g'/alt-click routes (ui-target.c L1488-1493, L1376-1383)
 * have no port here, so stepTargetLoop has no 'g' branch and targetHelpLines
 * always omits the pathfinding clause - the same "not a clause it prints"
 * rule the banner's own doc comment above states for the ignore-object gap.
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
    // target_dir_allow only sees the keypad-direction keys upstream's own
    // keymap has already translated the roguelike letters into; the port has
    // no keymap layer ahead of the target loop, so stepTargetLoop needs the
    // live option to do that translation itself.
    const rogueLike = state.options?.get("rogue_like_commands") ?? false;
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
      inputEvents.removeEventListener("keydown", onKey, true);
      canvas.removeEventListener("pointerdown", onTap);
      modalDepth--; // release the input gate raised for this loop
      render();
      resolve(targetIsSet(state));
    };

    /**
     * aux_monster's recall toggle (ui-target.c L595-598): open the full recall
     * for the grid's monster, then return to this same loop. The listeners come
     * off first because every overlay listens on window in the CAPTURE phase, so
     * a loop that stays attached eats the recall screen's own keys.
     */
    const openRecall = (mon: Monster): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      canvas.removeEventListener("pointerdown", onTap);
      void showMonsterRecall(mon).then(() => {
        inputEvents.addEventListener("keydown", onKey, true);
        canvas.addEventListener("pointerdown", onTap);
        paint();
      });
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
      /* aux_monster L591-595: button 1 on the grid the cursor is already on
       * toggles the RECALL, exactly as 'r' does - it does not select. In LOOK
       * mode there is nothing to select anyway (do_cmd_look just browses), so
       * the tap-to-confirm below is only the touch route for target selection
       * and must not eat look mode's recall click. */
      if (grid.x === cur.x && grid.y === cur.y && mode & TARGET.LOOK) {
        if (!lastMon) {
          state.sound?.(MSG.BELL);
          return;
        }
        openRecall(lastMon);
        return;
      }
      if (grid.x === cur.x && grid.y === cur.y) {
        const step = stepTargetLoop(state, targets, ui, "t", rogueLike);
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
        const mon = lastMon;
        if (!mon) {
          state.sound?.(MSG.BELL);
          return;
        }
        openRecall(mon);
        return;
      }
      const step = stepTargetLoop(state, targets, ui, ev.key, rogueLike);
      ui = step.ui;
      if (step.bell) state.sound?.(MSG.BELL);
      if (step.done) {
        finish();
        return;
      }
      paint();
    };

    inputEvents.addEventListener("keydown", onKey, true);
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
/* eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept as the fallback described above; nothing keys to it */
async function chooseTarget(): Promise<boolean> {
  const { items, mons } = targetMenu(state);
  if (items.length === 0) {
    say("No Available Target.");
    return false;
  }
  const idx = await selectFromMenu(
    term,
    "core:target-monster",
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
  /* "Auto-target if requested" (ui-input.c:1619-1620):
   *
   *   if (OPT(player, use_old_target) && target_okay() && !dir) dir = 5;
   *
   * With the option on and a live target, get_aim_dir returns DIR_TARGET without
   * printing a prompt or reading a key. The option was defined, toggleable and
   * persisted in this port and READ BY NOTHING, so turning it on changed nothing
   * and firing always asked for a direction. options.ts even recorded it as an
   * intentional no-op, attributing it to a "default-selection nuance" in
   * target_set_interactive - which is not where the C uses it; that note was
   * written from the option's description rather than from its one reader.
   *
   * The DEFAULT stays false, as upstream ships it (list-options.h:22-23), so
   * out of the box the game still prompts. Only two readers exist in the whole C
   * tree: this line and borg-init.c:421, which forces it off. */
  if (state.options?.get("use_old_target") && targetOkay(state)) return 5;
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
// "/me X" -> '<name> X'. Everything else becomes 'Note: X'. Faithful core
// stores that expanded text with the "-- " prefix; a mod may instead retain the
// raw input and mark it for the historyDisplay seam to expand when shown.
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

  /* The write seam sees the exact faithful entry plus the raw user input.  With
   * no hook it remains a normal 4.2.6 write; a hook can replace `what` with the
   * raw text and set expandUserInput without core learning a mod rule or an
   * expansion format. */
  const entry: HistoryAddEntry = {
    what: note,
    type: HIST.USER_INPUT,
    duplicate: false,
    rawUserInput: tmp,
  };
  const wanted = state.modHooks?.historyAdd?.(entry) ?? true;

  // Display the note without the "-- " prefix (cmd-misc.c:111).  The display
  // seam is also how a raw stored note gets the same feedback it will receive
  // in the history screen and character dump.
  const shown =
    state.modHooks?.historyDisplay?.(
      {
        what: entry.what,
        type: entry.type,
        ...(entry.expandUserInput === true ? { expandUserInput: true } : {}),
      },
      playerName,
    ) ?? entry.what;
  say(shown.slice(3));

  // historyStamp supplies history_add_with_flags's dlev/clev/turn off live
  // state (game/history.ts).  A refusing hook suppresses only the ledger write,
  // not the feedback for a note the player just entered.
  const stamp = historyStamp(state);
  if (wanted) {
    historyAdd(
      state.actor.player,
      entry.what,
      HIST.USER_INPUT,
      stamp.dlev,
      stamp.clev,
      stamp.turn,
      entry.expandUserInput,
    );
  }
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
 * Identify symbol (/, do_cmd_query_symbol, ui-knowledge.c:4283): prompt for a
 * display character (or a special list key), collect every monster race the
 * player has memory of whose glyph matches (char_matches_key), then browse the
 * matching races' recall sorted by level or kills. A free action (no turn).
 * C: ui-game.c:183.
 */
async function querySymbolCmd(): Promise<void> {
  // get_com_ex: one keypress. control+A/N/U select the full / unique-only /
  // non-unique-only lists (ui-knowledge.c:4306-4314); any other key is a
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
        inputEvents.removeEventListener("keydown", onKey, true);
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
      inputEvents.addEventListener("keydown", onKey, true);
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
  const sortIdx = await selectFromMenu(
    term,
    "core:monster-recall-sort",
    t("main.monster-recall.sort-title", "Recall details?"),
    [
      { label: t("main.monster-recall.sort-level", "Sort by level") },
      { label: t("main.monster-recall.sort-kills", "Sort by kills") },
    ],
  );
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
      label: `${capRaceName(race)}${
        lore.pkills > 0
          ? t("main.monster-recall.kill-count", "  ({count} killed)", {
              count: lore.pkills,
            })
          : ""
      }`,
    }));
    const idx = await selectFromMenu(
      term,
      "core:monster-recall",
      t("main.monster-recall.pick-title", "Recall which monster?"),
      items,
    );
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
 * Show previous message (^O, do_cmd_message_one, ui-knowledge.c:3709): print the
 * single most recent message, prefixed "> ", on the top line. A free action.
 * C: ui-game.c:187.
 */
function showPrevMessageCmd(): void {
  const latest = msglog.latest();
  message = latest ? `> ${latest}` : "> ";
  render();
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

/* player_resting_is_special (player-util.c:1382) is core's now (game/context.ts,
 * beside state.resting) - this file used to carry a third copy of it. The REST_
 * constants above stay local because restingCompleteSpecial below reads them by
 * name. */
const restingIsSpecial = playerRestingIsSpecial;

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
  inputEvents.addEventListener("keydown", onStopKey, true);
  // No message: upstream announces a rest ONLY through prt_state's "Rest" field
  // in the status column (ui-display.c:957), which core's stateRuns now lights
  // up off state.resting. The invented "Resting... (press any key to stop)" line
  // that used to sit here was never cleared when the rest ended, so it outlived
  // both a completed and a disturbed rest - and being an invented string, no
  // census could see it.
  render();

  try {
    for (;;) {
      // Interruptions before spending the turn (a keypress, a monster already
      // in view, or the world moved the player off the level): disturb().
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
      // Upstream bumps TWO counters here (player-util.c:1487-1488) and this loop
      // bumped one. player_turns_rested is the x2-regen gate that resets per
      // rest; player->resting_turn is the lifetime total the character sheet's
      // "Resting" line shows, and it is reset only at birth. Without this the
      // sheet read 0 for every character forever. PORT_TODO 3.13.
      rest.turnsRested += 1;
      state.restingTurn = (state.restingTurn ?? 0) + 1;

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
    inputEvents.removeEventListener("keydown", onStopKey, true);
    delete (state as StateWithRest).resting;
    void REST_REQUIRED_FOR_REGEN; // seam threshold; read by loop.ts (WIRING-NEEDED)
    render();
  }
}

// --- High scores (task #28: score.c / ui-score.c) -------------------------
// A localStorage-backed ScoreStore (JSON) is the persistence seam; the core
// owns the scoring/ordering/gating. `scoresOpen` gates the main keyhandler
// while the Hall of Fame screen owns the keyboard.
// highscore_write's eight failure messages (score.c L126-169) go to the
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

/**
 * predict_score around the current character (ui-score.c:193), with the keyboard
 * handed over to the score screen for as long as it is up.
 *
 * `allowScrolling` is predict_score's own argument, and the two callers are
 * upstream's two: the Hall of Fame command passes true (show_scores,
 * ui-score.c:216) and close_game's living-character tail passes false
 * (ui-game.c:1158). Nothing here writes to the table - see showPredictedScores.
 */
async function showHallOfFame(allowScrolling: boolean): Promise<void> {
  if (scoresOpen) return;
  scoresOpen = true;
  try {
    await showPredictedScores(
      term,
      scoreStore,
      state.actor.player,
      scoreBuildDeps("nobody (yet!)"),
      scoreNames,
      state.isDead,
      allowScrolling,
    );
  } finally {
    /* In a finally so a screen that throws cannot leave the keyboard gated for
     * the rest of the session - scoresOpen suppresses every input path. */
    scoresOpen = false;
    render();
  }
}

/** Open the Hall of Fame around the current character (show_scores). */
function openHallOfFame(): Promise<void> {
  return showHallOfFame(true);
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
    /* player_can_debug_prereq (player-util.c L1296-1307): debug consent is the
     * persisted NOSCORE_DEBUG bit, NOT wizard mode and NOT a session flag. Read
     * live off the player so accepting the warning takes effect immediately and
     * survives save/load exactly as upstream's savefile bit does. */
    debug: (player.noscore & NOSCORE.DEBUG) !== 0,
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
    /* A GETTER, not a snapshot. buildWizardDeps derives `debug` from the live
     * player.noscore, and confirmDebugGate sets that bit part-way through a ^A
     * command - so a snapshot taken when the context was built would still say
     * debug:false at dispatch time and every command would silently no-op. */
    get deps(): WizardDeps {
      return buildWizardDeps();
    },
    say,
    refresh: () => render(),
    changeLevel: (depth: number): void => {
      game.changeLevel(depth);
      state.generateLevel = false;
      panelCam = null; // new level: recentre the camera on the player
      panelCamPinned = false;
    },
    /* quit("user choice") (cmd-wizard.c L2203). Deliberately NOT exitToTitle:
     * that one saves first, and the whole point of this command is that nothing
     * is written. On desktop the process exits, as upstream's does. In a tab
     * there is no process, so the analogue is a reload with the continuation
     * flags cleared - the session is abandoned and boot lands on the title with
     * whatever was last autosaved still in the roster, which is the same
     * end state a real quit leaves. */
    quitNoSave: async (): Promise<void> => {
      if (desktopQuit()) return;
      try {
        sessionStorage.removeItem(SKIP_TITLE_KEY);
        sessionStorage.removeItem(BIRTH_DONE_KEY);
      } catch {
        /* storage disabled: boot then reads nothing and shows the title anyway */
      }
      const url = new URL(location.href);
      url.searchParams.delete("new");
      url.searchParams.delete("seed");
      location.assign(url.toString());
      await new Promise(() => {}); // navigation in flight; never resume the caller
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
    // wiz_hack_map (cmd-wizard.c:320): the debug query commands supply the
    // grids their probe selected, each with the colour that probe chose, and one
    // glyph per grid is overlaid on the visible panel exactly as print_rel
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

/* Where a mod's debug commands go, latched once. Feeds BOTH capability-gated
 * surfaces - `debug:spawn`'s `ctx.debug` and `debug:wizard`'s `ctx.wizard` -
 * because there is one live game on this page and this is the getter over it.
 * Two latches would be one more thing a future boot path could forget, and
 * forgetting it hands every mod an absent seam that reads exactly like a
 * capability the player never granted.
 *
 * THE SAME CONTEXT AND THE SAME CONFIRMATION the `^A` menu dispatches through,
 * passed rather than reassembled: one consent path, one bit, one moment at which
 * it is set. A second gate here would be a second answer to "does using the debug
 * commands mark your character", and the whole value of this door over what a
 * plugin can already reach through `ctx.core` is that the answer stays one. */
setModDebugDoor({ wizard: wizardCtx, confirm: confirmDebugGate });

/** The roster metadata for the current character, drawn from the live game. */
function metaFromState(id: string): CharMeta {
  const p = state.actor.player;
  /* The one field NOT derived from the game: who this character is (roster.ts's
   * lineage) lives in the roster, and every save rebuilds this object from
   * scratch. Dropping it here would have quietly severed an imported character
   * from their own history at the very first autosave, which is the failure that
   * makes transfer-gate.ts's refusals stop firing. */
  const known = getMeta(id);
  return {
    id,
    ...(known?.lineage !== undefined ? { lineage: known.lineage } : {}),
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

/**
 * The roster fields a transfer file carries, from the live game - the same
 * object `exportCharacter` builds inline, factored out so persistSave's
 * cloud-backup notification (#133) and a manual export share one producer
 * rather than two copies drifting.
 */
function transferMetaFromState(id: string): TransferMeta {
  const m = metaFromState(id);
  return {
    name: m.name,
    race: m.race,
    cls: m.cls,
    sex: m.sex,
    level: m.level,
    depth: m.depth,
    maxDepth: m.maxDepth,
    turn: m.turn,
    alive: m.alive,
  };
}

// Latched true just before a New-character reload so the OUTGOING page's
// pagehide autosave cannot write the (now throwaway) game into the freshly
// allocated slot - birthPending only guards the incoming page.
let suppressSave = false;

/**
 * savefile_save / save_game_checked (ui-game.c:1052, :1173): write the game and
 * report whether it worked. A `true` return with nothing written means the save
 * was not OFFERED - the "nothing to save" short-circuits and the mod-taint
 * refusal below - as opposed to offered and rejected, which is the `false` this
 * reports and the only thing the player can do anything about.
 *
 * The port used to swallow every failure silently, so a quota-exceeded
 * localStorage write left the player playing on believing they were saved.
 */
function persistSave(deliberate = false): boolean {
  /* A mod's hook threw mid-turn (mod-taint.ts), so this state may be half-updated
   * and must not go over the last good save. THE ONLY GATE THAT MATTERS: the tail
   * autosave is not the sole writer - a level change, the 'S' command, the options
   * screen and pagehide all force a save, so gating autosave() alone would leave
   * four ways to overwrite the file the moment the player walked downstairs. */
  if (sessionTaint()) return true;
  if (suppressSave || birthPending) return true; // a throwaway claims no slot
  /* THIS PAGE'S SLOT, not the origin's. `getActiveId` would answer with whatever
   * character any tab most recently chose to resume, which is how two tabs on one
   * character autosaved over each other every three seconds with neither told.
   * `attachedSlot` is set once, in this page's memory, when this page took a
   * character up - so a second tab cannot redirect this one's saves, and a page
   * whose slot turned out to belong to another tab has already been detached and
   * writes nowhere (slot-attach.ts). */
  const id = attachedSlot();
  if (!id) return true; // attached to nothing (e.g. the picker is up): nothing to save
  try {
    const b64 = bytesToB64(encodeSavedGame(saveGame(game), undefined, SAVE_CODEC));
    /* writeSlot's own verdict, not just "nothing threw": the storage write
     * itself is where a quota failure shows up. */
    const ok = writeSlot(id, b64, metaFromState(id));
    /* There is now a character worth protecting from the browser's own eviction, so
     * this is the moment to ask for persistent storage - once per session, in the
     * background, never blocking the save that prompted it. */
    if (ok) ensureDurableStorage();
    /* Ticket #133's cloud backup: every consenting mod's onSave fires on EVERY
     * successful save, not gated on `deliberate` - a backup that only updated on
     * a forced save would lag up to three seconds behind real play, which for a
     * folder a sync client watches is exactly the window "hands-off" was meant
     * to close. The file is the SAME bytes exportCharacter produces, so a
     * backup is byte-for-byte importable through Shift-M on another install.
     * Never allowed to affect whether the save itself is reported successful -
     * notifyBackupSinks contains a throwing mod's own callback internally, and
     * this call happens after `ok` is already decided. */
    if (ok) {
      notifyBackupSinks(
        () => {
          const transferMeta = transferMetaFromState(id);
          const lineage = lineageOf(metaFromState(id));
          return {
            name: backupFilename(transferMeta.name, lineage),
            text: encodeTransfer({
              meta: transferMeta,
              save: b64,
              engine: ENGINE_VERSION,
              exportedAt: new Date().toISOString(),
              lineage,
            }),
          };
        },
        (modId, err) =>
          reportModFault(modId, `cloud-backup write failed: ${faultMessage(err)}`),
      );
    }
    /* lore_save, from the saves that ARE ports of save_game_checked - the 'S'
     * command, a level change, the options screen, close_game. The throttled
     * three-second tail autosave has no upstream counterpart and does not
     * rewrite the file. Its failure is reported and does not fail the save:
     * upstream's own caller only prints a message too (ui-game.c:1090-1093). */
    if (ok && deliberate && !saveLoreFile(booted.registries.monsters.races, game.state.lore)) {
      /* BOTH messages, as upstream prints them: lore_save's own report of the
       * staged file it could not create (mon-lore.c:1908) and then the caller's
       * (ui-game.c:1091). */
      say(`Failed to create file ${userPath(LORE_FILE)}.new`);
      say("lore save failed!");
    }
    return ok;
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
  const prompting = prompt;
  while (!persistSave(true)) {
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
  if (persistSave(force)) {
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
  /* Let go of the character being left, before naming the one being started.
   * The reload attaches the new slot; this page is on its way out and must not
   * be attached to anything while it goes, so its unload-time flush writes
   * nowhere rather than into either character. */
  detachSlot();
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
  /* AFTER the flush and not before: detaching first would send that last save
   * nowhere. The hold on the slot goes back with it, so the character is free
   * for the next page - including this one, after the reload. */
  detachSlot();
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
 * Ask the desktop shell to quit (textui_quit, ui-game.c:199). False when this is
 * an ordinary browser tab, or a shell too old to offer it - in which case the
 * caller uses the tab analogue rather than doing nothing, because a Save-and-exit
 * that neither quits nor leaves play is the bug this replaced.
 */
function desktopQuit(): boolean {
  try {
    const shell = (globalThis as { neoDesktop?: { quit?: unknown } }).neoDesktop;
    if (typeof shell?.quit !== "function") return false;
    (shell.quit as () => void)();
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether desktopQuit would do anything - i.e. whether there is a host process
 * to exit. Asked BEFORE offering an exit (the title screen's Quit row), because
 * a tab has nothing to quit to and a row that does nothing is worse than a row
 * that says it cannot.
 */
function desktopQuitAvailable(): boolean {
  try {
    const shell = (globalThis as { neoDesktop?: { quit?: unknown } }).neoDesktop;
    return typeof shell?.quit === "function";
  } catch {
    return false;
  }
}

/**
 * Save and exit (^X, textui_quit, ui-game.c:199): flush the save, then LEAVE
 * play for the title screen.
 *
 * Upstream quits to the OS, and the next launch shows news.txt and then waits
 * for New/Open from the File menu (main-win.c:5475).
 *
 * A browser tab has no OS to quit to, so there the analogue reloads WITHOUT the
 * continuation flag - which is what routes boot through the title screen and then
 * the character select (isContinuation / bootGame), with this hero waiting to be
 * resumed. Nothing is lost: the save is written first.
 *
 * This function goes to the TITLE on both front ends, and deliberately does not
 * quit. It used to call desktopQuit() first, which made the desktop build close
 * the whole app - so the menu row labelled "Save and exit", its hint promising
 * "the title screen and character list", and the confirmation asking "Save and
 * exit to the title screen?" all did something else entirely. Reported from play
 * 2026-07-29 as "it just closes the game instead".
 *
 * That line came from reading an earlier report of "Save and exit just saves" as
 * "it should exit the process". The real defect then was that the reload landed
 * back in the game; the fix was to clear the continuation flags, which is what
 * the block below does. Quitting was a second, wrong fix layered on the first.
 *
 * Leaving play is NOT the same action as quitting the program, so the two are now
 * separate: this one, and saveQuitCmd (^X / textui_quit) which is the faithful
 * upstream quit. Three other callers were quietly inheriting the quit - death,
 * retirement, and ^X - which is why DYING closed the app on desktop.
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
async function modManagerDeps(): Promise<ModManagerDeps> {
  const store = defaultModStore();
  /* Fetched once for the life of this screen, the same way `store` above is: an
   * install through ctx.installMod only happens while a mod's plugin is running
   * in a live game, which this screen is not, so nothing here can go stale while
   * the player is looking at it. */
  const installedBy: Record<string, string> = {};
  for (const meta of await installedMods(globalThis)) {
    if (meta.installedByModId !== undefined) installedBy[meta.id] = meta.installedByModId;
  }
  return {
    store,
    listCatalog: () =>
      buildCatalog({
        content: discoverContentModManifests(),
        sandbox: [...discoverPlugins().values()].map((p) => p.manifest),
        /* Bundled trusted plugins AND folder ones. A folder plugin is trusted
         * in-process code exactly as a bundled trusted.ts is - same registry
         * facades, same consent gate - so it belongs in the same list rather than
         * a fourth kind the UI would have to learn about. */
        trusted: mergePluginManifests(
          [...discoverTrustedPlugins().values()].map((p) => p.manifest),
          folderPluginManifests(diskPacks().packs),
        ),
        // The EFFECTIVE set, not store.getEnabled(): a pack deployed into the
        // mods folder and listed in load-order.json is loaded without being in
        // the player's stored set, and a manager that showed it as off while the
        // game ran it would be lying about the state of the game.
        enabled: enabledModIds(),
        consents: store.getConsents(),
        /* Read off the packs that actually composed rather than off the staged
         * records, so a row is marked "this session" only when there is really a
         * pack behind it - the same rule presentNamespaces uses. */
        session: sessionPacks().packs.map((p) => p.manifest.id),
        installedBy,
      }),
    /* So a mod downloaded in this session is in the list on the way back out,
     * instead of after a reload the player has not been told to do yet. */
    rediscover: rediscoverModSources,
    conflictLines: () => liveConflictLines(),
    // The mods DIRECTORY, so the manager can name a real path instead of
    // describing a capability the shell might or might not have.
    diskPackStatus: () => diskPackStatus(),
    // Picking a mods folder is offered ONLY where the player is the one who has to
    // supply it: a browser tab, on an engine that can pick a directory. The desktop
    // shell knows where its own folder is (kind "app"), so offering to choose one
    // there would put a second, competing answer in front of the player.
    ...(folderPickingSupported() && diskPackStatus().kind !== "app"
      ? {
          modFolder: {
            pick: async () => (await pickModFolder())?.name ?? null,
            // The permission prompt is only allowed from a user gesture, which is
            // why this lives behind a menu row and never runs at boot.
            reconnect: async () => {
              const handle = await savedModFolder();
              if (!handle) return false;
              return (await folderPermission(handle, { request: true })) === "granted";
            },
            forget: () => forgetModFolder(),
            savedName: async () => (await savedModFolder())?.name ?? null,
          },
        }
      : {}),
    // Fixes & tweaks: the enabled mods' declared rules, and a live-apply so a
    // toggle takes effect at once (no reload).
    ruleDecls: () => loadEnabledModRuleDecls(),
    // The autoplayer speed row (Fixes & tweaks, beside the rule that hands the
    // mod its controller in the first place): activeId says which mod's screen
    // gets the row, getSpeed/setSpeed read and write the persisted tier and,
    // through installedControllerSpeed, re-pace the live pump at once.
    autoplayer: {
      activeId: () => installedController?.id ?? null,
      getSpeed: () => defaultModStore().getAutoplayerSpeed(),
      setSpeed: (speed) => {
        defaultModStore().setAutoplayerSpeed(speed);
        installedControllerSpeed?.(speed);
      },
    },
    applyRuleLive: (flag, on) => {
      /* modRules is now only the RECORD of the player's choice - core never
       * branches on it - so writing it alone was a SILENT NO-OP for all seven
       * patches the moment the behaviour moved to the mods' hooks. The behaviour
       * lives in state.modHooks, so a live toggle has to REBUILD them.
       *
       * mod-store.setRuleChoice has already written the new choice by the time
       * this runs (see mods.ts), so activeModHooks() re-reads it and re-composes.
       *
       * DELETE rather than assign undefined when nothing contributes: "no mod
       * loaded" has to stay absent, not an empty object, or core can tell a mod is
       * there - which is the one thing the seam exists to prevent. */
      (game.state.modRules ??= {})[flag] = on;
      const hooks = activeModHooks();
      if (hooks) game.state.modHooks = hooks;
      else delete game.state.modHooks;
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
    /* The three doors. Same reasoning as above for wiring it unconditionally: every
     * failure it can hit - offline, rate-limited, storage refused - is a message on a
     * row rather than a reason to hide the screen. */
    modBrowse: modBrowseDeps(),
    isModNoscore: () => game.manifest.modNoscore,
    advanceSaveRatchets: (mod) => {
      game.manifest.determinism = advanceDeterminism(game.manifest.determinism, mod.nondeterministic);
      game.manifest.modNoscore = advanceModNoscore(game.manifest.modNoscore, mod.affectsGameplay);
    },
    requestReload: (opts) => {
      reloadAfterModChange(opts);
    },
  };
}

async function openModManager(): Promise<void> {
  await runModManager(term, await modManagerDeps());
}

async function openModOptions(): Promise<void> {
  await runModOptionsBrowser(term, await modManagerDeps());
}

/**
 * Where the cursor was the last time the game menu closed.
 *
 * Module-scope rather than a local, so it survives the whole session: a player
 * who lives in Mods or Options should find the row they use under the cursor,
 * not row one. Upstream's menus keep `menu->cursor` in the long-lived struct for
 * the same reason; these are one call per open, so this is where it lives.
 */
let gameMenuCursor = 0;

/**
 * ESC GOES BACK ONE LEVEL, NOT ALL THE WAY OUT.
 *
 * This used to show the menu once and return, so closing any screen it opened
 * dropped the player into the dungeon. Pressing ESC in Mods to get back to the
 * menu you opened Mods from put you in the game instead, and the only route back
 * was ESC again plus finding the row again. Every screen in the switch below is a
 * SUBMENU of this one, so the loop re-shows the parent - which is what "back"
 * means everywhere else in the game.
 *
 * The rows that LEAVE - resume, save-and-exit, quit, new, switch - return instead
 * of looping, because there is nothing to come back to. Some of them navigate the
 * page, so anything after them would run against a game that is going away.
 */
async function openGameMenu(): Promise<void> {
  for (;;) {
    if (!(await gameMenuOnce())) return;
  }
}

/** One pass of the game menu. False means "stop showing it". */
async function gameMenuOnce(): Promise<boolean> {
  const entries = gameMenuEntries({ canQuit: desktopQuitAvailable() });
  const pick = await selectFromMenu(
    term,
    "core:game-menu",
    "Game menu",
    entries.map((e) => e.item),
    gameMenuFooter(),
    {
      initialCursor: gameMenuCursor,
      onHighlight: (i) => {
        gameMenuCursor = i;
      },
    },
  );
  if (pick === null) return false; // ESC resumes
  switch (entries[pick]?.action) {
    case "character":
      await showCharacterSheet(term, state, playerName, charSheetOpts());
      break;
    case "inventory":
      await showTextScreen(term, inventoryScreen(state));
      break;
    case "equipment":
      await showTextScreen(term, equipmentScreen(state));
      break;
    case "messages":
      await showTextScreen(term, messageHistoryScreen(msglog));
      break;
    case "knowledge":
      await openKnowledgeMenu();
      break;
    case "save":
      autosave(true);
      message = "Saving game... done.";
      render();
      /* The one row whose result is a MESSAGE on the map. Re-showing the menu
       * over it would hide the confirmation it just produced. */
      return false;
    case "options":
      await runOptionsMenu(term, state, openIgnoreSetup, sidebarModeMenu, prefsUiCtx(), openModOptions);
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
      await runHelp(term, rogueLikeKeys());
      break;
    case "report":
      await showReportPage();
      break;
    case "storage":
      await showStoragePage();
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
      /* The touch surface's route to the same command 'i' runs. It used to be
       * openItemActionsMenu, a separate picker with an invented prompt and only
       * the pack and worn gear in it. */
      await doCmdItemListing("inven");
      break;
    /* THE FOUR THAT LEAVE. Each either navigates the page or ends the session, so
     * they return rather than looping - a re-shown menu over a game that is going
     * away is a menu whose next keypress lands nowhere. A DECLINED confirmation
     * does come back to the menu, because declining is not leaving. */
    case "switch":
      // get_check-style confirmation (parallels ui-death.c's "Start a new
      // game?") so a stray tap never yanks the player out of a live run.
      if (await confirmYesNo("Switch character? (this hero is saved to its slot)")) {
        switchCharacter();
        return false;
      }
      break;
    case "new":
      if (await confirmYesNo("Start a new character? (this hero is saved to its slot)")) {
        persistSave(); // keep the current character in its slot, then birth anew
        newGame();
        return false;
      }
      break;
    case "exit":
      // Confirmed like Switch/New: the save is written first, so this loses
      // nothing, but a stray tap should not throw the player out of a live run.
      if (await confirmYesNo("Save and exit to the title screen?")) {
        await exitToTitle();
        return false;
      }
      break;
    case "quit":
      /* The desktop-only row. It runs saveQuitNow, the SAME body as ^X, so the two
       * cannot drift apart - which is how the previous defect here stayed alive.
       *
       * It keeps a confirmation where ^X does not, and that asymmetry is deliberate:
       * ^X is a command the C defines, and textui_quit asks nothing, so asking there
       * would be an invention. This row is port UI with no counterpart in the C - a
       * browse surface where Quit sits one arrow key from its neighbours - so a
       * guard rail here diverges from nothing. */
      if (await confirmYesNo("Save and quit?")) {
        await saveQuitNow();
        return false;
      }
      break;
    default:
      return false; // Resume play
  }
  return true;
}

/**
 * display_winner + display_exit_screen (ui-death.c L374-387): the winner crown
 * (total_winner only) then the tombstone epitaph, each a press-to-continue
 * screen. Shown once when the character dies, before the death menu.
 */
async function showTombstone(diedFrom: string): Promise<void> {
  const p = state.actor.player;
  if (p.totalWinner) {
    await showTextScreen(term, winnerScreen());
  }
  const title = p.cls.titles[Math.trunc((p.lev - 1) / 5)] ?? "";
  const retired = diedFrom === "Retiring";
  const view = tombstoneScreen({
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
  await showTextScreen(term, view);
}

/**
 * death_screen's menu (ui-death.c L374-416), routed through the same shared menu
 * component, with upstream's rows and tag letters.
 *
 * Its loop (L401-413) has four exits, and they do NOT agree on confirming:
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
      "core:death-menu",
      "You have died.",
      entries.map((e) => e.item),
      deathMenuFooter(),
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
        await showTextScreen(term, equipmentScreen(state, "You are using:"));
        await showTextScreen(term, inventoryScreen(state, "You are carrying:"));
        break;
      case "messages":
        await showTextScreen(term, messageHistoryScreen(msglog));
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
            /* The death dump is the one people actually post, so it is the one
             * that most needs to say what was running. */
            mods: enabledModSummary(),
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
        await showTextScreen(term, playerHistoryScreen(state));
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

// player_pickup_aux's get_quantity (cmd-pickup.c L270), resolved the same way
// and for the same reason: only part of the stack fits, so upstream asks how
// much to take. null means "the UI did not ask", and the core then takes the
// whole carryable amount.
let pendingPickupQuantity: number | null = null;

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
    getQuantity: (max): number => {
      const answer = pendingPickupQuantity;
      pendingPickupQuantity = null;
      return answer ?? max;
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
  let target = canPickup[0] ?? null;
  if (canPickup.length > 1) {
    const items = canPickup.map((o) => ({ label: objectName(state, o), color: UI_TEXT }));
    const idx = await selectFromMenu(term, "core:pickup", "Get which item?", items);
    if (idx === null) return;
    pendingPickupChoice = canPickup[idx] ?? null;
    target = pendingPickupChoice;
  }
  /* player_pickup_aux L253-274: a stack that only partly fits is prompted for.
   * A 0 answer still spends the turn upstream (player_pickup_item counts the
   * object at L389 before player_pickup_aux's early return), so the command is
   * queued either way and the core hook does the abandoning. */
  if (target) {
    const max = invenCarryNum(state.gear, target, constants);
    if (max > 0 && max !== target.number) {
      pendingPickupQuantity = await getQuantity(term, null, max);
    }
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

/**
 * show_floor for the pile under the player (ui-display.c:2629-2647): the "You
 * see: " list shown when more than one object is on the grid.
 *
 * This used to call showTextScreen, which clears the terminal - so a step onto a
 * pile blanked the map - and appended an invented "[ Press ESC to return ]"
 * footer. showFloorList is the real thing: an overlay over screen_save, the
 * OLIST_WEIGHT column upstream passes, no footer, and the dismissing key re-fed
 * as the next command (Term_event_push, :2644).
 *
 * `p` is upstream's own variable: "see" by default, and the two replacements at
 * :2626-2628 (ui-display.c). The format is `"You %s: "` (:2640), trailing space
 * and all - the prompt is a prt, so the space is what erases the cell after the
 * colon.
 *
 * No detach/reattach is needed here even though every overlay listens on window
 * in the capture phase: this is opened from advance() under openModal, with the
 * top-level game handler stood down and no other overlay attached. (A caller that
 * opened it from INSIDE another overlay would have to detach first - see
 * charsheet.ts changeName.)
 */
async function showFloorPileScreen(pile: GameObject[]): Promise<void> {
  const blind = (state.actor.player.timed[TMD.BLIND] ?? 0) > 0;
  const canPickup = pile.some((o) => invenCarryNum(state.gear, o, constants) > 0);
  const p = !canPickup
    ? "have no room for the following objects"
    : blind
      ? "feel something on the floor"
      : "see";
  const rows: ObjListRow[] = pile.map((o, i) => ({
    // The row's selection-tag letter ("a) ", "b) ", ...), not language-bearing
    // text - the same convention as the shared item-list letter/paren tags
    // elsewhere in this file.
    label: `${objLetter(i)}) `,
    name: objectName(state, o),
    color: objectColor(o, state),
    /* obj->number * object_weight_one(obj) (ui-object.c:462) - the curse-adjusted
     * single weight, not the raw kind weight. */
    weight: o.number * objectWeightOne(o, state.runeEnv.curses),
  }));
  await showFloorList(term, `You ${p}: `, rows, (key) => {
    /* The key that dismissed the list is re-fed as the next command, so a player
     * who read "You see: a Long Sword" and pressed `g` picks it up. NOT while an
     * autoplayer holds the keyboard: the key that dismissed the list was then the
     * autoplayer's own ESCAPE (answerBlockingPrompt), and feeding it back would
     * put a keystroke nobody pressed into the command stream of a mod that drives
     * the game through commands instead. */
    if (installedController) return;
    enqueueKeys([{ key }]);
  });
  /* screen_load (ui-display.c:2646): put the map back. */
  render();
}

// FOV refresh after the player moves: core's own `state.updateFov` (wireGame in
// session/game.ts) is exactly this call, and is deliberately left in place.
//
// The copy that used to live here was the same call spelled out again - Z is
// {maxSight, feelingNeed}, and viewerState() already delegates to viewerStateOf -
// so it bought nothing and cost a behaviour: core's version hands updateView the
// display_feeling(true) + disturb callback of cave-view.c:852, and a private
// duplicate silently opted the web out of it. Core reads `s.events` per call, so
// the sound bus assigned below still reaches the view code. See the viewerState
// note above; this is the second behaviour this one duplicate has cost.

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
/**
 * The caret (^) prefix fallback (#3, command.rst / commands.txt): "It is
 * often possible to specify control-keys without actually pressing the
 * control key, by typing a caret (^) followed by the key." True for exactly
 * one keydown after a bare, unmodified '^' - the keydown handler clears it
 * unconditionally at the top of every call, so it can never survive to color
 * a later, unrelated key.
 */
let caretPending = false;
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
async function repeatLastCommand(): Promise<void> {
  if (!lastRepeatCmd) return;
  /* cmdq_push_copy's CMD_REPEAT gate (cmd-core.c:296-297): the command that
   * ran last gets to say it must not be repeated, and seven `cmd_disable_repeat`
   * sites plus four `cmd_disable_repeat_floor_item` sites say so. This check did
   * not exist - cmd.ts's CommandQueue has the whole mechanism and nothing drives
   * it (mod/registry-host.ts:15), so the repeat the player gets was ungated.
   *
   * The floor case is the sharp one: a floor item is `args.floor`, an INDEX into
   * the pile under the player, so re-dispatching after the pile changed or the
   * player stepped away acted on a DIFFERENT object rather than failing. */
  if (!repeatPrevAllowed(state.actor.player)) return;
  /* cmd_get_target (cmd-core.c:955-969) runs on EVERY execution of an aimed
   * command, so a repeat re-validates its stored DIR_TARGET and re-opens the aim
   * prompt when the target has gone. This replayed the answer instead, and
   * rangedHelper's non-target branch aims at DDX[5]/DDY[5] - both 0 - so
   * repeating a shot at a monster that had walked out of view fired an arrow
   * into the player's own grid. See repeatDirSlots for why there are three. */
  let cmd: PlayerCommand = { ...lastRepeatCmd };
  for (const slot of repeatDirSlots(cmd)) {
    if (targetOkay(state)) break; // the stored target still validates: dir stands
    const dir = await aimDir();
    /* !get_aim_dir -> CMD_ARG_ABORTED -> the handler returns (cmd-obj.c:305):
     * no command, no turn. */
    if (dir === null) return;
    cmd = withRepeatDir(cmd, slot, dir);
  }
  /* The same low-mana confirm castSpell() asks on a fresh cast (cmd-obj.c:
   * 1139-1152), asked again here because a repeat re-dispatches straight into
   * the core "cast" handler and never runs through castSpell() at all - the
   * core handler is deliberately headless-safe and casts unconditionally
   * (spell-cmd.ts installSpellCommands). Mana can have dropped since the
   * command first ran (a prior cast, a monster's mana-drain), so this is not
   * merely repeating a check already passed once. */
  if (cmd.code === "cast") {
    const player = state.actor.player;
    const spellIndex =
      typeof cmd.args?.["spell"] === "number" ? cmd.args["spell"] : -1;
    const spellData = spellIndex >= 0 ? spellByIndex(player.cls, spellIndex) : null;
    if (spellData && spellData.mana > player.csp) {
      const verb = spellData.realm.verb ?? "cast";
      const noun = spellData.realm.spellNoun ?? "spell";
      say(`You do not have enough mana to ${verb} this ${noun}.`);
      if (!(await confirmYesNo("Attempt it anyway? "))) return;
    }
  }
  /* Same reasoning as the cast case above: a repeated "walk" re-dispatches
   * straight into the core handler and never runs through queueWalk(), so the
   * damaging-terrain confirm (walkTerrainPrompt -> cmd-cave.c L1156-1180) has
   * to be asked again here. The terrain under the destination grid, or the
   * player's HP, can both have changed since the step first ran. */
  if (cmd.code === "walk" && typeof cmd.dir === "number") {
    const prompt = walkTerrainPrompt(state, cmd.dir);
    if (prompt !== null && !(await confirmYesNo(prompt))) return;
  }
  commandBuffer.push(cmd);
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
  const idx = await selectFromMenu(term, "core:use-item", "Use which item? ", rows, undefined, {
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
      /* Still do_cmd_wield, so it still owes the ring question and the "!t"
       * confirm (cmd-obj.c:296-330) - a @0-tagged ring must ask which hand. */
      const args: Record<string, unknown> = { handle };
      if (!(await wieldPrompts(obj, args))) return;
      commandBuffer.push({ code: "wield", args });
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
  panelCamPinned = false;
  render();
}

/** Redraw the screen (^R, do_cmd_redraw, cmd_util:201). */
function redrawCmd(): void {
  render();
}

/**
 * Save and quit (^X, textui_quit, ui-game.c:199 -> ui-command.c:228-231).
 *
 * Upstream asks NOTHING. textui_quit's entire body is `playing = false`; the loop
 * unwinds through close_game (which saves), and every front end then calls quit()
 * (main.c:546-557, main-win.c:3511-3512). There is no get_check anywhere on the
 * path.
 *
 * The port used to open a "Save and quit?" confirmation. That prompt exists
 * nowhere in the C, and an invented string in a prompt slot is worse than an
 * absence, because it fills the slot and no census can see it. A confirm-on-quit
 * is a comfort, not a parity requirement: it belongs in a mod if it is wanted.
 * The risk it was guarding is also small - the save is written first, so ^X loses
 * nothing but the current screen.
 *
 * The one thing that DOES have to differ is the destination: a browser tab has no
 * OS to quit to, so it falls back to the title screen, the nearest thing that
 * exists there. That accommodation is necessary; the question was not.
 */
function saveQuitCmd(): void {
  void openModal(saveQuitNow);
}

/**
 * The body of the quit: save, pause, preview the score, leave. Shared with the
 * game menu's own Quit row so there is exactly ONE implementation of "save and
 * quit" - the previous defect in this area survived precisely because two call
 * sites drifted apart.
 *
 * The order is close_game's living-character branch (ui-game.c:1143-1159) and the
 * two middle steps are the ones this used to skip; closeGameLeavePause is where
 * they live. The save runs HERE rather than being left to exitToTitle so that the
 * pause comes after it on both front ends, which is the order upstream has. That
 * makes the browser path save twice (exitToTitle saves too, because its other
 * callers need it to); the second write is the same bytes, since nothing between
 * them advances the game.
 */
async function saveQuitNow(): Promise<void> {
  await closeGameSave(true);
  await closeGameLeavePause();
  if (desktopQuitAvailable() && desktopQuit()) return;
  await exitToTitle();
}

/**
 * close_game's living-character tail (ui-game.c:1152-1159): after the save is
 * written, print "Press Return (or Escape)." at row 0, column 40 and wait for one
 * key. Any key but Escape then opens predict_score(false) - the character's
 * would-be Hall of Fame entry, "Killed by nobody (yet!)" - and Escape leaves
 * straight away.
 *
 * Both are flush points rather than confirmations: nothing here can cancel the
 * quit, and there is no question asked. That is the distinction the port had
 * wrong. It answered "does textui_quit confirm?" correctly (it does not, and
 * inventing a prompt there was the bug that got removed) and then stopped, so the
 * two pauses that follow `playing = false` were never built and a player pressing
 * ^X went from the dungeon to the title screen with nothing in between.
 *
 * Upstream guards this with `Term->mapped_flag`, "is there a terminal to print
 * on". Every front end here has one before a command can be typed, so there is no
 * unmapped case and the guard has no counterpart.
 *
 * predict_score's argument is display_scores_aux's allow_scrolling, NOT a write
 * flag - no path through here touches the stored table (see showPredictedScores).
 * false is what close_game passes, so the preview pages forward and ends at the
 * last page instead of wrapping.
 */
async function closeGameLeavePause(): Promise<void> {
  /* prt("Press Return (or Escape).", 0, 40) then inkey() (ui-game.c:1155-1156).
   * The wording and the column are upstream's own. */
  const ch = await getKeyInline(term, "Press Return (or Escape).", 40);
  /* if (ch.code != ESCAPE) predict_score(false) (ui-game.c:1157-1158). */
  if (ch === "Escape") return;
  await showHallOfFame(false);
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
    /* FTYPE_HTML for the HTML form, exactly as upstream tags it (ui-command.c:501
     * passes it to file_open); a host that acts on the type then sees the truth. */
    if (!userWrite(file, text, mode === DUMP_HTML ? FileType.HTML : FileType.TEXT)) {
      /* html_screenshot's only failure: it could not open the file (L322-325). */
      say(`Cannot write the '${userPath(file)}' file!`);
      return;
    }
    exportUserFile(file, text, mode === DUMP_HTML ? "text/html" : "text/plain");
    say(`${mode ? "Forum text" : "HTML"} screen dump saved.`);
  });
}

/**
 * Ignore an item (k original / ^D both, CMD_IGNORE, cmd_item_manage:165):
 * picks an item then opens the faithful per-item ignore menu. Body wired to
 * ./ignore-menu (task 155).
 */
async function ignoreItemCmd(): Promise<void> {
  await showIgnoreItemMenu(term, state, game, applyIgnoreDrop, async (prompt, reject) => {
    const ref = await selectItemFrom(
      prompt,
      () => true,
      /* ui-object.c:1833 USE_INVEN | USE_QUIVER | USE_EQUIP | USE_FLOOR. No
       * startIn: command_wrk is reset to 0 at the end of every get_item
       * (ui-object.c:1594), so ignore lands on USE_INVEN (ui-object.c:1481-1482),
       * which is what initial = 0 gives. */
      { inven: true, quiver: true, equip: true, floor: true },
      reject,
      /* CMD_IGNORE's own key, so @k<digit> tags and the !k get_item_allow work. */
      itemCmdKey("ignore"),
      false,
      /* cmd_verb(CMD_IGNORE) is NULL upstream - CMD_IGNORE has no game_cmds
       * entry, it is UI-only - so the confirmation reads "Really do that with". */
      "ignore",
      /* textui_cmd_ignore passes no IS_HARMLESS, so a blanket `!*` does prompt. */
      false,
    );
    /* targetRefObject, NOT a `"handle" in ref` test: an ItemTargetRef is
     * `{handle}` for gear and `{floor}` for a floor pile entry, so testing for
     * the gear shape and returning null otherwise made every floor row a silent
     * no-op - the picker offered the item, took the keypress, and dropped it.
     * The USE_FLOOR above is what puts those rows on the screen in the first
     * place (ui-object.c:1833). */
    return ref ? targetRefObject(ref) : null;
  });
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
/**
 * 'V' (do_cmd_version, ui-command.c:143).
 *
 * UPSTREAM'S SHAPE, which this used to drop: a header naming the build and
 * pointing at '?', and then `copyright` (buildid.c:43) as the body. The body is
 * the part that matters and the part that was missing - it is the notice
 * Angband's own licence asks to travel with the work, and 'V' is where upstream
 * puts it, so a build that answers 'V' with credits and no licence is answering
 * the wrong question.
 *
 * The header names this port and the version it is a port OF, because that is
 * what the player has in front of them; the credit lines below the notice are
 * this port's own addition and stay.
 */
function versionCmd(): void {
  void openModal(() =>
    showTextScreen(term, "Version", [
      {
        text:
          `You are playing Neo Angband ${ENGINE_VERSION} (Angband ${PARITY_BASELINE}).` +
          "  Type '?' for more info.",
      },
      { text: "" },
      { text: "Copyright (c) 1987-2022 Angband contributors." },
      { text: "" },
      { text: "This work is free software; you can redistribute it and/or modify it" },
      { text: "under the terms of either:" },
      { text: "" },
      { text: "a) the GNU General Public License as published by the Free Software" },
      { text: "   Foundation, version 2, or" },
      { text: "" },
      { text: "b) the Angband licence:" },
      { text: "   This software may be copied and distributed for educational, research," },
      { text: "   and not for profit purposes provided that this copyright and statement" },
      { text: "   are included in all such copies.  Other copyrights may also apply." },
      { text: "" },
      { text: "Neo Angband: neostryder / RPGM Tools." },
      { text: "Angband is maintained by the Angband development team." },
    ]),
  );
}

/**
 * The remembered object glyph at a grid, minus anything the player ignores.
 *
 * map_info re-walks the KNOWN pile every frame and skips ignored objects
 * ("Item stays hidden", cave-map.c:162), so ignoring a kind hides it from the
 * map at once - it is not merely dropped from the pack.
 *
 * That skip now happens inside knownObject, which IS map_info's object loop
 * over the remembered pile. This used to consult the LIVE pile instead,
 * because the memory was a single glyph with no objects to test: it could only
 * ask "is EVERY object still on that grid ignored", so an ignored item lying
 * on top of a wanted one hid both, and a grid the player had never seen the
 * contents of was judged by contents they could not know (PORT_TODO 2.9).
 */
function knownObjectShown(x: number, y: number): ReturnType<typeof knownObject> {
  return knownObject(state, loc(x, y));
}

// Touch open/disarm: tapping the "Open"/"Disarm" action-bar button arms this,
// so the NEXT canvas tap resolves to a direction for that command instead of
// a walk (open/close cancel it without spending it on an unrelated tap).
let pendingChestAction: "open" | "disarm" | null = null;

/**
 * Dev-only: the TERMINAL cell the player was last painted into. The player is
 * drawn in a pass of its own after the cell loop, so nothing else knows where it
 * ended up, and an automated check that wants the player's pixels would otherwise
 * have to re-derive the camera clamp and the letterbox. Stripped from a
 * production bundle with the __neo hook that reads it.
 */
let lastPlayerCell: { x: number; y: number } | null = null;

function gridIndex(x: number, y: number): number {
  return y * state.chunk.width + x;
}

/**
 * A composed map cell: an ASCII glyph plus an optional graphics tile.
 *
 * `attr` is the COLOUR_* code `css` was derived from, kept alongside it because
 * grid_data_as_text's monster arms compare and reuse the attr UNDER the monster
 * (ui-map.c L275-286: the tile-code test and the ATTR_CLEAR/CHAR_CLEAR arms),
 * which a CSS string cannot answer.
 */
type CellGlyph = ResolvedGlyph;

// Revealed traps draw under objects and monsters (upstream layer order).
function trapIndex(): Map<number, CellGlyph> {
  const map = new Map<number, CellGlyph>();
  for (const list of state.traps.values()) {
    for (const t of list) {
      if (!t.flags.has(TRF.VISIBLE) || !t.kind.glyph.trim()) continue;
      const tile = tileMap
        ? tileDrawFor(tileForTrap(tileMap, t.kind.tidx, LIGHTING.LOS), t.grid.x, t.grid.y)
        : undefined;
      /* get_trap_graphics (ui-map.c:98): trap_x_attr/char[lighting][tidx]. */
      const g = glyphs.trapGlyph(LIGHTING.LOS, t.kind.tidx);
      const attr = g?.attr ?? colorCharToAttr(t.kind.color);
      map.set(gridIndex(t.grid.x, t.grid.y), {
        ch: g?.char ?? t.kind.glyph,
        attr,
        css: colorToCss(attr),
        ...(tile ? { tile } : {}),
        layer: { kind: "trap", id: t.kind.tidx, lighting: LIGHTING.LOS },
      });
    }
  }
  return map;
}

/**
 * object_kind_attr / object_kind_char (ui-object.c:87-112) plus the matching
 * x_attr tile: THE one place the port decides how an object kind draws.
 *
 * A flavoured kind draws with its flavour glyph+colour (use_flavor_glyph) until
 * identified - for a scroll, only while unaware. Without this an unidentified
 * potion renders in the kind's black placeholder colour (a black square on the
 * floor). The flavour attr is a colour NAME (colorTextToAttr); the kind attr is
 * a colour CHAR (colorCharToAttr).
 *
 * grid_data_as_text (ui-map.c:35-50) routes EVERY object arm through this pair -
 * the live pile, the remembered pile, the multi-object pile marker and the
 * sensed unknown-item/treasure markers alike - so this function is shared by
 * every caller that draws an object, and the flavour and the tile can no longer
 * disagree about which kind is being looked at.
 */
function objectKindCell(
  kind: ObjectKind,
  gx: number,
  gy: number,
  /** The grid is REMEMBERED, not seen: draw it at DIM_SCALE (see tileDrawFor). */
  dimmed = false,
): CellGlyph {
  const flavor = state.flavorGlyph?.(kind);
  const useFlavor = useFlavorGlyph(kind, flavor, game.flavor?.isAware(kind) ?? false);
  /* THE SAME DECISION DECIDES THE TILE. This used to ask for the KIND's tile
   * unconditionally, two lines above the code that carefully worked out that
   * the kind is not what should be drawn - so every flavoured item fell back
   * to a glyph in a tile set (an Ochre Potion painted as `!` beside fully
   * drawn armour), and would have leaked the identified art if the set had
   * happened to carry one. */
  const tile = tileMap
    ? tileDrawFor(
        tileForShownObject(tileMap, kind, useFlavor && flavor ? flavor.fidx : null),
        gx,
        gy,
        dimmed,
      )
    : undefined;
  /* Both arms read the x_attr table: flavor_x_attr/char[fidx] (ui-object.c:100)
   * or kind_x_attr/char[kidx] (:107), never the gamedata record directly. */
  const g = useFlavor ? glyphs.flavorGlyph(flavor.fidx) : glyphs.kindGlyph(kind.kidx);
  const attr =
    g?.attr ?? (useFlavor ? colorTextToAttr(flavor.attr) : colorCharToAttr(kind.dAttr));
  const css = colorToCss(attr);
  return {
    ch: g?.char ?? (useFlavor ? flavor.char : kind.dChar),
    attr,
    css: dimmed ? dim(css) : css,
    ...(tile ? { tile } : {}),
    layer: { kind: "object", id: kind.kidx },
  };
}

/**
 * How a REMEMBERED floor object draws: grid_data_as_text's object arms applied
 * to the player's memory rather than the live pile (ui-map.c:37-49).
 *
 * An exact memory resolves its kind and goes through objectKindCell, exactly as
 * a visible object does. A sensed marker resolves to the real unknown_gold_kind
 * / unknown_item_kind object kinds (`<unknown treasure>` / `<unknown item>` in
 * object.txt), so a tile set draws those too; absent from the pack, it falls
 * back to the dim `*` the port drew for both.
 *
 * This is the fix for "items turn into their glyphs when they go out of sight".
 * The memory used to be a glyph resolved at memorize time, so the draw had no
 * kind to look a tile up with - in EVERY tile set, for EVERY item.
 */
function rememberedObjectCell(
  mem: KnownObjectMemory,
  gx: number,
  gy: number,
): CellGlyph {
  const kinds = booted.registries.objects;
  /* ui-map.c:200-224's priority: the money star, then the item star, then the
   * `<pile>` glyph when the grid remembers more than one displayable object,
   * then the object's own kind. pile_kind was bound and read by nothing until
   * the remembered memory became a remembered PILE (PORT_TODO 2.9). */
  const kind = !mem.seen
    ? mem.money
      ? kinds.unknownGoldKind
      : kinds.unknownItemKind
    : mem.multiple
      ? (kinds.pileKind ?? kinds.kindByIdx(mem.kidx))
      : kinds.kindByIdx(mem.kidx);
  /* dimmed: this grid is remembered, not seen. Without it the item was the one
   * thing on a dim corridor drawn at full brightness - "the cell stays lit
   * instead of going dim when I walk away". */
  if (kind) return objectKindCell(kind, gx, gy, true);
  return { ch: "*", attr: COLOUR_L_DARK, css: UI_DIM, layer: { kind: "object" } };
}

// Live floor items from the engine's piles (pile head = newest, drawn on
// top exactly as upstream lists the first object).
function objectIndex(): Map<number, CellGlyph> {
  const map = new Map<number, CellGlyph>();
  const pileKind = booted.registries.objects.pileKind;
  for (const pile of state.floor.values()) {
    // map_info's object loop (cave-map.c:155-169), shared with the remembered
    // draw so the two halves cannot drift again: it skips an ignored object
    // ("Item stays hidden") and takes the first one that is NOT ignored, so a
    // kind the player has ignored disappears from the map instead of being
    // dropped from the pack and left visible on the ground.
    const shown = floorDisplay(pile, state.isIgnored);
    const grid = shown?.obj.grid;
    if (!shown || !grid) continue;
    /* g->multiple_objects -> the `<pile>` glyph instead of the top item's
     * (ui-map.c:216-219). rememberedObjectCell has always applied this rule and
     * THIS half of the same draw never had it, so a pile in sight showed
     * whatever lay on top and turned into `&` the moment it dimmed out of view -
     * an asymmetry a player can see by taking one step backwards. */
    const kind = shown.multiple ? (pileKind ?? shown.obj.kind) : shown.obj.kind;
    map.set(gridIndex(grid.x, grid.y), objectKindCell(kind, grid.x, grid.y));
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
  const scale = (h: string): number => Math.round(parseInt(h, 16) * DIM_SCALE);
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
  /* grid_data_as_text (ui-map.c:180): the glyph comes out of
   * feat_x_attr/char[lighting][fidx] FIRST, and grid_get_attr's torchlight
   * remap is applied on top of whatever that slot holds. */
  const slot = glyphs.featGlyph(lighting, disp.fidx);
  const dChar = slot?.char ?? disp.dChar;
  let attr = slot?.attr ?? colorCharToAttr(disp.dAttr);
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
      return {
        ch: dChar,
        attr,
        css,
        bg: dim(css),
        ...(tile ? { tile } : {}),
        layer: { kind: "terrain", id: disp.fidx, lighting },
      };
    if (state.options?.get("solid_walls"))
      return {
        ch: dChar,
        attr,
        css,
        bg: css,
        ...(tile ? { tile } : {}),
        layer: { kind: "terrain", id: disp.fidx, lighting },
      };
  }
  return {
    ch: dChar,
    attr,
    css,
    ...(tile ? { tile } : {}),
    layer: { kind: "terrain", id: disp.fidx, lighting },
  };
}

/**
 * do_animation (ui-display.c L1435-1471): once per animation frame, write the
 * animated colour into mon->attr for every ATTR_MULTI / ATTR_FLICKER monster.
 * grid_data_as_text then READS mon->attr (ui-map.c L259), which is also how an
 * ATTR_RAND monster shows the colour it rolled at birth. Upstream returns
 * immediately when animate_flicker is off (L1506), leaving mon->attr as it was.
 *
 * DIVERGENCE (necessary): upstream's RF_ATTR_MULTI branch draws on the GAME
 * RNG. The number of redraws is a front-end property - a browser at 60Hz would
 * consume draws a real terminal never does - so the shimmer uses the same
 * display-only RNG the rest of the animation seam does (displayRandint1),
 * keeping the determinism ratchet intact.
 */
function doAnimation(): void {
  if (!animator || !(state.options?.get("animate_flicker") ?? false)) return;
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    if (!mon.mflag.has(MFLAG.VISIBLE)) continue;
    const base = glyphs.monsterGlyph(mon.race.ridx)?.attr ?? mon.race.dAttr;
    const anim = animateMonsterAttr(animator, {
      ridx: mon.race.ridx,
      baseAttr: base,
      attrMulti: mon.race.flags.has(RF.ATTR_MULTI),
      attrFlicker: mon.race.flags.has(RF.ATTR_FLICKER),
      frame: animFrame,
      randint1: displayRandint1,
    });
    if (anim !== null) mon.attr = anim;
  }
}

/**
 * The player's own map glyph, and its TILE when a tile set supplies one.
 *
 * Faithful to grid_data_as_text's g->is_player branch (ui-map.c L289-331): both
 * the colour AND the character come from the x_attr table's race-0 slot
 * ("<player>" in monster.txt), so a pref file or the glyph picker can re-map the
 * '@'. hp_changes_color (the default, normal: true) then recolours by HP decile -
 * white at 90-100%, yellow 70-80%, orange 50-60%, light-red 30-40%, red 0-20%.
 *
 * THE TILE WAS MISSING, and the reason is worth keeping. Every tile set the game
 * ships defines the player: `monster:<player>:0x8C:0x80` in graf-xxx.prf L927 and
 * its equivalent in each of the others. playerGlyph already handles the tile case
 * correctly - it is why hp_changes_color is skipped when the slot holds a tile
 * code (upstream's `!(a & 0x80)`) - so the port read the right slot, preserved
 * the tile bit through it, and then threw the bit away in this function, which
 * returned a character and a colour and nothing else. Monsters got their tile
 * from tileForMonster one screen over; the player, who IS race 0 in the very same
 * monster table, got a '@'. So in graphics mode the whole map drew as art with a
 * text glyph standing on it - reported from play, on the Linoleum pack, but true
 * of the tilesheet engine and all six tile sets equally.
 *
 * The class/race variants are a separate matter: xtra-*.prf's "special player
 * pictures" block re-maps `<player>` about 110 times behind `?:` expressions on
 * $CLASS and $RACE, and NEITHER engine evaluates those yet, so every character
 * currently draws the same base tile. That is a real gap, tracked separately -
 * but a base tile is not a partial fix of it, it is what upstream draws when the
 * expressions are absent.
 *
 * A MOD MAY ANSWER FOR THIS CELL, and only this cell (registry:tiles' player
 * door, tile-registry.ts). It is asked before the race-0 lookup and its null
 * answer is that lookup, so a game with no such mod behaves exactly as it did
 * before the door existed. The COLOUR and the character are untouched either
 * way: what a tile set draws is a tile set's business, but the '@' and its HP
 * decile are upstream's own display code and a mod overriding a tile has said
 * nothing about them.
 */
function playerMapGlyph(): { ch: string; css: string; tile?: RenderAssetRef } {
  const slot = glyphs.monsterGlyph(0) ?? { attr: COLOUR_WHITE, char: "@" };
  const p = state.actor.player;
  const g = playerGlyph(slot, {
    hpChangesColor: state.options?.get("hp_changes_color") ?? true,
    chp: p.chp,
    mhp: p.mhp,
  });
  /* Race 0 in the monster tile table, the same table and the same index the glyph
   * above came from - not a parallel "player tile" lookup that could disagree
   * with it. Undefined in ASCII mode, or when a pack resolves no player asset. */
  const atlas = tileMap ? (playerTileOverride() ?? tileForMonster(tileMap, 0)) : null;
  const tile = atlas
    ? tileDrawFor(atlas, state.actor.grid.x, state.actor.grid.y)
    : undefined;
  return { ch: g.char, css: colorToCss(g.attr), ...(tile ? { tile } : {}) };
}

/**
 * Ask the installed mods whether the player's own cell should draw something
 * other than the pack's player tile (registry:tiles' player door).
 *
 * Cheap when nothing is installed, which is the case that has to stay cheap: it
 * runs once per rendered frame, and `playerProviders` is a map size read. The
 * view is built only when somebody is going to be asked.
 *
 * `player_is_shapechanged` (player-util.c L1065) is a non-"normal" shape, and
 * effect-general.ts normalises the normal shape to null when it assigns, so the
 * name test is belt as well as braces - it is what keeps this honest if that
 * invariant ever slips.
 */
function playerTileOverride(): TileAtlas | null {
  if (tileRegistry.playerProviders === 0) return null;
  const p = state.actor.player;
  const shape = p.shape !== null && p.shape.name !== "normal" ? p.shape.name : null;
  return tileRegistry.playerTile({
    shape,
    level: p.lev,
    cls: p.cls.name,
    race: p.race.name,
  });
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
 * One drawable monster: everything grid_data_as_text's monster branch needs
 * EXCEPT the glyph under it, which only the draw loop knows.
 */
interface MonsterCell {
  input: Omit<MonsterGlyphInput, "under">;
  tile?: RenderAssetRef;
  layer: WorldLayer;
}

/**
 * Live monster glyphs, rebuilt each frame since monsters move. Only
 * monsters the player can see (or has detected - MFLAG MARK) are drawn;
 * noteSpots maintains the flags after every FOV refresh.
 */
function monsterIndex(): Map<number, MonsterCell> {
  const map = new Map<number, MonsterCell>();
  const purpleUniques = state.options?.get("purple_uniques") ?? false;
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    if (!mon.mflag.has(MFLAG.VISIBLE) && !mon.mflag.has(MFLAG.MARK)) continue;
    /* grid_data_as_text's monster arm (ui-map.c:56): `else if
     * (!monster_is_camouflaged(cave_monster(cave, g->m_idx)))`. A camouflaged
     * monster is NOT drawn as a monster - it is left showing whatever the object
     * layer put there, which for a mimic is the fake item it created at
     * placement. The port had no camouflage test at all, so an undiscovered
     * creeping copper coin drew its true monster tile: the reveal, spoiled, and
     * the ONLY way it could be spoiled since every other consumer of camouflage
     * (melee, monster turn, messages) already honoured it. */
    if (monsterIsCamouflaged(mon)) continue;
    const tile = tileMap
      ? tileDrawFor(tileForMonster(tileMap, mon.race.ridx), mon.grid.x, mon.grid.y)
      : undefined;
    map.set(gridIndex(mon.grid.x, mon.grid.y), {
      input: {
        desired: glyphs.monsterGlyph(mon.race.ridx) ?? {
          attr: mon.race.dAttr,
          char: mon.race.dChar,
        },
        monAttr: mon.attr,
        attrMulti: mon.race.flags.has(RF.ATTR_MULTI),
        attrFlicker: mon.race.flags.has(RF.ATTR_FLICKER),
        attrRand: mon.race.flags.has(RF.ATTR_RAND),
        attrClear: mon.race.flags.has(RF.ATTR_CLEAR),
        charClear: mon.race.flags.has(RF.CHAR_CLEAR),
        purpleUniques,
        shapeUnique: monsterIsShapeUnique(mon),
      },
      ...(tile ? { tile } : {}),
      layer: { kind: "monster", id: mon.race.ridx },
    });
  }
  return map;
}

/**
 * grid_data_as_text's monster branch applied to the cell already composed from
 * terrain/trap/object, plus upstream's write-back of the drawn attr into
 * mon->attr (ui-map.c L288) - which the port skips, because the only reader of
 * that field here is doAnimation, and re-seeding it from the drawn value would
 * make an ATTR_CLEAR monster's colour drift with the floor it walks over.
 */
function composeMonster(under: CellGlyph, cell: MonsterCell): CellGlyph {
  const g = monsterGlyph({ ...cell.input, under: { attr: under.attr, char: under.ch } });
  return {
    ch: g.char,
    attr: g.attr,
    css: colorToCss(g.attr),
    ...(cell.tile ? { tile: cell.tile } : {}),
    layer: cell.layer,
  };
}

/**
 * The stream every hallucination roll comes from, and it is deliberately NOT
 * the game's.
 *
 * Upstream rolls these on the main RNG inside grid_data_as_text, which is safe
 * in a program whose only repaint trigger is a game event. Here the map also
 * repaints on a window resize, on returning from a menu and on the animation
 * timer, so binding the rolls to `state.rng` would make the dungeon a function
 * of how often the screen was painted. Decided 2026-08-09 accepts a
 * different stream where the rules and the odds are unchanged, which is exactly
 * this: same 1/128, same rejection loops, same distribution. It is seeded from
 * wall-clock entropy and never saved - hallucination is not reproducible from a
 * savefile, and nothing about the game depends on it being so.
 */
const hallucinationRng = new Rng((Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0);
const hallucinationRandom: HallucinationRandom = {
  oneIn: (n) => hallucinationRng.oneIn(n),
  randint0: (n) => hallucinationRng.randint0(n),
};

/**
 * A hallucinated monster's cell: the selected race's glyph and tile assigned
 * DIRECTLY, with none of composeMonster's clear/unique/animated resolution -
 * upstream's hallucinate arm returns before any of that (ui-map.c L232-235).
 */
function fakeMonsterCell(gx: number, gy: number): CellGlyph | null {
  const races = booted.registries.monsters.races;
  const ridx = hallucinatoryMonster(
    { count: races.length, named: (i) => !!races[i]?.name },
    hallucinationRandom,
  );
  if (ridx === null) return null;
  const race = races[ridx]!;
  const g = glyphs.monsterGlyph(ridx) ?? { attr: race.dAttr, char: race.dChar };
  const tile = tileMap ? tileDrawFor(tileForMonster(tileMap, ridx), gx, gy) : undefined;
  return {
    ch: g.char,
    attr: g.attr,
    css: colorToCss(g.attr),
    ...(tile ? { tile } : {}),
    layer: { kind: "monster", id: ridx },
  };
}

/**
 * A hallucinated object's cell. Note the `null` flavour: upstream takes the
 * KIND glyph and says so ("HACK - without flavors", ui-map.c L71), so a
 * hallucinated potion shows the unflavoured kind colour rather than the one its
 * flavour rolled this game.
 */
function fakeObjectCell(gx: number, gy: number): CellGlyph | null {
  const kinds = booted.registries.objects.kinds;
  const kidx = hallucinatoryObject(
    {
      count: kinds.length,
      named: (i) => !!kinds[i]?.name,
      glyph: (i) => glyphs.kindGlyph(i) ?? null,
    },
    hallucinationRandom,
  );
  if (kidx === null) return null;
  const kind = kinds[kidx]!;
  const g = glyphs.kindGlyph(kidx) ?? { attr: colorCharToAttr(kind.dAttr), char: kind.dChar };
  const tile = tileMap ? tileDrawFor(tileForShownObject(tileMap, kind, null), gx, gy) : undefined;
  return {
    ch: g.char,
    attr: g.attr,
    css: colorToCss(g.attr),
    ...(tile ? { tile } : {}),
    layer: { kind: "object", id: kidx },
  };
}

/**
 * One frame's hallucination resolver, or undefined when the player is not
 * hallucinating at all (so a normal frame does no extra work and consumes no
 * randomness).
 *
 * MEMOISED PER FRAME, by grid. Upstream resolves each panel grid exactly once
 * per refresh; this renderer resolves the player's grid twice (as a cell and as
 * the player) and the overview resolves every grid twice more for its priority
 * pass. Without the memo those extra visits would each roll again, so the
 * player's own square could show a monster in one pass and an '@' in the other
 * - a flicker with no upstream counterpart.
 */
function hallucinationResolver():
  | ((grid: { x: number; y: number }, present: HallucinationPresence) => HallucinatedCell | null)
  | undefined {
  if ((state.actor.player.timed[TMD.IMAGE] ?? 0) <= 0) return undefined;
  const frame = new Map<number, HallucinatedCell | null>();
  return (grid, present) => {
    const key = gridIndex(grid.x, grid.y);
    const cached = frame.get(key);
    if (cached !== undefined) return cached;
    const verdict = hallucinateGrid(
      {
        image: true,
        monster: present.monster,
        object: present.object,
        sensed: present.sensed,
        /* g->f_idx is the KNOWN, mimic-resolved feature at L181; knownFeat is
         * the port's read of exactly that square. */
        permanentWall: knownFeat(state, loc(grid.x, grid.y)) === FEAT.PERM,
      },
      hallucinationRandom,
    );
    let cell: HallucinatedCell | null = null;
    if (verdict.hallucinate) {
      /* Upstream's object arm runs before its monster arm, so the two draws
       * happen in that order on a grid that substitutes both. */
      const object = verdict.objectGlyph ? fakeObjectCell(grid.x, grid.y) : null;
      const monster = verdict.monsterGlyph ? fakeMonsterCell(grid.x, grid.y) : null;
      cell = { ...(object ? { object } : {}), ...(monster ? { monster } : {}) };
    }
    frame.set(key, cell);
    return cell;
  };
}

/**
 * do_cmd_view_map's data.  ASCII keeps ui-map.c display_map's compressed,
 * priority-resolved miniature.  An active tileset instead keeps one resolved
 * cell per known cave grid for overlay.ts to paint into one offscreen canvas
 * and scale, as the graphical upstream front ends do.  Both paths reuse the
 * map-knowledge helpers render() itself reads (knownFeat/knownObject/features/
 * monsterIndex/trapIndex); no parallel glyph pipeline is built here. No state
 * mutation, and no GAME RNG: while the player is hallucinating this does draw,
 * but from the display-only stream (see hallucinationRng), never from state.rng.
 */
let levelMapActive = false;
let levelMapView: { x: number; y: number; width: number; height: number } | null = null;
let levelMapRepaint: (() => void) | null = null;

function buildOverviewForShell(): LevelOverview {
  const { cols, rows } = term.size();
  const mapW = Math.min(cols - 2, state.chunk.width);
  const mapH = Math.min(rows - 2, state.chunk.height);
  const monsterAt = monsterIndex();
  const trapAt = trapIndex();
  /* Its own resolver, not the live map's: display_map is a separate refresh,
   * and upstream rolls afresh in each one. */
  const hallucinate = hallucinationResolver();
  const playerCell = hallucinate?.({ ...state.actor.grid }, {
    object: false, sensed: false, monster: false,
  })?.monster;
  const overviewParams: BuildOverviewParams = {
    width: state.chunk.width,
    height: state.chunk.height,
    mapW,
    mapH,
    ...(levelMapView ? { view: levelMapView } : {}),
    knownFeatAt: (x, y) => knownFeat(state, loc(x, y)),
    featureGlyph: (fidx, x = 0, y = 0) => {
      const f = features.get(fidx);
      const disp = f.mimic !== null ? features.get(f.mimic) : f;
      const slot = glyphs.featGlyph(LIGHTING.LIT, disp.fidx);
      const attr = slot?.attr ?? colorCharToAttr(disp.dAttr);
      /* display_map's "Hack - make every grid on the map lit" (ui-map.c:846)
       * sets g.lighting = LIGHTING_LIT before re-resolving, so the miniature's
       * TILE is the lit variant too - the same lighting this glyph already
       * asks for. The graphics overview supplies CAVE-grid x/y so tileDrawFor
       * can pick a per-grid variant; the unchanged compressed ASCII path uses
       * its established (0,0) tile identity. */
      const tile = tileMap
        ? tileDrawFor(tileForFeature(tileMap, disp.fidx, LIGHTING.LIT), x, y)
        : undefined;
      return {
        ch: slot?.char ?? disp.dChar,
        css: colorToCss(attr),
        priority: disp.priority,
        ...(tile ? { tile } : {}),
      };
    },
    objectGlyphAt: (x, y) => {
      const mem = knownObjectShown(x, y);
      if (!mem) return null;
      /* display_map goes through grid_data_as_text too (ui-map.c:446), so the
       * miniature resolves a remembered object the same way the map does. */
      const cell = rememberedObjectCell(mem, x, y);
      return { ch: cell.ch, css: cell.css, ...(cell.tile ? { tile: cell.tile } : {}) };
    },
    trapGlyphAt: (x, y) => trapAt.get(gridIndex(x, y)) ?? null,
    monsterGlyphAt: (x, y) => {
      const cell = monsterAt.get(gridIndex(x, y));
      if (!cell) return null;
      /* display_map calls grid_data_as_text too (ui-map.c L446), so the
       * ATTR_CLEAR arms need the same under-glyph the miniature is drawing:
       * the remembered terrain at LIGHTING_LIT. */
      const kf = knownFeat(state, loc(x, y));
      const f = kf >= 0 ? features.get(kf) : null;
      const disp = f && f.mimic !== null ? features.get(f.mimic) : f;
      const slot = disp ? glyphs.featGlyph(LIGHTING.LIT, disp.fidx) : undefined;
      const under: CellGlyph = {
        ch: slot?.char ?? disp?.dChar ?? " ",
        attr: slot?.attr ?? (disp ? colorCharToAttr(disp.dAttr) : 0),
        css: "",
      };
      return composeMonster(under, cell);
    },
    playerGrid: { x: state.actor.grid.x, y: state.actor.grid.y },
    /* The SAME cell the live map draws the player with. display_map has no
     * player special case - map_info reports the player's grid like any other
     * (ui-map.c:184) - so a hard-coded white '@' here was the one cell on the
     * miniature guaranteed to disagree with the map it summarises. That extends
     * to hallucination: display_map re-resolves the player's grid through
     * map_info at L864, so the phantom-monster arm reaches the miniature too. */
    playerGlyph: playerCell
      ? { ch: playerCell.ch, css: playerCell.css, ...(playerCell.tile ? { tile: playerCell.tile } : {}) }
      : playerMapGlyph(),
    ...(hallucinate
      ? {
          hallucinateAt: (x, y, present) => {
            const cell = hallucinate({ x, y }, present);
            if (!cell) return null;
            const flat = (g: ResolvedGlyph): OverviewGlyph => ({
              ch: g.ch, css: g.css, ...(g.tile ? { tile: g.tile } : {}),
            });
            return {
              ...(cell.object ? { object: flat(cell.object) } : {}),
              ...(cell.monster ? { monster: flat(cell.monster) } : {}),
            };
          },
          sensedObjectAt: (x, y) => knownObjectShown(x, y)?.seen === false,
        }
      : {}),
  };
  /* Selecting a graphics renderer is the mode gate, not whether one specific
   * asset has finished loading.  tileDrawFor still falls back to its ASCII
   * glyph while a pack is warming, just as the live map does. */
  return tileset ? buildGraphicsOverview(overviewParams) : buildOverview(overviewParams);
}

/** The faithful map modal, with only a repaint/window access point added. */
async function showLevelMapForShell(): Promise<void> {
  levelMapActive = true;
  try {
    await showLevelMap(term, buildOverviewForShell, (repaint) => {
      levelMapRepaint = repaint;
      return () => {
        if (levelMapRepaint === repaint) levelMapRepaint = null;
      };
    });
  } finally {
    levelMapActive = false;
    levelMapView = null;
  }
}

const SIDEBAR_W = 13; // classic Angband status column width.
let displaySidebarExtent: { columns: number; topRows: number } | null = null;

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
    /* prt_level_feeling (ui-display.c:1041) shows the object half as `?` until
     * feeling_squares reaches z_info->feeling_need. This dep was NOT supplied,
     * so the status line read the model's shipped-value fallback and a pack or
     * mod that changed world:feeling-need was obeyed by ^F and ignored by the
     * indicator right next to it (PORT_TODO 3.15). */
    feelingNeed: constants.feelingNeed,
  };
}

/**
 * THE HUD IS A FRAME NOW (#253, MOD_REACH gap 21).
 *
 * There used to be three functions here that walked a model and called
 * `term.print` - `renderSidebar`, `renderCompactVitals`, `renderStatusLine`.
 * They were correct and they were unreachable: a mod asking for the player's
 * hit points, or for where THIS layout puts them, had nowhere to ask, because
 * the only thing that knew had already flattened the answer into coloured
 * cells. Their rules now live in `hud-view.ts` as pure functions over values,
 * and the terminal is one consumer of what those produce - exactly as
 * `projectLiveWorld` made the map a frame the glyph grid merely happens to
 * paint.
 *
 * The clipping moved with them and is unchanged: the last column of a section
 * is reserved (SCREEN_WID, ui-term.h) and an entry placed off the section's
 * rows is dropped, which is the guard a mod-supplied side_handlers[] with a
 * from-bottom priority needs. What changed is that it is now written once, in
 * `paintHudSection`, instead of four times.
 *
 * Colours are resolved HERE because the colour table is the shell's: a run
 * carries the engine's own COLOUR_* attribute alongside the css it resolves to,
 * so a replacement can re-resolve it against a palette of its own.
 */
function hudModel(model: {
  key: string;
  runs: readonly DisplayRun[];
  values?: Readonly<Record<string, number>>;
}): HudModel {
  return {
    key: model.key,
    runs: model.runs.map((run) => ({
      text: run.text,
      color: run.color,
      css: colorToCss(run.color),
    })),
    /* Passed through untouched. The shell resolves colours because the palette
     * is its own; it has no business rounding, scaling or renaming a number the
     * engine computed. */
    ...(model.values ? { values: model.values } : {}),
  };
}

/**
 * Selected sidebar fields shown inline on the compact-layout vitals row.
 *
 * `health` is here because upstream's own compact layout carries it: update_topbar
 * calls prt_health_short (ui-display.c:795) between SP and Speed. This layout is
 * auto-selected whenever cols < 48, so leaving it out meant the monster health bar
 * was absent on a narrow or phone viewport even once tracking worked.
 */
const COMPACT_VITALS_KEYS = ["level", "hp", "sp", "health", "ac", "gold", "depth"];

/**
 * Everything core draws that is not the map, for the frame being rendered.
 *
 * A thin adapter and nothing more: it reads the live models and hands them to
 * buildHudFrame, which owns every layout rule. That split is the point of #253's
 * first step - the rules used to live in this module body, where the only way to
 * exercise them was to boot the game against a canvas, so they were never tested
 * and could never be reached by a mod. They are now pure functions over values in
 * hud-view.ts, and hud-view.test.ts drives them at sizes and layouts a running
 * game would take an afternoon to reproduce.
 */
function currentHudFrame(
  vp: ReturnType<typeof viewport>,
  cols: number,
  rows: number,
  regions: ScreenRegions,
  targeting: TargetingOverlay | undefined,
): HudFrame {
  /* One deps read for the whole HUD. It is a pure function of the game state,
   * so the sidebar and the status line cannot disagree about the frame they are
   * describing - and asking twice was only ever an accident of their having been
   * two separate draw calls. */
  const deps = displayDeps();
  return buildHudFrame({
    layout: vp.layout,
    cols,
    rows,
    sidebarWidth: vp.sidebarWidth,
    mapOriginX: vp.mapOriginX,
    mapCols: vp.mapCols,
    vitals: sidebarModel(state, deps).map(hudModel),
    placements: sidebarLayout(rows),
    compactKeys: COMPACT_VITALS_KEYS,
    indicators: statusLineModel(state, deps).map(hudModel),
    message: { text: message, css: messageColor },
    ...(targeting
      ? {
          targeting: {
            desc: targeting.desc,
            descCss: UI_GOLD,
            helpLines: targeting.help ? targeting.helpLines : null,
            helpCss: UI_TEXT,
            promptCss: UI_DIM,
          },
        }
      : {}),
    regions,
    /* What is drawn over this HUD, for a mod that has taken one of its regions
     * and draws it outside the terminal (#261). Same composite the world frame
     * carries, from the same relayout at the top of render(). */
    stack: liveRegionStack(),
  });
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
let panelCamPinned = false;

function viewport(focus?: Loc): {
  layout: SidebarLayout;
  compact: boolean;
  mapOriginX: number;
  mapTop: number;
  mapCols: number;
  mapRows: number;
  sidebarWidth: number;
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
  const sidebarWidth = displaySidebarExtent?.columns ?? SIDEBAR_W;
  const sidebarTopRows = displaySidebarExtent?.topRows ?? 1;
  const mapOriginX = layout === "left" ? sidebarWidth : 0;
  const mapTop = layout === "top" ? 1 + sidebarTopRows : 1;
  // SCREEN_WID reserves the rightmost column (ui-term.h: (wid - COL_MAP - 1)),
  // so the visible map is 66 cols in Left mode / 79 in Top/None, matching C.
  let mapCols = cols - mapOriginX - 1;
  let mapRows = rows - mapTop - 1; // the last row is the status line
  if (term.snapsViewportToEven()) {
    if (mapCols > 2 && mapCols % 2 !== 0) mapCols -= 1;
    if (mapRows > 2 && mapRows % 2 !== 0) mapRows -= 1;
  }
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
  return {
    layout,
    compact,
    mapOriginX,
    mapTop,
    mapCols,
    mapRows,
    sidebarWidth,
    camX,
    camY,
  };
}

/**
 * The named regions of the screen, from the numbers viewport() just computed.
 *
 * ONE PRODUCER, and this is the join that makes it one: every rectangle here
 * comes from the same call render() draws with, so a region cannot describe a
 * layout the frame was not drawn in. Writing "the status line is the last row"
 * a second time beside renderStatusLine's caller is the copy that goes stale -
 * `regions.test.ts` and `main-regions.test.ts` hold the two ends together.
 *
 * The metrics are the terminal's own cell size and letterbox offset, published
 * for the first time here (#234). Before that a replacement front end had no
 * way to find the map's pixels and covered the whole window instead, taking the
 * sidebar, the messages and every menu with it.
 */
function currentScreenRegions(vp: ReturnType<typeof viewport>): ScreenRegions {
  const { cols, rows } = term.size();
  return screenRegions(
    {
      cols,
      rows,
      sidebar: vp.layout,
      sidebarWidth: vp.sidebarWidth,
      sidebarTopRows: displaySidebarExtent?.topRows ?? 1,
      mapOriginX: vp.mapOriginX,
      mapTop: vp.mapTop,
      mapCols: vp.mapCols,
      mapRows: vp.mapRows,
    },
    term.metrics(),
  );
}

function clampDisplayOrigin(
  origin: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(Math.floor(origin.x), Math.max(0, state.chunk.width - size.width))),
    y: Math.max(0, Math.min(Math.floor(origin.y), Math.max(0, state.chunk.height - size.height))),
  };
}

const displayControl: ModDisplay = {
  snapshot() {
    const { cols, rows } = term.size();
    const metrics = term.metrics();
    if (levelMapActive) {
      let width = Math.max(1, cols - 2);
      let height = Math.max(1, rows - 2);
      if (term.snapsViewportToEven()) {
        if (width > 2 && width % 2 !== 0) width -= 1;
        if (height > 2 && height % 2 !== 0) height -= 1;
      }
      const view = levelMapView ?? { x: 0, y: 0, width: state.chunk.width, height: state.chunk.height };
      const regions = screenRegions(
        {
          cols,
          rows,
          sidebar: "none",
          sidebarWidth: 0,
          mapOriginX: 1,
          mapTop: 1,
          mapCols: width,
          mapRows: height,
        },
        metrics,
      );
      return {
        mode: "map" as const,
        grid: { cols, rows, cellWidth: metrics.cellWidth, cellHeight: metrics.cellHeight },
        viewport: {
          origin: { x: view.x, y: view.y },
          size: { width: view.width, height: view.height },
          screenOrigin: { x: 1, y: 1 },
        },
        level: { width: state.chunk.width, height: state.chunk.height },
        layout: "none" as const,
        regions,
      };
    }
    const vp = viewport();
    return {
      mode: "play" as const,
      grid: { cols, rows, cellWidth: metrics.cellWidth, cellHeight: metrics.cellHeight },
      viewport: {
        origin: { x: vp.camX, y: vp.camY },
        size: { width: vp.mapCols, height: vp.mapRows },
        screenOrigin: { x: vp.mapOriginX, y: vp.mapTop },
      },
      level: { width: state.chunk.width, height: state.chunk.height },
      layout: vp.layout,
      regions: currentScreenRegions(vp),
    };
  },
  onKey(listener) {
    inputEvents.addEventListener("keydown", listener, true);
    return () => inputEvents.removeEventListener("keydown", listener, true);
  },
  setGrid(request) {
    term.setReflow(request);
    if (levelMapActive) levelMapRepaint?.();
  },
  setCamera(origin) {
    if (levelMapActive) return;
    if (origin === null) {
      panelCam = null;
      panelCamPinned = false;
    } else {
      const vp = viewport();
      const next = clampDisplayOrigin(origin, { width: vp.mapCols, height: vp.mapRows });
      panelCam = loc(next.x, next.y);
      panelCamPinned = true;
    }
    renderBackground();
  },
  setMapView(view) {
    if (!levelMapActive) return;
    if (view === null) {
      levelMapView = null;
    } else {
      const width = Math.max(1, Math.min(Math.floor(view.size.width), state.chunk.width));
      const height = Math.max(1, Math.min(Math.floor(view.size.height), state.chunk.height));
      const origin = clampDisplayOrigin(view.origin, { width, height });
      levelMapView = { ...origin, width, height };
    }
    levelMapRepaint?.();
  },
  setSidebarExtent(extent) {
    displaySidebarExtent = extent
      ? {
          columns: Math.max(6, Math.min(32, Math.floor(extent.columns))),
          topRows: Math.max(1, Math.min(4, Math.floor(extent.topRows))),
        }
      : null;
    renderBackground();
  },
  setTileScaling(mode) {
    setTileScalingMode(mode);
    term.invalidate();
    if (levelMapActive) levelMapRepaint?.();
  },
  repaint() {
    if (levelMapActive) levelMapRepaint?.();
    else renderBackground();
  },
};

setModDisplayControl(displayControl);

/**
 * verify_panel (ui-output.c L563-670): keep the map offset (panelCam) so the
 * player stays on screen. center_player=OFF (normal) panel-scrolls - the offset
 * only moves once the player is within 3 grids of an edge, then re-centres by
 * half a screen; ON re-centres whenever the player leaves the exact centre.
 * modify_panel (L529) then clamps the offset to the level bounds. Called once
 * per render() so every viewport() reader in a frame sees the same offset.
 */
function verifyPanel(): void {
  if (panelCamPinned && panelCam) return;
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

  const vp = viewport(targeting?.cursor);
  const { mapOriginX, mapTop, mapCols, mapRows, camX, camY } = vp;
  /* ONE region table per frame, read by both halves of the screen: the world
   * frame carries it to whoever owns the map, and the HUD sections are the
   * roles it names. A second currentScreenRegions(vp) call here would let a
   * mid-frame layout change put the two descriptions of one screen at odds. */
  const regions = currentScreenRegions(vp);
  /* The base band of the live stack is the same four tiles, so a mod asking
   * "what is covering the map" is asking about the rectangle THIS frame was
   * drawn with. Re-placing here rather than in a resize handler alone is what
   * keeps that true when the sidebar layout changes without the grid doing so
   * ('=' -> (o) moves every rectangle at a constant cols x rows). */
  relayoutStack({ cols, rows, base: regions, metrics: term.metrics() });
  /* do_animation runs once per frame, BEFORE the glyphs are resolved, exactly
   * as upstream's animation timer fires before the redraw it triggers. */
  doAnimation();
  const monsterAt = monsterIndex();
  const objectAt = objectIndex();
  const trapAt = trapIndex();
  /* One resolver per frame, so a grid visited twice answers the same both
   * times and rolls only once (see hallucinationResolver). */
  const hallucinate = hallucinationResolver();

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

  // The importable Phase-4 producer owns cell resolution and visual projection.
  // These callbacks are the real repaint's current-state reads; the terminal is
  // only one sink for the exact frame this call produces.
  const frame = projectLiveWorld({
    width: state.chunk.width,
    height: state.chunk.height,
    origin: { x: camX, y: camY },
    size: { width: mapCols, height: mapRows },
    screenOrigin: { x: mapOriginX, y: mapTop },
    /* Where this frame sits on the screen, and what core is still drawing
     * around it. The one thing a replacement front end could not previously
     * learn, and the reason the sample covered the window (#234). */
    regions,
    /* And what is drawn OVER it (#261). `relayoutStack` ran at the top of this
     * same render(), so this is the composite this frame is being drawn into
     * rather than the previous frame's. */
    stack: liveRegionStack(),
    playerGrid: state.actor.grid,
    ...(targeting ? { cursor: targeting.cursor } : {}),
    cursorBackground: CURSOR_BG,
    unknownForeground: UI_BG,
    pathColours: pathColourAt,
    gridKey: ({ x, y }) => gridIndex(x, y),
    css: colorToCss,
    seen: ({ x, y }) => squareIsSeen(state.chunk, loc(x, y)),
    knownFeature: ({ x, y }) => knownFeat(state, loc(x, y)),
    remembered: ({ x, y }, kf) => {
      const f = features.get(kf);
      const disp = f.mimic !== null ? features.get(f.mimic) : f;
      const tile = tileMap
        ? tileDrawFor(tileForFeature(tileMap, disp.fidx, LIGHTING.LIT), x, y)
        : undefined;
      const slot = glyphs.featGlyph(LIGHTING.LIT, disp.fidx);
      const attr = slot?.attr ?? colorCharToAttr(disp.dAttr);
      const terrain: CellGlyph = {
        ch: slot?.char ?? disp.dChar,
        attr,
        css: colorToCss(attr),
        layer: { kind: "terrain", id: disp.fidx, lighting: LIGHTING.LIT },
      };
      return {
        terrain,
        visual: { ...terrain, css: dim(terrain.css), ...(tile ? { tile } : {}) },
        ...(tile ? { terrainAsset: tile } : {}),
      };
    },
    rememberedObjectAt: ({ x, y }) => knownObjectShown(x, y) ?? undefined,
    rememberedObjectGlyph: (memory, { x, y }) => rememberedObjectCell(memory, x, y),
    rememberedObjectSensed: (memory) => !memory.seen,
    ...(hallucinate ? { hallucinate } : {}),
    terrainAt: ({ x, y }) => terrainGlyph(x, y, LIGHTING.LOS),
    traps: trapAt,
    objects: objectAt,
    monsters: monsterAt,
    monsterGlyph: composeMonster,
    playerGlyph: playerMapGlyph,
    playerTerrain: ({ x, y }) => terrainGlyph(x, y, LIGHTING.LOS),
  }, liveWorldSink);

  if (frame.player && import.meta.env.DEV) lastPlayerCell = frame.player.screen;

  /* The rest of the screen, through the same shape the map goes through: a
   * frame of named sections, presented to a sink. The vitals, the message line
   * and the status line all live in it, including the two rows the targeting
   * loop takes over while it runs (target_set_interactive owns both).
   *
   * ONE sink for the whole frame, not one call per region: who owns each section
   * is `liveHudSink`'s business (hud-runtime.ts), and deciding it here would put
   * a second copy of the ownership rule on the hot path. */
  renderHudFrame(currentHudFrame(vp, cols, rows, regions, targeting), liveHudSink);

  // The map cursor - GlyphTerm.setCursor's one-pixel gold frame, drawn last
  // and on top of whatever the cell painted (#290). While targeting/looking,
  // the interactive loop's own grid takes the frame; between turns it is
  // show_target / highlight_player, exactly as before. Upstream places the
  // between-turns cursor just before waiting for a command and repeats the
  // same block at four sites (ui-display.c:2486 refresh, ui-game.c:678
  // pre_turn_refresh, ui-command.c:105 do_cmd_redraw, ui-input.c:1899
  // highlight_player in inkey) - target if show_target and target_sighted(),
  // else the player.
  //
  // This used to be gated on `!targeting`, on the theory that "the
  // interactive '*'/'l' loop owns the cursor itself" - but the loop never
  // called setCursor at all, only ever setting `cursorBackground` (a plain
  // glyph background fill an opaque tile draws straight over), so tile mode
  // never showed a highlight on a Look/target grid at all.
  const cursorGrid = targeting
    ? targeting.cursor
    : (state.options?.get("show_target") ?? false) && targetSighted(state)
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

  /* THE STACK IS PAINTED LAST, and the ordering is the whole point rather than
   * tidiness. render() opens with term.clear(), so a stack painted before it -
   * or by anything that runs before it - is erased by the very frame that was
   * supposed to carry it. The symptom would be a mod's window flickering only
   * while the player is moving, which reads as the mod being broken and is
   * reproducible nowhere else. Nothing in core registers a painter today; this
   * is the seam being put in the one place it can be correct in. */
  paintRegionStack(term);
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
    // prt (ui-output.c:385-391), not put_str: render() has just drawn the
    // message on this row, so a longer message would show its tail past the
    // banner.
    term.prt(0, 0, banner.slice(0, cols - 1), UI_TEXT);
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
      inputEvents.removeEventListener("keydown", onKey, true);
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
      const cell = term.cellAt(ev.clientX, ev.clientY);
      if (!cell) return;
      const { col, row } = cell;
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
    inputEvents.addEventListener("keydown", onKey, true);
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

/**
 * ANSWER THE BLOCKING PROMPT THE AUTOPLAYER IS PARKED ON - the port's
 * `inkey_hack` (borg.c:189, `borg_inkey_hack`).
 *
 * Upstream's borg is compiled into the game and installs itself as the hook
 * `inkey()` consults for EVERY key the game reads, prompt or not. Reading its
 * own hook in order says the rest: before it thinks about a move at all it looks
 * at the message line, and a trailing " -more-" is answered with a space
 * (borg.c:371-388) while a set of named prompts get their own reply
 * (borg-messages-react.c). So a blocking prompt is never something the borg
 * waits out. It is the borg's next keypress, delivered through the same input
 * function every other key goes through.
 *
 * This port's controller seam answers a different question: it supplies a
 * `PlayerCommand`, and "dismiss this message" is not one. Meanwhile every
 * blocking read in this shell - the `-more-` pager, the floor-pile list, the
 * store screen, a yes/no confirm - resolves on a keydown delivered through the
 * ONE input door (input-door.ts). Feeding a key into that door is therefore the
 * same mechanism in this shell's terms, and it is why this reaches all of them
 * rather than only the pager, which is what the `auto_more` option reaches.
 *
 * ESCAPE, for two reasons that agree: "any key" satisfies the pager, and ESCAPE
 * is the answer that closes an overlay and reads as "no" at a confirm - which is
 * what upstream's borg answers to "Die?" (borg-messages-react.c:133).
 *
 * Called ONLY from an autoplayer's own pump, and only while a modal is open on a
 * live game screen. So the human's keyboard is never doubled: with no modal open
 * nothing is waiting, and before `gameScreenLive` the birth flow owns the
 * terminal and must not be answered by a mod's clock.
 */
function answerBlockingPrompt(who: string): void {
  dispatchUiInput(
    { key: { key: "Escape", modifiers: { ctrl: false, shift: false, alt: false, meta: false }, repeat: false } },
    undefined,
    true, // bypass keymaps: this is the autoplayer's key, not the player's
  );
  /* borg_note("clearing -more-") (borg.c:385): an unattended run's log is the
   * only record that a prompt came up and who answered it. */
  log.debug(who, "answered a blocking prompt");
}

/** Wait for any keypress or tap (anykey, ui-input.c) - the -more- gate. */
function waitAnyKey(): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = (ev: Event): void => {
      ev.preventDefault();
      if (ev.type === "keydown") (ev as KeyboardEvent).stopImmediatePropagation();
      inputEvents.removeEventListener("keydown", done, true);
      window.removeEventListener("pointerdown", done, true);
      resolve();
    };
    inputEvents.addEventListener("keydown", done, true);
    window.addEventListener("pointerdown", done, true);
  });
}

/**
 * Page the raw message events recorded since cursor `preLen`, pausing with
 * "-more-" between pages unless auto_more is set. A single page (the common
 * case) needs no pause - render() has already put it on the top line - so this
 * returns immediately. Runs inside a modal so the game key handler stands down
 * while the player reads.
 *
 * The feed is the RAW stream (`rawSince`), not the collapsed history, because
 * upstream's `event_signal_message` fires on every occurrence while
 * `message_add` collapses only the recall screen's copy. A dig repeated until
 * the wall gives way therefore reprints its line and pauses, instead of ticking
 * a `<Nx>` counter in place.
 */
async function pumpMessages(preLen: number, force = false): Promise<void> {
  const fresh = msglog.rawSince(preLen);
  // `preLen` is always the caller's snapshot of `msgPending`, so `msgPendingOffset`
  // still names how far into `fresh[0]` (if any) the pending cursor sits.
  const { pages, pendingFrom, pendingOffset } = packMessages(fresh, term.size().cols, msgPendingOffset);
  const autoMore = state.options?.get("auto_more") ?? false;
  /* `force` is message_flush (ui-input.c L609-635), which the caller signals
   * before replacing the screen: it flushes the PENDING line too, so nothing is
   * left on row 0 to be wiped unread. on_new_level (game-world.c:1027) sends
   * EVENT_MESSAGE_FLUSH before EVENT_NEW_LEVEL_DISPLAY for exactly that reason.
   * Ordinary paging instead leaves the final page standing, because that is
   * what message_column still holds when display_message returns.
   *
   * Either way the flushed pages are gone: msg_flush erases row 0 and zeroes
   * message_column, and this cursor is that erasure - only the unflushed tail
   * may be shown again on the next step of a self-continuing command. */
  msgPending = force ? msglog.rawLength() : preLen + pendingFrom;
  msgPendingOffset = force ? 0 : pendingOffset;
  if (fresh.length > 0) {
    messageColor = fresh[fresh.length - 1]?.color ?? UI_TEXT;
  }
  if (pages.length === 0) return;
  /* How many pages end in a "-more-" the player has to answer. auto_more (and a
   * keymap's auto-more) skips msg_flush's anykey() but not its erase, so the
   * pages still happen; only the waiting does not. */
  const prompts = autoMore ? 0 : force ? pages.length : pages.length - 1;
  const last = pages[pages.length - 1] ?? "";
  if (prompts === 0) {
    // display_message packs the whole turn's messages onto row 0 (ui-input.c
    // L570-590), so a turn with several short messages ("You are covered in
    // acid!" + "You feel your life draining away!") shows them concatenated -
    // not just the newest one, which is all render() drew. Put the packed page
    // on the top line so no earlier message is dropped.
    message = force ? "" : last;
    render();
    return;
  }
  await openModal(async () => {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i] ?? "";
      message = page;
      render();
      if (i < prompts) {
        // msg_flush(message_column + split + 1) (ui-input.c L575): the -more-
        // prompt sits one column after the message text, which now starts at
        // col 0 (REND-5), so no sidebar offset.
        term.print(page.length + 1, 0, "-more-", MORE_COLOR);
        await waitAnyKey();
      }
    }
  });
  // Term_erase(0, 0, 255) at the tail of the forced flush; otherwise the last
  // page stays on row 0, which is where display_message left it.
  message = force ? "" : last;
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
        /* object_is_in_store (obj-info.c): a store's stock shows a useable
         * item's real effect even when its flavour is unknown, which is the
         * whole point of being able to read the shelf. */
        const tb = objectInfoTextblock(state, obj, { ...inspectExtras, inStore: true });
        await showTextScreen(term, objectRecallScreen(header, tb));
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
        inventory: () => showTextScreen(term, inventoryScreen(state)),
        equipment: () => showTextScreen(term, equipmentScreen(state)),
        quiver: () => showTextScreen(term, quiverScreen(state)),
      },
    }),
  ).then(() => {
    /* leave_store's "Disable repeats" (ui-store.c:1315-1317). A store visit
     * rearranges the pack wholesale, so the remembered command's handle or floor
     * index no longer means what it did when it was recorded. */
    cmdDisableRepeat(state.actor.player);
  });
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** bolt_pict's motion classification (ui-display.c:1524-1554), ASCII branch:
 * the five glyphs are a fixed direction alphabet, chosen by comparing the
 * step's old and new grid - never by the projection type, which only picks
 * the colour. Order matches BOLT_NO_MOTION/_0/_45/_90/_135 (project.h:54-58). */
const BOLT_CHARS = "*|/-\\";
function boltMotionChar(from: Loc, to: Loc): string {
  const dy = to.y - from.y;
  const dx = to.x - from.x;
  if (dy === 0 && dx === 0) return BOLT_CHARS[0]!;
  if (dx === 0) return BOLT_CHARS[1]!;
  if (dy === -dx) return BOLT_CHARS[2]!;
  if (dy === 0) return BOLT_CHARS[3]!;
  if (dy === dx) return BOLT_CHARS[4]!;
  return BOLT_CHARS[0]!;
}

/** The projection's own colour (projection.txt's "color", e.g. "Slate"),
 * matching wizard.ts's PROJ demo screen. Unbound/unknown types read white,
 * same as colorTextToAttr's own fallback. */
function boltColour(typ: number): string {
  const proj = booted.registries.projections?.[typ];
  return colorToCss(colorTextToAttr(proj?.color ?? "w"));
}

/** Draw one marker glyph at a grid, or do nothing off-panel - the port has no
 * panels (an established reduction, e.g. target-loop.ts's module doc), so
 * "off-panel" here means "outside the current viewport" rather than upstream's
 * literal panel_contains. */
function paintProjectionMarker(grid: Loc, ch: string, fg: string): void {
  const vp = viewport();
  const sx = vp.mapOriginX + (grid.x - vp.camX);
  const sy = vp.mapTop + (grid.y - vp.camY);
  if (sx < vp.mapOriginX || sy < vp.mapTop) return;
  if (sx >= vp.mapOriginX + vp.mapCols || sy >= vp.mapTop + vp.mapRows) return;
  term.print(sx, sy, ch, fg);
}

/**
 * display_bolt / display_explosion (ui-display.c:1645,1559), replayed after
 * the turn that generated them: draw each traveled grid (erasing the last
 * marker with a fresh render() first, matching print_rel drawing straight
 * over the previous frame), pausing delayFactor ms per step - a beam's
 * grids stay lit as a trail behind the moving tip, matching the second,
 * un-erased bolt_pict call display_bolt makes per beam grid.
 */
async function playProjectionAnimation(
  bolts: readonly BoltEventData[],
  blasts: readonly ExplosionEventData[],
): Promise<void> {
  const delayMs = state.options?.delayFactor ?? DEFAULT_DELAY_FACTOR;
  let trail: Loc[] = [];
  for (const b of bolts) {
    const from = loc(b.ox, b.oy);
    const to = loc(b.x, b.y);
    if (trail.length > 0) {
      const last = trail[trail.length - 1]!;
      if (last.x !== from.x || last.y !== from.y) trail = [];
    }
    render();
    const fg = boltColour(b.projType);
    for (const t of trail) paintProjectionMarker(t, BOLT_CHARS[0]!, fg);
    paintProjectionMarker(to, boltMotionChar(from, to), fg);
    await sleep(delayMs);
    if (b.beam) trail.push(to);
    else trail = [];
  }
  // display_explosion (ui-display.c:1559-1640): draw the blast from inside
  // out, flushing (and pausing) once per radius ring rather than per grid -
  // distanceToGrid is already sorted ascending (computeProjection's own
  // outward sort), so a ring boundary is just "the next grid's distance grew".
  for (const e of blasts) {
    const fg = boltColour(e.projType);
    const drawn: Loc[] = [];
    for (let i = 0; i < e.blastGrid.length; i++) {
      const g = e.blastGrid[i]!;
      if (e.playerSeesGrid[i]) drawn.push(g);
      const atRingEnd =
        i === e.blastGrid.length - 1 ||
        (e.distanceToGrid[i + 1] ?? 0) > (e.distanceToGrid[i] ?? 0);
      if (atRingEnd && drawn.length > 0) {
        render();
        for (const d of drawn) paintProjectionMarker(d, BOLT_CHARS[0]!, fg);
        await sleep(delayMs);
      }
    }
  }
  render();
}

function advance(): void {
  // A key held over from a pump that ended some other way (a level change, a
  // death) must not abort the NEXT run.
  if (!pumping) interruptKey = false;
  /* Is this the first step of a player command, or the next step of one that is
   * continuing itself (a run, a pathfind, an auto-repeated dig)? Upstream asks
   * the same question by whether inkey was reached: `textui_get_command` clears
   * `msg_flag` (ui-input.c:1824) and the next `display_message` therefore zeroes
   * `message_column`, but a self-continuing command never gets there, so its
   * top line keeps filling across steps until it overflows into a "-more-". */
  const continuing = pumping;
  pumping = false;
  /* THE OTHER HALF, and it is the one that is easy to get backwards.
   * process_player asks `cmd_get_nrepeats() > 0` at the top of every iteration
   * (game-world.c:972). A command repeating on its own COUNT - tunnel, open,
   * close, disarm, alter, the five with auto_repeat_n 99 (cmd-core.c L82-87) -
   * takes the yes branch, which signals EVENT_COMMAND_REPEAT, and
   * repeated_command_display (ui-display.c:2495) assumes those messages were
   * seen: `msg_flag = false` and `prt("", 0, 0)`. So a long dig gets a FRESH top
   * line every attempt and never builds towards a "-more-". A run, a rest or a
   * pathfind carries no repeat count, takes the no branch, and accumulates.
   * `repeatRemaining` is this port's nrepeats, the same field
   * checkForPlayerInterrupt reads (loop.ts). */
  const repeating = (state.cmdQueue ?? []).some((c) => (c.repeatRemaining ?? 0) > 0);
  // Raw events before this command, for -more-. A fresh command and a counted
  // repeat both start clean; only a run/rest/pathfind step inherits the partial
  // line the step before it left pending.
  const startsClean = !continuing || repeating;
  if (startsClean) msgPending = msglog.rawLength();
  if (startsClean) msgPendingOffset = 0;
  const preLen = msgPending;
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
  //
  // A RUN OR REST STEP IS NOT A NEW COMMAND, so it does not erase row 0 -
  // nothing upstream clears the line between those steps, and clearing it here
  // threw away the partial line the pending cursor above is still carrying. A
  // counted repeat DOES erase it, because repeated_command_display does
  // (prt("", 0, 0)); that is the same condition, so it is the same flag.
  if (startsClean) message = "";
  /* THE ENGINE IS NOT EXEMPT FROM ITS OWN CONTAINMENT RULE.
   *
   * A mod's hook throwing mid-turn is caught, named and taints the session
   * (mod-taint.ts). A PORT BUG throwing mid-turn did none of that: the
   * exception escaped this function, the pump stopped, the screen never
   * repainted, and the player was left looking at the frame before their
   * keypress with no message and no idea the game had stopped. What saved their
   * character was the same accident mod-taint.ts was written to stop relying
   * on - the throw unwinding past the tail autosave - and it is not enough,
   * because 'S', a level change and pagehide all write too. So a player who hit
   * a bug and pressed S to be safe saved the half-finished turn over the good
   * one.
   *
   * Rethrowing is not an option and neither is carrying on. Taint the session
   * (which shuts every writer, not just this one), then let the shared notice
   * say what happened - the same modal a mod fault raises, worded for a core
   * fault. This is an alpha; the bug it reports is the point. */
  let status;
  try {
    status = runGameLoop(state, registry);
  } catch (e) {
    taintSession({
      id: null,
      hook: "taking a turn",
      why: e instanceof Error ? e.message : String(e),
    });
    /* Repaint, so the screen is not frozen on the pre-keypress frame while the
     * notice comes up. The state may be half-updated; drawing it is still more
     * honest than drawing the state before the command the player gave. */
    try {
      render();
    } catch {
      /* The renderer is downstream of whatever broke. The notice is a terminal
       * overlay and does not need the map to have painted. */
    }
    return;
  }
  // The turn is fully resolved (state already reflects every hit and death
  // the projection caused) before any of this runs, so the animation plays
  // as a REPLAY of the geometry rather than upstream's live frame-by-frame
  // draw - see playProjectionAnimation's own doc for why. The overwhelming
  // majority of turns queue nothing, so those keep running the rest of this
  // function synchronously exactly as before this seam existed.
  const bolts = pendingBolts;
  const blasts = pendingBlasts;
  pendingBolts = [];
  pendingBlasts = [];
  if (bolts.length === 0 && blasts.length === 0) {
    continueAdvance(status, preLen, beforeX, beforeY, seeFloorReq);
    return;
  }
  void playProjectionAnimation(bolts, blasts).then(() => {
    continueAdvance(status, preLen, beforeX, beforeY, seeFloorReq);
  });
}

/**
 * The autoplayer half of a death: reincarnate in place instead of ending the run
 * (borg/borg-reincarnate.c, reached from borg_think.c:300 whenever the borg is the
 * one playing and cheat-death is off).
 *
 * THE GATE IS THE KEYBOARD, and it is the gate this shell already had.
 * `installedController` is the one autoplayer slot: a mod fills it only by
 * returning a controller from `controller()`, and the Borg returns one only when
 * its own `borg.autoplay` flag is on. So "is an autoplayer playing" needs no second
 * flag and no mod id written into the engine - which is the same argument that
 * settled `mods/registry.json` carrying no facts about a mod. Upstream's gate is
 * the same sentence: `reincarnate_borg` is called from inside `borg_think`, so the
 * borg running IS the condition.
 *
 * WHY THE MOD CANNOT ASK FOR THIS ITSELF. `AgentCommand` is `PlayerCommand` - an
 * in-game turn command - and birth has no representation in that set. There is no
 * value a controller could return that means "roll me a new character", so the
 * decision has to be taken here, on the host side of the seam.
 *
 * NO NEW SAVE FILE AND NO NEW SLOT. `setActiveId` is not touched and `markDead` is
 * not called, so the reborn character autosaves over the same slot the dead one
 * used - which is what makes this a session that kept going rather than a sequence
 * of games. The slot's roster row updates on the next save (metaFromState reads
 * the live race, class and name).
 *
 * Returns false when nothing was reincarnated, and the caller runs the ordinary
 * death flow. A throw is contained the same way a mod fault is: the character is
 * dead either way, and a broken respawn must still reach the tombstone.
 */
function reincarnateAutoplayer(): boolean {
  const holder = installedController;
  if (!holder) return false;
  const diedFrom = state.actor.player.diedFrom || "the dungeon";
  const diedAt = state.chunk.depth;
  const diedAtLevel = state.actor.player.lev;
  let reborn;
  try {
    reborn = game.reincarnate({
      /* Mark the savefile (borg-reincarnate.c:587-589). player_generate zeroed the
       * field, so every character this loop produces is marked again. */
      noscore: NOSCORE.BORG,
      /* create_random_name (borg-reincarnate.c:499-501) through this port's own
       * name generator rather than a second copy of upstream's syllable tables. */
      fullName: playerRandomName(state.rng, tolkienNameProbs()),
    });
  } catch (err) {
    log.error(`mod:${holder.id}`, `reincarnation failed:`, err);
    reportModFault(
      holder.id,
      `it could not start a new character after this one died, so the run ends here: ${faultMessage(err)}`,
    );
    return false;
  }
  playerName = state.actor.player.fullName;
  /* borg_note("# Respawning") (borg-reincarnate.c:566), with what happened to the
   * character that just died - the log of a screensaver run is the only record of
   * it, and "died" with no depth or level says nothing worth reading later. */
  log.info(
    `mod:${holder.id}`,
    `died to ${diedFrom} at level ${diedAtLevel} on depth ${diedAt}; respawning as a ${reborn.raceName} ${reborn.className}`,
  );
  say(`You awaken as a ${reborn.raceName} ${reborn.className}.`);
  message = "";
  /* The turn's tail, the parts of it that still apply: the reborn character is on
   * a fresh town level, so there is no floor pile to announce and no shop to walk
   * into. Forced, because a respawn is a save point in the same way a level change
   * is and the throttle would drop it. */
  autosave(true);
  render();
  return true;
}

function continueAdvance(
  status: LoopStatus,
  preLen: number,
  beforeX: number,
  beforeY: number,
  seeFloorReq: boolean,
): void {
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
    /* AN AUTOPLAYER'S DEATH IS NOT A PLAYER'S DEATH.
     *
     * While a mod holds the keyboard, a death starts the next character in place
     * instead of ending the session - upstream's reincarnate_borg, which is what
     * turns the Borg into something that plays itself over and over rather than
     * once. It is FIRST in this branch on purpose: everything below is the human
     * death flow (a tombstone, a dropped save slot, a score entry, a menu), and
     * none of it may run for a character that is about to be alive again.
     *
     * A HUMAN'S DEATH CANNOT REACH IT. `installedController` is null unless a mod
     * returned a controller from `controller()`, which the Borg does only when its
     * own `borg.autoplay` flag is on. With nobody at the wheel this is a single
     * null check that falls straight through to the flow that was here before. */
    if (reincarnateAutoplayer()) return;
    dead = true;
    // Death is terminal (decision 16): the character's slot becomes a
    // tombstone - its save bytes are dropped so it can never be resumed, but
    // its record stays in the roster for the memorial. Clearing the active id
    // sends the next boot to the picker (or birth if no one else is left).
    /* THE SLOT THIS PAGE IS ATTACHED TO, and nothing else may be read here. This
     * is the one path that DESTROYS bytes: markDead drops the save and writes a
     * death into a ledger that outlives the tombstone. Reading the shared key
     * would mean a character dying in this tab could tombstone whichever
     * character another tab most recently resumed - a real hero, still alive over
     * there, with a memorial to prove otherwise. */
    const activeId = attachedSlot();
    // close_game's dead branch (ui-game.c:1152-1158): the tombstone IS the
    // port's dead-player save (decision 16 drops the resumable bytes), so a
    // failed metadata write loses the memorial and gets upstream's message.
    if (activeId && !markDead(activeId)) say("death save failed!");
    detachSlot();
    setActiveId(null);
    // death_knowledge (player-util.c L278-317), in full: retire a winner in a
    // good state, reveal the gear and the home's stock, then unmask the
    // ARTIFACT_UNKNOWN history entries so a "Missed X" find the player never
    // identified shows its real name. Runs before the memorial and before
    // enterScore below, exactly as the C orders it (enter_score is L315, and
    // the shell owns the store). 4.2.6 writes no HIST_PLAYER_DEATH entry
    // (verified: zero uses in reference/src).
    deathKnowledge(state.actor.player, {
      runeEnv: state.runeEnv,
      flavor: game.flavor!,
      flavorDeps: state.flavorAwareDeps!,
      gear: state.gear.store.values(),
      homeStock:
        state.stores?.find((s) => s.feat === FEAT.HOME)?.stock ?? [],
      setDepth: (d) => {
        state.chunk.depth = d;
      },
    });
    message = "You have died. (Press 'N' or refresh to start a new game.)";
    // Enter the character on the high-score table (enter_score). died_from is
    // the real killer recorded on the player at take-hit (12.5/WP-10); it falls
    // back only if the engine never set it.
    const player = state.actor.player;
    const diedFrom = player.diedFrom || "the dungeon";
    // enter_score gating (score.c L246-292): a cheater (any OP_SCORE option
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
        /* score.c:268: the Borg gets its own line. The bit is set by the borg
         * mod's activation gate (cmd-misc.c:140) when that mod is mounted. */
        borg: (player.noscore & NOSCORE.BORG) !== 0,
        totalWinner: player.totalWinner,
      },
    );
    /* score.c:257/264/269/274/277: each rejection tells the player which rule
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
  // Warm the ground around the player's new position ahead of it scrolling
  // into view, so the loose-pack engine's per-asset cache is already a few
  // frames old by the time a newly-approached tile (a staircase, most
  // noticeably - #290) is actually drawn, instead of racing its own load.
  if (moved) precacheTilesNear(state.actor.grid.x, state.actor.grid.y, PRECACHE_RADIUS);
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
/** One row of cmds_all: what it is called, where it lives, and what runs it. */
interface CommandRow {
  /** Stable key for its declarative registry row; the action stays private. */
  id?: string;
  /** cmd_info.desc (ui-game.c:116-232), verbatim. */
  desc: string;
  /** Which cmds_all list this row is in; null = a PORT ADDITION that is
   * not a cmd_info row upstream, so the ENTER browser must not list it. */
  cat: string | null;
  o?: string | null;
  r?: string | null;
  /** A control key, for rows the ctrl branch of the dispatcher owns. Label
   * only: keypress_to_readable renders KTRL('A') as "^A". */
  ctrl?: string;
  act: () => void;
  /** cmd_info.nested_name: this row opens a nested list instead of running. */
  nested?: () => CommandCategory[];
}

/**
 * cmds_all (ui-game.c:329-353) for this shell: every command the port
 * implements, in upstream's own table order, each row carrying the exact
 * cmd_info.desc, the cmds_all list it belongs to, and its key in each keyset.
 *
 * `r: null` means the command has no plain roguelike key (it moves to a control
 * key, handled in the ctrl branch of the keydown handler), so that letter stays
 * free for roguelike movement; `o: null` means original has no binding (a
 * roguelike-only key). This mirrors cmd_lookup exactly - no key differs.
 *
 * MODULE LEVEL, not a const inside the keydown handler where it used to live.
 * Two things read it now: that handler, and the ENTER command browser
 * (runCommandBrowser), which upstream reaches every nested command category
 * through and which could not see a table rebuilt per keypress inside a
 * closure. It is built by a function rather than written as a top-level array
 * because every `act` closes over module state that is not initialised yet at
 * module-evaluation time.
 */
function buildCommandTable(): CommandRow[] {
  const COMMANDS: CommandRow[] = [
    // Item commands (cmd_item, ui-game.c:118-133).
    { desc: "Inscribe an object", cat: "Items", o: "{", act: () => void openModal(inscribeItem) },
    { desc: "Uninscribe an object", cat: "Items", o: "}", act: () => void openModal(uninscribeItem) },
    // do_cmd_wield's item_tester is obj_can_wear = wield_slot(obj) >= 0
    // (cmd-obj.c L284, obj-util.c L810) - the slot lookup, not the tval set.
    { desc: "Wear/wield an item", cat: "Items", o: "w", act: () => void openModal(() => useItem("wield", (t) => objCanWear(state, t), "Wear or wield which item?", "You have nothing to wear or wield.", { inven: true, floor: true, quiver: true })) },
    { desc: "Take off/unwield an item", cat: "Items", o: "t", r: "T", act: () => void openModal(takeOffItem) },
    { desc: "Examine an item", cat: "Items", o: "I", act: () => void openModal(() => inspectItem()) },
    { desc: "Drop an item", cat: "Items", o: "d", act: () => void openModal(dropItem) },
    { desc: "Fire your missile weapon", cat: "Items", o: "f", r: "t", act: () => void openModal(fireCmd) },
    { desc: "Use a staff", cat: "Items", o: "u", r: "Z", act: () => void openModal(() => useItem("use-staff", (t) => tvalIsStaff(t.tval), "Use which staff? ", "You have no staves to use.", { inven: true, floor: true })) },
    { desc: "Aim a wand", cat: "Items", o: "a", r: "z", act: () => void openModal(() => useItem("aim-wand", (t) => tvalIsWand(t.tval), "Aim which wand? ", "You have no wands to aim.", { inven: true, floor: true })) },
    { desc: "Zap a rod", cat: "Items", o: "z", r: "a", act: () => void openModal(() => useItem("zap-rod", (t) => tvalIsRod(t.tval), "Zap which rod? ", "You have no rods to zap.", { inven: true, floor: true })) },
    { desc: "Activate an object", cat: "Items", o: "A", act: () => void openModal(activateItem) },
    { desc: "Eat some food", cat: "Items", o: "E", act: () => void openModal(() => useItem("eat", (t) => tvalIsEdible(t.tval), "Eat which food? ", "You have no food to eat.", { inven: true, floor: true })) },
    { desc: "Quaff a potion", cat: "Items", o: "q", act: () => void openModal(() => useItem("quaff", (t) => tvalIsPotion(t.tval), "Quaff which potion? ", "You have no potions from which to quaff.", { inven: true, floor: true })) },
    { desc: "Read a scroll", cat: "Items", o: "r", act: () => void openModal(() => useItem("read", (t) => tvalIsScroll(t.tval), "Read which scroll? ", "You have no scrolls to read.", { inven: true, floor: true })) },
    // player_can_refuel_prereq gates 'F' (ui-game.c:132) before CMD_REFILL.
    { desc: "Fuel your light source", cat: "Items", o: "F", act: () => { if (playerCanRefuelPrereq()) void openModal(refuelItem); else render(); } },
    { desc: "Use an item", cat: "Items", o: "U", r: "X", act: () => void openModal(useGenericCmd) },
    // General actions (cmd_action, ui-game.c:141-153).
    { desc: "Disarm a trap or chest", cat: "Action commands", o: "D", act: () => void openModal(disarmCmd) },
    { desc: "Rest for a while", cat: "Action commands", o: "R", act: () => void openModal(restCmd) },
    { desc: "Look around", cat: "Action commands", o: "l", r: "x", act: () => void openModal(async () => { if (await runTargetLoop(TARGET.LOOK, true)) say("Target Selected."); }) },
    // Swap weapon: the original keyset maps 'x' to the pref.prf "w0" macro
    // (wield the item inscribed @0). The roguelike keyset uses 'x' for Look
    // (the look row above), so this binds 'x' only in the original keyset.
    { desc: "Swap weapon", cat: null, o: "x", r: null, act: () => void openModal(swapWeaponCmd) },
    { desc: "Target monster or location", cat: "Action commands", o: "*", act: () => void openModal(async () => { if (await runTargetLoop(TARGET.KILL, true)) say("Target Selected."); else say("Target Aborted."); }) },
    { desc: "Target closest monster", cat: "Action commands", o: "'", act: () => { targetSetClosest(state, TARGET.KILL); render(); } },
    // Tunnel: 'T' in the original keyset; the roguelike keyset uses ^T (handled
    // above) since roguelike 'T' is Take off.
    { desc: "Dig a tunnel", cat: "Action commands", o: "T", r: null, act: () => void openModal(tunnelCmd) },
    { desc: "Go up staircase", cat: "Action commands", o: "<", act: () => { commandBuffer.push({ code: "ascend" }); advance(); } },
    { desc: "Go down staircase", cat: "Action commands", o: ">", act: () => { commandBuffer.push({ code: "descend" }); advance(); } },
    { desc: "Open a door or a chest", cat: "Action commands", o: "o", act: () => void openModal(openCmd) },
    { desc: "Close a door", cat: "Action commands", o: "c", act: () => void openModal(closeCmd) },
    { desc: "Fire at nearest target", cat: "Action commands", o: "h", r: "Tab", act: () => fireAtNearestCmd() },
    { desc: "Throw an item", cat: "Action commands", o: "v", act: () => void openModal(throwCmd) },
    { desc: "Walk into a trap", cat: "Action commands", o: "W", r: "-", act: () => void openModal(jumpCmd) },
    // Item management (cmd_item_manage, ui-game.c:161-165).
    /* do_cmd_equip / do_cmd_inven / do_cmd_quiver open with an emptiness
     * check that says why rather than showing an empty screen
     * (ui-knowledge.c:3932-3934, :3978-3980, :4027-4029). */
    /* do_cmd_equip / do_cmd_inven / do_cmd_quiver: each opens its listing as a
     * PICKER into context_menu_object, not as a read-only screen. */
    { desc: "Display equipment listing", cat: "Manage items", o: "e", act: () => void openModal(() => doCmdItemListing("equip")) },
    { desc: "Display inventory listing", cat: "Manage items", o: "i", act: () => void openModal(() => doCmdItemListing("inven")) },
    { desc: "Display quiver listing", cat: "Manage items", o: "|", act: () => void openModal(() => doCmdItemListing("quiver")) },
    { desc: "Pick up objects", cat: "Manage items", o: "g", act: () => void openModal(pickupCmd) },
    // Ignore: 'k' in the original keyset; roguelike uses ^D (handled above) so
    // roguelike 'k' stays free for movement.
    { desc: "Ignore an item", cat: "Manage items", o: "k", r: null, act: () => void openModal(ignoreItemCmd) },
    // Information commands (cmd_info, ui-game.c:173-185).
    { desc: "Browse a book", cat: "Information", o: "b", r: "P", act: () => void openModal(browseCmd) },
    { desc: "Gain new spells", cat: "Information", o: "G", act: () => void openModal(studySpell) },
    { desc: "View abilities", cat: "Information", o: "S", act: () => void openModal(showAbilitiesScreen) },
    { desc: "Cast a spell", cat: "Information", o: "m", act: () => void openModal(castSpell) },
    { desc: "Full dungeon map", cat: "Information", o: "M", act: () => void openModal(showLevelMapForShell) },
    { desc: "Toggle ignoring of items", cat: "Information", o: "K", r: "O", act: () => { state.ignore.unignoring = !state.ignore.unignoring; void openModal(() => applyIgnoreDrop()); } },
    { desc: "Display visible item list", cat: "Information", o: "]", act: () => void openModal(() => showTextScreen(term, objectListScreen(state))) },
    { desc: "Display visible monster list", cat: "Information", o: "[", act: () => void openModal(() => showMonsterList(term, state)) },
    { desc: "Locate player on map", cat: "Information", o: "L", r: "W", act: () => void openModal(() => runLocate()) },
    { desc: "Identify symbol", cat: "Information", o: "/", act: () => void openModal(querySymbolCmd) },
    { desc: "Character description", cat: "Information", o: "C", act: () => void openModal(() => showCharacterSheet(term, state, playerName, charSheetOpts())) },
    { desc: "Check knowledge", cat: "Information", o: "~", act: () => void openModal(openKnowledgeMenu) },
    // Utility/assorted (cmd_util, ui-game.c:196-203).
    { desc: "Interact with options", cat: "Utility", o: "=", act: () => { void openModal(() => runOptionsMenu(term, state, openIgnoreSetup, sidebarModeMenu, prefsUiCtx(), openModOptions)).then(() => autosave(true)); } },
    { desc: "Retire character and quit", cat: "Utility", o: "Q", act: () => void openModal(retireCmd) },
    { desc: "Save \"screen dump\"", cat: "Utility", o: ")", act: () => screenDumpCmd() },
    // Hidden commands (cmd_hidden, ui-game.c:211-223).
    { desc: "Take notes", cat: "Hidden", o: ":", act: () => void openModal(noteCmd) },
    { desc: "Version info", cat: "Hidden", o: "V", act: () => versionCmd() },
    { desc: "Load a single pref line", cat: "Hidden", o: '"', act: () => void openModal(prefLineCmd) },
    { desc: "Alter a grid", cat: "Hidden", o: "+", act: () => void openModal(alterCmd) },
    { desc: "Steal from a monster", cat: "Hidden", o: "s", act: () => void openModal(stealCmd) },
    { desc: "Walk", cat: "Hidden", o: ";", act: () => void openModal(walkStepCmd) },
    // Run/stand: the two keys swap between keysets (CMD_RUN {'.',','} and
    // CMD_HOLD {',','.'}), so '.' runs and ',' stands in the original keyset,
    // and the reverse in the roguelike keyset.
    { desc: "Start running", cat: "Hidden", o: ".", r: ",", act: () => void openModal(runDirCmd) },
    { desc: "Stand still", cat: "Hidden", o: ",", r: ".", act: () => holdCmd() },
    // Numpad 5 is the stay-still key in both keysets (do_cmd_hold): standing
    // still on a shop door re-enters the store (EVENT_ENTER_STORE,
    // cmd-cave.c:1592), and it is the canonical "wait one turn" command.
    { desc: "Stand still (numpad)", cat: null, o: "5", r: "5", act: () => holdCmd() },
    { desc: "Start exploring", cat: "Hidden", o: "p", act: () => exploreCmd() },
    // Repeat: 'n' in the original keyset; roguelike uses ^V (handled above).
    { desc: "Repeat previous command", cat: "Hidden", o: "n", r: null, act: () => void repeatLastCommand() },
    // Center map: roguelike '@' (original uses ^L, handled above).
    { desc: "Center map", cat: "Hidden", o: null, r: "@", act: () => centerMapCmd() },
    /* cmd_hidden's last row (ui-game.c:225): a PLACEHOLDER whose cmd and hook
     * are both NULL and whose nested_name is "Debug". Its key is ^A in both
     * keysets - handled in the ctrl branch, which is why `o`/`r` are null - and
     * selecting it in the browser opens the nine debug categories, which is the
     * only place they are reachable at all. */
    {
      desc: "Debug mode commands",
      cat: "Hidden",
      ctrl: "A",
      o: null,
      r: null,
      act: () => void openModal(() => runWizardDebugMenu(wizardCtx())),
      nested: debugCommandCategories,
    },
    /* "Borg commands" at KTRL('Z') (cmd_hidden, ui-game.c:227, #ifdef
     * ALLOW_BORG). No `nested`: upstream opens a menu of borg sub-commands here,
     * which this port does not have - the mod is a single autoplayer, not a
     * debug toolbox, so the one thing this key does is the warn-confirm-and-play
     * gate (#125), or hand the keyboard back if the mod already has it. */
    {
      desc: "Borg commands",
      cat: "Hidden",
      ctrl: "Z",
      o: null,
      r: null,
      act: () => tryBorgCommand(),
    },
  ];
  return COMMANDS;
}

/**
 * key_confirm_command (ui-input.c:1923) at ui-game.c:544-547's exact position:
 * the key has resolved to a real command, and the WORN equipment's `^*` /
 * `^<key>` inscriptions get to veto it before the command runs. Refusing drops
 * the key entirely - upstream sets cmd to NULL, so nothing is queued and no
 * turn passes.
 *
 * The command runs AFTER the confirm modal closes, not inside it: `act` opens
 * its own modal, and running it nested meant this one's close repainted over
 * it.
 *
 * One copy, called from both routes into a command - the keypress and the ENTER
 * browser. Upstream has one too: textui_action_menu_choose returns a cmd_info
 * and its caller puts it through the same gate a keypress goes through, so a
 * second copy here would be a second place to forget the veto.
 */
function runConfirmedCommand(key: string | null, act: () => void): void {
  const owed = key === null ? 0 : keyConfirmCount(state.actor.player, state.gear, key);
  if (owed > 0) {
    let allowed = false;
    void openModal(async () => {
      for (let i = 0; i < owed; i++) {
        if (!(await confirmYesNo(KEY_CONFIRM_PROMPT))) return;
      }
      allowed = true;
    }).then(() => {
      if (allowed) act();
    });
    return;
  }
  act();
}

/**
 * cmds_all grouped into its lists for the ENTER browser, with each row's key in
 * the keyset the player is actually using (cmd_sub_entry reads
 * `commands[oid].key[mode]`, ui-context.c:1132-1135). Built per open so a
 * keyset change between openings is picked up.
 */
function commandCategories(): CommandCategory[] {
  const roguelike = state.options?.get("rogue_like_commands") ?? false;
  return groupCommands(
    commandTable(),
    (row) => (row.ctrl !== undefined ? `^${row.ctrl}` : keyForKeyset(row, roguelike)),
    (row) => row.act,
    (row) => row.nested,
  );
}

/**
 * cmd_debug + the nine cmd_debug_* lists (ui-game.c:341-351) as the browser's
 * nested tier, built from wizard.ts's DEBUG_MENU - the frozen, exact copy of
 * upstream's own tables - rather than a second transcription of them.
 *
 * Each command goes through the SAME gate ^A does, because it dispatches
 * through runWizardDebugCommand: a row reached from the menu must not be a way
 * around player_can_debug_prereq and the NOSCORE_DEBUG marking (ui-game.c:595).
 */
function debugCommandCategories(): CommandCategory[] {
  return DEBUG_MENU.map((cat) => ({
    name: cat.title,
    commands: cat.commands.map((cmd) => ({
      desc: cmd.label,
      key: cmd.letter,
      run: () => void openModal(() => runWizardDebugCommand(wizardCtx(), cmd.action)),
    })),
  }));
}

let commandTableCache: CommandRow[] | null = null;

/** The one cmds_all instance. Built on first use, not at module evaluation:
 * every `act` closes over module state that is not initialised until boot. */
function commandTable(): CommandRow[] {
  commandTableCache ??= buildCommandTable();
  return transformKeypressCommandTable(commandTableCache, (id, rows) => menuRegistry.transform(id, rows));
}

function logKeypress(ev: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): void {
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

setKeymapResolver(
  (input) => {
    const key = input.key;
    // isBindableTriggerKey (keymap-store.ts) is the SAME predicate the
    // keymap-editor's trigger capture uses: a single character, Enter, or a
    // plain F-key. Gating on it here rather than on `key.key.length === 1`
    // is what lets a keymap actually bound to Enter/F1-F12 fire (#62, #63) -
    // upstream's own dispatch (textui_get_command, ui-input.c:1882) runs
    // keymap_find for every key including KC_ENTER, unconditionally, before
    // anything downstream gets a chance to treat Enter as "open the command
    // menu" (ui-game.c:533-538 only reaches that fallback when no keymap
    // claimed the key).
    if (!key || key.modifiers.ctrl || key.modifiers.alt || key.modifiers.meta || !isBindableTriggerKey(key.key)) {
      return null;
    }
    const roguelike = state.options?.get("rogue_like_commands") ?? false;
    // These root affordances deliberately precede upstream keymaps.
    if (key.key === "?" || (key.key === "N" && !roguelike) || dead) return null;
    const action = keymapFind(keymapModeFor(roguelike), key.key);
    return action
      ? decodeActionTokens(action).map((mapped) => ({
        key: { key: mapped, modifiers: { ctrl: false, shift: false, alt: false, meta: false }, repeat: false },
      }))
      : null;
  },
  {
    // These are the three gates that occurred before keymap lookup when it
    // lived in the root listener. The active modal, score page, or interrupt
    // loop must receive the literal key instead of a queued player macro.
    enabled: () => !scoresOpen && modalDepth === 0 && !pumping,
    onExpanded: (input) => {
      const key = input.key;
      if (!key) return;
      logKeypress({
        key: key.key,
        ctrlKey: key.modifiers.ctrl,
        shiftKey: key.modifiers.shift,
        altKey: key.modifiers.alt,
        metaKey: key.modifiers.meta,
      });
    },
  },
);

/**
 * Ctrl-key command aliases (cmd_action / cmd_util faithful bindings that use a
 * control modifier). `key` is the plain letter as it would follow a real
 * Ctrl chord (e.g. "s" for both an actual Ctrl-S and a caret-then-s fallback
 * keypress); `roguelike` is the live rogue_like_commands option. Returns
 * whether a binding fired, so a caller knows whether to swallow the key.
 *
 * Shared by two callers: a real `ev.ctrlKey` chord, and the caret (^) prefix
 * fallback (#3) below, which resolves to the exact same commands - upstream's
 * documented "type a caret, then the key" route exists specifically because a
 * host (a browser tab) can swallow the real chord before any page script
 * sees it, so the fallback has to reach every command a real chord reaches.
 */
function dispatchControlKey(key: string, roguelike: boolean): boolean {
  /* The keypress table's one control-bound row is declarative too. Its action
   * remains private, but a registry:menu rewrite of `controlKey` must change
   * the real key route as well as the label the ENTER browser displays. This
   * is before the table-external control aliases below; with no mod it is the
   * same ^A debug branch that used to live there. */
  const tableControl = commandTable().find(
    (command) => command.ctrl?.toLowerCase() === key.toLowerCase(),
  );
  if (tableControl) {
    tableControl.act();
    return true;
  }
  // Dig a tunnel (^T): the roguelike-keyset alias of Tunnel, whose original
  // key is the plain 'T' (ui-game.c:146 { 'T', KTRL('T') }). Roguelike 'T' is
  // Take off, so tunnel moves to ^T there; in the original keyset ^T is unbound.
  if (roguelike && (key === "t" || key === "T")) {
    void openModal(tunnelCmd);
    return true;
  }
  // Save (^S, cmd_util "Save and don't quit"): same autosave 'S' triggers.
  if (key === "s" || key === "S") {
    autosave(true);
    message = "Saving game... done.";
    render();
    return true;
  }
  // Toggle wizard mode (^W, do_cmd_wizard / ui-game.c L222). First entry
  // confirms and marks player.noscore |= NOSCORE_WIZARD (15.1 / cmd-misc.c).
  if (key === "w" || key === "W") {
    void openModal(async () => {
      wizardMode = await runWizardToggle(wizardCtx(), wizardMode);
      /* player->wizard for take_hit's cheat-death gate (W2-009). */
      state.wizard = wizardMode;
    });
    return true;
  }
  // Repeat level feeling (^F, do_cmd_feeling / ui-game.c:186): a free action.
  if (key === "f" || key === "F") {
    feelingCmd();
    return true;
  }
  // Show previous message (^O, do_cmd_message_one / ui-game.c:187): free.
  if (key === "o" || key === "O") {
    showPrevMessageCmd();
    return true;
  }
  // Do autopickup (^G, CMD_AUTOPICKUP / ui-game.c:224): pick up everything on
  // the grid that needs no action - gold, plus =g / pickup_always items - a
  // single key active in both keysets. Distinct from 'g' (interactive pickup);
  // the core doAutopickup path is registered as the "autopickup" command.
  if (key === "g" || key === "G") {
    commandBuffer.push({ code: "autopickup" });
    advance();
    return true;
  }
  // Repeat previous command (^V): the roguelike-keyset alias of Repeat, whose
  // original key is the plain 'n' (ui-game.c:223 { 'n', KTRL('V') }). Roguelike
  // 'n' is a movement key, so repeat moves to ^V; original-keyset ^V is unbound.
  if (roguelike && (key === "v" || key === "V")) {
    void repeatLastCommand();
    return true;
  }
  // Save and quit (^X, textui_quit / cmd_util:199). The browser reserves some
  // Ctrl combos, but the game takes ownership so its bindings never differ.
  if (key === "x" || key === "X") {
    saveQuitCmd();
    return true;
  }
  // Redraw the screen (^R, do_cmd_redraw / cmd_util:201).
  if (key === "r" || key === "R") {
    redrawCmd();
    return true;
  }
  // Center map on the player (^L original keyset, do_cmd_center_map /
  // cmd_hidden:221). In the roguelike keyset ^L is alter-east, so ^L centers
  // only in the original keyset; the roguelike center-map key is '@' (below).
  if (!roguelike && (key === "l" || key === "L")) {
    centerMapCmd();
    return true;
  }
  // Ignore an item (^D): the roguelike-keyset alias of Ignore, whose original
  // key is the plain 'k' (ui-game.c:165 { 'k', KTRL('D') }). Roguelike 'k' is a
  // movement key, so ignore moves to ^D; in the original keyset ^D is unbound.
  if (roguelike && (key === "d" || key === "D")) {
    void openModal(ignoreItemCmd);
    return true;
  }
  // The roguelike keyset's caret+direction alter-keys (#4, r_comm.txt:
  // ^b/^h/^j/^k/^l/^n/^u/^y -> alter-direction): the movement.rst fallback
  // ("Preceding this command with CTRL will cause you to alter... in the
  // appropriate direction") for every hjkl/yubn letter DIRS_ROGUELIKE binds to
  // a direction. A real direction is known from the letter itself, so this
  // pushes straight to the core 'alter' action instead of prompting like the
  // '+' key's alterCmd does.
  if (roguelike) {
    const dir = DIRS_ROGUELIKE[key.toLowerCase()];
    if (dir !== undefined) {
      commandBuffer.push({ code: "alter", dir });
      advance();
      return true;
    }
  }
  return false;
}

inputEvents.addEventListener("keydown", (ev) => {
  logKeypress(ev);
  // Caret (^) prefix fallback (#3): the flag armed below survives to color
  // exactly the next keydown and no further - captured and cleared here, at
  // the very top, so a modal, an interrupt, or any other early return between
  // the arming keypress and this one can never leave it stuck on for a later,
  // unrelated key.
  const wasCaretPending = caretPending;
  caretPending = false;
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
      showTextScreen(term, messageHistoryScreen(msglog)),
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
    void openModal(() => runHelp(term, rogueLikeKeys()));
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
  // Caret (^) prefix fallback (#3): the previous keydown armed this one.
  // command.rst: "It is often possible to specify control-keys without
  // actually pressing the control key, by typing a caret followed by the
  // key" - the documented route for a host that swallows the real chord (a
  // browser tab intercepts Ctrl-W outright; no preventDefault changes that).
  // A caret followed by something with no control meaning has, per that same
  // page, "no useful way" to be an underlying command, so it is simply
  // dropped rather than falling through to plain-key handling below.
  if (wasCaretPending) {
    if (!ev.altKey && !ev.metaKey && ev.key.length === 1 && ev.key !== "^") {
      if (dispatchControlKey(ev.key, roguelike)) ev.preventDefault();
    }
    return;
  }
  // Player keymaps are resolved by input-door before this root screen (and
  // before any future mod input consumer); queued expansion bypasses that
  // resolver so an action never recursively re-keymaps itself.
  if (!ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.key === "^") {
    ev.preventDefault();
    caretPending = true;
    return;
  }
  // Ctrl-key command aliases (cmd_action / cmd_util faithful bindings that use a
  // control modifier). Checked before the modifier-free block below.
  if (ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    if (dispatchControlKey(ev.key, roguelike)) ev.preventDefault();
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
    const COMMANDS = commandTable();
    for (const c of COMMANDS) {
      const key = roguelike ? (c.r === undefined ? c.o : c.r) : c.o;
      if (key != null && ev.key === key) {
        ev.preventDefault();
        /* key_confirm_command (ui-input.c:1923) at ui-game.c:544-547's exact
         * position: the key has resolved to a real command, and the WORN
         * equipment's `^*` / `^<key>` inscriptions get to veto it before the
         * command runs. Refusing drops the key entirely - upstream sets cmd to
         * NULL, so nothing is queued and no turn passes.
         *
         * The command runs AFTER this modal closes, not inside it: c.act opens
         * its own modal, and running it nested meant this one's close repainted
         * over it. */
        runConfirmedCommand(key, c.act);
        return;
      }
    }
    /* ENTER opens the command browser (textui_action_menu_choose,
     * ui-context.c:1268), which is how upstream lets a player who does not know
     * the keys reach any command, and the ONLY route it offers to a nested
     * category. The chosen command goes through runConfirmedCommand, so an
     * inscription that vetoes a key vetoes the menu row too - upstream
     * dispatches the returned cmd_info down the same path a keypress takes. */
    if (ev.key === "Enter") {
      ev.preventDefault();
      void openModal(() => chooseCommand(term, commandCategories(), render, roguelike)).then((chosen) => {
        if (chosen) runConfirmedCommand(chosen.key, chosen.run);
      });
      return;
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
const regionPointerOwners = new WeakMap<PointerEvent, NonNullable<ReturnType<typeof regionInputAt>>>();
canvas.addEventListener("pointerdown", (ev) => {
  if (scoresOpen || dead || modalDepth > 0) return; // a modal owns input
  const cell = term.cellAt(ev.clientX, ev.clientY);
  if (!cell) return;
  /* A region owns the cells it DREW. A mod's panel over the map is the mod's,
   * and the tap stops here rather than becoming a step through it (#276). */
  const owner = regionInputAt(cell.col, cell.row);
  if (owner) {
    regionPointerOwners.set(ev, owner);
    ev.preventDefault();
    owner.spec.input?.({ ...owner.local, kind: "tap" });
    return;
  }
  // ui-context.c L1002: "if (!OPT(player, mouse_movement)) return;" gates
  // click-to-move specifically (not the context menu below, which upstream
  // never gates on this option). Defaults on (normal: true).
  if (!(state.options?.get("mouse_movement") ?? true)) return;
  const { col, row } = cell;
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
// Touch: a long-press (pointerdown held ~450ms, cancelled by the pressing
// finger's own move or lift) opens the same menu at the pressed cell, since a
// phone has no right-click. A second finger is ignored outright - it neither
// cancels the press nor starts one of its own (#277).
canvas.addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  if (scoresOpen || dead || modalDepth > 0) return;
  const cell = term.cellAt(ev.clientX, ev.clientY);
  if (!cell) return;
  const owner = regionInputAt(cell.col, cell.row);
  if (owner) {
    owner.spec.input?.({ ...owner.local, kind: "context" });
    return;
  }
  const grid = contextClickGrid(ev.clientX, ev.clientY);
  if (!grid) return;
  void openModal(() => dispatchContextClick(grid));
});

let longPressTimer: ReturnType<typeof setTimeout> | null = null;
type LongPressTarget =
  | {
      readonly kind: "core-grid";
      readonly pointerId: number;
      readonly cell: { readonly col: number; readonly row: number };
      readonly grid: Loc;
    }
  | {
      readonly kind: "region-cell";
      readonly pointerId: number;
      readonly cell: { readonly col: number; readonly row: number };
      readonly owner: NonNullable<ReturnType<typeof regionInputAt>>;
    };
let longPressTarget: LongPressTarget | null = null;
function cancelLongPress(): void {
  if (longPressTimer !== null) clearTimeout(longPressTimer);
  longPressTimer = null;
  longPressTarget = null;
}
/* A press belongs to ONE finger, so the lift that ends it has to be that
 * finger's. Wired bare, `cancelLongPress` cancelled on any pointer's lift, and
 * a second finger's touch overwrote the target so the pressing finger's own
 * drag was then compared against somebody else's cell (#277). */
function cancelLongPressFrom(ev: PointerEvent): void {
  if (longPressTarget?.pointerId === ev.pointerId) cancelLongPress();
}
canvas.addEventListener("pointerdown", (ev) => {
  if (scoresOpen || dead || modalDepth > 0 || ev.pointerType !== "touch") return;
  if (longPressTarget) return; // a press is already running, and it is not this finger's
  const cell = term.cellAt(ev.clientX, ev.clientY);
  if (!cell) return;
  /* The tap listener above sees this same PointerEvent first. Retain its
   * answer so a handler that releases itself after throwing cannot make this
   * very long-press fall through to the dungeon in the later listener. */
  const owner = regionPointerOwners.get(ev) ?? regionInputAt(cell.col, cell.row);
  if (owner) {
    longPressTarget = { kind: "region-cell", pointerId: ev.pointerId, cell, owner };
  } else {
    const grid = contextClickGrid(ev.clientX, ev.clientY);
    if (!grid) return;
    longPressTarget = { kind: "core-grid", pointerId: ev.pointerId, cell, grid };
  }
  longPressTimer = setTimeout(() => {
    const target = longPressTarget;
    cancelLongPress();
    if (!target) return;
    if (target.kind === "region-cell") {
      target.owner.spec.input?.({ ...target.owner.local, kind: "context" });
      return;
    }
    void openModal(() => dispatchContextClick(target.grid));
  }, 450);
});
canvas.addEventListener("pointerup", cancelLongPressFrom);
canvas.addEventListener("pointercancel", cancelLongPressFrom);
canvas.addEventListener("pointermove", (ev) => {
  if (!longPressTarget || longPressTarget.pointerId !== ev.pointerId) return;
  if (longPressTarget.kind === "core-grid") {
    const grid = contextClickGrid(ev.clientX, ev.clientY);
    if (!grid || grid.x !== longPressTarget.grid.x || grid.y !== longPressTarget.grid.y) {
      cancelLongPress();
    }
    return;
  }
  const cell = term.cellAt(ev.clientX, ev.clientY);
  if (!cell || cell.col !== longPressTarget.cell.col || cell.row !== longPressTarget.cell.row) {
    cancelLongPress();
  }
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
    ["Inv", () => { void openModal(() => showTextScreen(term, inventoryScreen(state))); }],
    ["Objs", () => { void openModal(() => showTextScreen(term, objectListScreen(state))); }],
    ["Map", () => { void openModal(showLevelMapForShell); }],
    ["Locate", () => { void openModal(() => runLocate()); }],
    ["Insp", () => { void openModal(() => inspectItem()); }],
    ["Insc", () => { void openModal(() => inscribeItem()); }],
    ["Fuel", () => { void openModal(() => refuelItem()); }],
    ["Char", () => { void openModal(() => showCharacterSheet(term, state, playerName, charSheetOpts())); }],
    ["Hist", () => { void openModal(() => showTextScreen(term, playerHistoryScreen(state))); }],
    ["Ignore", () => { void openModal(() => openIgnoreSetup()); }],
    ["Opts", () => { void openModal(() => runOptionsMenu(term, state, openIgnoreSetup, sidebarModeMenu, prefsUiCtx(), openModOptions)).then(() => autosave(true)); }],
    ["Help", () => { void openModal(() => runHelp(term, rogueLikeKeys())); }],
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

/* A mod's hook threw mid-turn (mod-taint.ts): the save has been refused from this
 * point on, and the player has to be told THAT, not merely that some mod is
 * unhappy - every turn they keep playing is a turn they will lose on reload.
 *
 * DEFERRED with setTimeout because the fault surfaces inside core, halfway
 * through a turn: opening a modal from there would put an overlay up while the
 * turn is still unwinding, and the tail render would paint the map back over it.
 * A macrotask lands after advance() has finished, which is the same trick
 * pumpStep uses to let the turn's own tail complete. */
onSessionTaint((t) => {
  setTimeout(() => {
    void openModal(async () => {
      await showTextScreen(
        term,
        /* Never blame a mod for the game's own bug: `id === null` is a core
         * fault, and a title saying "a mod stopped the game" would send the
         * player to the mod manager to hunt for a culprit that is not there. */
        t.id === null
          ? "The game stopped mid-turn"
          : "A mod stopped the game mid-turn",
        taintNotice(t).map((text) => ({ text })),
        "[ Press ESC for the reload prompt ]",
      );
      if (await confirmYesNo("Reload from the last save now? ")) location.reload();
    });
  }, 0);
});

/* This page took a character up and another page already had it, so this page has
 * stopped writing (slot-attach.ts detached it before saying so).
 *
 * IT HAS TO BE A SCREEN, not a message line. The failure this replaces was silent
 * and that is the whole of what made it costly: a tab that is no longer saving
 * looks exactly like a tab that is, and the player finds out when they close it.
 * A line in the message log is missed by the same player for the same reason, so
 * this stops the game and says it.
 *
 * It cannot happen through the character select, which refuses a character
 * somebody else is playing before this page ever attaches. What reaches here is
 * the door that has no picker in it: a DUPLICATED tab, which carries
 * `sessionStorage` across and so satisfies `isContinuation()` and resumes
 * straight into the same character.
 *
 * Deferred for the reason onSessionTaint is - the refusal lands from a background
 * lock request, which can resolve mid-turn - and the same macrotask puts it after
 * whatever turn is unwinding. */
onSlotLost((id) => {
  const who = getMeta(id)?.name || "that character";
  setTimeout(() => {
    void openModal(async () => {
      await showTextScreen(
        term,
        "This character is open in another window",
        [
          { text: `${who} is already being played somewhere else.`, color: UI_BAD },
          { text: "" },
          {
            text: "Nothing you do in THIS window will be saved. The other window",
            color: UI_TEXT,
          },
          { text: "has the character and is saving normally.", color: UI_TEXT },
          { text: "" },
          {
            text: "Close this window and carry on in the other one. If you would",
            color: UI_DIM,
          },
          {
            text: "rather play here, close the other window first and reload.",
            color: UI_DIM,
          },
        ],
      );
    });
  }, 0);
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
/* A MOD'S SOUND PACK, once boot has verified one (MOD_REACH gap 7). Latched
 * here rather than passed, because this install runs at module scope and the
 * pack is a fetch away - see SoundBase in sound.ts.
 *
 * PRECEDENCE: an explicit `?sounds=` beats a mod, and a mod beats the bundled
 * default. The query parameter is the USER saying which pack they want, right
 * now, in this tab; a mod is a standing preference they set earlier. When the
 * two disagree the one typed most recently wins, which is the same rule the
 * `?tiles=` override already follows. */
let modSoundPack: string | null = null;
installWebSound(soundEvents, {
  baseUrl: () => (params.get("sounds") ?? modSoundPack ?? soundBase),
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

// panel_contains (ui-output.c:689), the one piece of the camera core needs:
// message_flags (game/mon-message.ts) tags a stacked monster message
// "(offscreen)" from it, so a kobold dying out of shot reads "The kobold
// (offscreen) dies." Core cannot compute this - it has no idea how many rows
// the terminal gave the map - so the shell binds it from its own viewport.
// Read LIVE on each call rather than captured: the camera pans, the terminal
// resizes, and '=' can move the sidebar, all between two messages in one turn.
// The PREDICATE is tested (core game/display.test.ts, all four edges plus the
// negative-coordinate case); this BINDING is not, because nothing imports
// main.ts - same as state.sound above and every other wiring line here.
state.panelContains = (grid: Loc): boolean => panelContains(viewport(), grid);

// display_bolt / display_explosion (ui-display.c:1645,1559): the traveling
// spell-effect animation. project() (world/project.ts, via session/game.ts's
// cast.hooks.onBolt/onBlast) fires these synchronously, once per grid, as
// part of a single turn's core processing - there is no mid-turn await in
// core, so the events are collected here and replayed as a short animation
// by advance() once the turn (and everything it did) has already resolved.
// A grid the player cannot presently see (seen/playerSeesGrid false) upstream
// draws NOTHING for it (display_bolt's `else if (drawing)` branch never
// fires - project.c's `drawing` local is declared `false` and never
// reassigned in 4.2.6 itself), so unseen bolts are dropped at the door and
// every blast grid keeps its per-grid visibility flag for playProjectionAnimation.
let pendingBolts: BoltEventData[] = [];
let pendingBlasts: ExplosionEventData[] = [];
soundEvents.on("bolt", (_type, data) => {
  if (data.seen) pendingBolts.push(data);
});
soundEvents.on("explosion", (_type, data) => {
  if (data.playerSeesGrid.some(Boolean)) pendingBlasts.push(data);
});

/* First FOV after birth/load: clear only_partial left sticky by startGame
 * when updateFov was not yet wired (ui-display.c:2556-2557).
 *
 * Thrown, not `?.`-skipped: wireGame always installs updateFov, and if that ever
 * stopped being true the map would come up blank on birth - a silent skip here
 * would hide it behind a black screen with no error. */
if (!state.updateFov) throw new Error("wireGame did not install updateFov");
state.updateFov(state);
state.chunk.onlyPartial = false;
// A resize/reflow is a background repaint (the ResizeObserver in term.ts also
// fires once on observe, and again whenever the embed's layout settles), so it
// must not paint the map over a boot overlay - see renderBackground.
/* Re-place the region stack BEFORE the repaint below is decided, and as its own
 * listener rather than folded into that one.
 *
 * SEPARATE BECAUSE THE TWO ANSWER DIFFERENT QUESTIONS. renderBackground declines
 * to repaint while a modal owns the terminal - correctly; that is the guard that
 * keeps a ResizeObserver settle from painting the town over the title screen -
 * and a full-screen modal is now itself a region. Folding the relayout into that
 * callback would make the one case where a screen is open across a resize the
 * one case where its rectangle keeps describing the terminal it opened on.
 * Registered first, so the stack is placed before anything is drawn on it. */
term.onSizeChanged(() => {
  const { cols, rows } = term.size();
  relayoutStack({ cols, rows, base: currentScreenRegions(viewport()), metrics: term.metrics() });
});
term.onSizeChanged(() => {
  if (levelMapActive) levelMapRepaint?.();
  else renderBackground();
});

/* TELL A REPLACEMENT FRONT END WHEN SOMETHING OPENS OVER IT (#261).
 *
 * A world frame is produced by render(), and render() does not run while a core
 * screen owns the terminal - a screen repaints itself from its own key loop. So
 * the one moment a mod front end most needs to hear "you are covered" is the one
 * moment no frame is coming to tell it, and its canvas sits over the middle of
 * the inventory until the player closes it. This re-presents its LAST frame with
 * the new stack, which is exactly the fact that changed.
 *
 * `restate` is absent when CORE holds the display, and that is the answer rather
 * than an oversight: core repaints the map from render() and nowhere else, so
 * restating it would paint the dungeon over the screen that had just opened.
 * See `FrontendMapStream`. */
onStackChanged((stack) => liveWorldSink.restate?.(stack));

/*
 * NOT render(). The map belongs to a character the player has not chosen yet,
 * and boot has work left to do - mod resources, a tile atlas, a version check -
 * so what a top-level render() actually shows is somebody else's town for as
 * long as that work takes. See gameScreenLive.
 *
 * The seed is the clock rather than the game's RNG: this runs before a
 * character exists, and drawing from the game's stream here would move a
 * position the save re-derives the world from.
 */
const stopLoading = startLoading(term, { seed: Date.now() >>> 0 });

// Boot the persisted/URL-selected graphics mode (ASCII if none). Async and
// best-effort: fetches the pack image + prefs and repaints when ready, leaving
// the map ASCII on any failure.
void applyTileMode(readTileMode());

// --- Birth: choose a character for a new game -------------------------------
// A brand-new game opens the staged birth screen (ui-birth.c stage order). The
// engine has already built a default Human Warrior this load; when the player
// chooses, the choice is persisted and the game reloads so startGame rebuilds as that
// race/class (its stats and starting kit differ). A one-shot sessionStorage
// flag suppresses the screen on that rebuild. Backing out (ESC) keeps whatever
// character was built. Resuming a save never births.
async function maybeBirth(): Promise<BootStep> {
  if (!bootedNew) return "done";
  // An autoplayer (the Borg, ?agent=) boots straight into play: skip the modal
  // birth screen and let it drive the default (or last-birthed) character, so it
  // never stalls waiting for a human to click through character creation.
  if (params.get("agent")) {
    say("Borg awakens.");
    return "done";
  }
  let justBirthed = false;
  try {
    justBirthed = sessionStorage.getItem(BIRTH_DONE_KEY) === "1";
    sessionStorage.removeItem(BIRTH_DONE_KEY);
  } catch {
    /* sessionStorage unavailable: fall through and show birth. */
  }
  if (justBirthed) return "done"; // the choice from the previous load is already live
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
  state.rng.reseed(seed);
  const historyFor = (raceName: string): string => {
    const race = players.raceByName(raceName);
    if (!race) return "";
    return generateHistory(players.historyChart(race), state.rng);
  };
  return openModal(async () => {
    // ESC inside birth steps BACK one stage, and that is upstream's own rule:
    // "As all the menus are displayed in 'hierarchical' style, we allow use of
    // 'back' (left arrow key or equivalent) to step back in the proces as well as
    // 'escape'" (ui-birth.c:804-806), which turns ESC into BIRTH_BACK (:811) and
    // then `next = current_stage - 1` (:1662). runBirth already does that
    // internally and returns null for the FIRST stage's step-back only.
    //
    // Upstream has nowhere above birth to go - textui_do_birth is entered from a
    // running program whose only exit is KTRL('X') - so it remaps that
    // first-stage BIRTH_BACK to BIRTH_QUICKSTART and then to BIRTH_RESET
    // (:1615-1626 + :1661-1666), i.e. creation starts over. The web shell DOES
    // have a level above: the title screen is its "no game in progress" splash
    // (main-win.c:5475). So the hierarchical-back rule continues one step further
    // here and the answer is "back", letting bootMenus put the title up. What must
    // NOT happen is accepting the null and playing on: the hero kept that way is
    // the throwaway one startGame rolled behind the birth screen, which the player
    // never chose - that was the "ESC instantly creates a default character" bug.
    //
    // quickstart_allowed (ui-birth.c): offer the quick-start stage only when a
    // previous character's choices exist to reuse.
    const choice = await runBirth(term, players.races, players.classes, {
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
        // player_birth's dynastic suffix bump (player-birth.c:1060-1073): the
        // previous character's name comes forward, roman suffix incremented, so
        // the name prompt defaults to the next generation. Gated on there BEING
        // a previous character, which is upstream's `player->ht_birth` gate and
        // the same one quickstart_allowed uses.
        ...(birthChoice?.name ? { previousName: birthChoice.name } : {}),
        msg: (text) => say(text),
        // player_random_name (player.c:375) for the name field's '*' key and the
        // name finish_with_random_choices fills in. Draws on the same game RNG.
        randomName: () => playerRandomName(state.rng, tolkienNameProbs()),
        // Seed the '=' birth-options editor with the previous character's choices
        // so a New Game defaults to them (as upstream keeps the last birth opts).
      ...(birthChoice?.birthOptions ? { birthOptions: birthChoice.birthOptions } : {}),
    });
    /* The first stage's step-back: up one level, to the title.
     *
     * runBirth answers null for TWO things and they are not distinguished here,
     * deliberately: the first-stage step-back above, and KTRL('X') at the
     * quickstart prompt, which upstream turns into `quit(NULL)` (ui-birth.c:121-
     * 123). A browser tab has no program to exit, and the title screen is the
     * port's "no game in progress" splash - the same substitution saveQuitCmd
     * makes for ^X in play - so both land in the right place. On a host that CAN
     * exit, the KTRL('X') half should reach desktopQuit() instead; distinguishing
     * them needs a third runBirth result and is not done here.
     *
     * ESC at the quickstart prompt itself is NOT one of these: upstream's
     * do/while loops until Y/N/C/= and ignores ESCAPE outright unless the terminal
     * is disconnecting (ui-birth.c:114-131), so it stays inert - the one step of
     * the pre-game flow ESC does not back out of, and that is the C's choice. */
    if (!choice) return "back";
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
    return "done";
  });
}

/**
 * Refuse to open a character another window is already playing, and say why.
 *
 * THE DELIBERATE DOOR. `onSlotLost` catches a page that has already attached and
 * turns out to have lost the race, which works but costs the player a window they
 * thought they were playing in. This is the same collision caught one step
 * earlier, where the answer is a sentence and a menu the player is still standing
 * in rather than a game they have to abandon.
 *
 * Answers false whenever it cannot know (no Web Locks in this browser) - see
 * `slotHeldElsewhere`. Being unable to detect the collision must not become a
 * refusal to open a character at all.
 */
async function refusedAsPlayedElsewhere(id: string): Promise<boolean> {
  if (!(await slotHeldElsewhere(id))) return false;
  const who = getMeta(id)?.name || "That character";
  await showTextScreen(term, "Already being played", [
    { text: `${who} is open in another window.`, color: UI_BAD },
    { text: "" },
    {
      text: "Two windows playing one character overwrite each other's saves,",
      color: UI_TEXT,
    },
    { text: "so only one at a time may have them.", color: UI_TEXT },
    { text: "" },
    {
      text: "Carry on in that window, or close it and try again here.",
      color: UI_DIM,
    },
  ]);
  return true;
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
/**
 * How long the title screen will wait for the update check before painting
 * without its shimmer. Long enough that a warm check (2-5ms) always wins;
 * short enough that a cold one is not something the player sits through.
 */
const TITLE_CHECK_WAIT_MS = 400;

/**
 * The update answer if it arrives promptly, otherwise "not yet".
 *
 * The late value is `ok: false` rather than `ok: true, update: null`, because
 * those mean different things and this port has already shipped the bug where
 * they did not (#247). "I did not wait long enough" is not "there is nothing
 * there", and the title screen must not shimmer on either - so the distinction
 * costs nothing here and stays true.
 */
async function updateOfferSoon(): Promise<UpdateCheck> {
  const probe = updateOffer();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<UpdateCheck>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, reason: "The check has not answered yet." }),
      TITLE_CHECK_WAIT_MS,
    );
  });
  try {
    return await Promise.race([probe, late]);
  } finally {
    clearTimeout(timer);
  }
}

async function maybeTitle(): Promise<TitleChoice | null> {
  if (params.get("agent")) return null;
  try {
    if (sessionStorage.getItem(SKIP_TITLE_KEY) === "1") {
      sessionStorage.removeItem(SKIP_TITLE_KEY);
      return null;
    }
    if (sessionStorage.getItem(BIRTH_DONE_KEY) === "1") return null; // post-birth rebuild
  } catch {
    /* sessionStorage unavailable: fall through and show the title */
  }
  /* The loading screen is NOT stopped here. It used to be, one line above this
   * paint, and that put the only stop behind one of this function's four exits -
   * see bootMenus, which now owns it (#251). */
  const titleHandle = pushRegion(screenRegionSpec(), term.size());
  try {
    paintTitleArt(regionSurface(term, titleHandle.cells));
  } finally {
    popRegion(titleHandle);
  }
  /* Which File-menu rows are live (main-win.c:2957-2990). "Quit" needs a host
   * with something to exit; desktopQuit reports whether there is one. */
  const living = livingRoster().length > 0;
  /* A ROW MUST NOT APPEAR UNDER THE PLAYER'S CURSOR, which is why this used to
   * wait for the answer outright. It cost too much: measured on the shipped
   * build, the first api.github.com request a fresh process makes took 6.1s
   * (later ones in the same process: 2-5ms), and the title sat unfinished for
   * every millisecond of it.
   *
   * Bounded instead. What the answer decides differs by shell, and that is what
   * makes the bound safe under a desktop shell: canUpdate below reads updateHow,
   * not the answer, so the (U)pdate ROW is there either way and only its shimmer
   * is waiting. Nothing moves. In a browser the row's presence really does
   * depend on the answer - so the browser waits, and can afford to, because its
   * probe asks the service worker rather than the network (5ms, measured).
   *
   * The probe is not abandoned. It keeps running, the (U)pdate screen awaits the
   * same promise, and updateReadyLater lights the shimmer if it arrives late. */
  const updateCheck =
    desktopBridge === null ? await updateOffer() : await updateOfferSoon();
  /* A check that never got an answer must not shimmer and must not hide the
   * row: the row is the only door to the update screen, which is where the
   * failure is now reported and where it can be retried. */
  const update = updateCheck.ok ? updateCheck.update : null;
  /* MODS ARE DELIBERATELY NOT ASKED ABOUT HERE. This used to add
   * `|| modsWaiting` to both flags below, on the grounds that a player whose mods
   * are stale has the same question - which is true, and was free while the answer
   * was a local comparison against a catalogue inside the build. It is now a
   * request per installed mod against a sixty-an-hour rate limit, on the launch
   * path whose latency the player saw as a town map. The Mods screen owns that
   * question now; see waitingModUpdates. */
  titleUp = true;
  try {
    return await openModal(() =>
      showTitleScreen(
        term,
        {
          canLoad: living || resumedActive,
          canOpen: listRoster().length > 0,
          canQuit: desktopQuitAvailable(),
          /* Absent under the desktop shell rather than greyed - see TitleOptions. */
          canInstall: offerInstall({ isDesktop: desktopBridge !== null }),
          /* Present wherever updating is a thing this shell does, so the channel
           * is reachable; in a browser only when the worker really has a build,
           * because there is no channel to choose there. */
          canUpdate:
            desktopBridge === null ? update !== null : updateHow !== "none",
          updateReady: update !== null,
        },
        {
          randint1: titleRandint1,
          /* The answer that did not make it in time. The row is already drawn
           * and in its final place, so this only ever lights it up. */
          updateReadyLater: updateProbe.then((c) => c.ok && c.update !== null),
        },
      ),
    );
  } finally {
    titleUp = false;
  }
}

/**
 * The title shimmer's RNG, and the reason it is not the game's.
 *
 * `displayRandint1` draws on `state.rng`, which is right for a monster on a map:
 * upstream's do_animation draws on the game RNG and the determinism ledger
 * accounts for it. The title screen is a different case entirely - it runs
 * BEFORE any character exists and stays up for however long the player leaves
 * it, so drawing there would make the game's RNG stream depend on how long
 * somebody looked at the splash. Nothing downstream can be affected by this one,
 * which is exactly why it is allowed to be the cheap generator.
 */
const titleRandint1 = (n: number): number => Math.floor(Math.random() * n) + 1;

/**
 * The update check, started once at boot and awaited at the title screen.
 *
 * Desktop asks GitHub; the browser asks its own service worker, which has
 * already fetched the new build (see pwa.ts). Both answer null when there is
 * nothing to offer, and neither ever throws: a failed check is not something the
 * player asked about.
 */
let updateHow: UpdateHow = "none";
let updateRoot = "";

/** localStorage, or null where a browser refuses it outright. */
function channelStore(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let updateChannel: UpdateChannel = readChannel(channelStore(), ENGINE_VERSION);

/**
 * What this install is, asked once. Cheap, local, and the same on every channel,
 * so it is not repeated when the player switches.
 */
const shapeProbe: Promise<{ platform: string; arch: string } | null> = (async () => {
  try {
    /* `updaterBridge`, NOT `desktopBridge`: the preload exposes two globals and
     * the updater is on `neoDesktop`, while detectDesktopBridge returns
     * `neoHostFs`. Reading it off the wrong one is how this feature spent its
     * first build wired to nothing - see updaterBridge's comment. */
    const bridge = updaterBridge();
    if (!bridge) {
      /* The browser. The worker knows, and there is nothing to download. */
      return null;
    }
    const res = (await bridge.update("shape")) as
      | { ok?: boolean; shape?: { how?: string; installRoot?: string; platform?: string; arch?: string } }
      | undefined;
    const shape = res?.shape;
    if (!shape || shape.how === "none") return null;
    updateHow = shape.how === "swap" ? "swap" : "manual";
    updateRoot = shape.installRoot ?? "";
    return { platform: shape.platform ?? "", arch: shape.arch ?? "" };
  } catch {
    return null;
  }
})();

/**
 * Ask GitHub what this channel currently holds. Never throws.
 *
 * NO MACHINE IS NOT A FAILED CHECK. `shapeProbe` answers null for a launch
 * with nothing to replace - a dev run, or the browser - and there is no
 * question to have failed there, so it reports a successful check with nothing
 * to offer. Calling that a failure would put "the check did not get an answer"
 * on a screen whose real answer is "this shell does not install updates".
 */
async function runUpdateCheck(channel: UpdateChannel): Promise<UpdateCheck> {
  try {
    const machine = await shapeProbe;
    if (!machine) return { ok: true, update: null };
    return await checkForUpdate({
      fetch: globalThis.fetch.bind(globalThis),
      machine,
      current: ENGINE_VERSION,
      channel,
    });
  } catch (err) {
    /* checkForUpdate does not throw, so reaching here means the bridge did.
     * Still an unanswered question, and still not currency. */
    return { ok: false, reason: `The check could not be made: ${String(err)}` };
  }
}

/* Started at boot so the title screen does not wait on a network round trip. */
let updateProbe: Promise<UpdateCheck> = runUpdateCheck(updateChannel);

/**
 * What, if anything, the title screen should offer.
 *
 * The web half cannot fail the way the desktop half can: the service worker
 * has already fetched whatever it is going to say, so `webUpdateReady` is a
 * local question and its "no" really does mean no.
 */
async function updateOffer(): Promise<UpdateCheck> {
  if (desktopBridge === null) {
    if (!webUpdateReady()) return { ok: true, update: null };
    updateHow = "web";
    /* The worker does not report a version number - it has a build, not a tag -
     * so the screen says "a newer version" rather than inventing one. */
    return {
      ok: true,
      update: { version: "a newer version", tag: "", url: "", asset: null },
    };
  }
  return updateProbe;
}

/**
 * How a mod is downloaded, verified and stored - built once and shared.
 *
 * Used by the mod manager AND by the update screen, which is the point: the
 * update screen offers mod updates now, and if it had built its own copy of
 * these three functions the two screens could disagree about where mods live.
 */
/**
 * THE ONE DOOR A MOD CHANGE LEAVES BY.
 *
 * A page re-compose is what actually adds or removes a mod, and everything that
 * has to happen first happens here. It is a named module-level function rather
 * than an inline callback because there are now two callers - the mod manager,
 * and the update screen's mod updates - and mod-teardown.test.ts exists
 * precisely to stop there being two DOORS: teardown wired into one of them
 * would be silently skipped by the other.
 *
 * `resume` is the difference between the two callers and is not cosmetic.
 * Applying mods mid-game is a continuation: skip the title and pick the same
 * character back up. Updating mods from the title screen is not - there is no
 * live character to resume, and asking for one would send the player somewhere
 * they did not choose to go.
 */
function reloadAfterModChange(opts?: { showGraphics?: boolean; resume?: boolean }): void {
  /* Teardown BEFORE the save, which is the whole reason it is here and not
   * skipped as ceremony in front of a reload (mod-teardown.ts). The page
   * re-compose is what actually removes a mod; what this ordering buys is that
   * the last bytes written for this character are taken AFTER each plugin's
   * uninstall() has had its say and AFTER the autoplayer has handed
   * state.nextCommand back to the human. */
  teardownModPlugins({
    plugins: activeModCode().plugins,
    controller: installedController,
    revokePanels: revokeModPanels,
    closePanels: closeAllModPanels,
  });
  installedController = null;
  installedControllerSpeed = null;
  stopInstalledController = null;
  /* A candidate still waiting on the confirm gate below (#125) does not
   * survive a reload either - the new boot runs the whole install loop, and
   * this gate, again from scratch. */
  pendingAutoplayerInstall = null;
  hideAutoplayerBanner();
  /* Back to candidate zero, not to nothing: the page has not re-composed yet
   * and the autosave below can still repaint, so the map needs an owner the
   * whole way down. A departing mod's sink must not be that owner. */
  installedFrontend = coreFrontendSlot;
  try {
    autosave(true); // keep the live hero before the page re-composes
    if (opts?.resume !== false) sessionStorage.setItem(SKIP_TITLE_KEY, "1");
    if (opts?.showGraphics) sessionStorage.setItem(SHOW_GRAPHICS_KEY, "1");
  } catch {
    /* best-effort */
  }
  location.reload();
}

/**
 * do_cmd_try_borg's two warnings and its prompt (cmd-misc.c:131-136), shared
 * by both entrances an autoplayer can take the keyboard through: Ctrl-Z
 * (activateAutoplayerCmd, right below) and the boot-time gate on a rule flag
 * flipped from the ordinary Mods screen (confirmPendingAutoplayerInstall,
 * near the controller-install loop). One copy of the text so the two
 * entrances cannot drift into saying different things for the same decision.
 *
 * The text itself is upstream's own (BORG_CONFIRM_MSG_1/2, BORG_CONFIRM in
 * neo-angband-mod-borg's activate.ts) - copied rather than imported, because
 * core does not and must not depend on a mod package; a mod is a URL fetched
 * at runtime, not a build-time dependency.
 */
async function confirmBorgActivation(): Promise<boolean> {
  say("You are about to use the dangerous, unsupported, borg commands!");
  say("Your machine may crash, and your savefile may become corrupted!");
  render();
  return confirmYesNo("Are you sure you want to use the borg commands? ");
}

/**
 * do_cmd_try_borg (cmd-misc.c:125-145), Ctrl-Z: warn once, confirm, then let an
 * autoplaying mod have the keyboard (#125).
 *
 * There is nothing upstream-shaped left to call here: `controller()` runs
 * synchronously at boot, before this game exists, so there is no live install
 * to reach into. What upstream's gate marks with one assignment
 * (`player->noscore |= NOSCORE_BORG`) this instead reaches by turning the mod's
 * own rule flag on - the same write the mod manager's row already makes - and
 * reloading through the one door every other mod change already uses
 * (reloadAfterModChange). The confirmation is what changes: it now always runs
 * first, whether the player found the flag through this key or through Mods.
 */
async function activateAutoplayerCmd(modId: string): Promise<void> {
  if (!(await confirmBorgActivation())) return;
  defaultModStore().setRuleChoice(`${modId}.autoplay`, true);
  /* Marked HERE, before the reload, not left for the boot loop that runs after
   * it (#125). That reload goes through the exact same boot-time install path
   * as any other launch, and that path now only asks once - a save that
   * already carries NOSCORE.BORG installs at once, because the gate already
   * ran. Leaving the mark for the boot loop to set instead would mean the very
   * next boot asks again for a confirmation the player just gave. */
  const takenOver = state.actor.player;
  takenOver.noscore = markNoscore(takenOver.noscore, NOSCORE.BORG);
  reloadAfterModChange({ resume: true });
}

/**
 * Ctrl-Z (#125). Already running: this IS the interrupt key, same as any other
 * real keypress (input-door.ts's AutoplayerInterruptOwner) - upstream reaches
 * the borg's own submenu by pressing it again too, and "give the keyboard
 * back" is the port's whole answer to that menu. Not running: find a loaded mod
 * that CAN autoplay (declares `controller`, regardless of whether its own rule
 * flag is on) and offer to turn it on, through the warn-and-confirm gate above.
 *
 * `.controller` is checked for existing rather than the AUTOPLAY_FLAG concept
 * this file has no way to name - a mod's own rule ids are its business, not
 * the host's, and `${modId}.autoplay` above is a convention this shares with
 * neo-angband-mod-borg's plugin.ts, not a contract the host enforces.
 */
function tryBorgCommand(): void {
  if (installedController) {
    stopInstalledController?.();
    return;
  }
  const candidate = activeModCode().plugins.find(
    (loaded) => typeof loaded.plugin.controller === "function",
  );
  if (!candidate) {
    say("You do not have an autoplayer mod installed.");
    render();
    return;
  }
  void openModal(() => activateAutoplayerCmd(candidate.id));
}

/**
 * Resolves the candidate the boot-time controller-install loop held back
 * (#125): a mod whose own rule flag was already on at boot, on a save that
 * has never granted it the keyboard before (NOSCORE.BORG unset). Runs
 * upstream's own warning and confirm, then either installs for real
 * (finishAutoplayerInstall) or leaves the human at the keyboard - never both,
 * and never neither.
 *
 * Chained after maybeShowGraphics in the boot promise below, so this is the
 * first thing the player sees once the game screen is actually live, not
 * something that can flash past behind a loading screen or a birth flow that
 * still owns the terminal.
 */
async function confirmPendingAutoplayerInstall(): Promise<void> {
  const pending = pendingAutoplayerInstall;
  if (!pending) return;
  pendingAutoplayerInstall = null;
  await openModal(async () => {
    if (!(await confirmBorgActivation())) {
      say(
        `${pending.loaded.id} will not take the keyboard this session. Turn its ` +
          `autoplay rule back off from Mods if you do not want to be asked again.`,
      );
      render();
      return;
    }
    finishAutoplayerInstall(pending.loaded, pending.controller);
    render();
  });
}

/**
 * Installed mods with a newer version in their own repository. Never throws.
 *
 * A NETWORK CALL PER INSTALLED MOD, so where it is called from is now part of the
 * design rather than a detail. It used to be a local comparison against the
 * catalogue compiled into the build - free, offline, and answering a weaker
 * question than the one it printed - and it was called from three places including
 * the boot path. Two of those are gone:
 *
 *   - THE TITLE SCREEN NO LONGER ASKS. Its shimmer means a game build is waiting.
 *     Asking here would put one request per mod on the launch path whose latency
 *     was the town-map flash, against an unauthenticated rate limit of sixty an
 *     hour, every launch. The Mods screen's own row is where a player is told, and
 *     it says plainly that pressing it is what does the asking.
 *   - THE MOD MANAGER'S ROW NO LONGER CARRIES A COUNT, for the same reason, and
 *     because the only way to have one for free would be to cache it - a stale
 *     answer wearing a fresh answer's wording, which is the defect this whole
 *     change is about, one layer down.
 *
 * What is left is the (U)pdate screen, which the player opened in order to ask.
 */
async function waitingModUpdates(): Promise<readonly ModUpgrade[]> {
  try {
    return pendingUpgrades(await modBrowseDeps().refresh());
  } catch {
    return [];
  }
}


/**
 * The browse screen's dependencies - the wiring that makes six modules reachable.
 *
 * Every piece of this was built and had no caller: mod-curated reads the list,
 * mod-discover asks a repository, mod-authors reads the register, mod-consent holds
 * the switch, installModFromRepo does the write. This function is where they meet a
 * player.
 *
 * THE CHANNEL IS READ HERE, from the same store and the same function the game's own
 * updater reads it with - so a player's one channel choice governs both, and there is
 * no second setting to fall out of step with the first.
 */
function modBrowseDeps(): ModUpgradeDeps {
  const net = { fetch: (url: string) => fetch(url) };
  const discoverEnv: DiscoverEnv = {
    engineVersion: ENGINE_VERSION,
    channel: readChannel(channelStore(), ENGINE_VERSION),
    fetch: async (url) => {
      const res = await fetch(url);
      return { ok: res.ok, status: res.status, text: () => res.text() };
    },
  };
  const installEnv = {
    fetch: (url: string) => fetch(url),
    subtle: crypto.subtle,
    scope: globalThis,
    now: () => new Date().toISOString(),
  };

  return {
    installed: async () => {
      const metas = await installedMods(globalThis);
      return new Map(metas.map((m) => [m.id, m.tag] as const));
    },
    discover: async (ref) => {
      const r = await discoverMod(ref, discoverEnv);
      return r.ok ? { ok: true, ref, mod: r.mod } : { ok: false, ref, problem: r.problem };
    },
    /* The installed record is LOOKED UP, not passed as null. It used to be null, which
     * silently disabled the only check that stops a mod being replaced from a different
     * repository than the one it came from - see installedMeta in mod-install.ts. */
    install: async (mod, origin, onProgress) =>
      await installModFromRepo(
        mod,
        await installedMeta(mod.id, globalThis),
        installEnv,
        onProgress,
        { origin, allowed: readConsent(channelStore()) },
      ),
    uninstall: (id) => uninstallMod(id, globalThis),
    /* The fourth door. Feature-detected off the desktop bridge, so a browser tab gets
     * the file picker and no mods-folder listing rather than a broken row. */
    importZip: zipImportDeps(installEnv, () => readConsent(channelStore()), globalThis),
    curated: async () => {
      const r = await fetchRegistry(DEFAULT_REGISTRY_URL, net);
      return r.ok ? { registry: r.registry, problem: null } : { registry: null, problem: r.problem };
    },
    registryAt: async (url) => {
      const r = await fetchRegistry(url, net);
      return r.ok ? { registry: r.registry, problem: null } : { registry: null, problem: r.problem };
    },
    authors: async () => {
      /* A failure here decides nothing: every author simply shows as unvouched,
       * which is the honest default. So it is swallowed rather than surfaced - a
       * register outage must never look like a mod problem. */
      const r = await fetchAuthors(DEFAULT_AUTHORS_URL, net);
      return r.ok ? r.register : null;
    },
    consent: {
      read: () => readConsent(channelStore()),
      write: (allow) => writeConsent(channelStore(), allow),
    },
    /* One tags call per installed mod, made only when the player opens the update
     * screen. NOT at boot: it is a network round trip per mod against an
     * unauthenticated rate limit of sixty an hour, on the code path whose latency
     * was the town-map flash, and the alternative - caching the answer - is a
     * stale claim wearing a fresh one's wording. */
    refresh: async () => refreshInstalledMods(await installedMods(globalThis), discoverEnv),
  };
}

/**
 * Run one of a screen's actions with whoever is holding the screen TOLD FIRST.
 *
 * The same shape `charsheet.ts` already uses, and shared by this file's two
 * prompting hosts rather than written twice: `core:report`'s `describe` (three
 * row-0 line edits) and `core:update`'s `mods` (a whole nested page). Both of
 * those landed under a presenter's overlay until this existed, and `update:mods`
 * is also the site the re-entrancy guard in `screen-runtime.ts` is written for -
 * the guard only sees a presenter that has stood aside, so without this call it
 * had nothing to guard.
 *
 * THE CENSUS DECIDES, not a list spelled again here. `screenPromptFor` has a row
 * only for the actions verified to reach the terminal, so `channel`, `log-level`
 * and `confirm` run with nothing announced and a presenter does not fade its
 * overlay out for a page it is still holding.
 *
 * `label` is the action's OWN label, read off the view rather than transcribed
 * into a second table - the wording a presenter drew on its button is the wording
 * it should caption its standing-aside with, and two copies of it would be two
 * things to keep in step.
 *
 * `withTerminal`'s `held` is deliberately dropped, exactly as `charsheet.ts`
 * drops it: `held: false` means the holder could not stand aside, it has already
 * been reported BY NAME through `screenFault`, and there is nothing this page
 * would do differently.
 */
async function announcedAction<T>(
  view: ScreenView,
  actionId: string,
  work: () => Promise<T>,
): Promise<T> {
  const fact = screenPromptFor(view.id, actionId);
  if (fact === undefined) return work();
  const label = view.actions?.find((a) => a.id === actionId)?.label ?? fact.promptId;
  const { value } = await withTerminal(
    promptRequest(fact.promptId, actionId, fact.extent, label, term.size()),
    work,
    screenFault,
  );
  return value;
}

/**
 * The (U)pdate screen.
 *
 * DRAWN HERE, BUT NOT HIDDEN FROM MODS. `showTextScreen` cannot serve this page:
 * that viewer resolves on ESC, ENTER *and* SPACE alike, and this screen has to
 * tell "yes, replace my install" apart from "get me out of here"; and it cannot
 * repaint itself, which a progress bar is entirely made of. What used to follow
 * from that - and does not - is that a presenter never saw the page at all. It is
 * offered through `showThroughPresenter` like every other screen, its prose
 * travelling as a `lines` block, and the keys the footer names travel with it as
 * `actions` so `ScreenHost.invoke` runs the GAME's own update from a mod's own
 * button. Prose the game already laid out is finished at `lines`; there is no
 * table here to model.
 *
 * ONE PAINT PER PROGRESS EVENT WOULD BE 160 MB OF PAINTS. The download reports
 * every chunk, so the bar is redrawn only when the whole-percent figure changes
 * - about a hundred times over a download instead of tens of thousands.
 */
async function showUpdatePage(): Promise<void> {
  const handle = pushRegion(screenRegionSpec(), term.size());
  const surface = regionSurface(term, handle.cells);
  try {
  const bridge = updaterBridge();
  let check = await updateOffer();
  /* ASK AGAIN, HERE, when the boot check got no answer. That check races the
   * heaviest part of startup and is bounded by a six-second timer, so a big
   * install can lose it to its own mods and tile packs. Pressing (U) is a
   * player asking the question deliberately, which is worth one request, and
   * by now boot is long finished. */
  if (!check.ok) {
    updateProbe = runUpdateCheck(updateChannel);
    check = await updateProbe;
  }
  let offer = check.ok ? check.update : null;

  /* Mod updates share this screen, and asking is now a request per installed mod
   * against each mod's own repository. That is affordable HERE and nowhere else on
   * the launch path: the player pressed (U) in order to ask. It also means the page
   * works differently offline - the game half says so, and the mod half simply has
   * nothing to report, which is correct rather than reassuring. */
  const browse = modBrowseDeps();
  let modPending: readonly ModUpgrade[] = [];
  const refreshModPending = async (): Promise<void> => {
    modPending = await waitingModUpdates();
  };
  await refreshModPending();

  /* The page is reachable with nothing to install, because it is also where the
   * channel is chosen - see UpdatePhase's comment. */
  const viewFor = (c: UpdateCheck): UpdateView => {
    const o = c.ok ? c.update : null;
    return {
      how: updateHow,
      current: ENGINE_VERSION,
      version: o?.version ?? ENGINE_VERSION,
      channel: updateChannel,
      buildId: WEB_BUILD_ID,
      installRoot: updateRoot,
      assetName: o?.asset?.name,
      /* THREE OUTCOMES, THREE PHASES, decided in update-ui.ts where a test can
       * see it: `uptodate` is now reachable only from a check that actually got
       * an answer, and the third phase is what used to be indistinguishable
       * from it. */
      ...checkPhase(c),
      releaseUrl: o?.url ?? `https://github.com/${UPDATE_REPO}/releases`,
      modUpdates: modPending,
    };
  };

  let view: UpdateView = viewFor(check);

  /* True while a presenter is holding this screen. Every paint is gated on it,
   * because a download reports progress about a hundred times and every one of
   * those would otherwise be the game drawing the terminal underneath somebody
   * else's overlay. */
  let owned = false;

  const paint = (): void => {
    if (owned) return;
    const { cols, rows } = surface.size();
    surface.clear();
    surface.print(0, 1, UPDATE_TITLE.slice(0, cols - 1), UI_GOLD);
    const lines = updateLines(view);
    for (let r = 0; r < lines.length && 3 + r < rows - 1; r++) {
      const line = lines[r];
      if (!line) continue;
      surface.print(0, 3 + r, line.text.slice(0, cols - 1), UPDATE_TONE[line.tone]);
    }
    const footer = updateFooter(view, cols);
    surface.print(0, rows - 1, footer.slice(0, cols - 1), UI_DIM);
  };

  const key = (): Promise<string> =>
    new Promise<string>((resolve) => {
      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key.length !== 1 && ev.key !== "Enter" && ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        inputEvents.removeEventListener("keydown", onKey, true);
        resolve(ev.key);
      };
      inputEvents.addEventListener("keydown", onKey, true);
    });

  /**
   * ONE key press, whether it came from the terminal's own loop or from a
   * presenter calling `host.invoke`. False means the screen is over.
   *
   * Extracted rather than duplicated because the alternative is two copies of
   * "what ENTER does here", and the copy a mod drives is the one nobody plays.
   */
  const act = async (pressed: string): Promise<boolean> => {
    if (pressed === "Escape") return false;

    /* Change channel, then ask again. The browser has no channels: what it runs
     * is whatever the site last deployed. */
    if ((pressed === "c" || pressed === "C") && view.how !== "web" && view.phase !== "downloading") {
      const next = UPDATE_CHANNELS[(UPDATE_CHANNELS.indexOf(updateChannel) + 1) % UPDATE_CHANNELS.length];
      if (next) {
        updateChannel = next;
        writeChannel(channelStore(), next);
        /* Re-run rather than filter the old answer: a slower channel's newest
         * release may not even have been in the twenty this machine fetched. */
        view = { ...view, channel: next, phase: "uptodate" };
        paint();
        updateProbe = runUpdateCheck(next);
        check = await updateProbe;
        offer = check.ok ? check.update : null;
        view = viewFor(check);
      }
      return true;
    }
    /* M, and never ENTER. ENTER on this screen ends the session and replaces
     * the whole install; pulling a few KiB of mod is not that, and a player who
     * wanted only the mod should not lose their game to get it. */
    if ((pressed === "m" || pressed === "M") && modPending.length > 0 && view.phase !== "downloading") {
      const touched = await showModUpgrades(surface, browse);
      await refreshModPending();
      view = viewFor(check);
      /* Mod code is read at boot, so a mod that changed on disk is not the mod
       * that is loaded until the page starts again. Reloading from the title
       * screen is invisible - the same reasoning pwa.ts relies on. */
      if (touched) {
        reloadAfterModChange({ resume: false });
        return false;
      }
      return true;
    }
    if (pressed !== "Enter") return true;
    /* The retry the screen names in its footer. Without it the only way to ask
     * a second time was to restart the game, which is how a transient failure
     * at boot became a permanent "you are up to date". */
    if (view.phase === "unchecked") {
      updateProbe = runUpdateCheck(updateChannel);
      check = await updateProbe;
      offer = check.ok ? check.update : null;
      view = viewFor(check);
      return true;
    }
    if (!offer) return true;

    if (view.how === "web") {
      /* Awaited: it asks the worker to check and, if one is waiting, to take
       * over - a bare reload would serve the cached old build back out of the
       * worker's own cache and bring this row straight back. */
      view = { ...view, phase: "installing" };
      paint();
      await applyWebUpdate();
      return false;
    }
    if (view.how === "manual" || !bridge?.update || !offer.asset) {
      await bridge?.update?.("reveal", view.releaseUrl);
      return false;
    }

    /* Downloading. Progress is throttled to whole percents - see above. */
    view = { ...view, phase: "downloading", received: 0, total: offer.asset.size };
    paint();
    let lastPercent = -1;
    const stop = bridge.onUpdateProgress?.((received, total) => {
      const pc = total > 0 ? Math.floor((received / total) * 100) : -1;
      if (pc === lastPercent) return;
      lastPercent = pc;
      view = { ...view, received, total };
      paint();
    });
    /* The desktop main process re-reads this release from GitHub and derives
     * the URL, digest, and platform asset itself. The renderer only says which
     * release the player selected. */
    const res = (await bridge.update("download", offer.tag)) as
      | { ok?: boolean; error?: string }
      | undefined;
    stop?.();

    if (!res?.ok) {
      view = { ...view, phase: "failed", error: res?.error };
      return true;
    }
    view = { ...view, phase: "installing" };
    paint();
    const applied = (await bridge.update("apply")) as { ok?: boolean; error?: string } | undefined;
    if (!applied?.ok) {
      view = { ...view, phase: "failed", error: applied?.error };
      return true;
    }
    /* The main process is quitting and a swap script is waiting on this pid.
     * There is nothing left to draw. */
    return false;
  };

  /** The current page as a screen; `updateScreen` owns the shape, this the tone. */
  const screenNow = (): ScreenView =>
    updateScreen(
      view,
      updateLines(view).map((line) => ({ text: line.text, color: UPDATE_TONE[line.tone] })),
      updateFooter(view, surface.size().cols),
      modPending.length,
    );

  const host: ScreenHost = {
    invoke: async (id: string): Promise<ScreenView | undefined> => {
      const pressed = UPDATE_ACTION_KEYS[id];
      /* An unknown id is a no-op returning the current view, never an error: a
       * presenter written against a later engine must not be able to close the
       * player's update page by asking for a command this one has not got. */
      if (pressed === undefined) return screenNow();
      const again = await announcedAction(screenNow(), id, () => act(pressed));
      return again ? screenNow() : undefined;
    },
  };

  owned = true;
  const taken = showThroughPresenter(screenNow(), screenFault, host);
  if (taken) {
    try {
      await taken;
      return;
    } catch (error: unknown) {
      /* The presenter died with the page open. It is already reported and the
       * seam is already out; all that is left is to show the player the page
       * they asked for, which the terminal loop below does. */
      if (!(error instanceof ScreenAbandoned)) throw error;
      owned = false;
    }
  } else {
    owned = false;
  }

  for (;;) {
    paint();
    if (!(await act(await key()))) return;
  }
  } finally {
    popRegion(handle);
  }
}

/** Tones to this shell's palette, so update-ui.ts stays free of the terminal. */
const UPDATE_TONE: Record<UpdateLine["tone"], string> = {
  head: UI_GOLD,
  body: UI_TEXT,
  dim: UI_DIM,
  good: UI_GOOD,
  warn: UI_BAD,
};

/** Tones to this shell's palette, so report.ts stays free of the terminal. */
const REPORT_TONE: Record<ReportLine["tone"], string> = {
  head: UI_GOLD,
  body: UI_TEXT,
  dim: UI_DIM,
  good: UI_GOOD,
  warn: UI_BAD,
};

/** The same, for storage-page.ts. */
const STORAGE_TONE: Record<StorageTone, string> = {
  head: UI_GOLD,
  text: UI_TEXT,
  dim: UI_DIM,
  good: UI_GOOD,
  warn: UI_BAD,
};

/**
 * "Where your characters live" (storage-page.ts): the one screen that says what
 * would destroy a roster, reached from the Escape menu and with Shift-W on the
 * character list.
 *
 * Every input is read here and nothing is assumed: a mod store that will not open
 * costs the COUNT, not the warning, which is the whole reason the page exists.
 */
async function showStoragePage(): Promise<void> {
  const durability = await storageDurability();
  let mods = 0;
  try {
    mods = (await installedMods(globalThis)).length;
  } catch (err) {
    /* A broken or blocked IndexedDB is exactly the situation somebody reading
     * this screen may be in. Report what is known rather than nothing. */
    log.warn("storage", "could not count installed mods for the storage page", err);
  }
  const lines = storageLines({
    desktop: desktopBridge !== null,
    home: desktopDataDir() ?? undefined,
    origin: location.origin,
    characters: listRoster().length,
    mods,
    persisted: durability.persisted,
    usage: durability.usage,
    quota: durability.quota,
  });
  await showTextScreen(
    term,
    "Where your characters live",
    lines.map((l) => ({ text: l.text, color: STORAGE_TONE[l.tone] })),
  );
}

/** Which front end this is, in the words the report screen uses. */
function reportShell(): ReportShell {
  if (desktopBridge !== null) return "desktop";
  return isStandalone() ? "installed" : "browser";
}

/**
 * A string off the `neoDesktop` global, or null in a browser.
 *
 * `neoDesktop`, NOT the host bridge - the same two-globals trap the updater fell
 * into, where an optional property on the wrong object reads as `undefined`
 * rather than as an error and the feature is simply never on.
 */
function desktopString(key: string): string | null {
  const desktop = (globalThis as Record<string, unknown>)["neoDesktop"];
  if (desktop === null || typeof desktop !== "object") return null;
  const v = (desktop as Record<string, unknown>)[key];
  return typeof v === "string" && v !== "" ? v : null;
}

/** Where this launch writes its log and its reports. Null in a browser. */
function desktopLogsDir(): string | null {
  return desktopString("logsDir");
}

/** The install's data folder, used only to take it back out of a report. */
function desktopDataDir(): string | null {
  return desktopString("dataDir");
}

/**
 * Everything about this launch that a report should carry, gathered at the
 * moment the player presses ENTER rather than when the screen opened.
 *
 * Gathered here and not in report.ts because every one of these is a live
 * reading off a global - the terminal's size, the window's dpr, the character
 * currently in play. report.ts stays a pure function over them so the text can
 * be asserted, which is the only part anybody outside this project ever sees.
 */
function reportInput(description: readonly string[]): ReportInput {
  const { cols, rows } = term.size();
  let character: ReportCharacter | null = null;
  try {
    const p = state.actor.player;
    character = {
      name: playerName || "(unnamed)",
      race: p.race.name,
      cls: p.cls.name,
      level: p.lev,
      /* Fifty feet to the level, as upstream's depth display has it. */
      depthFt: state.chunk.depth * 50,
    };
  } catch {
    /* No game in play. The escape menu cannot be open without one, but the
     * report must not be the thing that throws while somebody files a bug. */
  }
  return {
    at: Date.now(),
    version: ENGINE_VERSION,
    parityBaseline: PARITY_BASELINE,
    buildId: WEB_BUILD_ID,
    channel: updateChannel,
    shell: reportShell(),
    platform: desktopBridge !== null ? (navigator.platform || "desktop") : "web",
    arch: navigator.userAgent.includes("ARM") ? "arm64" : "x64",
    userAgent: navigator.userAgent,
    cols,
    rows,
    cssWidth: window.innerWidth,
    cssHeight: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    level: log.level,
    ringSize: LOG_RING_DEFAULT,
    dropped: log.dropped(),
    description,
    character,
    mods: enabledModSummary(),
    lines: log.recent(REPORT_LOG_LINES).map((r) => formatLogLine(r)),
    home: desktopDataDir() ?? undefined,
  };
}

/**
 * The "Report a problem" screen.
 *
 * DRAWN HERE, BUT NOT HIDDEN FROM MODS, for the same reason the update page is:
 * `showTextScreen` resolves on ESC, ENTER and SPACE alike, and this screen has to
 * tell "write the file" apart from "get me out of here". It is still offered
 * through `showThroughPresenter` - prose as a `lines` block, and D / L / ENTER as
 * `actions` a presenter runs through `ScreenHost.invoke`, so the game writes the
 * game's file from a mod's own button.
 *
 * THE FILE IS NEVER WRITTEN WITHOUT THE PLAYER PRESSING ENTER, and the screen
 * lists what will be in it first. A menu row that silently dropped a file
 * somewhere would be asking them to trust a sentence; this asks them to read a
 * list.
 */
async function showReportPage(): Promise<void> {
  const handle = pushRegion(screenRegionSpec(), term.size());
  const surface = regionSurface(term, handle.cells);
  try {
  const description: string[] = [];
  /*
   * WHERE A MOD'S ADDRESS COMES FROM: its INSTALL RECORD, not its manifest.
   *
   * `InstalledModMeta.repo` is the origin trust-on-first-use pinned when the mod
   * was installed, and every later fetch for that mod has had to match it
   * (mod-source.ts, originConflict). The manifest's `repository` is the same
   * string only until somebody edits the copy on disk, and this screen is one a
   * player reaches precisely when something is wrong with their mods.
   *
   * Read once, here, rather than per repaint: it is an IndexedDB round trip, and
   * an enabled mod's origin cannot change while this page is open.
   *
   * A FAILURE IS NOT AN EMPTY LIST OF MODS. If the records cannot be read the
   * mods are still listed, with no address - which is the truth. Dropping them
   * would tell a player with a broken mod set that no mod could be involved.
   */
  const origins = await (async (): Promise<ReportModOrigin[]> => {
    const enabled = enabledModSummary();
    if (enabled.length === 0) return [];
    let byId = new Map<string, string>();
    try {
      byId = new Map((await installedMods(globalThis)).map((m) => [m.id, m.repo]));
    } catch (error: unknown) {
      log.warn("report", "could not read where the enabled mods came from", error);
    }
    return enabled.map((m) => ({ id: m.id, repo: byId.get(m.id) ?? "" }));
  })();

  let view: ReportView = {
    phase: "compose",
    shell: reportShell(),
    description,
    level: log.level,
    lineCount: log.recent().length,
    modCount: enabledModSummary().length,
    logsDir: desktopLogsDir() ?? undefined,
    modOrigins: origins,
  };

  /* True while a presenter holds the page; see the update page's own `owned`. */
  let owned = false;

  const paint = (): void => {
    if (owned) return;
    const { cols, rows } = surface.size();
    surface.clear();
    surface.print(0, 1, REPORT_TITLE.slice(0, cols - 1), UI_GOLD);
    const lines = reportLines(view);
    for (let r = 0; r < lines.length && 3 + r < rows - 1; r++) {
      const line = lines[r];
      if (!line) continue;
      surface.print(0, 3 + r, line.text.slice(0, cols - 1), REPORT_TONE[line.tone]);
    }
    const footer = reportFooter(view);
    surface.print(0, rows - 1, footer.slice(0, cols - 1), UI_DIM);
  };

  const key = (): Promise<string> =>
    new Promise<string>((resolve) => {
      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key.length !== 1 && ev.key !== "Enter" && ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        inputEvents.removeEventListener("keydown", onKey, true);
        resolve(ev.key);
      };
      inputEvents.addEventListener("keydown", onKey, true);
    });

  /** ONE key press, from the terminal's loop or from `host.invoke`; see the
   * update page's `act` on why this is shared rather than copied. */
  const act = async (pressed: string): Promise<boolean> => {
    if (pressed === "Escape") return false;

    /*
     * OPENING A TRACKER, and why this branch is first and holds no `await`.
     *
     * A browser only honours `window.open` while the gesture that asked for it is
     * still being handled. Anything awaited before the call spends that gesture
     * and the popup blocker takes the page, which presents as a key that does
     * nothing at all. So the lookup is a synchronous walk over rows this function
     * already has, and the open happens on the same tick as the key.
     *
     * Only in the saved phase: the keys are digits and letters that mean nothing
     * on the compose page, and claiming them there would take `1` away from a
     * screen that may one day want it.
     */
    if (view.phase === "saved") {
      const dest = reportDestinations(origins).find(
        (d) => d.key !== "" && d.key.toLowerCase() === pressed.toLowerCase(),
      );
      if (dest?.url != null) {
        const opened = openExternalUrl(dest.url);
        log.info(
          "report",
          opened
            ? `opened the tracker for ${dest.label}`
            : `could not open the tracker for ${dest.label}`,
          dest.url,
        );
        /* Said on the screen rather than only in the log. A refused popup is
         * indistinguishable from a broken link to the person looking at it, and
         * the address is already printed on the row below, so the recoverable
         * answer is to say so and leave them the address to copy. Cleared on a
         * success, or the warning outlives the failure it describes. */
        view = {
          ...view,
          ...(opened
            ? { notice: undefined }
            : { notice: `${dest.label} did not open. Its address is listed below.` }),
        };
        return true;
      }
    }

    if (pressed === "d" || pressed === "D") {
      /*
       * Three single-line prompts rather than one text area. get_string is
       * upstream's askfor_aux and it is what every other typed answer in this
       * game goes through; a multi-line editor would be a new input mode to
       * build, test and teach, for a field whose job is to point at the log.
       * An empty line stops early, so somebody with one sentence presses ENTER
       * twice and is done.
       */
      description.length = 0;
      for (let i = 0; i < REPORT_DESCRIPTION_LINES; i++) {
        const typed = await getString(
          surface,
          `Line ${String(i + 1)} of ${String(REPORT_DESCRIPTION_LINES)} (ENTER to stop): `,
          "",
          78 - 40,
        );
        if (typed === null || typed.trim() === "") break;
        description.push(typed);
      }
      view = { ...view, description: [...description] };
      return true;
    }

    if (pressed === "l" || pressed === "L") {
      /* Cycled rather than chosen from a list: there are four, they have an
       * order, and the only journey anybody makes is "turn it up". */
      const next = LOG_LEVELS[(LOG_LEVELS.indexOf(log.level) + 1) % LOG_LEVELS.length];
      if (next) {
        setLogLevel(next);
        log.warn("report", `logging level set to ${next} by the player`);
        view = { ...view, level: next };
      }
      return true;
    }

    if (pressed !== "Enter") return true;
    if (view.phase === "saved") return false;

    const text = reportText(reportInput(description));
    const bridge = updaterBridge() as (UpdaterBridge & {
      writeReport?: (t: string) => Promise<unknown>;
    }) | null;
    if (bridge?.writeReport) {
      const res = (await bridge.writeReport(text)) as
        | { ok?: boolean; path?: string; error?: string }
        | undefined;
      view = res?.ok
        ? { ...view, phase: "saved", savedAs: res.path }
        : { ...view, phase: "failed", error: res?.error };
    } else {
      /* The browser, which has no folder to write into. A download is the
       * closest thing it has to the same act, and the player already chose
       * where their downloads go. */
      const name = `neo-angband-report-${new Date().toISOString().replace(/[:.]/gu, "-")}.txt`;
      view = downloadUserFile(name, text)
        ? { ...view, phase: "saved", savedAs: name }
        : { ...view, phase: "failed", error: "this browser refused the download" };
    }
    /* Straight to disk, before anything else can go wrong - the log line about
     * having written it is the last thing a truncated log should be missing. */
    flushLog();
    return true;
  };

  /** The current page as a screen; `reportScreen` owns the shape, this the tone. */
  const screenNow = (): ScreenView =>
    reportScreen(
      view,
      reportLines(view).map((line) => ({ text: line.text, color: REPORT_TONE[line.tone] })),
      reportFooter(view),
      reportDestinations(origins),
    );

  const host: ScreenHost = {
    invoke: async (id: string): Promise<ScreenView | undefined> => {
      /* The three fixed keys, then the destination rows - which carry their own
       * key because how many there are depends on the player's mods. Looked up
       * from the same builder the screen drew from, so a presenter cannot invoke
       * a row the player was never shown. */
      const pressed =
        REPORT_ACTION_KEYS[id] ?? reportDestinations(origins).find((d) => d.id === id)?.key;
      /* An unknown id is a no-op returning the current view; see the update
       * page's host on why it is never an error. */
      if (pressed === undefined || pressed === "") return screenNow();
      const again = await announcedAction(screenNow(), id, () => act(pressed));
      return again ? screenNow() : undefined;
    },
  };

  owned = true;
  const taken = showThroughPresenter(screenNow(), screenFault, host);
  if (taken) {
    try {
      await taken;
      return;
    } catch (error: unknown) {
      /* The presenter died with the page open; show the player the page they
       * asked for, which the terminal loop below does. */
      if (!(error instanceof ScreenAbandoned)) throw error;
      owned = false;
    }
  } else {
    owned = false;
  }

  for (;;) {
    paint();
    if (!(await act(await key()))) return;
  }
  } finally {
    popRegion(handle);
  }
}

/** Tones to this shell's palette, so install-local.ts stays free of the terminal. */
const INSTALL_TONE: Record<InstallLine["tone"], string> = {
  head: UI_GOLD,
  body: UI_TEXT,
  dim: UI_DIM,
  good: UI_GOOD,
  warn: UI_BAD,
};

/** Tones to this shell's palette, so install-choice.ts stays free of the terminal. */
const INSTALL_CHOICE_TONE: Record<"head" | "body" | "dim", string> = {
  head: UI_GOLD,
  body: UI_TEXT,
  dim: UI_DIM,
};

/**
 * The choice ahead of "(I)nstall locally": the desktop app, or installing this
 * page itself as a PWA. See install-choice.ts for where each claim it shows
 * comes from.
 *
 * (D) opens the Releases page in the player's real browser. That is the whole
 * download flow this screen needs - `openExternalUrl` needs no bridge, and
 * "get the desktop build" already has one door (docs/RELEASING.md's own asset
 * table lives there, not duplicated into this screen). (W) hands off to the
 * existing PWA install screen (`showInstallPage`, below), which already reads
 * the live capabilities and does the one action a PWA install has: prompt, or
 * say where the browser's own button is.
 *
 * A REGION, for the same reason `showLevelMap` is one: this screen needs two
 * keys `showTextScreen` does not offer (D and W, not just ESC/Enter/Space), so
 * it paints itself rather than going through that helper - and a hand-painted
 * screen that skipped declaring its rectangle is exactly the full-screen-erase
 * gap `docs/modding/MOD_REACH.md`'s row 21 tracks. Declaring it here means this
 * screen adds nothing to that count. The split into a `show*`/`paint*` pair and
 * the `.finally(popRegion)` are copied from `showLevelMap` verbatim; the
 * painter's body only differs from a plain `term.clear()`/`print()` loop in
 * that `term` here is already the clipped region surface.
 */
function showInstallChoicePage(): Promise<void> {
  const handle = pushRegion(screenRegionSpec(), term.size());
  return paintInstallChoiceOnTerminal(regionSurface(term, handle.cells)).finally(() => {
    popRegion(handle);
  });
}

async function paintInstallChoiceOnTerminal(
  surface: GridSurface & GridPointerInput,
): Promise<void> {
  const lines = installChoiceLines({ canPromptInstall: canPromptInstall() });
  const footer = "[ D: desktop app   W: install as an app   ESC: back ]";
  /* Content runs longer than the 20 body rows a 24-row terminal leaves after
   * the title and footer - up to 26 lines, worst case. Scrolling reuses the
   * same top/maxTop and "(a-b/n)" footer cue as paintViewOnTerminal's
   * showTextScreen, rather than inventing a second convention for it; this
   * screen is hand-painted only because it needs the D/W keys that helper
   * does not offer, not because its body is exempt from that pattern. */
  let top = 0;

  const paint = (): void => {
    const { cols, rows } = surface.size();
    surface.clear();
    surface.print(0, 1, "Install Neo Angband locally".slice(0, cols - 1), UI_GOLD);
    const bodyRows = rows - 4;
    const maxTop = Math.max(0, lines.length - bodyRows);
    if (top > maxTop) top = maxTop;
    for (let r = 0; r < bodyRows; r++) {
      const line = lines[top + r];
      if (!line) break;
      surface.print(0, 3 + r, line.text.slice(0, cols - 1), INSTALL_CHOICE_TONE[line.tone]);
    }
    const more =
      maxTop > 0 ? `  (${top + 1}-${Math.min(top + bodyRows, lines.length)}/${lines.length})` : "";
    surface.print(0, rows - 1, (footer + more).slice(0, cols - 1), UI_DIM);
  };

  const key = (): Promise<KeyboardEvent> =>
    new Promise<KeyboardEvent>((resolve) => {
      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key.length !== 1 && ev.key !== "Escape" && !menuNav(ev)) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        inputEvents.removeEventListener("keydown", onKey, true);
        resolve(ev);
      };
      inputEvents.addEventListener("keydown", onKey, true);
    });

  for (;;) {
    paint();
    const ev = await key();
    const { rows } = surface.size();
    const bodyRows = rows - 4;
    const maxTop = Math.max(0, lines.length - bodyRows);
    const nav = menuNav(ev);
    if (nav) {
      if (nav === "up") top = Math.max(0, top - 1);
      else if (nav === "down") top = Math.min(maxTop, top + 1);
      else if (nav === "pageup") top = Math.max(0, top - Math.max(1, bodyRows - 1));
      else if (nav === "pagedown") top = Math.min(maxTop, top + Math.max(1, bodyRows - 1));
      else if (nav === "home") top = 0;
      else if (nav === "end") top = maxTop;
      continue;
    }
    const pressed = ev.key;
    if (pressed === "Escape") return;
    if (pressed === "d" || pressed === "D") {
      /* Synchronous, and before anything else: a browser only honours
       * window.open while the gesture that asked for it is still being
       * handled - see external-link.ts. */
      const url = `https://github.com/${UPDATE_REPO}/releases`;
      const opened = openExternalUrl(url);
      await showTextScreen(term, "Getting the desktop app", [
        opened
          ? { text: "Opening the Releases page in your browser.", color: UI_GOOD }
          : { text: "Could not open a new tab. Go to this address:", color: UI_BAD },
        ...(opened ? [] : [{ text: url, color: UI_TEXT }]),
        { text: "", color: UI_TEXT },
        { text: "Download the build for your system, then run it.", color: UI_TEXT },
      ]);
      return;
    }
    if (pressed === "w" || pressed === "W") {
      await showInstallPage();
      return;
    }
  }
}

/**
 * The (I)nstall locally page's PWA half, reached by pressing (W) on the choice
 * screen above - and the one action it offers.
 *
 * ENTER installs, when the browser gave the page a prompt to show; showTextScreen
 * already closes on ENTER, so the install is attached to the same key the player
 * would press to dismiss the page - which is only honest because the page says so
 * in the line above the footer, and because a browser that offered no prompt
 * shows different text there.
 */
async function showInstallPage(): Promise<void> {
  const lines = installLines({
    isDesktop: desktopBridge !== null,
    isStandalone: isStandalone(),
    canPickFolder: folderPickingSupported(),
    canPromptInstall: canPromptInstall(),
    caps: host().capabilities,
  });
  const offer = canPromptInstall();
  await showTextScreen(
    term,
    "Install Neo Angband on this computer",
    lines.map((l) => ({ text: l.text, color: INSTALL_TONE[l.tone] })),
    offer ? "[ ENTER to install - ESC to go back ]" : "[ ESC to go back ]",
  );
  if (offer && (await promptInstall())) {
    await showTextScreen(term, "Installed", [
      { text: "Neo Angband is installed.", color: UI_GOOD },
      { text: "", color: UI_TEXT },
      { text: "Look for it where your other apps live. Your characters are", color: UI_TEXT },
      { text: "already there - it is this same game in its own window.", color: UI_TEXT },
    ]);
  }
}

/**
 * One pre-game menu's answer.
 *
 * "back" is deliberately NOT null. The pre-game flow has two genuinely different
 * outcomes that a nullable result conflates, and conflating them is what broke
 * ESC at both boundaries: "the player stepped back one level" (put the level above
 * up again) versus "there is nothing here to choose" (the menu was suppressed or
 * empty, so fall through). openRoster used to answer `false` for the first and
 * bootMenus read that as the second, so ESC out of the character picker dropped
 * into character creation instead of returning to the title.
 *
 * This is upstream's own hierarchical-back rule (ui-birth.c:804-806, ":we allow
 * use of 'back' ... as well as 'escape'") carried up into the shell's menu stack,
 * where menu_select's EVT_ESCAPE pops ONE level and the caller decides what the
 * level above is (ui-menu.c menu_select / ui-birth.c:807-811).
 */
type BootStep = "done" | "back";

// Boot-time flow: the title screen first, then a resumed character plays
// immediately; otherwise pick from the roster (when other characters are saved)
// or birth a brand-new one.
async function openRoster(): Promise<BootStep> {
  // Whether this origin's storage is exempt from the browser's own eviction. A
  // query, never a request: the request happens when a save lands (persistSave),
  // which is a moment the player caused and has something to protect.
  const durability = await storageDurability();
  return openModal(async () => {
    for (;;) {
      const roster = listRoster();
      const res = await runCharacterSelect(
        term,
        roster,
        durabilityNotice(durability, roster.length),
      );
      if (res.action === "delete") {
        deleteSlot(res.id);
        if (livingRoster().length === 0) {
          newGame();
          return "done";
        }
        continue;
      }
      /* ESC: cancelling the picker steps back one level - to the title - it does
       * not pick, and it does not fall through into character creation. */
      if (res.action === "back") return "back";
      if (res.action === "export") {
        await exportCharacter(res.id);
        continue;
      }
      if (res.action === "import") {
        await importCharacter();
        continue;
      }
      if (res.action === "storage") {
        await showStoragePage();
        continue;
      }
      if (res.action === "resume") {
        /* Back to the list rather than into the character: another window has
         * them, and letting this one in would start the two-tab overwrite this
         * check exists to prevent. */
        if (await refusedAsPlayedElsewhere(res.id)) continue;
        resumeSelected(res.id);
        return "done";
      }
      /* "New character": through the ONE birth path, so ESC in birth still comes
       * back up here rather than being a dead end. newGame reloads with the
       * fresh-start flag; the reload's bootMenus runs birth. */
      newGame();
      return "done";
    }
  });
}

/**
 * Write one character to a file the player can carry elsewhere.
 *
 * Only a LIVING character can be exported, and not as a policy: a dead slot's
 * bytes are deleted by markDead, so there is nothing to write. The picker already
 * refuses the key on a tombstone; this re-checks rather than trusting it, because
 * the two are edited in different files.
 */
async function exportCharacter(id: string): Promise<void> {
  const meta = listRoster().find((c) => c.id === id);
  const save = readSlotSave(id);
  if (!meta || !save) {
    await showTextScreen(term, "Export character", [
      { text: "That character has no save to export.", color: UI_BAD },
      { text: "", color: UI_TEXT },
      { text: "A character who has died leaves a memorial, not a save.", color: UI_DIM },
    ]);
    return;
  }
  const transfer: TransferMeta = {
    name: meta.name,
    race: meta.race,
    cls: meta.cls,
    sex: meta.sex,
    level: meta.level,
    depth: meta.depth,
    maxDepth: meta.maxDepth,
    turn: meta.turn,
    alive: meta.alive,
  };
  /* NOT transferMetaFromState here: this reads a ROSTER entry (any character,
   * possibly not the one running), while that helper reads the LIVE game
   * state for the active id - persistSave's case, not this one. */
  const name = transferFilename(transfer);
  const ok = downloadUserFile(
    name,
    encodeTransfer({
      meta: transfer,
      save,
      engine: ENGINE_VERSION,
      exportedAt: new Date().toISOString(),
      /* WHO, not which slot. This is what lets the receiving roster - including
       * this one, later - tell this character apart from a stranger, and it is
       * the whole mechanism behind transfer-gate.ts. */
      lineage: lineageOf(meta),
    }),
    "application/json",
  );
  await showTextScreen(term, "Export character", [
    ok
      ? { text: `${meta.name || "(unnamed)"} written to ${name}.`, color: UI_GOOD }
      : { text: "This browser refused the download.", color: UI_BAD },
    { text: "", color: UI_TEXT },
    ...(ok
      ? [
          { text: "Open the other copy of the game, come back to this screen,", color: UI_TEXT },
          { text: "and press Shift-M to bring the character in.", color: UI_TEXT },
          { text: "", color: UI_TEXT },
          {
            text: "This character is still here too, and this file is not a restore",
            color: UI_DIM,
          },
          {
            text: "point: it will only import back over them once it is FURTHER on,",
            color: UI_DIM,
          },
          { text: "and never at all once they have died here.", color: UI_DIM },
        ]
      : []),
  ]);
}

/**
 * Read a character file and give it a slot.
 *
 * Never on top of a DIFFERENT character: the file carries no slot id
 * (save-transfer.ts says why), so a stranger always gets a fresh slot - which
 * matters most in the case a player will actually hit, importing the same file
 * twice. What it may land on top of is ITSELF: a character who left this roster
 * and comes back further along takes their own slot again rather than becoming a
 * second copy. transfer-gate.ts draws that line, and is also what refuses a file
 * that would be a restore point.
 */
async function importCharacter(): Promise<void> {
  const picked = await pickTextFile(`${TRANSFER_EXT},application/json`, MAX_TRANSFER_TEXT_BYTES);
  if (!picked) return; // cancelled
  if ("tooLarge" in picked) {
    await showTextScreen(term, "Import character", [
      { text: `${picked.name} was not imported.`, color: UI_BAD },
      { text: "", color: UI_TEXT },
      { text: "That character file is larger than the 5 MiB import limit.", color: UI_TEXT },
    ]);
    return;
  }
  const read = decodeTransfer(picked.text);
  if (!read.ok) {
    await showTextScreen(term, "Import character", [
      { text: `${picked.name} was not imported.`, color: UI_BAD },
      { text: "", color: UI_TEXT },
      { text: read.why, color: UI_TEXT },
    ]);
    return;
  }
  const { meta, save } = read.file;
  const decision = decideImport(read.file, listRoster(), listDeaths());
  if (decision.kind === "refused") {
    await showTextScreen(term, "Import character", [
      { text: `${picked.name} was not imported.`, color: UI_BAD },
      { text: "", color: UI_TEXT },
      ...decision.why.map((text) => ({ text, color: text === "" ? UI_TEXT : UI_DIM })),
    ]);
    return;
  }
  /* "replace" is the same character taking their own slot back, so the id is
   * theirs; anything else is a stranger and gets a new one. */
  const id = decision.kind === "replace" ? decision.id : newCharId();
  const ok = writeSlot(id, save, {
    id,
    /* Carried, not re-minted: this is what makes the character the same person
     * next time they travel. A file with no lineage (an export from before the
     * field existed) is born into this roster as its own slot id, which is what
     * lineageOf answers for every pre-existing character too. */
    ...(read.file.lineage !== undefined ? { lineage: read.file.lineage } : {}),
    name: meta.name,
    race: meta.race,
    cls: meta.cls,
    sex: meta.sex,
    level: meta.level,
    depth: meta.depth,
    maxDepth: meta.maxDepth,
    turn: meta.turn,
    alive: meta.alive,
    /* NOW, not the file's exportedAt: this list is ordered by when a character was
     * last touched HERE, and a months-old export would arrive buried. */
    updatedAt: Date.now(),
  });
  await showTextScreen(term, "Import character", [
    ok
      ? { text: `${meta.name} the ${meta.race} ${meta.cls} is now in your roster.`, color: UI_GOOD }
      : { text: "This browser would not store the character.", color: UI_BAD },
    { text: "", color: UI_TEXT },
    ...(ok
      ? decision.kind === "replace"
        ? [
            { text: "Back in their own slot, further on than the copy that was", color: UI_TEXT },
            { text: "here. Nobody else was touched. Select them to play.", color: UI_TEXT },
          ]
        : [
            { text: "In a new slot of their own - nothing you already had was", color: UI_TEXT },
            { text: "touched. Select them to play.", color: UI_TEXT },
          ]
      : [{ text: "Storage is full, or disabled for this site.", color: UI_TEXT }]),
  ]);
}

/** IDM_FILE_NEW (main-win.c:3501). */
async function startNewCharacter(): Promise<BootStep> {
  /* A boot with nothing to resume has already built a fresh game and claimed a
   * slot for it, so birth can run in place - and its "back" has to reach
   * bootMenus, which is why this is awaited rather than fired and forgotten.
   * Anything else has a live character to leave behind first, which newGame does
   * through a reload. */
  if (!resumedActive && !needsSelect) return maybeBirth();
  newGame();
  return "done";
}

/**
 * The pre-game menu stack: title -> (load | open the roster | new -> birth).
 *
 * ONE loop, and every level answers BootStep, so "the player pressed ESC" walks
 * back up a level at a time until the title is showing again - ui-birth.c's
 * hierarchical-back rule (:804-806) applied to the whole boot, which is what the
 * player asked for. The two boundaries that used to leak:
 *
 *   - ESC out of the character picker with the title suppressed (a continuation
 *     boot) fell THROUGH to maybeBirth, so backing out of the roster started
 *     character creation.
 *   - birth's own first-stage ESC looped forever (`while (!choice)`), so once you
 *     were in creation there was no way back to the title at all.
 */
async function bootMenus(): Promise<void> {
  /*
   * THE LOADING SCREEN ENDS HERE, and it ends at the ONE ENTRY to the menu
   * stack rather than at one of maybeTitle's four EXITS.
   *
   * It used to sit inside maybeTitle, one line above paintTitleArt. Three of
   * that function's four returns never reached it - `?agent=`, SKIP_TITLE and
   * BIRTH_DONE all answer null before it - and two of those three go on to
   * paint a real screen. So the animation kept its 90ms interval and kept
   * calling term.clear(), and whatever came next was drawn and erased eleven
   * times a second. Measured on the shipped Windows build, 2026-08-13: (N)ew
   * game from the title sets SKIP_TITLE (newGame), reloads, and the birth
   * screen was LIVE and invisible underneath - killing the interval from
   * outside made the race menu appear, mid-prompt, exactly where it should
   * have been. No character could be created at all (#251). Switch character
   * takes the same route and lost the roster the same way.
   *
   * Everything the loading screen is for - mod resources, the tile atlas, the
   * save - has already finished by the time this is called, and every route out
   * of here hands the terminal to a screen. So one unconditional stop at the
   * top is the whole rule, and there is no exit left for it to hide behind.
   * It stays idempotent, and boot's tail still calls it for the routes that
   * return from here without painting anything.
   */
  stopLoading();
  /* ?agent= suppresses the title for the whole session (maybeTitle's first line),
   * so there is no level above to back up TO and no loop to make infinite: an
   * autoplayer boot keeps the old fall-through. Every other suppressor
   * (SKIP_TITLE, BIRTH_DONE) is one-shot and cleared on the first pass, so the
   * second time round the title really does appear. */
  const canReturnToTitle = !params.get("agent");
  for (;;) {
    const choice = await maybeTitle();
    /* Title suppressed (autoplayer, post-birth rebuild, or an internal
     * continuation reload): the pre-title-menu flow. */
    if (choice === null) {
      if (resumedActive) return;
      if (needsSelect) {
        if ((await openRoster()) === "done") return;
        if (canReturnToTitle) continue; // ESC: up to the title
      }
      if ((await maybeBirth()) === "done") return;
      if (!canReturnToTitle) return;
      continue; // ESC out of birth: up to the title
    }
    /* IDM_FILE_EXIT at the splash (main-win.c:3568): with no game in progress it
     * just quits. Only offered when desktopQuitAvailable() said yes, so there is
     * no browser fallback to write here. */
    if (choice === "quit") {
      desktopQuit();
      return;
    }
    /* Not a File-menu item and not a way into the game: read it, then back to the
     * title, the same as ESC out of any other pre-game screen. */
    if (choice === "install") {
      await openModal(() => showInstallChoicePage());
      continue;
    }
    /* Same shape as (I)nstall locally: read it, act or do not, come back to the
     * title. The one path that does NOT come back is a successful swap, which
     * ends with the process exiting. */
    if (choice === "update") {
      await openModal(() => showUpdatePage());
      continue;
    }
    if (choice === "new") {
      if ((await startNewCharacter()) === "done") return;
      continue; // ESC off birth's first stage: back to the title
    }
    /* "Load last save": the most recent living character, straight in. A boot
     * that already resumed one IS that character, so there is nothing to do. */
    if (choice === "load") {
      if (resumedActive) return;
      const recent = livingRoster()[0];
      if (recent) {
        /* The same refusal the picker gives, because this is the same act with
         * the list skipped. Refused, it falls through to the picker below rather
         * than stalling on the title with nothing said. */
        if (!(await refusedAsPlayedElsewhere(recent.id))) {
          resumeSelected(recent.id);
          return;
        }
      }
      /* Nothing living after all: show the picker rather than stalling. */
    }
    /* IDM_FILE_OPEN (main-win.c:3518) raises a picker over the save directory;
     * the port's picker is the character-select screen. */
    if ((await openRoster()) === "done") return;
    /* ESC: round the loop, which puts the title back up. */
  }
}

/**
 * Open the Graphics screen once, if the reload that just happened was a mod apply
 * that newly enabled a tile mod (SHOW_GRAPHICS_KEY).
 *
 * A tiles mod contributes Graphics ROWS and nothing else, composed at boot, so
 * enabling one is meant to leave the map exactly as it was until the player picks
 * a row. That is correct and it reads as broken - the reported symptom was
 * "enabling it does nothing and the imagery stayed as text glyphs". So the apply
 * hands the player straight to the screen where the new rows are.
 *
 * One-shot and cleared before the screen opens, so a refresh afterwards does not
 * reopen it, and a crash inside the menu cannot wedge every future boot in it.
 */
async function maybeShowGraphics(): Promise<void> {
  try {
    if (sessionStorage.getItem(SHOW_GRAPHICS_KEY) !== "1") return;
    sessionStorage.removeItem(SHOW_GRAPHICS_KEY);
  } catch {
    return; /* no sessionStorage: nothing was ever set */
  }
  await runTileModePage(term, tileModeMenu);
}

/**
 * reset_visuals(true) at ui_leave_init (ui-display.c L2700-2703): re-read the
 * graphics pref file now that the character is known.
 *
 * The boot pass at module scope runs before birth or a save load has settled, so
 * every `?:[EQU $CLASS ...]` block in the pack's xtra file bypassed and the
 * player drew the pack's generic figure. bootMenus() resolving is the port's
 * ui_leave_init: a game is in play and its race and class are final.
 *
 * A no-op in ASCII, and the atlas refetch is a cache hit, so the visible cost is
 * one reparse and one repaint.
 */
async function resetVisualsForCharacter(): Promise<void> {
  if (!currentGrafID || currentGrafID === GRAPHICS_NONE) return;
  await applyTileMode(currentGrafID);
}

/**
 * Hand the enabled mods' verified resources to the five things that read them
 * (MOD_REACH gap 7).
 *
 * BEFORE bootMenus, because two of the five are already on screen by the time it
 * resolves: the font decides the size of every cell, and the splash is what the
 * title screen paints. A font arriving later would mean tearing the terminal
 * down and rebuilding it mid-screen; art arriving later would mean the player
 * watching the title change under them.
 *
 * Each consumer is wrapped on its own. A mod's pref file that will not parse
 * must not cost the player the mod's SOUND pack, and none of the five may cost
 * them the game - so a throw anywhere in here becomes a line on a mod's row and
 * boot carries on with core's own resources, which is exactly what would have
 * happened had the mod not been installed.
 */
async function applyModResources(): Promise<void> {
  await installModResources();

  const font = await modFontData();
  if (font !== null) term.setBitmapFont(font);

  modSoundPack = await modSoundBase();

  const splash = await modArtLines("splash");
  setSplashArt(splash);

  /* PREF FILES ACCUMULATE, in load order - a `.prf` is a list of assignments and
   * layering them is what upstream's own pref pipeline does. Applied after the
   * font because a pref file may set glyphs the font has to already be able to
   * draw. */
  const ctx = prefsUiCtx();
  const nextTilePrefTexts: ModPrefText[] = [];
  for (const pref of modPrefResources()) {
    const resolve = pref.resolve;
    if (resolve === null) continue;
    const url = await resolve(pref.resource.path);
    if (url === null) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      /* `%:` INCLUDES RESOLVE BESIDE THE INCLUDING RESOURCE (#278), which is the
       * mod-folder reading of upstream's flat directory search: a pack's
       * `%:flvr-x.prf` sits next to its `graf-x.prf`, and `loadTilePrefs` has
       * always resolved one against the other's directory. Every include of
       * every depth is resolved against the declared resource's directory, so a
       * mod lays its pref files out in one folder rather than reasoning about
       * which file asked. */
      const dir = pref.resource.path.replace(/[^/]*$/u, "");
      const applied = await applyPrefText(
        ctx,
        text,
        pref.resource.path,
        async (name) => {
          const at = await resolve(`${dir}${name}`);
          if (at === null) return null;
          const r = await fetch(at);
          return r.ok ? await r.text() : null;
        },
      );
      /* Keep the exact bytes that reach the GlyphTable - and the include bytes
       * with them - so every fresh graphics map can replay the tile directives
       * without resolving the mod again. */
      nextTilePrefTexts.push({ text, includes: applied.includes });
      for (const line of applied.faults) {
        reportModFault(pref.modId, line);
      }
    } catch (e) {
      reportModFault(
        pref.modId,
        `pref file "${pref.resource.path}" could not be applied (${faultMessage(e)})`,
      );
    }
  }
  modTilePrefTexts = nextTilePrefTexts;

  /* TRANSLATIONS, before anything that prints. Each file was verified above -
   * valid JSON, a readable language tag, and a tag agreeing with its slot - so
   * what is left here is reading it and handing it to core.
   *
   * A translation is DATA and gets no consent prompt; a translation that needs
   * to change how text is ASSEMBLED (Japanese counters, German case endings)
   * ships a plugin.js and calls core's registerLocale itself, through the
   * ordinary code path with the ordinary consent. That is why this loop only
   * carries messages: it is the half that is safe by construction. */
  for (const locale of modLocaleResources()) {
    if (locale.resolve === null) continue;
    const url = await locale.resolve(locale.resource.path);
    if (url === null) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      registerLocale((await res.json()) as LocaleBundle);
    } catch (e) {
      reportModFault(
        locale.modId,
        `translation "${locale.resource.path}" could not be read (${faultMessage(e)})`,
      );
    }
  }
  /* ENGLISH UNLESS ASKED OTHERWISE. `?lang=` is a one-off override for testing
   * and for a link; otherwise the player's saved choice; otherwise English.
   * NOT `navigator.language`, deliberately - the game is English by default, and
   * silently switching a player's game because their browser is set to French
   * would be a surprise they did not ask for and might not be able to undo. */
  const chosenLocale = params.get("lang") ?? readStoredLocale();
  if (chosenLocale !== null) setLocale(chosenLocale);

  const pages: { slot: string; label: string; lines: ScreenLine[] }[] = [];
  for (const page of modHelpResources()) {
    if (page.resolve === null) continue;
    const url = await page.resolve(page.resource.path);
    if (url === null) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      pages.push({
        slot: page.resource.slot ?? page.resource.path,
        /* The mod's own `name`, then the mod's display name - a row in the help
         * index has to say something, and "which mod is this from" is the useful
         * thing for it to say when the author did not name the page. */
        label: page.resource.name ?? page.modName,
        lines: helpLinesFromText(await res.text()),
      });
    } catch (e) {
      reportModFault(
        page.modId,
        `help page "${page.resource.path}" could not be read (${faultMessage(e)})`,
      );
    }
  }
  setModHelpPages(pages);
}

void applyModResources()
  .catch((e: unknown) => {
    /* The whole pass, as the last net under the per-consumer ones. A resource is
     * decoration; the game starting is not. */
    reportModFault("mods", `resources could not be applied (${faultMessage(e)})`);
  })
  .then(bootMenus)
  .then(() => {
    /* A game is in play: the map is now the honest thing to draw, and every
     * background repaint from here (atlas, prefs, resize, animation tick) is
     * allowed through. Belt and braces on the loading screen - maybeTitle stops
     * it before it paints - because this is the one line every boot route
     * passes through, including the ones that never see a title at all.
     * stopLoading is idempotent for exactly that reason. */
    stopLoading();
    gameScreenLive = true;
    render();
  })
  .then(resetVisualsForCharacter)
  .then(maybeShowGraphics)
  .then(confirmPendingAutoplayerInstall);

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
    /* glyphs: the live x_char table (agent API 1.1.0) - an agent that draws a
     * map should draw the player's map, pref-file overrides and all. */
    viewDeps: { resolver, reg: booted.registries.objects, glyphs: glyphs.agentGlyphs() },
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
    if (scoresOpen) return;
    if (modalDepth > 0) {
      /* Not "wait out birth / menus" any more: a prompt raised by the agent's
       * own turn is the agent's to answer (see answerBlockingPrompt). Before
       * gameScreenLive the birth flow owns the terminal, so this still waits. */
      if (gameScreenLive) answerBlockingPrompt(`agent:${agentId}`);
      return;
    }
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

/**
 * The one autoplayer slot (ModPlugin.controller). Null while the human has the
 * keyboard. A single slot rather than a set because installController swaps a
 * single state.nextCommand: two of them is not "two autoplayers", it is one
 * autoplayer and one mod that thinks it is running and is not.
 */
let installedController: { id: string; session: AgentSession } | null = null;

/**
 * Re-paces the live autoplayer pump to a newly chosen speed tier, when one is
 * installed - null while `installedController` is null. Set alongside it (the
 * controller-install loop below), cleared alongside it (reloadAfterModChange).
 * The mod manager's "Autoplayer speed" row (mods.ts) calls through this rather
 * than through `installedController` directly, because a slot ID is not enough
 * to rebuild a `setInterval` at a new rate - only the closure that owns the
 * timer can do that.
 */
let installedControllerSpeed: ((speed: AutoplayerSpeed) => void) | null = null;

/**
 * Hands the keyboard back on demand - a real keypress (input-door.ts's
 * AutoplayerInterruptOwner) or Ctrl-Z pressed while an autoplayer is already
 * running (#125). Null on the same schedule as `installedController`: set
 * alongside it in the controller-install loop below, cleared alongside it here
 * and in reloadAfterModChange (which tears the whole mod down instead, for a
 * page reload rather than a live hand-back).
 */
let stopInstalledController: (() => void) | null = null;

/**
 * A candidate autoplayer the boot-time controller-install loop held back
 * (#125): its `controller()` returned a real controller, but the save has
 * never granted it the keyboard before (NOSCORE.BORG unset), so installing it
 * at once would be the silent activation this bug is about. Resolved by
 * confirmPendingAutoplayerInstall once the game screen is live - to an
 * install (finishAutoplayerInstall), or to nothing on a decline - and cleared
 * without resolving by reloadAfterModChange, on the same reasoning as
 * installedController: a reload is a fresh boot, and the new one runs this
 * whole gate again from scratch.
 */
let pendingAutoplayerInstall: { loaded: LoadedModPlugin; controller: AgentController } | null =
  null;

function installSandbox(pluginId: string): void {
  const found = discoverPlugins().get(pluginId);
  if (!found) {
    log.warn("plugins", `"${pluginId}" not found; skipping`);
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
      viewDeps: {
        resolver,
        reg: booted.registries.objects,
        /* The same live table the shell draws from (agent API 1.1.0), so an
         * agent's map is the player's map - including any pref file or glyph
         * picker change, which is the whole reason this is a table and not a
         * lookup. */
        glyphs: glyphs.agentGlyphs(),
      },
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
      if (scoresOpen) return;
      if (modalDepth > 0) {
        /* The sandboxed autoplayer answers its own prompts too, on the same
         * terms as the mod pump below (answerBlockingPrompt). */
        if (gameScreenLive) answerBlockingPrompt(`plugin:${pluginId}`);
        return;
      }
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
    log.warn("trusted", `"${trustedId}" not found; skipping`);
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
          profiles: booted.registries.profiles,
          blows: state.blowEffects ?? null,
          stores: state.storeBehaviour ?? null,
          commands: registry,
          commandVerbs: state.commandVerbs ?? null,
          state,
          projections: state.projectionHandlers ?? null,
          uiEntry: state.uiEntry ?? null,
          glyphs: booted.registries.rooms.glyphs,
          effectInfo: effectInfoRegistry(),
          randart: randartRegistry(),
          tval: tvalRegistry(),
          rune: runeRegistry(),
          vocab: trustedVocab,
          menus: menuRegistry.forOwner(trustedId),
          tiles: tileRegistry.forOwner(trustedId),
        },
        caps,
      );
      found.plugin.register(host, {
        state,
        id: trustedId,
        log: (msg) => {
          logs.push(msg);
          log.info(`trusted:${trustedId}`, `${msg}`);
        },
      });
    } catch (err) {
      trustedError = err instanceof Error ? err.message : String(err);
      log.error(`trusted:${trustedId}`, `install failed:`, err);
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
          log.warn("mods", `"${id}" enabled but capabilities not consented; skipping`);
        }
        continue;
      }
      const tr = trustedMods.get(id);
      if (tr) {
        if (consentSatisfied(tr.manifest.capabilities ?? [], consents[id] ?? [])) {
          installTrusted(id);
        } else {
          log.warn("mods", `"${id}" enabled but capabilities not consented; skipping`);
        }
      }
    }
  }
} catch (err) {
  log.warn("mods", "persisted-enable auto-install failed", err);
}

/* The FOLDER plugins' register() half.
 *
 * A bundled trusted.ts reaches the five capability-gated registries through
 * installTrusted above; this is the identical thing for a plugin that came from a
 * folder, and it is the half that had no path at all - the registry facades
 * existed, were tested, and in a release build had no non-test caller, because the
 * only way to reach them was a module compiled into the app.
 *
 * mod-code.ts already applied every gate before importing, including consent, so
 * a plugin that reaches here has been agreed to. The capability set is still built
 * from the MANIFEST and still gates each facade at every call: consent says the
 * player allowed these domains, CapabilitySet says the mod asked for them, and a
 * facade the mod did not declare throws even though it was consented to something
 * else.
 */
const folderRuleFlags = resolveModRuleFlagsByMod();

/* What every plugin is told about THIS session, built once so the three places
 * that make a context cannot disagree about it.
 *
 * `newCharacter` is bootedNew AND the birth screen having finished. bootedNew
 * alone is true of the throwaway default game that runs BEHIND the birth screen
 * before the player has chosen anything - a mod seeding that character would be
 * seeding one that is about to be discarded, and the reload after birth would
 * ask it again anyway. */
const sessionFacts: ModSessionFacts = { newCharacter: bootedNew && !birthPending };

/* Each mod's own save bag, brought up to the schema that mod is now at, BEFORE
 * any of its other code runs (mod-bags.ts).
 *
 * This is the first moment a bag exists - the save has been read - and the last
 * one before a plugin could read its own. Core has shipped `migrateModBag` and
 * carried `saveSchema` through the manifest since the seam was designed, with no
 * caller and no way for a mod to supply the migrator, so a mod that changed the
 * shape of its own data was handed the OLD shape at the new version and could not
 * tell.
 *
 * FOLDER plugins only, which is where every real mod now comes from: the game
 * bundles none, and the one bundled plugin.ts left is a dev-only demo whose
 * manifest declares no saveSchema. */
{
  const bagOwners = activeModCode().plugins.map((loaded) => {
    const migrateBag = loaded.plugin.migrateBag;
    return {
      id: loaded.id,
      saveSchema: loaded.manifest.saveSchema,
      migrate: migrateBag
        ? (data: JsonValue, from: number): JsonValue =>
            migrateBag.call(
              loaded.plugin,
              data,
              from,
              modPluginContext(
                loaded.id,
                folderRuleFlags.get(loaded.id) ?? {},
                state,
                modOwnFiles(loaded.data),
                sessionFacts,
              ),
            ) as JsonValue
        : undefined,
    };
  });
  const bags = migrateModBags(game.mods, bagOwners);
  /* Written back onto the StartedGame, which is what saveGame reads - not onto
   * GameState, which does not carry the bags at all. A migration that rewrote a
   * copy nobody saves would be the same no-op this task set out to fix. */
  game.mods = { ...bags.bags };
  for (const p of bags.problems) if (p.id !== null) reportModFault(p.id, p.why);
  if (bags.migrated.length > 0) {
    log.info("mods", `migrated saved data for: ${bags.migrated.join(", ")}`);
  }
}

for (const loaded of activeModCode().plugins) {
  const register = loaded.plugin.register;
  if (!register) continue;
  try {
    const host = createModRegistryHost(
      {
        effects: effectRegistry,
        rooms: booted.registries.rooms,
        profiles: booted.registries.profiles,
        blows: state.blowEffects ?? null,
        stores: state.storeBehaviour ?? null,
        commands: registry,
        commandVerbs: state.commandVerbs ?? null,
        state,
        projections: state.projectionHandlers ?? null,
        uiEntry: state.uiEntry ?? null,
        glyphs: booted.registries.rooms.glyphs,
        effectInfo: effectInfoRegistry(),
        randart: randartRegistry(),
        tval: tvalRegistry(),
        rune: runeRegistry(),
        vocab: new VocabularyRegistry(),
        menus: menuRegistry.forOwner(loaded.id),
        tiles: tileRegistry.forOwner(loaded.id),
      },
      CapabilitySet.fromManifest(loaded.manifest),
    );
    register.call(
      loaded.plugin,
      host,
      modPluginContext(
        loaded.id,
        folderRuleFlags.get(loaded.id) ?? {},
        state,
        modOwnFiles(loaded.data),
        /* `capabilities` gates ctx.backupFolder (#133) - this mod's OWN
         * resolved set, the same value `createModRegistryHost` above already
         * computed for it, not recomputed differently. */
        { ...sessionFacts, capabilities: CapabilitySet.fromManifest(loaded.manifest) },
      ),
    );
    installedPluginIds.add(loaded.id);
  } catch (err) {
    /* One mod's bad register() loses that mod and nothing else. A third-party
     * plugin throwing must not take the game, or the other mods, down.
     *
     * REPORTED as well as logged: a console.error is not a channel a player has, so
     * this mod was enabled, consented to, listed as loaded, and registering nothing,
     * with the only evidence in devtools. */
    reportModFault(
      loaded.id,
      `register() failed, so its effects, rooms and commands are not installed: ${faultMessage(err)}`,
    );
    log.error(`mod:${loaded.id}`, `register() failed:`, err);
  }
}

/* The display slot is last-load-wins, unlike the autoplayer's historical
 * first-claim guard. Select BEFORE invoking: a lower front end never gets a
 * chance to mount anything when a later mod replaces it.
 *
 * CORE'S RENDERER IS CANDIDATE ZERO, in the same list and under the same rule.
 * It is not a fallback the selection falls through to - it is what wins when no
 * mod outranks it, and what a faulting replacement hands the map back to. A mod
 * must hold `display:replace` to be eligible at all; declaring frontend()
 * without it is reported against that mod and leaves core drawing. */
function displayCandidateContext(id: string): ModPluginContext {
  const loaded = activeModCode().plugins.find((plugin) => plugin.id === id);
  /* Candidate zero has no pack behind it, so there are no own-files and no
   * folder rules to hand it - but it goes through the same call, with the
   * same session facts, because a candidate invoked differently would be the
   * special case this list exists to remove. */
  if (!loaded) {
    return modPluginContext(
      id,
      {},
      state,
      {},
      sessionFacts,
    );
  }
  return modPluginContext(
    id,
    folderRuleFlags.get(id) ?? {},
    state,
    modOwnFiles(loaded.data),
    /* `capabilities` for the same reason the register() loop above passes it:
     * every capability-gated ctx member is absent without it. It matters here
     * and not only there, because a mod's panel is opened from a player action -
     * a tap on one of its regions - and the context a `regions()` declaration
     * closed over is one of the two it could have got `ctx.ui` from. A candidate
     * with no pack behind it (core's own renderer, above) has no manifest to
     * read, which is the one case that legitimately has none. */
    { ...sessionFacts, capabilities: CapabilitySet.fromManifest(loaded.manifest) },
  );
}

installedFrontend = installFrontend(
  [coreFrontend, ...activeModCode().plugins],
  displayCandidateContext,
  reportDisplayFault,
);
liveWorldSink = frontendWorldFrameSink(installedFrontend, reportDisplayFault);

/* THE HUD, region by region. Same rule, applied three times: the last enabled
 * mod holding `ui:<region>.replace` draws that region, and everything nobody
 * claimed stays core's and keeps being drawn. That is the difference from the
 * map - a mod can take the vitals without taking the message line with it, and a
 * player consenting is told which part of their screen is changing hands.
 *
 * Selected from the MANIFESTS before anybody is invoked, so a losing candidate
 * never mounts UI it will never draw into. See hud-runtime.ts for why that makes
 * the capability the claim. */
installedHud = installHud(
  [coreHud, ...activeModCode().plugins],
  displayCandidateContext,
  reportDisplayFault,
);
liveHudSink = hudFrameSink(installedHud, reportDisplayFault);

/* THE MENUS. One grant for all of them (`ui:menu.replace`) rather than one per
 * menu id, which would be a consent list nobody could read; the finer choice is
 * made per question, where a presenter declines whatever it has no better way to
 * ask. Installed into a module-level holder because `selectFromMenu` is called
 * from ~50 sites, and a mod being disabled takes effect on reload anyway. */
setUiFaultReporter(reportDisplayFault);
setMenuPresenter(
  installMenu([...activeModCode().plugins], displayCandidateContext, reportDisplayFault),
);

/* THE SCREENS. Same bargain as the menus - one grant (`ui:screen.replace`), the
 * choice made per screen - and the same module-level holder, because
 * `showTextScreen` is called from ~85 sites. This is the seam that reaches the
 * CONTENT of the big views rather than the frame around them: a screen arrives as
 * a document of blocks, so an inventory can be drawn as sprites. */
setScreenPresenter(
  installScreen([...activeModCode().plugins], displayCandidateContext, reportDisplayFault),
);

/* THE REGIONS - furniture of a mod's OWN, rather than any of the game's changing
 * hands. The fifth owner seam, and the only one with no selection in it: the
 * map, a HUD region, the menus and the screens are each one thing that exactly
 * one owner can hold, and two mods adding a panel are not in contention at all.
 * So every eligible mod's regions go up, in load order, each at the band it
 * asked for - and "last in load order wins" appears here only in its ordinary
 * form, deciding which of two overlapping panels is on top.
 *
 * `ui:region.create`, which `ui:*.replace` deliberately does NOT cover: taking
 * the vitals and adding furniture are two different sentences for a player to
 * agree to. `system` is refused, by the type and again at the door, so the mod
 * manager and a fault report can always be drawn ABOVE a mod - including above
 * the mod that has gone wrong, which is the only recovery path there is.
 *
 * Pushed with the terminal as it stands right now, because the first relayout
 * may not have happened yet and a region faulted against a 0x0 grid would be
 * blamed on its author for the host's timing. */
installRegions(
  [...activeModCode().plugins],
  displayCandidateContext,
  reportDisplayFault,
  term.size(),
);

/* The controller() half: an autoplayer mod takes over state.nextCommand.
 *
 * After register(), so a mod can register the very commands its controller then
 * drives. ONE at a time, by construction: installController swaps
 * state.nextCommand and returns an uninstall that restores the previous
 * provider, so two mods installing directly would leave the second silently in
 * charge and an out-of-order teardown restoring the wrong one. The host holds
 * the slot instead and refuses the second by name, which is a sentence the
 * player can act on.
 *
 * Determinism is not consulted here: the manifest's `nondeterministic` flag
 * already advanced the save ratchet when the mod was enabled
 * (advanceSaveRatchets above), and asking the plugin again would be a second
 * source of truth for one fact. */
/* Same three tiers and millisecond values as the debug agent seam's
 * ?speed=fast|normal|slow (AGENT_TICK_MS above), so the two pumps read the
 * same way to a player who has met either. Player-set via Mods -> the
 * autoplaying mod's own screen -> Autoplayer speed (mods.ts managePatches),
 * beside the rule that hands the mod its controller in the first place. */
const AUTOPLAYER_SPEED_MS: Record<AutoplayerSpeed, number> = {
  turbo: 10,
  fast: 40,
  normal: 120,
  slow: 400,
};
let MOD_AUTOPLAYER_TICK_MS = AUTOPLAYER_SPEED_MS[defaultModStore().getAutoplayerSpeed()] ?? 120;

/**
 * The mod that already holds the keyboard, or is about to once the confirm
 * gate below resolves - if either slot is taken. A named function rather than
 * an inline `installedController?.id ?? pendingAutoplayerInstall?.loaded.id`
 * in the loop that calls it: TypeScript's loop narrowing otherwise sees
 * `installedController` written by finishAutoplayerInstall (called later in
 * the same loop body) and infers a type of `never` for it on the read above
 * that call, which is a control-flow analysis artifact, not a real
 * impossibility - installedController is reassigned from inside a nested
 * function, not the loop's own straight-line flow.
 */
function currentOrPendingAutoplayerId(): string | undefined {
  return installedController?.id ?? pendingAutoplayerInstall?.loaded.id;
}

/**
 * Finishes an autoplayer's takeover of the keyboard (#125): installs the
 * controller, marks the save NOSCORE_BORG, shows the on-screen indicator that
 * it now holds the keyboard, and starts its pump. The one place that does all
 * four, so a save that already carries NOSCORE_BORG (the loop below) and a
 * save that just earned it through the confirm gate
 * (confirmPendingAutoplayerInstall) both reach the exact same install - the
 * only difference between them is whether this runs at once or waits on a
 * "yes" first.
 */
function finishAutoplayerInstall(loaded: LoadedModPlugin, controller: AgentController): void {
  /* installController is installed and then nothing drove it (found
   * 2026-08-21 while wiring the restart-on-death loop, see docs/PLANNED.md):
   * a mod's controller took a turn only when a human happened to press a
   * key, which is not what a mod that plays the game by itself is for. The
   * debug-only agent and plugin seams both already solve this with a
   * setInterval pump plus a latch that yields one action per tick - the
   * latch is not optional, because runGameLoop asks nextCommand() for as
   * long as the player has energy, and a controller that always answers
   * would never let advance() return. Same shape here, for real. */
  let modArmed = false;
  const modLatched: AgentController = (view, act) => {
    if (!modArmed) return null;
    modArmed = false;
    return controller(view, act);
  };
  const session = installController(state, modLatched, {
    capabilities: CapabilitySet.fromManifest(loaded.manifest),
  });
  installedController = { id: loaded.id, session };
  /* Mark the savefile (do_cmd_try_borg, cmd-misc.c:128-140): a character an
   * autoplayer took over is not a character that earned its result, and the bit
   * is what the score gate reads at death (score.c:268, the "Score not
   * registered for borgs." line below). This is upstream's own activation gate -
   * the moment the borg is switched on, not the moment it first respawns - so the
   * character that was already alive when the mod took over is marked too.
   *
   * The bit was already defined, already score-invalidating, already persisted
   * and already read at death. Nothing had ever SET it, so every read answered
   * false: an inert seam of exactly the shape this project keeps finding. It is
   * one-way (markNoscore only ORs) and there is no path that clears it, so a save
   * that has run an autoplayer stays marked for the rest of its life. */
  const takenOver = state.actor.player;
  takenOver.noscore = markNoscore(takenOver.noscore, NOSCORE.BORG);
  log.info(`mod:${loaded.id}`, `installed an autoplayer`);
  /* The other half of #125: a save can no longer be quietly handed to an
   * autoplayer, so a player who IS running one must be able to see that from
   * the screen, and see how to get the keyboard back, without knowing to look
   * for a one-shot chat line on the way out. */
  showAutoplayerBanner(loaded.id);
  /* The pump. No tick cap: the demo/plugin seams cap ticks as a debug
   * safety valve for a manual test run, and a real "let it play" mod has no
   * such length limit - it plays until the human takes the keyboard back or
   * the mod throws.
   *
   * startModTimer is a named function rather than an inline setInterval so a
   * live speed change (installedControllerSpeed, driven by the mod manager's
   * Autoplayer speed row) can tear the pump down and rebuild it at the new
   * rate at once - no reload, the same bar the rule toggles above already
   * clear. */
  let modTimer: ReturnType<typeof setInterval> | undefined;
  const startModTimer = (): void => {
    modTimer = setInterval(() => {
      if (dead) {
        clearInterval(modTimer);
        return;
      }
      if (scoresOpen) return;
      if (modalDepth > 0) {
        /* THE AUTOPLAYER ANSWERS ITS OWN PROMPTS (answerBlockingPrompt).
         *
         * This line used to be `if (scoresOpen || modalDepth > 0) return`, and
         * that made every blocking prompt a full stop: descending prints "You
         * enter a maze of down staircases." behind a forced -more-, so a mod
         * that plays the game by itself could not change level without a human
         * pressing a key. The floor-pile list and the store screen are the same
         * shape, and the `auto_more` option reaches neither.
         *
         * Before gameScreenLive the birth flow owns the terminal, and a mod's
         * clock must not answer for the player who is rolling a character. */
        if (gameScreenLive) answerBlockingPrompt(`mod:${loaded.id}`);
        return;
      }
      modArmed = true;
      /* A buggy or hostile autoplayer must not crash or hang the host: on a
       * throw, stop the pump and hand the keyboard back rather than let the
       * exception escape the timer. The human can still take over by hand;
       * this only stops the automatic driving. */
      try {
        advance();
      } catch (err) {
        log.error(`mod:${loaded.id}`, `autoplayer pump failed:`, err);
        clearInterval(modTimer);
      }
    }, MOD_AUTOPLAYER_TICK_MS);
  };
  startModTimer();
  installedControllerSpeed = (speed) => {
    MOD_AUTOPLAYER_TICK_MS = AUTOPLAYER_SPEED_MS[speed] ?? 120;
    clearInterval(modTimer);
    startModTimer();
  };
  /* The player's way out (#125): any real keypress, or Ctrl-Z pressed again,
   * calls this. A live hand-back, not a reload - the character stays exactly
   * where it is, mid-turn, with the human in the chair. */
  stopInstalledController = () => {
    clearInterval(modTimer);
    const id = installedController?.id ?? loaded.id;
    try {
      installedController?.session.uninstall();
    } catch (err) {
      reportModFault(id, `could not be released from the keyboard: ${faultMessage(err)}`);
    }
    installedController = null;
    installedControllerSpeed = null;
    stopInstalledController = null;
    hideAutoplayerBanner();
    say(`You take the keyboard back from ${id}.`);
    render();
  };
}

for (const loaded of activeModCode().plugins) {
  const makeController = loaded.plugin.controller;
  if (!makeController) continue;
  const holderId = currentOrPendingAutoplayerId();
  if (holderId) {
    reportModFault(
      loaded.id,
      `it plays the game automatically, and "${holderId}" is already doing that - ` +
        `only one autoplayer can hold the keyboard. Disable one of them.`,
    );
    continue;
  }
  try {
    const controller = makeController.call(
      loaded.plugin,
      modPluginContext(
        loaded.id,
        folderRuleFlags.get(loaded.id) ?? {},
        state,
        modOwnFiles(loaded.data),
        sessionFacts,
      ),
    );
    /* undefined is a decline, not a failure: a mod whose own autoplay toggle is
     * off says so by returning nothing, and the human keeps the keyboard. */
    if (!controller) continue;
    /* THE GATE (#125). do_cmd_try_borg (cmd-misc.c:127) only ever asks once per
     * character - "already marked" is upstream's own short-circuit, not a port
     * addition - and NOSCORE.BORG is one-way (markNoscore only ORs, never
     * clears; finishAutoplayerInstall above). So a save that already carries it
     * ran this exact gate on an earlier boot, or through Ctrl-Z
     * (activateAutoplayerCmd), and installing again here is the SAME character
     * continuing, not a new activation. A save that does not carry it yet is
     * the only case upstream's gate ever asks about either: hold the candidate
     * rather than install it, and let confirmPendingAutoplayerInstall run the
     * warn-and-confirm once the game screen is live. Turning the rule flag on
     * from the ordinary Mods screen must not, by itself, be enough - that was
     * the whole bug. */
    if ((state.actor.player.noscore & NOSCORE.BORG) !== 0) {
      finishAutoplayerInstall(loaded, controller);
    } else {
      pendingAutoplayerInstall = { loaded, controller };
    }
  } catch (err) {
    /* Same containment as register(): a controller that will not install must
     * leave a game the player can still play by hand. The commonest cause is a
     * manifest that never asked for command:add, and AgentCapabilityError says
     * exactly that. */
    reportModFault(
      loaded.id,
      `its autoplayer could not be installed, so the game stays under your control: ${faultMessage(err)}`,
    );
    log.error(`mod:${loaded.id}`, `controller() failed:`, err);
  }
}

/* The hatch itself (#125): registered once, unconditionally - `active()` reads
 * `installedController` fresh on every real keypress, so this is correct
 * whether or not a controller ever installs, and whichever mod's turn it is. */
setAutoplayerInterruptOwner({
  active: () => installedController !== null,
  interrupt: () => stopInstalledController?.(),
});

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
    /** Cell paints and whole-screen redraws so far - the overdraw measurement. */
    paints: () => term.paintStats(),
    /**
     * What the mod system actually did, for the harness and for diagnosing the
     * failure this whole area keeps producing: a mod that loaded, reported no
     * problem, and contributed nothing.
     *
     * Every field is an OBSERVATION of composed state, not a restatement of the
     * manifest - `sections` is the resolved on/off after the player's choices and
     * any `patches` claim, and `records` counts what came out of composition.
     * Asking the manifest what a mod contributes is how "it is enabled, so it
     * must be working" survives.
     */
    mods: () => {
      const enabled = enabledModIds();
      const manifests = discoverContentModManifests().filter((m) => enabled.includes(m.id));
      const lines = liveConflictLines();
      const store = defaultModStore();
      store.migrateSectionChoices(manifests);
      return {
        enabled,
        sections: Object.fromEntries(
          [...resolveSectionState(
            manifests,
            store.getSectionChoices(),
            new Set(enabled),
          )].map(([id, table]) => [id, Object.fromEntries(table)]),
        ),
        order: sortModOrder(manifests, {
          pins: store.getPins(),
          current: store.getEnabled(),
        }),
        conflicts: lines,
        /* Composed record counts per file, so a section switching off is visible
         * as a NUMBER rather than as an absence somebody has to go looking for. */
        records: Object.fromEntries(
          Object.entries(composedRecords()).map(([file, recs]) => [file, recs.length]),
        ),
      };
    },
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
      // The two-pass (tap, tcp) draw: cells whose foreground tile has the
      // terrain tile under it, so an alpha tile shows floor and not UI_BG.
      bgTileCells: term.bgTileCellCount(),
      // Which player picture the pack's `?:` blocks selected, and for whom.
      // race/cls are what fed $RACE/$CLASS into the parse.
      race: state.actor.player.race.name,
      cls: state.actor.player.cls.name,
      playerTile: tileMap ? tileForMonster(tileMap, 0) : null,
      // Canvas rect of the player's own cell, for a pixel-exact crop.
      playerRect: lastPlayerCell
        ? term.cellRect(lastPlayerCell.x, lastPlayerCell.y)
        : null,
    }),
    setTileMode: (id: number): Promise<void> => applyTileMode(id, true),
    // The live x_attr/x_char tables (ui-prefs.c), so a verification pass can
    // write an override and watch the map redraw with it - the same write the
    // pref-file parser and the knowledge browser's glyph picker make.
    glyphs: () => glyphs,
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
    // Whether a mod's hook has broken this session, and therefore whether the
    // game is still writing saves (mod-taint.ts). Null while it is healthy.
    // Drive a real fault with the demo-hooks.explode rule, then read this - the
    // refusal itself is measurable from outside by watching the slot stop
    // changing, which is the only check that cannot be satisfied by a flag.
    modTaint: (): unknown => sessionTaint(),
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
