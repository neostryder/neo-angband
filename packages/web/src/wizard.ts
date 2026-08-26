/**
 * Wizard / debug mode UI: the faithful web command surface over the wizard
 * engine in @rpgm-tools/neo-angband-core (game/wizard.ts).
 *
 * Every prompt, confirmation and message in this file is transcribed from the
 * C, not described in this port's own words. The sources are cmd-wizard.c (the
 * command-level prompts), ui-wizard.c (the menu shims), ui-game.c L234-322
 * (the two-level menu tables) and cmd-misc.c L37-68 / game-input.c L281-295
 * (the two entry gates).
 *
 * An earlier pass wrote its own wording for most of this surface - "How many
 * good objects?" for upstream's `How many good objects? `, "Cured." where
 * upstream prints `You feel *much* better!`, "Allocated." / "Monsters
 * banished." / "You have lit up the level." where upstream prints nothing at
 * all, and a field-picker menu where upstream walks all seven player edits in
 * sequence. Paraphrase is a deviation under the exact-parity mandate and is
 * worse than silence, because the text census cannot tell a paraphrase from a
 * port. The strings here are exact and the control flow around them follows the
 * C branch for branch.
 *
 * Input primitives: get_string / get_quantity / get_check / get_com are the
 * askfor_aux-based inline prompts in overlay.ts. A wizard prompt never opens a
 * titled full-screen editor - the C keeps the screen and asks on row 0.
 *
 * Attribution: neostryder / RPGM Tools.
 */

import {
  NOSCORE,
  wizAcquire,
  wizAdvance,
  wizBanish,
  wizChangeItemQuantity,
  wizCreateAllArtifact,
  wizCreateAllArtifactFromTval,
  wizCreateAllObj,
  wizCreateAllObjFromTval,
  wizCreateArtifact,
  wizCreateObj,
  wizCreateTrap,
  wizCureAll,
  wizCurseItem,
  wizDetectAllLocal,
  wizDetectAllMonsters,
  dumpLevel,
  spoilArtifact,
  spoilMonDesc,
  spoilMonInfo,
  spoilObjDesc,
  wizEditPlayerExp,
  wizEditPlayerGold,
  wizEditPlayerStat,
  wizHitAllLos,
  wizIncreaseExp,
  wizJumpLevel,
  wizLearnObjectKinds,
  wizMagicMap,
  wizPeekFlow,
  wizPushObject,
  wizQueryFeature,
  wizQuerySquareFlag,
  wizRecallMonster,
  wizRerate,
  wizRerollItem,
  wizStatItem,
  wizSummonNamed,
  wizSummonRandom,
  wizTeleportRandom,
  wizTeleportTo,
  wizTweakItem,
  wizWizardLight,
  wizWipeRecall,
  wizDisplayItem,
  wizPlayItemBegin,
  wizPlayItemReject,
  wizPlayItemAccept,
  describeObject,
  objectPrep,
  objDescNameFormat,
  colorTextToAttr,
  lookupTrap,
  statNameToIdx,
  COLOUR_RED,
  COLOUR_WHITE,
  COLOUR_YELLOW,
  colorToCss,
  KF,
  FEAT,
  ODESC,
  OBJECT_FLAG_ENTRIES,
  SQUARE,
  EF,
  effectLookup,
  effectSubtype,
  sourcePlayer,
  buildEffectContext,
  attachGameEnv,
  OBJ_MOD_NAMES,
  STAT_MAX,
  t,
} from "@rpgm-tools/neo-angband-core";
import type {
  GamePack,
  GameState,
  WizardDeps,
  WizEffectDeps,
  MonsterRace,
  GameObject,
  Artifact,
  EgoItem,
  EffectContext,
  EffectEnvDeps,
  CastContext,
  Loc,
  ObjectBase,
  ObjectKind,
  ProjectionInfo,
  WizItemDisplay,
} from "@rpgm-tools/neo-angband-core";
import { gearGet } from "@rpgm-tools/neo-angband-core";
import type { GridPointerInput, GridSurface } from "./term";
import {
  getCheck,
  getFile,
  getKeyInline,
  getQuantity,
  getString,
  selectFromMenu,
  showTextScreen,
  screenFault,
  screenRegionSpec,
} from "./overlay";
import { popRegion, pushRegion, regionSurface } from "./ui-stack";
import {
  userWrite,
  userWriteChecked,
  exportUserFile,
  userPath,
  FileType,
} from "./user-io";
import type { MenuItem, ScreenLine } from "./overlay";
import { packMenu } from "./screens";
import { UI_TEXT } from "./ui-colors";
import { showThroughPresenter } from "./screen-runtime";
import { freezeView, screenBodyLines, SCREEN_FOOTER } from "./screen-view";
import type { ScreenView, ScreenColumn, ScreenRow, ScreenCell, ScreenTableBlock } from "./screen-view";

/** One grid the shell should highlight for wiz_hack_map (cmd-wizard.c:320). */
export interface WizHackMark {
  grid: Loc;
  /** The COLOUR_* index the C's probe hands print_rel. */
  color: number;
}

/**
 * One entry of upstream's keylog (struct keypress, ui-event.h): the text
 * keypress_to_text renders, the keycode, and the modifier bits.
 */
export interface WizKeypress {
  text: string;
  code: number;
  mods: number;
}

/**
 * stats_are_enabled (wiz-stats.c:1652 under USE_STATS, :3162 without it): the
 * three Monte-Carlo collectors the Statistics menu drives. A build without them
 * prints one message and returns before any prompt, which is what a stock 4.2.6
 * build does - `--enable-stats` is off by default.
 */
export interface WizStatsCollectors {
  /** stats_collect(nsim, simtype). */
  statsCollect: (nsim: number, simtype: number) => void;
  /** pit_stats(nsim, pittype, depth_min, depth_max). */
  pitStats: (
    nsim: number,
    pittype: number,
    depthMin: number,
    depthMax: number,
  ) => void;
  /** disconnect_stats(nsim, stop_on_disconnect). */
  disconnectStats: (nsim: number, stopOnDisconnect: boolean) => void;
}

/**
 * The runtime context the web shell hands the wizard UI. `deps.debug` gates every
 * debug command and `deps.wizard` gates only cheat death (see WizardDeps);
 * `deps.markNoscore` is the WP-10 handoff hook that ORs cheat bits into
 * player.noscore (persisted by save.ts, read by the score gate).
 */
export interface WizardUiCtx {
  term: GridSurface & GridPointerInput;
  state: GameState;
  /**
   * The wizard engine dependency bundle assembled by the shell. Read it fresh at
   * each use rather than caching it: `debug` is derived from the live
   * player.noscore, which confirmDebugGate can set mid-command, and the shell
   * supplies this as a getter for that reason.
   */
  deps: WizardDeps;
  /** msg(): route a line to the game message log. */
  say: (text: string) => void;
  /** Redraw the game view (and, where relevant, ride the next derived recompute). */
  refresh: () => void;
  /** dungeon_change_level: regenerate at the pending targetDepth (jump-level). */
  changeLevel?: (depth: number) => void;
  /**
   * quit("user choice") (do_cmd_wiz_quit_no_save, cmd-wizard.c L2203): abandon
   * the session WITHOUT writing a save. The shell owns what "quit" means on each
   * front end, so the command asks and this performs. Never resolves on desktop
   * (the process is going away).
   */
  quitNoSave?: () => Promise<void>;
  /**
   * The on-map grid picker (the shell's targeting/look UI), used by the
   * teleport "To location" command (do_cmd_wiz_teleport_to). Returns the chosen
   * grid, or null on ESC. Absent, the command falls back to numeric coordinate
   * prompts so it still functions before the picker is wired.
   */
  pickGrid?: () => Promise<Loc | null>;
  /**
   * wiz_hack_map (cmd-wizard.c:320) hosted: overlay one glyph per highlighted
   * grid on the visible panel - '@' on the player, '*' where passable, '#'
   * otherwise, in the colour the C's probe hands print_rel. The panel geometry
   * lives in the shell, so the query commands hand it marks and it paints.
   */
  hackMap?: (marks: readonly WizHackMark[]) => void;
  /** lookup_monster (mon-util.c:119): the registry's raceByName. */
  raceByName?: (name: string) => MonsterRace | null;
  /** The statistics collectors, when this build has them (see above). */
  stats?: WizStatsCollectors;
  /**
   * keylog[] (ui-term.c:317, KEYLOG_SIZE = 8): the shell's keypress ring for
   * wiz_display_keylog, most recent LAST. Absent, the screen shows the blank
   * rows upstream draws for an empty log.
   */
  keylog?: () => readonly WizKeypress[];
  /**
   * projections[] (project.c), for wiz_proj_demo's "PROJ_ types display".
   * Absent, the command reports itself unavailable.
   */
  projections?: readonly ProjectionInfo[];
  /**
   * The booted game pack, for do_cmd_spoilers' four generators (they walk the
   * static content, not the live level). Absent, the command reports itself
   * unavailable rather than inventing a message.
   */
  pack?: GamePack;
}

/* ------------------------------------------------------------------ *
 * effect_simple plumbing for the effect-driven debug commands (a web-side
 * mirror of game/wizard.ts's private effContext/runSimple, since those are not
 * exported). Every field comes from the WizEffectDeps bundle the shell already
 * hands the wizard UI via deps.effect.
 * ------------------------------------------------------------------ */

/** effContext (cmd-wizard.c effect plumbing): assemble an EffectContext. */
function wizEffectContext(state: GameState, eff: WizEffectDeps): EffectContext {
  const base = buildEffectContext(state, eff.envDeps as EffectEnvDeps);
  return attachGameEnv(base, {
    state,
    cast: eff.cast as CastContext,
    ...(eff.teleport ? { teleport: eff.teleport } : {}),
    ...(eff.general ? { general: eff.general } : {}),
    ...(eff.item ? { item: eff.item } : {}),
    ...(eff.summon ? { summon: eff.summon } : {}),
  });
}

/** Parameters for a wizard effect_simple call (mirrors EffectSimpleParams). */
interface WizEffectParams {
  diceString?: string;
  subtype?: number;
  radius?: number;
  other?: number;
  y?: number;
  x?: number;
}

/** effect_simple(index, source_player(), ...): run one effect from the debug UI. */
function runWizEffect(
  state: GameState,
  eff: WizEffectDeps,
  index: number,
  p: WizEffectParams,
): boolean {
  const ctx = wizEffectContext(state, eff);
  return eff.registry.effectSimple(index, ctx, {
    origin: sourcePlayer(),
    diceString: p.diceString ?? "0",
    subtype: p.subtype ?? 0,
    radius: p.radius ?? 0,
    other: p.other ?? 0,
    y: p.y ?? 0,
    x: p.x ?? 0,
  });
}

/* ------------------------------------------------------------------ *
 * String -> number, exactly as cmd-wizard.c parses its prompts.
 * ------------------------------------------------------------------ */

/**
 * get_int_from_string (cmd-wizard.c:68): strtol base 10, rejecting an empty
 * string, anything but trailing whitespace after the number, and INT_MIN /
 * INT_MAX themselves (L77-79, so callers need not check errno). Returns null
 * where the C returns false.
 */
function intFromString(s: string): number | null {
  const m = /^\s*([+-]?\d+)\s*$/.exec(s);
  if (!m) return null;
  const v = Number.parseInt(m[1] as string, 10);
  if (v <= -2147483648 || v >= 2147483647) return null;
  return v;
}

/**
 * get_long_from_string (cmd-wizard.c:96): as intFromString without the int
 * bound - the C rejects LONG_MIN / LONG_MAX instead, which no prompt here can
 * reach, so only the parse strictness carries over.
 */
function longFromString(s: string): number | null {
  const m = /^\s*([+-]?\d+)\s*$/.exec(s);
  if (!m) return null;
  return Number.parseInt(m[1] as string, 10);
}

/* ------------------------------------------------------------------ *
 * do_cmd_wizard entry strings (cmd-misc.c L42-60) and confirm_debug
 * strings (game-input.c L289-294). Exported verbatim for the tests that
 * lock the exact wording.
 * ------------------------------------------------------------------ */

export const WIZARD_ENTRY_MSG_1 =
  "You are about to enter 'wizard' mode for the very first time!";
export const WIZARD_ENTRY_MSG_2 =
  "This is a form of cheating, and your game will not be scored!";
export const WIZARD_ENTRY_CONFIRM = "Are you sure you want to enter wizard mode? ";
export const WIZARD_ON_MSG = "Wizard mode on.";
export const WIZARD_OFF_MSG = "Wizard mode off.";

export const DEBUG_CONFIRM_MSG_1 =
  "You are about to use the dangerous, unsupported, debug commands!";
export const DEBUG_CONFIRM_MSG_2 =
  "Your machine may crash, and your savefile may become corrupted!";
export const DEBUG_CONFIRM = "Are you sure you want to use the debug commands? ";

/**
 * stats_are_enabled's message in a build without the collectors
 * (wiz-stats.c:3164). The web build is such a build - the port's Monte-Carlo
 * collectors live in packages/cli - so the three Statistics commands print
 * this and return before their first prompt, exactly as stock 4.2.6 does.
 */
export const STATS_DISABLED_MSG =
  "Statistics generation not turned on in this build.";

/**
 * spoil_actions (ui-spoil.c:47-52), verbatim - labels, order and the file each
 * row writes. Reached from BOTH the debug menu's "Create spoilers" and the death
 * menu's Spoilers row (ui-death.c:339), so the table lives here.
 */
export const SPOIL_ACTIONS: readonly { label: string; file: string; kind: SpoilKind }[] = [
  { label: "Brief Object Info (obj-desc.spo)", file: "obj-desc.spo", kind: "obj" },
  { label: "Brief Artifact Info (artifact.spo)", file: "artifact.spo", kind: "artifact" },
  { label: "Brief Monster Info (mon-desc.spo)", file: "mon-desc.spo", kind: "mon-desc" },
  { label: "Full Monster Info (mon-info.spo)", file: "mon-info.spo", kind: "mon-info" },
];

export type SpoilKind = "obj" | "artifact" | "mon-desc" | "mon-info";

/** Translator ids for each SPOIL_ACTIONS row's label, keyed by kind. */
const SPOIL_ACTION_IDS: Record<SpoilKind, string> = {
  obj: "wizard.spoilers.obj",
  artifact: "wizard.spoilers.artifact",
  "mon-desc": "wizard.spoilers.monDesc",
  "mon-info": "wizard.spoilers.monInfo",
};

/**
 * do_cmd_spoilers (ui-spoil.c:59-73): the four-row "Create spoilers" menu, each
 * row writing one spoiler file into the user directory.
 *
 * The generators are the ported wiz-spoil.c ones (core game/spoil.ts, moved
 * there from the CLI for this - upstream's spoiler writers are in the game
 * binary, not a separate tool). The three outcome messages are upstream's:
 * file_open's failure, file_close's failure, and success.
 */
export async function runSpoilers(
  term: GridSurface & GridPointerInput,
  pack: GamePack,
  say: (text: string) => void,
): Promise<void> {
  const idx = await selectFromMenu(
    term,
    "core:wizard-spoilers",
    t("wizard.spoilers.title", "Create spoilers"),
    SPOIL_ACTIONS.map((a) => ({ label: t(SPOIL_ACTION_IDS[a.kind], a.label) })),
  );
  if (idx === null || idx < 0) return;
  const action = SPOIL_ACTIONS[idx];
  if (!action) return;

  const text =
    action.kind === "obj"
      ? spoilObjDesc(pack)
      : action.kind === "artifact"
        ? spoilArtifact(pack)
        : action.kind === "mon-desc"
          ? spoilMonDesc(pack)
          : spoilMonInfo(pack);

  const outcome = userWriteChecked(action.file, text);
  if (outcome === "create-failed") {
    say(t("wizard.spoilers.createFailed", "Cannot create spoiler file.")); /* wiz-spoil.c:220 */
    return;
  }
  if (outcome === "close-failed") {
    say(t("wizard.spoilers.closeFailed", "Cannot close spoiler file.")); /* wiz-spoil.c:330 */
    return;
  }
  exportUserFile(action.file, text);
  say(t("wizard.spoilers.success", "Successfully created a spoiler file.")); /* wiz-spoil.c:335 */
}

/** get_check (textui_get_check): inline row-0 "<prompt>[y/n] ", y/Y only. */
function confirmYesNo(term: GridSurface & GridPointerInput, title: string): Promise<boolean> {
  return getCheck(term, title);
}

/**
 * get_com (textui_get_com, ui-input.c:1398): prompt at row 0, one keypress,
 * false on ESCAPE. Returns null where the C returns false.
 */
async function getCom(term: GridSurface & GridPointerInput, prompt: string): Promise<string | null> {
  const key = await getKeyInline(term, prompt);
  return key === "Escape" ? null : key;
}

/* ------------------------------------------------------------------ *
 * 15.1 - do_cmd_wizard (Control-W), cmd-misc.c L37-68.
 * ------------------------------------------------------------------ */

/**
 * Toggle wizard mode. On the very first entry (player.noscore lacks the WIZARD
 * bit) upstream mentions the effects, flushes, and asks get_check; declining
 * aborts with no change. Accepting marks the savefile (noscore |= WIZARD via the
 * markNoscore seam) then toggles. Returns the new wizard-mode boolean the shell
 * stores (unchanged when a first-time confirm is declined).
 */
export async function runWizardToggle(
  ctx: WizardUiCtx,
  currentMode: boolean,
): Promise<boolean> {
  const p = ctx.state.actor.player;
  if (!(p.noscore & NOSCORE.WIZARD)) {
    ctx.say(t("wizard.entry.msg1", WIZARD_ENTRY_MSG_1));
    ctx.say(t("wizard.entry.msg2", WIZARD_ENTRY_MSG_2));
    ctx.refresh();
    if (!(await confirmYesNo(ctx.term, t("wizard.entry.confirm", WIZARD_ENTRY_CONFIRM)))) {
      ctx.refresh();
      return currentMode;
    }
    /* Mark savefile (player->noscore |= NOSCORE_WIZARD, cmd-misc.c L51). */
    ctx.deps.markNoscore?.(NOSCORE.WIZARD);
  }
  const next = !currentMode;
  ctx.say(
    next ? t("wizard.mode.on", WIZARD_ON_MSG) : t("wizard.mode.off", WIZARD_OFF_MSG),
  );
  ctx.refresh();
  return next;
}

/* ------------------------------------------------------------------ *
 * 15.2 - the debug command menu (Control-A), ui-game.c L234-322.
 * ------------------------------------------------------------------ */

/** One debug command: its faithful letter + label + a dispatch key. */
export interface DebugCommand {
  readonly letter: string;
  readonly label: string;
  readonly action: string;
}

/** One debug category: faithful title + its commands. */
export interface DebugCategory {
  readonly title: string;
  readonly commands: readonly DebugCommand[];
}

/**
 * Freeze the table and every row in it. The `readonly` types below only bind
 * TypeScript callers, and a mod folder ships plain `plugin.js` - so the runtime
 * freeze is the half that actually holds the door shut. Shallow freezing would
 * leave `commands` mutable, which is where the rows people would want to add
 * actually live.
 */
function deepFreezeMenu(cats: readonly DebugCategory[]): readonly DebugCategory[] {
  for (const cat of cats) {
    Object.freeze(cat.commands);
    for (const cmd of cat.commands) Object.freeze(cmd);
    Object.freeze(cat);
  }
  return Object.freeze(cats);
}

/**
 * The nine cmd_debug[] categories and their cmd_debug_* command tables
 * (ui-game.c L234-322). Titles, letters and labels match the C tables exactly.
 *
 * The nesting is DATA, not the ^A interaction: upstream calls these categories
 * "placeholders for the Enter menu system" (ui-game.c L232), and ^A never shows
 * them - it resolves one keypress against the flat DEBUG_BY_KEY table below.
 * They are reachable through the ENTER command browser (textui_action_menu_choose
 * / cmd_menu, ui-context.c L1176-1215), which main.ts drives off this table -
 * Hidden -> "Debug mode commands (^A)" -> these nine -> each one's commands.
 * PORT_TODO 3.18. Either route dispatches through runWizardDebugCommand, so the
 * menu is not a way around player_can_debug_prereq.
 *
 * FROZEN (deeply), AND DELIBERATELY NOT A MOD SEAM. These are upstream's own
 * tables and must match the C exactly, which is what the parity tests assert.
 * Exported-and-mutable made it an accidental extension point: a mod could push a
 * row here at import time, and that row would be outside the mod system - no
 * ordering against another mod's rows, absent from every manifest, and NOT
 * removable by disabling the mod, which breaks the rule that a disabled mod's
 * patches do not exist. It would also silently break the parity tests that count
 * these letters. Frozen, the attempt throws in strict mode.
 *
 * A mod wanting its own debug or developer commands should register a command,
 * not edit upstream's table.
 *
 * Not routed through the translator. Every title and label here is read
 * structurally by main.ts (the ENTER command browser walks this table by
 * `.title` / `.commands` / `.label`) and asserted verbatim by this file's own
 * tests, both outside this module's translation seam; wrapping the strings
 * here would turn every reader into a caller of `t()` at once rather than one
 * file at a time. The debug menu is reachable only after the debug-command
 * gate above, which keeps it out of the ordinary play surface a translation
 * pass is covering first.
 */
export const DEBUG_MENU: readonly DebugCategory[] = deepFreezeMenu([
  {
    title: "Items",
    commands: [
      { letter: "c", label: "Create an object", action: "create-obj" },
      { letter: "C", label: "Create an artifact", action: "create-artifact" },
      { letter: "V", label: "Create all from tval", action: "create-all-tval" },
      { letter: "g", label: "Acquire good", action: "acquire-good" },
      { letter: "v", label: "Acquire great", action: "acquire-great" },
      { letter: "o", label: "Play with item", action: "play-item" },
    ],
  },
  {
    title: "Player",
    commands: [
      { letter: "a", label: "Cure everything", action: "cure-all" },
      { letter: "A", label: "Make powerful", action: "advance" },
      { letter: "x", label: "Increase experience", action: "increase-exp" },
      { letter: "h", label: "Rerate hitpoints", action: "rerate" },
      { letter: "e", label: "Edit player", action: "edit-player" },
      { letter: "l", label: "Learn object kinds", action: "learn-kinds" },
      { letter: "r", label: "Recall monster", action: "recall-monster" },
      { letter: "W", label: "Erase monster recall", action: "wipe-recall" },
    ],
  },
  {
    title: "Teleport",
    commands: [
      { letter: "b", label: "To location", action: "tele-to" },
      { letter: "p", label: "Random near", action: "tele-near" },
      { letter: "t", label: "Random far", action: "tele-far" },
      { letter: "j", label: "Jump to a level", action: "jump-level" },
    ],
  },
  {
    title: "Effects",
    commands: [
      { letter: "d", label: "Detect all nearby", action: "detect-local" },
      { letter: "u", label: "Detect all monsters", action: "detect-monsters" },
      { letter: "m", label: "Map local area", action: "magic-map" },
      { letter: "H", label: "Hit all in LOS", action: "hit-los" },
      { letter: "E", label: "Perform an effect", action: "perform-effect" },
      { letter: "G", label: "Graphics demo", action: "graphics-demo" },
    ],
  },
  {
    title: "Summon",
    commands: [
      { letter: "n", label: "Summon specific", action: "summon-named" },
      { letter: "s", label: "Summon random", action: "summon-random" },
    ],
  },
  {
    title: "Files",
    commands: [
      { letter: '"', label: "Create spoilers", action: "spoilers" },
      { letter: "M", label: "Write map", action: "write-map" },
    ],
  },
  {
    title: "Statistics",
    commands: [
      { letter: "S", label: "Objects and monsters", action: "stat-objmon" },
      { letter: "P", label: "Pits", action: "stat-pits" },
      { letter: "D", label: "Disconnected levels", action: "stat-disconnect" },
      { letter: "f", label: "Obj/mon alternate key", action: "stat-objmon" },
    ],
  },
  {
    title: "Query",
    commands: [
      { letter: "F", label: "Feature", action: "query-feature" },
      { letter: "q", label: "Square flag", action: "query-square-flag" },
      { letter: "_", label: "Noise and scent", action: "peek-flow" },
      { letter: "L", label: "Keystroke log", action: "keylog" },
    ],
  },
  {
    title: "Miscellaneous",
    commands: [
      { letter: "w", label: "Wizard light level", action: "wizard-light" },
      { letter: "T", label: "Create a trap", action: "create-trap" },
      { letter: "z", label: "Banish nearby monsters", action: "banish" },
      { letter: ">", label: "Push objects from square", action: "push-object" },
      { letter: "X", label: "Quit without saving", action: "quit-no-save" },
    ],
  },
]);

/**
 * player_can_debug_prereq + confirm_debug (player-util.c L1296-1307,
 * game-input.c L281-295): on the first debug-command use (player.noscore lacks
 * the DEBUG bit) upstream mentions the danger, flushes, and asks get_check;
 * accepting marks the savefile (noscore |= DEBUG). Returns whether the debug
 * command may run. Consulted for every debug command, not once per session, and
 * never a function of wizard mode.
 *
 * EXPORTED because a mod holding `debug:spawn` conjures things through the same
 * gate (`spawn-runtime.ts`). One consent path rather than two: the sentence a
 * player is asked, the bit it sets and the moment it is set all have to be the
 * same whether the request came from `^A` or from a mod, or "the debug commands
 * mark your character" stops being a true statement about this game.
 */
export async function confirmDebugGate(ctx: WizardUiCtx): Promise<boolean> {
  const p = ctx.state.actor.player;
  if (p.noscore & NOSCORE.DEBUG) return true;
  ctx.say(t("wizard.debug.gate.msg1", DEBUG_CONFIRM_MSG_1));
  ctx.say(t("wizard.debug.gate.msg2", DEBUG_CONFIRM_MSG_2));
  ctx.refresh();
  if (!(await confirmYesNo(ctx.term, t("wizard.debug.gate.confirm", DEBUG_CONFIRM)))) {
    ctx.refresh();
    return false;
  }
  ctx.deps.markNoscore?.(NOSCORE.DEBUG);
  return true;
}

/**
 * nested_prompt / nested_error for the ^A row of cmd_hidden[] (ui-game.c L225),
 * transcribed exactly. The prompt's trailing colon-space is part of the string;
 * the error is what ui-game.c L580-584 prints when the key is not bound.
 */
export const DEBUG_PROMPT = "Debug Command: ";
export const DEBUG_NESTED_ERROR = "That is not a valid debug command.";

/**
 * nested_lists[0] (ui-game.c L421-440): ONE table keyed by character, populated
 * by all nine cmd_debug_* lists, which every one of them shares because each
 * carries keymap 1 in cmds_all[] (ui-game.c L342-350). Upstream asserts the keys
 * are globally unique across the nine lists (L436); this build throws on a
 * duplicate for the same reason, so a future row that collides fails loudly at
 * module load instead of shadowing an existing command.
 */
const DEBUG_BY_KEY: ReadonlyMap<string, DebugCommand> = (() => {
  const table = new Map<string, DebugCommand>();
  for (const cat of DEBUG_MENU) {
    for (const cmd of cat.commands) {
      if (table.has(cmd.letter)) {
        throw new Error(`duplicate debug command key ${cmd.letter} (ui-game.c L436)`);
      }
      table.set(cmd.letter, cmd);
    }
  }
  return table;
})();

/**
 * The debug command surface (Control-A). Upstream this is NOT a menu. The ^A row
 * of cmd_hidden[] has nested_keymap 1 and nested_prompt "Debug Command: "
 * (ui-game.c L225), so textui_process_command asks get_com for ONE keypress,
 * looks it up in the flat nested_lists[0] table, prints nested_error when the key
 * is unbound, and only THEN evaluates the row's prereq (ui-game.c L568-596).
 *
 * The port previously got three things wrong here, all of them invented:
 *   - it opened a two-level category menu. The cmd_debug[] categories are
 *     "placeholders for the Enter menu system" (ui-game.c L232) and are not
 *     reachable from ^A at all; see the note on DEBUG_MENU.
 *   - it ran the debug confirmation BEFORE asking for a command, where upstream
 *     asks for the key first and confirms only once a real command is selected.
 *   - it required wizard mode, a prerequisite player_can_debug_prereq does not
 *     have (player-util.c L1296-1307). That single invented check made all 41
 *     debug commands unreachable for a non-wizard character.
 *
 * It also looped, re-prompting after each command; upstream handles exactly one
 * debug command per ^A and returns to the main input loop.
 */
export async function runWizardDebugMenu(ctx: WizardUiCtx): Promise<void> {
  const key = await getKeyInline(ctx.term, t("wizard.debug.prompt", DEBUG_PROMPT));
  /* get_com_ex returns false on ESCAPE (ui-input.c L1439), and the caller then
   * abandons the nested lookup entirely (ui-game.c L586-588). */
  if (key === "Escape") {
    ctx.refresh();
    return;
  }
  const cmd = DEBUG_BY_KEY.get(key);
  if (!cmd) {
    ctx.say(t("wizard.debug.nestedError", DEBUG_NESTED_ERROR));
    ctx.refresh();
    return;
  }
  /* Check prereqs (ui-game.c L595): player_can_debug_prereq runs AFTER the key
   * resolves to a command, so an unbound key never triggers the warning. It is
   * inside runWizardDebugCommand, which both routes into a debug command use. */
  await runWizardDebugCommand(ctx, cmd.action);
}

/**
 * One debug command, with the gate ^A puts in front of it: player_can_debug_prereq
 * runs AFTER the command has resolved (ui-game.c:595), so it is here rather than
 * at the menu, and every route to a debug command goes through this one function.
 *
 * Two routes exist now - the ^A keypress above, and the ENTER command browser's
 * nested "Debug mode commands" tier, which is the only place the nine cmd_debug
 * categories are reachable at all. Neither may be a way around the NOSCORE_DEBUG
 * marking, which is why this is a shared function and not a copied three lines.
 */
export async function runWizardDebugCommand(ctx: WizardUiCtx, action: string): Promise<void> {
  if (!(await confirmDebugGate(ctx))) {
    ctx.refresh();
    return;
  }
  await dispatchDebug(ctx, action);
  ctx.refresh();
}

/** Short "engine bundle not surfaced to the web shell yet" note. */
function unavailable(ctx: WizardUiCtx): void {
  ctx.say(t("wizard.debug.unavailable", "That debug command is not available in this build."));
}

/**
 * stat_idx_to_name (player.c L122): the list-stats.h macro names verbatim, in
 * list order. These, not long words, are what do_cmd_wiz_edit_player_stat puts
 * in its prompts - the stat-picker default (cmd-wizard.c:1309) and the value
 * prompt "%s (3-118): " (cmd-wizard.c:1326).
 */
const STAT_NAMES = ["STR", "INT", "WIS", "DEX", "CON"];

/**
 * do_cmd_wiz_query_feature's letter -> feature set (cmd-wizard.c L1987-2101).
 * The comment in the C is "OMG hax"; the sets are verbatim, including 't'
 * covering both staircases and 'd' covering all four door states.
 */
const FEATURE_QUERY_CHOICES: Record<string, readonly number[]> = {
  f: [FEAT.FLOOR],
  o: [FEAT.OPEN],
  b: [FEAT.BROKEN],
  u: [FEAT.LESS],
  z: [FEAT.MORE],
  t: [FEAT.LESS, FEAT.MORE],
  c: [FEAT.CLOSED],
  d: [FEAT.CLOSED, FEAT.OPEN, FEAT.BROKEN, FEAT.SECRET],
  h: [FEAT.SECRET],
  m: [FEAT.MAGMA, FEAT.MAGMA_K],
  q: [FEAT.QUARTZ, FEAT.QUARTZ_K],
  g: [FEAT.GRANITE],
  p: [FEAT.PERM],
  r: [FEAT.RUBBLE],
  a: [FEAT.PASS_RUBBLE],
};

/**
 * do_cmd_wiz_query_square_flag's letter -> SQUARE flag (cmd-wizard.c
 * L2114-2129). An unlisted key leaves flag 0, which the command reads as
 * "highlight the known grids" (L2088).
 */
const SQUARE_FLAG_CHOICES: Record<string, number> = {
  g: SQUARE.GLOW,
  r: SQUARE.ROOM,
  a: SQUARE.VAULT,
  s: SQUARE.SEEN,
  v: SQUARE.VIEW,
  w: SQUARE.WASSEEN,
  d: SQUARE.DTRAP,
  f: SQUARE.FEEL,
  t: SQUARE.TRAP,
  n: SQUARE.INVIS,
  i: SQUARE.WALL_INNER,
  o: SQUARE.WALL_OUTER,
  l: SQUARE.WALL_SOLID,
  x: SQUARE.MON_RESTRICT,
};

/** Route a debug action key to its collect-and-dispatch handler. */
export async function dispatchDebug(ctx: WizardUiCtx, action: string): Promise<void> {
  const { term, state, deps, say } = ctx;
  switch (action) {
    /* ---- Items ---- */
    case "create-obj":
      /* wiz_create_nonartifact (ui-wizard.c:466) -> wiz_create_item(false). */
      await runCreateItem(ctx, false);
      break;
    case "create-artifact":
      /* wiz_create_artifact (ui-wizard.c:394) -> wiz_create_item(true). */
      await runCreateItem(ctx, true);
      break;
    case "create-all-tval":
      /* wiz_create_all_for_tval (ui-wizard.c:433) presets choice = 1, so
       * instant artifacts are included without asking. */
      await runCreateAllObjFromTval(ctx, true);
      break;
    case "acquire-good":
      await runAcquire(ctx, false);
      break;
    case "acquire-great":
      await runAcquire(ctx, true);
      break;
    case "play-item":
      await runPlayItem(ctx);
      break;

    /* ---- Player ---- */
    case "cure-all":
      /* do_cmd_wiz_cure_all (cmd-wizard.c:942) says "You feel *much* better!"
       * itself (L991), through the engine. Nothing is added here. */
      if (!deps.effect) return unavailable(ctx);
      wizCureAll(state, deps);
      break;
    case "advance":
      /* do_cmd_wiz_advance (L414) prints nothing. */
      if (!deps.expDeps) return unavailable(ctx);
      wizAdvance(state, deps);
      break;
    case "increase-exp": {
      const n = await getQuantity(
        term,
        t("wizard.increaseExp.prompt", "Gain how much experience? "),
        9999,
      );
      if (!deps.expDeps) return unavailable(ctx);
      wizIncreaseExp(state, { quantity: n }, deps);
      break;
    }
    case "rerate":
      /* do_cmd_wiz_rerate says "Current Life Rating is %d/100." itself. */
      wizRerate(state, deps);
      break;
    case "edit-player":
      await runEditPlayer(ctx);
      break;
    case "learn-kinds":
      /* wiz_learn_all_object_kinds (ui-wizard.c:443) presets level = 100, so
       * the menu asks nothing. The engine says "You now know about many
       * items!". */
      await runLearnObjectKinds(ctx, 100);
      break;
    case "recall-monster":
      await runRecall(ctx, false);
      break;
    case "wipe-recall":
      await runRecall(ctx, true);
      break;

    /* ---- Teleport ---- */
    case "tele-to":
      await runTeleportTo(ctx);
      break;
    case "tele-near":
      /* wiz_phase_door (ui-wizard.c:453) presets range 10. */
      await runTeleportRandom(ctx, 10);
      break;
    case "tele-far":
      /* wiz_teleport (ui-wizard.c:463) presets range 100. */
      await runTeleportRandom(ctx, 100);
      break;
    case "jump-level":
      await runJumpLevel(ctx);
      break;

    /* ---- Effects (all need the effect interpreter bundle) ---- */
    case "detect-local":
      if (!deps.effect) return unavailable(ctx);
      wizDetectAllLocal(state, deps);
      break;
    case "detect-monsters":
      if (!deps.effect) return unavailable(ctx);
      wizDetectAllMonsters(state, deps);
      break;
    case "magic-map":
      if (!deps.effect) return unavailable(ctx);
      wizMagicMap(state, deps);
      break;
    case "hit-los":
      if (!deps.effect) return unavailable(ctx);
      wizHitAllLos(state, deps);
      break;
    case "perform-effect":
      await runPerformEffect(ctx);
      break;
    case "graphics-demo":
      await runProjDemo(ctx);
      break;

    /* ---- Summon ---- */
    case "summon-named":
      await runSummonNamed(ctx);
      break;
    case "summon-random": {
      /* do_cmd_wiz_summon_random (cmd-wizard.c:2681). */
      const n = await getQuantity(
        term,
        t("wizard.summon.randomCount.prompt", "How many monsters? "),
        40,
      );
      if (!deps.effect) return unavailable(ctx);
      wizSummonRandom(state, { quantity: n < 1 ? 1 : n }, deps);
      break;
    }

    /* ---- Files ---- */
    case "spoilers":
      if (!ctx.pack) return unavailable(ctx);
      await runSpoilers(term, ctx.pack, say);
      break;
    case "write-map":
      await runWriteMap(ctx);
      break;

    /* ---- Statistics ---- */
    case "stat-objmon":
      await runCollectObjMonStats(ctx);
      break;
    case "stat-pits":
      await runCollectPitStats(ctx);
      break;
    case "stat-disconnect":
      await runCollectDisconnectStats(ctx);
      break;

    /* ---- Query ---- */
    case "query-feature":
      await runQueryFeature(ctx);
      break;
    case "query-square-flag":
      await runQuerySquareFlag(ctx);
      break;
    case "peek-flow":
      await runPeekNoiseScent(ctx);
      break;
    case "keylog":
      await runDisplayKeylog(ctx);
      break;

    /* ---- Miscellaneous ---- */
    case "wizard-light":
      /* do_cmd_wiz_wizard_light (L2907) is one call to wiz_light and prints
       * nothing of its own. */
      wizWizardLight(state, deps);
      break;
    case "create-trap":
      await runCreateTrap(ctx);
      break;
    case "banish": {
      /* do_cmd_wiz_banish (cmd-wizard.c:450): default z_info->max_sight, and
       * no message afterwards. */
      const range = await getQuantity(
        term,
        t("wizard.banish.prompt", "Zap within what distance? "),
        state.z.maxSight,
      );
      wizBanish(state, { range }, deps);
      break;
    }
    case "push-object":
      /* do_cmd_wiz_push_object (L1871) needs a "point" argument and returns
       * silently without one; the menu row has no picker upstream either, so
       * the player's own grid is the only reachable case. No message. */
      wizPushObject(state, { grid: state.actor.grid }, deps);
      break;
    case "quit-no-save":
      /* wiz_confirm_quit_no_save (ui-wizard.c L432-436) asks, then pushes
       * CMD_WIZ_QUIT_NO_SAVE, whose handler is do_cmd_wiz_quit_no_save
       * (cmd-wizard.c L2203): quit("user choice") - end the program, writing
       * nothing.
       *
       * The port used to ask the question and then TELL THE PLAYER to reload the
       * page, which is a stand-in, not a port: the row promised an action and
       * performed a suggestion. ctx.quitNoSave is the shell's real equivalent -
       * on desktop it exits the process, in a tab it abandons the session and
       * lands on the title without persisting. Both leave whatever was last
       * written on disk untouched, which is exactly what upstream's quit does. */
      if (
        await confirmYesNo(term, t("wizard.quitNoSave.confirm", "Really quit without saving? "))
      ) {
        if (ctx.quitNoSave) {
          await ctx.quitNoSave();
        } else {
          /* No seam wired (headless / test harness): say so rather than claim a
           * quit that did not happen. */
          say(t("wizard.debug.unavailable", "That debug command is not available in this build."));
        }
      }
      break;
    default:
      say(t("wizard.debug.unknown", "Unknown debug command."));
  }
  ctx.refresh();
}

/* ------------------------------------------------------------------ *
 * Interactive sub-flows.
 * ------------------------------------------------------------------ */

/** EF_MAX (list-effects.h): one past the last effect code. */
const EF_MAX = Object.keys(EF).length;

/* ------------------------------------------------------------------ *
 * ui-wizard.c's three browsable screens.
 * ------------------------------------------------------------------ */

/** object_base_name(tval, plural) (obj-desc.c:31). */
function objectBaseName(base: ObjectBase | undefined, plural: boolean): string {
  if (!base || !base.name) return "";
  return objDescNameFormat(base.name, null, plural);
}

/**
 * object_kind_name(kind, easy_know) (obj-desc.c:48) with easy_know true, which
 * is what the create menu passes: the proper name, never the flavour.
 */
function objectKindName(kind: ObjectKind): string {
  return objDescNameFormat(kind.name, null, false);
}

/**
 * wiz_create_item (ui-wizard.c:376): the browsable object / artifact creator
 * behind the Items menu's 'c' and 'C'. Two levels - a tval menu titled
 * "What kind of object?" / "What kind of artifact?" over object_base_name, then
 * a submenu of that tval's kinds ("What kind of %s?") or artifacts
 * ("Which artifact %s? ") - each with a trailing "All ..." row that creates
 * every entry at that level. For artifacts only tvals that HAVE an artifact are
 * listed (L440-449), and a submenu holds at most 60 entries (L303/L312), both
 * upstream bounds.
 *
 * ESCAPE in the submenu returns to the tval menu (L367 returns EVT_ESCAPE, which
 * keeps the outer menu open); a selection closes both.
 */
async function runCreateItem(ctx: WizardUiCtx, art: boolean): Promise<void> {
  const { term, state, deps } = ctx;
  if (!deps.makeDeps) return unavailable(ctx);
  if (art && !deps.artifacts) return unavailable(ctx);
  const make = deps.makeDeps;
  const reg = make.reg;
  const artifacts = deps.artifacts ?? [];

  /**
   * get_art_name (ui-wizard.c:154-187): the label for one artifact row.
   *
   * This is NOT make_fake_artifact, and the difference is not cosmetic. Upstream
   * builds the object here by hand -- object_prep(obj, kind, 0, RANDOMISE) and
   * an artifact pointer, with no copy_artifact_data -- so it rolls the base
   * item's random plusses off the GAME stream and never rolls a curse timeout.
   * The port used to call makeFakeArtifact against a throwaway Rng at a fixed
   * seed, which is a different function drawing a different number of values
   * from a different stream; substituting a widget for an upstream function is
   * how a divergence hides behind a plausible name.
   *
   * Upstream's known twin is a full object_copy marked OBJ_NOTICE_IMAGINED
   * (L176-179); ODESC_SPOIL makes object_desc treat the object as its own known
   * twin, so the twin is not built separately here.
   */
  function getArtName(art: Artifact): string {
    const kind = reg.lookupKind(art.tval, art.sval);
    /* No base kind: upstream returns with buf untouched (L167). */
    if (!kind) return "";
    const obj = objectPrep(state.rng, reg, make.constants, kind, 0, "randomise");
    obj.artifact = art;
    return describeObject(state, obj, ODESC.SINGULAR | ODESC.SPOIL);
  }

  /* The tval filter (L423-451). */
  const tvals: number[] = [];
  for (let tval = 0; tval < reg.bases.length; tval++) {
    const base = reg.bases[tval];
    if (!base || !base.name) continue; // "Only real object bases"
    if (art && !artifacts.some((a) => a && a.tval === tval)) continue;
    tvals.push(tval);
  }

  for (;;) {
    const rows: MenuItem[] = tvals.map((tval) => ({
      label: objectBaseName(reg.bases[tval], true),
    }));
    rows.push({
      label: art
        ? t("wizard.createItem.allArtifacts", "All artifacts")
        : t("wizard.createItem.allObjects", "All objects"),
    });
    const pick = await selectFromMenu(
      term,
      "core:wizard-object-kind",
      art
        ? t("wizard.createItem.artifactTitle", "What kind of artifact?")
        : t("wizard.createItem.objectTitle", "What kind of object?"),
      rows,
      t("wizard.hint.letterCancel", "[ a-z to choose, ESC to cancel ]"),
    );
    if (pick === null) return;
    if (pick === tvals.length) {
      /* The top-level "All ..." row (L286-290). */
      if (art) wizCreateAllArtifact(state, deps);
      else wizCreateAllObj(state, deps);
      return;
    }
    const tval = tvals[pick];
    if (tval === undefined) return;
    const baseName = objectBaseName(reg.bases[tval], true);

    /* The submenu's choices, capped at 60 as upstream caps them. */
    const choices: number[] = [];
    if (art) {
      for (let i = 1; i < artifacts.length && choices.length < 60; i++) {
        if (artifacts[i]?.tval === tval) choices.push(i);
      }
    } else {
      for (let i = 1; i < reg.kinds.length && choices.length < 60; i++) {
        const kind = reg.kinds[i];
        if (!kind || kind.tval !== tval) continue;
        if (kind.kindFlags.has(KF.INSTA_ART)) continue;
        choices.push(i);
      }
    }
    const subRows: MenuItem[] = choices.map((idx) => {
      if (!art) return { label: objectKindName(reg.kinds[idx] as ObjectKind) };
      /* get_art_name (ui-wizard.c:150): a fake artifact described with
       * ODESC_SINGULAR | ODESC_SPOIL. */
      const a = artifacts[idx];
      return { label: a ? getArtName(a) : "" };
    });
    subRows.push({
      label: art
        ? t("wizard.createItem.allArtifactOfBase", "All artifact {baseName}", { baseName })
        : t("wizard.createItem.allOfBase", "All {baseName}", { baseName }),
    });

    const sub = await selectFromMenu(
      term,
      "core:wizard-object-subtype",
      art
        ? t("wizard.createItem.whichArtifact", "Which artifact {baseName}? ", { baseName })
        : t("wizard.createItem.whichKind", "What kind of {baseName}?", { baseName }),
      subRows,
      t("wizard.hint.letterBack", "[ a-z to choose, ESC to go back ]"),
    );
    if (sub === null) continue; // ESC: back to the tval menu
    if (sub === choices.length) {
      /* The per-tval "All ..." row (L246-253). The non-artifact branch passes
       * choice = 0, so instant artifacts are EXCLUDED here - unlike the "Create
       * all from tval" menu row, which passes 1. */
      if (art) wizCreateAllArtifactFromTval(state, { tval }, deps);
      else await runCreateAllObjFromTval(ctx, false, tval);
      return;
    }
    const index = choices[sub];
    if (index === undefined) return;
    if (art) await runCreateArtifact(ctx, index);
    else await runCreateObj(ctx, index);
    return;
  }
}

/** KEYLOG_SIZE (ui-term.h:336). */
const KEYLOG_SIZE = 8;

/**
 * wiz_display_keylog (ui-wizard.c:96) as a document: a `key`/`code`/`mods`
 * table for the last KEYLOG_SIZE keypresses, most recent first, then the
 * static "Press any key to continue." line.
 *
 * EVERY COLUMN IS `pad: false` WITH ITS OWN BAKED PUNCTUATION, rather than a
 * declared `width` the table would centre columns on. Upstream's own row is
 * `    %-12s (code=%lu mods=%u)` - a MINIMUM width on the key text, never a
 * maximum, so a key logged with several modifiers (`{^SAM}[ArrowDown]`, 17
 * characters) overruns the 12-column pad and is shown in FULL rather than
 * lining up under the row above it. `ScreenColumn.width` is a CLAMP by this
 * module's own design (screen-view.ts), so declaring one here would silently
 * truncate that row instead of reproducing upstream's un-aligned overflow -
 * baking the exact text per cell is the only way to keep both behaviours.
 * `code` and `mods` are still published as `values`, which is the point of
 * modelling this at all: a presenter reads the number without parsing "(code=5
 * mods=3)" back out of a string.
 */
export function wizKeylogScreen(log: readonly (WizKeypress | undefined)[]): ScreenView {
  const columns: ScreenColumn[] = [
    { key: "key", pad: false },
    { key: "code", pad: false, gap: 0 },
    { key: "mods", pad: false, gap: 0 },
  ];
  const rows: ScreenRow[] = [];
  for (let i = 0; i < KEYLOG_SIZE; i++) {
    const k = log[i];
    rows.push({
      cells: k
        ? {
            key: { text: `    ${k.text.padEnd(12)}` },
            code: { text: ` (code=${k.code}`, values: { code: k.code } },
            mods: { text: ` mods=${k.mods})`, values: { mods: k.mods } },
          }
        : {},
    });
  }
  return freezeView({
    id: "core:wizard-keylog",
    title: t("wizard.keylog.title", "Previous keypresses (top most recent):"),
    footer: SCREEN_FOOTER,
    blocks: [
      /* `key`/`code`/`mods` cells below bake their own C-format punctuation
       * (see the doc comment above); those fragments are exempt for the same
       * reason wizItemScreen's field-dump rows are. */
      { kind: "table", key: "keylog", tagged: false, columns, rows },
      {
        kind: "lines",
        lines: [{ text: t("wizard.keylog.pressAnyKey", "Press any key to continue.") }],
      },
    ],
  });
}

async function runDisplayKeylog(ctx: WizardUiCtx): Promise<void> {
  const log = [...(ctx.keylog?.() ?? [])].reverse(); // the ring, most recent first
  await showTextScreen(ctx.term, wizKeylogScreen(log));
}

/**
 * wiz_proj_demo (ui-wizard.c:78): the "PROJ_ types display" menu - every
 * projection by its list-projections.h code, with the five bolt glyphs drawn 25
 * columns in, in that projection's colour (proj_display, L37-64). Upstream rules
 * every odd row with dots so the columns stay readable.
 */
/*
 * DEAD CODE, CORDONED (convention: packages/core/src/player/spell.ts).
 *
 * proj_display's else branch (ui-wizard.c L61-63) prints this when tile_height is
 * not 1, because a multi-row tile cannot be drawn inside a one-row menu entry.
 * This port has no tile_height > 1 state at all - the renderer scales a tile to
 * one cell, documented at mapview.ts:70 - so the branch is unreachable here.
 * Transcribed rather than omitted so both censuses can see it and so the reason
 * it never fires is recorded next to the string instead of nowhere.
 *
 * Not routed through the translator: no code path in this build ever prints
 * it, so there is no player-facing occurrence for a catalogue entry to cover.
 */
export const PROJ_DEMO_TILE_HEIGHT_MSG = "Change tile_height to 1 to see graphics.";

async function runProjDemo(ctx: WizardUiCtx): Promise<void> {
  const projections = ctx.projections;
  if (!projections || projections.length === 0) return unavailable(ctx);
  /* REDUCED: upstream picks proj_to_attr/proj_to_char[type][i] when use_graphics
   * is not GRAPHICS_NONE (L56-58); the port has no per-projection tile table, so
   * the bolt row is always the ASCII glyphs below. A real gap, not a stand-in -
   * the ASCII path is what upstream draws in the default GRAPHICS_NONE build. */
  /* wchar_t chars[] = L"*|/-\\" (L52): the BOLT_MAX ASCII bolt glyphs. */
  const BOLT_CHARS = ["*", "|", "/", "-", "\\"].join("");
  const white = colorToCss(COLOUR_WHITE);
  const rows: MenuItem[] = projections.map((proj, type) => {
    const fill = Math.max(1, 25 - proj.code.length);
    const rule = (type % 2 ? "." : " ").repeat(fill);
    return {
      label: `${proj.code}${rule}${BOLT_CHARS}`,
      runs: [
        { text: `${proj.code}${rule}`, color: white },
        { text: BOLT_CHARS, color: colorToCss(colorTextToAttr(proj.color ?? "w")) },
      ],
    };
  });
  await selectFromMenu(
    ctx.term,
    "core:wizard-projection",
    t("wizard.projDemo.title", "PROJ_ types display"),
    rows,
    t("wizard.hint.escClose", "[ ESC to close ]"),
  );
}

/* ------------------------------------------------------------------ *
 * The four commands whose menu row presets an argument. Upstream writes each as
 * `if (cmd_get_arg_*(...) != CMD_OK) { ask }`, so the SAME function serves the
 * menu (argument supplied, no prompt) and a bare command from a keymap or a
 * repeat (argument absent, prompt asked). Passing the argument as an optional
 * parameter keeps both paths in one place, as the C does - the prompts are not
 * dead code waiting for a keymap layer.
 * ------------------------------------------------------------------ */

/** do_cmd_wiz_create_obj (cmd-wizard.c:874). */
async function runCreateObj(ctx: WizardUiCtx, index?: number): Promise<void> {
  const { term, state, deps } = ctx;
  if (!deps.makeDeps) return unavailable(ctx);
  let ind = index;
  if (ind === undefined) {
    const kMax = deps.makeDeps.reg.kinds.length;
    const s = await getString(
      term,
      t("wizard.createObj.prompt", "Create which object (0-{max})? ", { max: kMax - 1 }),
      "",
      80,
    );
    if (s === null) return;
    const parsed = intFromString(s);
    if (parsed === null) return;
    ind = parsed;
  }
  /* Out of range prints "That's not a valid kind of object." from the engine. */
  wizCreateObj(state, { index: ind }, deps);
}

/** do_cmd_wiz_create_artifact (cmd-wizard.c:843). */
async function runCreateArtifact(ctx: WizardUiCtx, index?: number): Promise<void> {
  const { term, state, deps } = ctx;
  if (!deps.makeDeps || !deps.artifacts) return unavailable(ctx);
  let ind = index;
  if (ind === undefined) {
    const aMax = deps.artifacts.length;
    const s = await getString(
      term,
      t("wizard.createArtifact.prompt", "Create which artifact (1-{max})? ", { max: aMax - 1 }),
      "",
      80,
    );
    if (s === null) return;
    const parsed = intFromString(s);
    if (parsed === null) return;
    ind = parsed;
  }
  /* Out of range prints "That's not a valid artifact." from the engine. */
  wizCreateArtifact(state, { index: ind }, deps);
}

/** do_cmd_wiz_acquire (cmd-wizard.c:390). */
async function runAcquire(ctx: WizardUiCtx, great?: boolean): Promise<void> {
  const { term, state, deps } = ctx;
  let isGreat = great;
  if (isGreat === undefined) {
    isGreat = await confirmYesNo(term, t("wizard.acquire.confirmGreat", "Acquire great objects? "));
  }
  const n = await getQuantity(
    term,
    isGreat
      ? t("wizard.acquire.howManyGreat", "How many great objects? ")
      : t("wizard.acquire.howManyGood", "How many good objects? "),
    40,
  );
  if (n < 1) return;
  if (!deps.makeDeps) return unavailable(ctx);
  wizAcquire(state, { quantity: n, great: isGreat }, deps);
}

/** do_cmd_wiz_create_all_obj_from_tval (cmd-wizard.c:804). */
async function runCreateAllObjFromTval(
  ctx: WizardUiCtx,
  art?: boolean,
  presetTval?: number,
): Promise<void> {
  const { term, state, deps } = ctx;
  if (!deps.makeDeps) return unavailable(ctx);
  const tvalMax = deps.makeDeps.reg.bases.length;
  let tval = presetTval ?? null;
  if (tval === null) {
    const s = await getString(
      term,
      t("wizard.createAllTval.prompt", "Create all items of which tval (1-{max})? ", {
        max: tvalMax - 1,
      }),
      "",
      80,
    );
    if (s === null) return;
    tval = intFromString(s);
  }
  if (tval === null || tval < 1 || tval >= tvalMax) return;
  let withArt = art;
  if (withArt === undefined) {
    withArt = await confirmYesNo(term, t("wizard.createAllTval.confirmArt", "Create instant artifacts? "));
  }
  wizCreateAllObjFromTval(state, { tval, art: withArt }, deps);
}

/** do_cmd_wiz_learn_object_kinds (cmd-wizard.c:1436). */
async function runLearnObjectKinds(ctx: WizardUiCtx, level?: number): Promise<void> {
  const { term, state, deps } = ctx;
  let lvl = level;
  if (lvl === undefined) {
    const s = await getString(
      term,
      t("wizard.learnKinds.prompt", "Learn object kinds up to level (0-100)? "),
      "100",
      80,
    );
    if (s === null) return;
    const parsed = intFromString(s);
    if (parsed === null) return;
    lvl = parsed;
  }
  if (!deps.makeDeps || !deps.flavor) return unavailable(ctx);
  wizLearnObjectKinds(state, { level: lvl }, deps);
}

/** do_cmd_wiz_teleport_random (cmd-wizard.c:2703). */
async function runTeleportRandom(ctx: WizardUiCtx, range?: number): Promise<void> {
  const { term, state, deps } = ctx;
  let r = range;
  if (r === undefined) {
    const s = await getString(term, t("wizard.teleport.rangePrompt", "Teleport range? "), "100", 80);
    if (s === null) return;
    const parsed = intFromString(s);
    if (parsed === null || parsed < 1) return;
    r = parsed;
  }
  if (!deps.effect) return unavailable(ctx);
  wizTeleportRandom(state, { range: r }, deps);
}

/**
 * do_cmd_wiz_create_trap (cmd-wizard.c:905): "Create which trap? " takes an
 * index OR a trap name (lookup_trap); an unknown name becomes trap_max, which
 * the command reports as "Trap not found.". All three refusals come from the
 * engine.
 */
async function runCreateTrap(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps } = ctx;
  if (!deps.trapDeps) return unavailable(ctx);
  const s = await getString(term, t("wizard.createTrap.prompt", "Create which trap? "), "", 80);
  if (s === null) return;
  let tidx = intFromString(s);
  if (tidx === null) {
    const trap = lookupTrap(deps.trapDeps.kinds, s);
    tidx = trap ? trap.tidx : deps.trapDeps.kinds.length;
  }
  wizCreateTrap(state, { index: tidx }, deps);
}

/**
 * do_cmd_wiz_jump_level (cmd-wizard.c:1389): the level, then
 * "Choose cave profile? " - answering yes sets NOSCORE_JUMPING (L1366). The
 * engine says "You jump to dungeon level %d.".
 */
async function runJumpLevel(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps } = ctx;
  const maxDepth = state.z.maxDepth;
  const s = await getString(
    term,
    t("wizard.jumpLevel.prompt", "Jump to level (0-{max}): ", { max: maxDepth - 1 }),
    String(state.chunk.depth),
    80,
  );
  if (s === null) return;
  const level = intFromString(s);
  if (level === null) return;
  if (level < 0 || level >= maxDepth) return; // L1358 paranoia
  const chooseGen = await confirmYesNo(term, t("wizard.jumpLevel.chooseProfile", "Choose cave profile? "));
  if (chooseGen) {
    /* choose_profile (generate.c:824-836) asks this at GENERATION time, off the
     * NOSCORE_JUMPING bit the answer above just set. Nothing else can consume
     * that bit in between - the jump generates the very next level - and the
     * port's generator is synchronous, so the answer is collected here and
     * carried on state.jumpProfileName for the generation to consume once.
     * `char name[30]` is the C's buffer (L825). */
    const name = await getString(
      term,
      t("wizard.jumpLevel.profileNamePrompt", "Profile name (eg classic): "),
      "",
      30,
    );
    state.jumpProfileName = name ?? undefined;
  }
  if (wizJumpLevel(state, { level, chooseGen }, deps) && ctx.changeLevel && state.generateLevel) {
    ctx.changeLevel(state.targetDepth ?? level);
  }
}

/**
 * do_cmd_wiz_teleport_to (cmd-wizard.c L2725): pick a destination grid, and if
 * it is passable, effect_simple(EF_TELEPORT_TO) to it; otherwise report it is
 * impassable ("The square you are aiming for is impassable.", from the engine).
 * The grid comes from the shell's targeting UI (ctx.pickGrid) - upstream's
 * cmd_get_point, i.e. textui_get_point's own look/target loop. Without the
 * picker the command has no argument and, like upstream, does nothing.
 */
async function runTeleportTo(ctx: WizardUiCtx): Promise<void> {
  const { state, deps } = ctx;
  if (!deps.effect) return unavailable(ctx);
  if (!ctx.pickGrid) return; // cmd_get_point != CMD_OK -> return (L2677)
  const grid = await ctx.pickGrid();
  if (!grid) return;
  wizTeleportTo(state, { grid }, deps);
}

/**
 * do_cmd_wiz_perform_effect (cmd-wizard.c L1574): the effect (name or index),
 * its dice, its subtype, and the radius / other / y / x parameters, then
 * effect_simple() from a player source.
 *
 * Upstream wart preserved: ESCAPE at the FIRST prompt does not abort - the
 * `if (get_string(...))` body is skipped, index stays -1, and the remaining
 * prompts still run before effect_simple(-1, ...) does nothing (L1537-1548).
 * Only a name that resolves to nothing prints "No effect found." and returns.
 */
async function runPerformEffect(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps, say } = ctx;
  if (!deps.effect) return unavailable(ctx);

  let index = -1;
  const nameEntry = await getString(term, t("wizard.performEffect.namePrompt", "Do which effect: "), "", 80);
  if (nameEntry !== null) {
    const parsed = intFromString(nameEntry);
    index = parsed ?? effectLookup(nameEntry);
    if (index <= EF.NONE || index >= EF_MAX) {
      say(t("wizard.performEffect.notFound", "No effect found."));
      return;
    }
  }

  /* "Enter damage dice (eg 1+2d6M2): "; ESCAPE leaves the default "0". */
  const diceEntry = await getString(
    term,
    t("wizard.performEffect.dicePrompt", "Enter damage dice (eg 1+2d6M2): "),
    "0",
    80,
  );
  const diceString = diceEntry ?? "0";

  /* "Enter name or number for effect subtype: " -> effect_subtype (L1557). */
  let subtype = 0;
  const subEntry = await getString(
    term,
    t("wizard.performEffect.subtypePrompt", "Enter name or number for effect subtype: "),
    "0",
    80,
  );
  if (subEntry !== null) {
    const st = effectSubtype(index, subEntry, deps.effect.inject);
    subtype = st === -1 ? 0 : st;
  }

  /* The four get_quantity prompts, max 100 (L1567-1570). */
  const radius = await getQuantity(
    term,
    t("wizard.performEffect.radiusPrompt", "Enter second parameter (radius): "),
    100,
  );
  const other = await getQuantity(
    term,
    t("wizard.performEffect.otherPrompt", "Enter third parameter (other): "),
    100,
  );
  const y = await getQuantity(term, t("wizard.performEffect.yPrompt", "Enter y parameter: "), 100);
  const x = await getQuantity(term, t("wizard.performEffect.xPrompt", "Enter x parameter: "), 100);

  const ident = runWizEffect(state, deps.effect, index, {
    diceString,
    subtype,
    radius,
    other,
    y,
    x,
  });
  if (ident) say(t("wizard.performEffect.identified", "Identified!"));
}

/**
 * do_cmd_wiz_edit_player_start (cmd-wizard.c:1252): upstream queues one
 * CMD_WIZ_EDIT_PLAYER_STAT per stat, then GOLD, then EXP, and walks them in
 * order - there is no field picker. Each stage's prompt carries the current
 * value as its default: "STR (3-118): " ... "Gold: ", "Experience: ".
 *
 * edit_player_state is the C's cancel semantics: a cancelled or unparseable
 * stage sets EDIT_PLAYER_BREAK, and every LATER stage then returns
 * immediately (L1252, L1142, L1174) - so ESC at INT skips WIS/DEX/CON, gold and
 * exp too. That is what returning from this loop reproduces.
 */
async function runEditPlayer(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps } = ctx;
  const p = state.actor.player;

  for (let stat = 0; stat < STAT_MAX; stat++) {
    if (!(await runEditPlayerStat(ctx, stat))) return; // EDIT_PLAYER_BREAK
  }

  const gs = await getString(term, t("wizard.editPlayer.goldPrompt", "Gold: "), String(p.au), 80);
  if (gs === null) return;
  const gv = longFromString(gs);
  if (gv === null) return;
  wizEditPlayerGold(state, { value: gv }, deps);

  const es = await getString(
    term,
    t("wizard.editPlayer.expPrompt", "Experience: "),
    String(p.exp),
    80,
  );
  if (es === null) return;
  const ev = longFromString(es);
  if (ev === null) return;
  wizEditPlayerExp(state, { value: ev }, deps);
}

/**
 * do_cmd_wiz_edit_player_stat (cmd-wizard.c:1297). Called per stat by the edit
 * sequence with the stat preset; called with `stat` absent it asks upstream's
 * own picker, "Edit which stat (name or 0-%d): ", which takes an index or a
 * stat_name_to_idx name and defaults to stat_idx_to_name(0). Returns false where
 * the C sets EDIT_PLAYER_BREAK, i.e. every later stage is skipped.
 */
async function runEditPlayerStat(ctx: WizardUiCtx, stat?: number): Promise<boolean> {
  const { term, state, deps } = ctx;
  const p = state.actor.player;
  let idx = stat;
  if (idx === undefined) {
    const pick = await getString(
      term,
      t("wizard.editPlayerStat.pickPrompt", "Edit which stat (name or 0-{max}): ", {
        max: STAT_MAX - 1,
      }),
      STAT_NAMES[0] ?? "STR",
      80,
    );
    if (pick === null) return true; // a cancelled PICK just returns (L1261)
    const parsed = intFromString(pick);
    if (parsed !== null) {
      idx = parsed;
    } else {
      const named = statNameToIdx(pick);
      if (named < 0) return true;
      idx = named;
    }
  }
  if (idx < 0 || idx >= STAT_MAX) return true; // L1272 paranoia
  const s = await getString(
    term,
    t("wizard.editPlayerStat.valuePrompt", "{stat} (3-118): ", { stat: STAT_NAMES[idx] ?? "" }),
    String(p.statMax[idx] ?? 10),
    80,
  );
  if (s === null) return false;
  const v = intFromString(s);
  if (v === null) return false;
  wizEditPlayerStat(state, { stat: idx, value: v }, deps);
  return true;
}

/**
 * do_cmd_wiz_recall_monster (cmd-wizard.c:2213) and do_cmd_wiz_wipe_recall
 * (L2860). Both open with a get_com over all monsters or one, and the specific
 * branch takes an index OR a monster name (lookup_monster). An index outside
 * [0, r_max) - which is where an unresolved name lands - prints
 * "No monster found.".
 */
async function runRecall(ctx: WizardUiCtx, wipe: boolean): Promise<void> {
  const { term, state, deps, say } = ctx;
  if (!deps.races) return unavailable(ctx);
  const c = await getCom(
    term,
    wipe
      ? t(
          "wizard.recall.wipePrompt",
          "Wipe recall for [a]ll monsters or [s]pecific monster? ",
        )
      : t(
          "wizard.recall.fullPrompt",
          "Full recall for [a]ll monsters or [s]pecific monster? ",
        ),
  );
  if (c === null) return;

  let ridx = deps.races.length; // r_idx = z_info->r_max (L2163/L2862)
  if (c === "a" || c === "A") {
    ridx = -1;
  } else if (c === "s" || c === "S") {
    const s = await getString(term, t("wizard.recall.whichMonster", "Which monster? "), "", 80);
    if (s === null) return;
    const parsed = intFromString(s);
    if (parsed !== null) {
      ridx = parsed;
    } else {
      const race = ctx.raceByName?.(s);
      if (race) ridx = race.ridx;
    }
  } else {
    return; // any other key: return (L2183/L2882)
  }

  if (ridx === -1) {
    if (wipe) wizWipeRecall(state, { all: true }, deps);
    else wizRecallMonster(state, { all: true }, deps);
    return;
  }
  const race = ridx >= 0 && ridx < deps.races.length ? deps.races[ridx] : undefined;
  if (!race) {
    say(t("wizard.monster.notFound", "No monster found."));
    return;
  }
  if (wipe) wizWipeRecall(state, { race }, deps);
  else wizRecallMonster(state, { race }, deps);
}

/**
 * do_cmd_wiz_summon_named (cmd-wizard.c:2621): "Summon which monster? " takes
 * an index or a name; nothing resolved prints "No monster found." and returns.
 * "Could not place monster." comes from the engine's ten placement tries.
 */
async function runSummonNamed(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps, say } = ctx;
  if (!deps.monPlace || !deps.races) return unavailable(ctx);
  const s = await getString(term, t("wizard.summon.namedPrompt", "Summon which monster? "), "", 80);
  if (s === null) return;
  let race: MonsterRace | undefined;
  const parsed = intFromString(s);
  if (parsed !== null) {
    if (parsed > 0 && parsed < deps.races.length) race = deps.races[parsed];
  } else {
    race = ctx.raceByName?.(s) ?? undefined;
  }
  if (!race) {
    say(t("wizard.monster.notFound", "No monster found."));
    return;
  }
  wizSummonNamed(state, { race }, deps);
}

/**
 * do_cmd_wiz_dump_level_map (cmd-wizard.c:1162-1186): get_file("level.html"),
 * then "Title for map: " defaulted to "Map of level %d", then dump_level writes
 * the HTML page and file_close's success reports "Level dumped to %s.".
 *
 * Both prompts are upstream's and both can cancel (L1119-1122). The page is the
 * real dump_level output (core game/dump-level.ts), written into the installed
 * host's user directory - a real file under the desktop shell - and handed to the
 * browser as a download only where that is the only way to reach it.
 */
async function runWriteMap(ctx: WizardUiCtx): Promise<void> {
  const { term, state } = ctx;
  // "level.html" is a default FILENAME (get_file's own suggested name), not
  // prose - not translatable.
  const file = await getFile(term, "level.html");
  if (file === null) return;
  const title = await getString(
    term,
    t("wizard.writeMap.titlePrompt", "Title for map: "),
    t("wizard.writeMap.defaultTitle", "Map of level {depth}", { depth: state.chunk.depth }),
    80,
  );
  if (title === null) return;
  const html = dumpLevel(state, title);
  /* file_open failing is silent upstream; only the close reports (L1124-1128). */
  if (!userWrite(file, html, FileType.HTML)) return;
  exportUserFile(file, html, "text/html");
  ctx.say(t("wizard.writeMap.saved", "Level dumped to {path}.", { path: userPath(file) }));
}

/* ------------------------------------------------------------------ *
 * The map QUERY commands. Each highlights the visible panel through
 * wiz_hack_map, waits for a key, then restores the map.
 * ------------------------------------------------------------------ */

/**
 * wiz_hack_map + "Press any key." (cmd-wizard.c:2109-2118): paint the marks,
 * wait for one keypress, clear row 0 and redraw the map. `msg("Press any
 * key.")` puts the line in the message log, so it is said rather than printed.
 */
async function highlightAndWait(
  ctx: WizardUiCtx,
  marks: readonly WizHackMark[],
): Promise<void> {
  ctx.hackMap?.(marks);
  ctx.say(t("wizard.hackMap.pressAnyKey", "Press any key."));
  await getKeyInline(ctx.term, "");
  ctx.refresh(); // prt("", 0, 0) + prt_map()
}

/**
 * Both map-query probes colour a highlighted grid yellow when it is passable
 * and red when it is not (wiz_hack_map_query_feature L1915,
 * wiz_hack_map_query_square_flag L2091).
 */
function featColor(ctx: WizardUiCtx, grid: Loc): number {
  return ctx.state.chunk.isPassable(grid) ? COLOUR_YELLOW : COLOUR_RED;
}

/**
 * do_cmd_wiz_query_feature (cmd-wizard.c:1982): one key picks a feature class,
 * the matching grids are highlighted (yellow where passable, red otherwise),
 * and an unlisted key prints the invalid-selection line.
 */
async function runQueryFeature(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps, say } = ctx;
  const choice = await getCom(term, t("wizard.queryFeature.prompt", "Debug Command Feature Query: "));
  if (choice === null) return;
  const features = FEATURE_QUERY_CHOICES[choice];
  if (!features) {
    say(
      t(
        "wizard.queryFeature.invalid",
        "That was an invalid selection.  Use one of fobuztcdhmqgpra .",
      ),
    );
    return;
  }
  const grids = wizQueryFeature(state, { features }, deps);
  await highlightAndWait(ctx, grids.map((grid) => ({ grid, color: featColor(ctx, grid) })));
}

/**
 * do_cmd_wiz_query_square_flag (cmd-wizard.c:2157): one key picks a SQUARE
 * flag; anything unlisted leaves flag 0, which highlights the KNOWN grids
 * instead of refusing (L2088). Colours are the same passable/impassable pair.
 */
async function runQuerySquareFlag(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps } = ctx;
  const c = await getCom(
    term,
    t("wizard.querySquareFlag.prompt", "Debug Command Query [grasvwdftniolx]: "),
  );
  if (c === null) return;
  const flag = SQUARE_FLAG_CHOICES[c] ?? 0;
  const grids = wizQuerySquareFlag(state, { flag }, deps);
  await highlightAndWait(ctx, grids.map((grid) => ({ grid, color: featColor(ctx, grid) })));
}

/**
 * do_cmd_wiz_peek_noise_scent (cmd-wizard.c:1527): step depth 0..99 over the
 * noise map, then 0..49 over the scent map, highlighting each depth's grids and
 * waiting on get_com(format("Depth %d: ", i)) between them; ESCAPE breaks out
 * of that loop. Noise is red, scent yellow.
 */
async function runPeekNoiseScent(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps } = ctx;
  for (let i = 0; i < 100; i++) {
    const grids = wizPeekFlow(state, { depth: i, which: "noise" }, deps);
    ctx.hackMap?.(grids.map((grid) => ({ grid, color: COLOUR_RED })));
    const k = await getCom(term, t("wizard.peekFlow.depthPrompt", "Depth {depth}: ", { depth: i }));
    if (k === null) break;
    ctx.refresh(); // prt_map()
  }
  for (let i = 0; i < 50; i++) {
    const grids = wizPeekFlow(state, { depth: i, which: "scent" }, deps);
    ctx.hackMap?.(grids.map((grid) => ({ grid, color: COLOUR_YELLOW })));
    const k = await getCom(term, t("wizard.peekFlow.depthPrompt", "Depth {depth}: ", { depth: i }));
    if (k === null) break;
    ctx.refresh();
  }
  ctx.refresh();
}

/* ------------------------------------------------------------------ *
 * The Statistics commands. Each opens with stats_are_enabled(), which is
 * false in a build without the collectors compiled in - it prints one
 * message and every prompt below it is unreachable, exactly as in a stock
 * 4.2.6 build (wiz-stats.c:3162, the #else arm of the USE_STATS guard).
 * ------------------------------------------------------------------ */

/** stats_are_enabled (wiz-stats.c:1652 / :3162). */
function statsAreEnabled(ctx: WizardUiCtx): WizStatsCollectors | null {
  if (ctx.stats) return ctx.stats;
  ctx.say(t("wizard.stats.disabled", STATS_DISABLED_MSG));
  return null;
}

/* The C's `static int default_nsim` values, which persist between invocations
 * (cmd-wizard.c:586, :623). */
let defaultDisconnectNsim = 50;
let defaultObjMonNsim = 50;
let defaultObjMonSimtype = 1;

/** do_cmd_wiz_collect_disconnect_stats (cmd-wizard.c:586). */
async function runCollectDisconnectStats(ctx: WizardUiCtx): Promise<void> {
  const { term } = ctx;
  const stats = statsAreEnabled(ctx);
  if (!stats) return;
  const s = await getString(
    term,
    t("wizard.stats.numSimulations", "Number of simulations: "),
    String(defaultDisconnectNsim),
    80,
  );
  if (s === null) return;
  const nsim = intFromString(s);
  if (nsim === null || nsim < 1) return;
  defaultDisconnectNsim = nsim;
  const stop = await confirmYesNo(
    term,
    t("wizard.stats.stopIfDisconnected", "Stop if disconnected level found? "),
  );
  stats.disconnectStats(nsim, stop);
}

/** do_cmd_wiz_collect_obj_mon_stats (cmd-wizard.c:623). */
async function runCollectObjMonStats(ctx: WizardUiCtx): Promise<void> {
  const { term } = ctx;
  const stats = statsAreEnabled(ctx);
  if (!stats) return;
  const s = await getString(
    term,
    t("wizard.stats.numSimulations", "Number of simulations: "),
    String(defaultObjMonNsim),
    80,
  );
  if (s === null) return;
  const nsim = intFromString(s);
  if (nsim === null || nsim < 1) return;
  defaultObjMonNsim = nsim;

  const simTypeAnswer = await getString(
    term,
    t("wizard.stats.simType", "Type of Sim: Diving (1) or Clearing (2) "),
    String(defaultObjMonSimtype),
    80,
  );
  if (simTypeAnswer === null) return;
  let simtype = intFromString(simTypeAnswer);
  if (simtype === null || simtype < 1 || simtype > 2) return;
  if (
    simtype === 2 &&
    (await confirmYesNo(term, t("wizard.stats.regenRandarts", "Regen randarts (warning SLOW)? ")))
  ) {
    simtype = 3;
  }
  defaultObjMonSimtype = simtype === 1 ? 1 : 2;
  stats.statsCollect(nsim, simtype);
}

/** do_cmd_wiz_collect_pit_stats (cmd-wizard.c:672). */
async function runCollectPitStats(ctx: WizardUiCtx): Promise<void> {
  const { term, state } = ctx;
  const stats = statsAreEnabled(ctx);
  if (!stats) return;
  const s = await getString(
    term,
    t("wizard.stats.numSimulationsPerDepth", "Number of simulations per depth: "),
    "1000",
    80,
  );
  if (s === null) return;
  const nsim = intFromString(s);
  if (nsim === null || nsim < 1) return;

  const p = await getString(term, t("wizard.stats.pitType", "Pit type (1-3): "), "1", 80);
  if (p === null) return;
  const pittype = intFromString(p);
  if (pittype === null || pittype < 1 || pittype > 3) return;

  const lo = await getString(
    term,
    t("wizard.stats.minDepth", "Minimum depth: "),
    String(state.chunk.depth),
    80,
  );
  if (lo === null) return;
  const depthMin = intFromString(lo);
  if (depthMin === null || depthMin < 1) return;

  const hi = await getString(term, t("wizard.stats.maxDepth", "Maximum depth: "), String(depthMin), 80);
  if (hi === null) return;
  const depthMax = intFromString(hi);
  if (depthMax === null || depthMax < depthMin) return;

  stats.pitStats(nsim, pittype, depthMin, depthMax);
}

/* ------------------------------------------------------------------ *
 * do_cmd_wiz_play_item (cmd-wizard.c:1646-1914) and the four commands it
 * queues.
 * ------------------------------------------------------------------ */

/** "%-5d"-style left-justified field padding for the wiz_display_item lines. */
function pad(value: number, width: number): string {
  const s = String(value);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

/**
 * The "+---FLAGS---+" ruled header and the five rows of vertically-written
 * flag-name letters (wiz_display_item, cmd-wizard.c:263-278), unchanged.
 *
 * LEFT AS `lines`, DELIBERATELY, not folded into the bits table below. This is
 * ASCII art with one column per flag and no per-flag DATA in it (a letter is
 * not a value a mod would read), and `ScreenColumn.label` renders as ONE
 * header row above a table - it has no way to spell a label spread across
 * five rows in a one-character-wide column. Forcing it through `label` would
 * either print only the label's first letter (padding a 5-character string
 * into a 1-wide column truncates) or hijack the bits table into emitting a
 * header row neither `drawWizItem` nor the C ever drew. A presenter is still
 * free to draw its own header from each bits-table column's `key` (the flag's
 * real name, e.g. `SUST_STR`) - reskinning the frame is open, reimagining the
 * banner just is not.
 */
// The "FLAGS" ruled header below is ASCII art built one glyph per column
// (see the doc comment above), not a sentence - not translatable.
function wizFlagBannerLines(labels: readonly string[]): ScreenLine[] {
  const nflg = labels.length;
  const head: string[] = new Array<string>(nflg).fill(" ");
  let k = 0;
  if (nflg >= 6) {
    head[0] = "+";
    k = Math.floor((nflg - 6) / 2);
    for (let i = 1; i < k; i++) head[i] = "-";
  }
  "FLAGS".split("").forEach((ch, i) => {
    head[k + i] = ch;
  });
  for (let i = k + 5; i < nflg - 1; i++) head[i] = "-";
  if (nflg >= 7) head[nflg - 1] = "+";
  const lines: ScreenLine[] = [{ text: head.join("").slice(0, nflg >= 7 ? nflg : k + 5) }];
  const done: boolean[] = new Array<boolean>(nflg).fill(false);
  for (let row = 0; row < 5; row++) {
    let line = "";
    for (let i = 0; i < nflg; i++) {
      const label = labels[i] ?? "";
      if (done[i] || row >= label.length) {
        done[i] = true;
        line += " ";
      } else {
        line += label[row];
      }
    }
    lines.push({ text: line });
  }
  return lines;
}

/**
 * prt_binary (ui-output.c): one glyph per set flag, as a TABLE - one column
 * per flag, keyed by the flag's own name (`SUST_STR`, not its 5-character
 * `debugLabel`), two rows ('actual' flags, then the known twin's). This is
 * the part of `wiz_display_item` a modding/debugging tool would actually
 * want: "is SUST_STR set on this object" is a lookup by key rather than a
 * count of characters into a 39-wide string.
 */
function wizFlagBitsTable(
  entries: readonly { readonly name: string }[],
  disp: WizItemDisplay,
): ScreenTableBlock {
  const columns: ScreenColumn[] = entries.map((e, i) => ({
    key: e.name,
    pad: false,
    ...(i === 0 ? {} : { gap: 0 }),
  }));
  const cellsFor = (set: { has: (i: number) => boolean }, ch: string): Record<string, ScreenCell> => {
    const cells: Record<string, ScreenCell> = {};
    entries.forEach((e, i) => {
      cells[e.name] = { text: set.has(i + 1) ? ch : "." };
    });
    return cells;
  };
  return {
    kind: "table",
    key: "flags-bits",
    tagged: false,
    columns,
    rows: [
      { id: "actual", cells: cellsFor(disp.flags, "*") },
      { id: "known", cells: cellsFor(disp.flagsKnown, "+") },
    ],
  };
}

/**
 * wiz_display_item (cmd-wizard.c:189) as a document: the spoiled description,
 * the combat / kind / number lines, then the FLAGS block (see
 * `wizFlagBannerLines` / `wizFlagBitsTable` above for why the banner and the
 * bits are two different kinds of block).
 *
 * COMBAT / KIND / NUMBER ARE EACH A ONE-ROW TABLE whose columns are `pad:
 * false` with their own baked punctuation, for the same reason
 * `wizKeylogScreen` bakes its columns: `pad()` and upstream's `%-Nd` both
 * guarantee a MINIMUM field width, never a maximum, and `ScreenColumn.width`
 * is a CLAMP (screen-view.ts) - declaring one would truncate a value that
 * overruns its usual digit count instead of reproducing the un-aligned
 * overflow upstream itself would show. Every field still carries its raw
 * number under `values`, which is the point of doing this as a table rather
 * than leaving the whole readout as one opaque string.
 */
export function wizItemScreen(disp: WizItemDisplay, description: string): ScreenView {
  const plus = (n: number): string => (n >= 0 ? `+${n}` : String(n));

  // combatRow / kindRow / numberRow below are not routed through the
  // translator. Their cell text is not prose - it is upstream's own C struct
  // field names (kind, tval, sval, pval, egoidx, cost, wgt, timeout) baked
  // together with printf-style punctuation one fragment at a time, exactly as
  // the doc comment above explains for the un-padded columns. A field name is
  // an identifier, not a sentence a translation catalogue would carry, and
  // splitting these fragments to make them ICU patterns would undo the
  // baked-punctuation layout this function exists to preserve.
  const combatCols: ScreenColumn[] = [
    { key: "dd", pad: false },
    { key: "ds", pad: false, gap: 0 },
    { key: "toH", pad: false, gap: 0 },
    { key: "toD", pad: false, gap: 0 },
    { key: "ac", pad: false, gap: 0 },
    { key: "toA", pad: false, gap: 0 },
  ];
  const combatRow: ScreenRow = {
    cells: {
      dd: { text: `combat = (${disp.dd}d`, values: { dd: disp.dd } },
      ds: { text: `${disp.ds}) (`, values: { ds: disp.ds } },
      toH: { text: `${plus(disp.toH)},`, values: { toH: disp.toH } },
      toD: { text: `${plus(disp.toD)}) [`, values: { toD: disp.toD } },
      ac: { text: `${disp.ac},`, values: { ac: disp.ac } },
      toA: { text: `${plus(disp.toA)}]`, values: { toA: disp.toA } },
    },
  };

  const kindCols: ScreenColumn[] = [
    { key: "kind", pad: false },
    { key: "tval", pad: false, gap: 0 },
    { key: "sval", pad: false, gap: 0 },
    { key: "weight", pad: false, gap: 0 },
    { key: "timeout", pad: false, gap: 0 },
  ];
  const kindRow: ScreenRow = {
    cells: {
      kind: { text: `kind = ${pad(disp.kidx, 5)}`, values: { kind: disp.kidx } },
      tval: { text: `  tval = ${pad(disp.tval, 5)}`, values: { tval: disp.tval } },
      sval: { text: `  sval = ${pad(disp.sval, 5)}`, values: { sval: disp.sval } },
      weight: { text: `  wgt = ${pad(disp.weight, 3)}`, values: { weight: disp.weight } },
      timeout: { text: `     timeout = ${disp.timeout}`, values: { timeout: disp.timeout } },
    },
  };

  const numberCols: ScreenColumn[] = [
    { key: "number", pad: false },
    { key: "pval", pad: false, gap: 0 },
    { key: "name1", pad: false, gap: 0 },
    { key: "egoidx", pad: false, gap: 0 },
    { key: "cost", pad: false, gap: 0 },
  ];
  const numberRow: ScreenRow = {
    cells: {
      number: { text: `number = ${pad(disp.number, 3)}`, values: { number: disp.number } },
      pval: { text: `  pval = ${pad(disp.pval, 5)}`, values: { pval: disp.pval } },
      name1: { text: `  name1 = ${pad(disp.name1, 4)}`, values: { name1: disp.name1 } },
      egoidx: { text: `  egoidx = ${pad(disp.egoidx, 4)}`, values: { egoidx: disp.egoidx } },
      cost: { text: `  cost = ${disp.cost}`, values: { cost: disp.cost } },
    },
  };

  /* nflg = MIN(OF_MAX - FLAG_START, 80) (L235). FLAG_START is 1, so this is
   * every flag but the unused zeroth. */
  const entries = OBJECT_FLAG_ENTRIES.slice(0, Math.min(OBJECT_FLAG_ENTRIES.length, 80));
  const labels = entries.map((e) => e.debugLabel);

  return freezeView({
    id: "core:wizard-item",
    title: t("wizard.itemScreen.title", "Item properties"),
    footer: SCREEN_FOOTER,
    blocks: [
      { kind: "lines", lines: [{ text: description }, { text: "" }] },
      { kind: "table", key: "combat", tagged: false, columns: combatCols, rows: [combatRow] },
      { kind: "table", key: "kind", tagged: false, columns: kindCols, rows: [kindRow] },
      /* gapAfter reproduces the nine blank rows between the number line (row 6)
       * and the FLAGS header (row 16) - a layout fact beside the data, exactly
       * as the character sheet's panel spacing is (screen-view.ts). */
      {
        kind: "table",
        key: "number",
        tagged: false,
        columns: numberCols,
        rows: [numberRow],
        gapAfter: 9,
      },
      { kind: "lines", lines: wizFlagBannerLines(labels) },
      wizFlagBitsTable(entries, disp),
    ],
  });
}

/**
 * The faithful terminal's own paint of `wizItemScreen`, anchored at row 2
 * exactly as the hand-drawn version was (rows 0-1 are the OUTER play-item
 * loop's own `getCom` prompt, not this screen's).
 *
 * THIS IS NOT `showTextScreen`'s generic renderer, and that is deliberate:
 * that renderer always draws a title at row 0 and a footer at the last row,
 * and `wiz_display_item` draws neither (confirmed against
 * reference/src/cmd-wizard.c:191-285 - upstream never calls `prt` for a
 * title here). Reusing it would add two rows nothing in this screen ever
 * had. What IS shared with every other screen is the one renderer,
 * `screenBodyLines` - this differs only in WHERE the lines land, not in how
 * they are computed, so the model and the pixels still cannot part.
 */
function paintWizItemOnTerminal(term: GridSurface & GridPointerInput, view: ScreenView): void {
  term.clear();
  const { cols } = term.size();
  const fg = UI_TEXT;
  screenBodyLines(view, cols).forEach((line, i) => {
    if (line.runs) {
      let x = 0;
      for (const run of line.runs) {
        if (x >= cols - 1) break;
        const chunk = run.text.slice(0, cols - 1 - x);
        term.print(x, 2 + i, chunk, run.color);
        x += chunk.length;
      }
    } else {
      term.print(0, 2 + i, line.text.slice(0, cols - 1), line.color ?? fg);
    }
  });
}

/**
 * wiz_display_item (cmd-wizard.c:189): draw the item's raw properties.
 *
 * OFFERED TO A PRESENTER BUT NEVER AWAITED - the one call site in this file
 * that differs from every other `showThroughPresenter` use. Every other
 * caller (`showTextScreen`, `showMonsterList`, the character sheet) OWNS its
 * dismissal: it shows one view and resolves when the player is done with it.
 * `drawWizItem` does not - it paints one frame of `runPlayItem`'s own loop,
 * which reads its NEXT command through `getCom` regardless of what this
 * function does, so there is no "done" for this call to wait on. A presenter
 * that takes the screen is expected to repaint on the very next call, exactly
 * as the terminal fallback below repaints on every call; and a fault mid-open
 * needs no recovery here either, because `showThroughPresenter` already
 * reports it and flips `broken` (screen-runtime.ts) before the rejection
 * reaches this `.catch`, so the NEXT redraw already falls through to the
 * terminal path on its own.
 *
 * `term.clear()` runs UNCONDITIONALLY, before deciding disp/presenter/fallback
 * at all - matching `wiz_display_item`'s own `Term_clear()` (cmd-wizard.c:212),
 * which upstream also runs before its all/known branch. It has to: this is a
 * REDRAW inside a loop, so the previous frame on screen is either the item
 * picker that ran before the loop started or this same function's own prior
 * paint, and a presenter that takes the view is still drawing over a clean
 * terminal rather than whatever that leftover frame was.
 */
function drawWizItem(ctx: WizardUiCtx, obj: GameObject, all: boolean): void {
  const { term: host, state, deps } = ctx;
  const handle = pushRegion(screenRegionSpec(), host.size());
  const term = regionSurface(host, handle.cells);
  try {
  term.clear();
  const disp = wizDisplayItem(obj, deps, { all });
  if (!disp) return;
  const description = describeObject(state, obj, ODESC.PREFIX | ODESC.FULL | ODESC.SPOIL);
  const view = wizItemScreen(disp, description);
  const taken = showThroughPresenter(view, screenFault);
  if (taken) {
    void taken.catch(() => {});
    return;
  }
  paintWizItemOnTerminal(term, view);
  } finally {
    popRegion(handle);
  }
}

/**
 * do_cmd_wiz_play_item (cmd-wizard.c:1646): snapshot the object, then loop -
 * draw wiz_display_item and ask the one-line get_com menu. [a]ccept keeps the
 * changes silently, ESCAPE rejects them and says "Changes ignored." only when
 * something was changed, and any unrecognised key just asks again (L1791-1796).
 */
async function runPlayItem(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps, say } = ctx;
  if (!deps.makeDeps) return unavailable(ctx);

  /* get_item(&obj, "Play with which object? ", "You have nothing to play
   * with.", ... USE_EQUIP | USE_INVEN | USE_QUIVER | USE_FLOOR) - L1631. */
  const { items, handles } = packMenu(state, () => true);
  if (items.length === 0) {
    say(t("wizard.playItem.nothingToPlayWith", "You have nothing to play with."));
    return;
  }
  const pick = await selectFromMenu(
    term,
    "core:wizard-play-object",
    t("wizard.playItem.pickPrompt", "Play with which object? "),
    items,
    t("wizard.hint.letterCancel", "[ a-z to choose, ESC to cancel ]"),
  );
  if (pick === null) return;
  const handle = handles[pick];
  if (handle === undefined) return;
  const obj = gearGet(state.gear, handle);
  if (!obj) return;

  const snapshot = wizPlayItemBegin(obj, deps);
  if (!snapshot) return;
  let changed = false;
  let displayAllProp = true; // "all_prop" defaults to 1 (L1653)

  for (;;) {
    drawWizItem(ctx, obj, displayAllProp);
    const ch = await getCom(
      term,
      t(
        "wizard.playItem.menuPrompt",
        "[a]ccept [s]tatistics [r]eroll [t]weak [c]urse [q]uantity [k]nown? ",
      ),
    );

    if (ch === null) {
      /* get_com false: done, rejected (L1806-1811). */
      wizPlayItemReject(obj, snapshot, deps);
      if (changed) say(t("wizard.playItem.changesIgnored", "Changes ignored."));
      ctx.refresh();
      return;
    }
    switch (ch) {
      case "A":
      case "a": {
        const equipped = state.actor.player.equipment.includes(handle);
        wizPlayItemAccept(state, obj, snapshot, { changed, equipped }, deps);
        ctx.refresh();
        return;
      }
      case "K":
      case "k":
        displayAllProp = !displayAllProp;
        break;
      case "S":
      case "s":
        await runStatItem(ctx, obj);
        break;
      case "R":
      case "r":
        if (await runRerollItem(ctx, obj)) changed = true;
        break;
      case "T":
      case "t":
        if (await runTweakItem(ctx, obj)) changed = true;
        break;
      case "C":
      case "c":
        if (await runCurseItem(ctx, obj)) changed = true;
        break;
      case "Q":
      case "q":
        if (await runChangeQuantity(ctx, obj, handle)) changed = true;
        break;
      default:
        /* "next pass through will ask again what's wanted" (L1791-1796). */
        break;
    }
  }
}

/**
 * do_cmd_wiz_reroll_item (cmd-wizard.c:2306), as queued by the play session:
 * one get_com for the roll quality, then the reroll. Artifacts are left alone
 * by the command itself (L2306).
 */
async function runRerollItem(ctx: WizardUiCtx, obj: GameObject): Promise<boolean> {
  const { term, state, deps } = ctx;
  const ch = await getCom(
    term,
    t("wizard.reroll.prompt", "Roll as [n]ormal, [g]ood, or [e]xcellent? "),
  );
  if (ch === null) return false;
  const roll = rollChoice(ch);
  if (roll === null) return false;
  return wizRerollItem(state, { obj, roll }, deps);
}

/** The shared [n]ormal / [g]ood / [e]xcellent answer -> 0 / 1 / 2. */
function rollChoice(ch: string): number | null {
  if (ch === "n" || ch === "N") return 0;
  if (ch === "g" || ch === "G") return 1;
  if (ch === "e" || ch === "E") return 2;
  return null;
}

/**
 * do_cmd_wiz_stat_item (cmd-wizard.c:2438): the treasure quality, then the
 * depth, then TEST_ROLL rolls compared against the target item, reported as
 * "Rolls: ..., Matches: ..., Better: ..., Worse: ..., Other: ...".
 *
 * The C also prints that line as a progress readout every hundredth roll and
 * lets a keypress break out early (L2483-2497); the port runs the sample in one
 * synchronous call, so only the final line is shown.
 */
async function runStatItem(ctx: WizardUiCtx, obj: GameObject): Promise<void> {
  const { term, state, deps, say } = ctx;
  drawWizItem(ctx, obj, true);
  const ch = await getCom(
    term,
    t("wizard.statItem.rollPrompt", "Roll for [n]ormal, [g]ood, or [e]xcellent treasure? "),
  );
  if (ch === null) return;
  const roll = rollChoice(ch);
  if (roll === null) return;
  const quality =
    roll === 0
      ? t("wizard.quality.normal", "normal")
      : roll === 1
        ? t("wizard.quality.good", "good")
        : t("wizard.quality.excellent", "excellent");

  const maxDepth = state.z.maxDepth;
  const s = await getString(
    term,
    t("wizard.statItem.depthPrompt", "Depth for treasure (0-{max}): ", { max: maxDepth - 1 }),
    String(state.chunk.depth),
    80,
  );
  if (s === null) return;
  const level = intFromString(s);
  if (level === null || level < 0 || level >= maxDepth) return;

  say(
    t("wizard.statItem.creating", "Creating a lot of {quality} items.  Base level = {level}.", {
      quality,
      level,
    }),
  );
  const r = wizStatItem(state, { obj, roll, level }, deps);
  if (!r) return;
  say(
    t(
      "wizard.statItem.result",
      "Rolls: {rolls}, Matches: {matches}, Better: {better}, Worse: {worse}, Other: {other}",
      { rolls: r.rolls, matches: r.matches, better: r.better, worse: r.worse, other: r.other },
    ),
  );
}

/**
 * do_cmd_wiz_curse_item (cmd-wizard.c:1005), as queued by the play session:
 * the curse (name or index), then its power, where 0 removes the curse.
 */
async function runCurseItem(ctx: WizardUiCtx, obj: GameObject): Promise<boolean> {
  const { term, state, deps } = ctx;
  if (!deps.makeDeps || !deps.curses) return false;
  const s = await getString(term, t("wizard.curse.namePrompt", "Enter curse name or index: "), "0", 80);
  if (s === null) return false;
  let index = intFromString(s);
  if (index === null) index = deps.makeDeps.reg.lookupCurse(s);
  if (index <= 0 || index >= deps.curses.length) return false; // L1031

  const ps = await getString(term, t("wizard.curse.powerPrompt", "Enter curse power (0 removes): "), "0", 80);
  if (ps === null) return false;
  const power = intFromString(ps);
  if (power === null || power < 0) return false; // L1039-1046
  return wizCurseItem(state, { obj, index, power }, deps);
}

/**
 * do_cmd_wiz_change_item_quantity (cmd-wizard.c:485), as queued by the play
 * session: "Quantity (1-%d): " where the bound is the ceiling the command
 * computes, defaulted to the current number. The two refusals (equipped item,
 * artifact) come from the engine.
 */
async function runChangeQuantity(
  ctx: WizardUiCtx,
  obj: GameObject,
  handle: number,
): Promise<boolean> {
  const { term, state, deps } = ctx;
  const nmax = obj.kind.base.maxStack;
  const s = await getString(
    term,
    t("wizard.quantity.prompt", "Quantity (1-{max}): ", { max: nmax }),
    String(obj.number),
    80,
  );
  if (s === null) return false;
  const n = intFromString(s);
  /* L530-534: reject outside [1, base->max_stack] before the command's own
   * clamp to its computed nmax. */
  if (n === null || n < 1 || n > nmax) return false;
  const res = wizChangeItemQuantity(state, { obj, handle, quantity: n, update: false }, deps);
  return res?.changed ?? false;
}

/**
 * do_cmd_wiz_tweak_item (cmd-wizard.c:2757): the ego, then the artifact, then
 * every object modifier by its list-object-modifiers.h name, then AC bonus,
 * to-hit and to-dam. Every prompt takes a name OR an index, carries the
 * current value as its default, and ESCAPE at any of them stops there and
 * keeps what was already applied (the WIZ_TWEAK macro's early return, L2826).
 * The item display is redrawn after each accepted value, as upstream does.
 */
async function runTweakItem(ctx: WizardUiCtx, obj: GameObject): Promise<boolean> {
  const { term, state, deps } = ctx;
  if (!deps.makeDeps || !deps.egos || !deps.artifacts) return false;
  if (obj.artifact) return false; // "Leave artifacts alone" (L2726)
  const reg = deps.makeDeps.reg;

  /* Ego: the default is the ego's NAME when it has one, else "-1" (L2737). */
  const egoDefault = obj.ego ? obj.ego.name : "-1";
  const es = await getString(term, t("wizard.tweak.egoPrompt", "Enter ego item: "), egoDefault, 80);
  if (es === null) return false;
  const egoNum = intFromString(es);
  /* Accept an index or a name (L2745-2753); an out-of-range index clears it. */
  const ego: EgoItem | null =
    egoNum !== null
      ? egoNum >= 0 && egoNum < deps.egos.length
        ? deps.egos[egoNum] ?? null
        : null
      : reg.lookupEgoItem(es, obj.tval, obj.sval);

  /* Artifact: the default is the artifact's name, else "0" (L2776). An
   * artifact never gets here (the L2726 guard above), so the default is "0". */
  const as = await getString(term, t("wizard.tweak.artifactPrompt", "Enter new artifact: "), "0", 80);
  let artifact: Artifact | null = null;
  let stopped = as === null;
  if (as !== null) {
    const artNum = intFromString(as);
    if (artNum !== null) {
      artifact =
        artNum > 0 && artNum < deps.artifacts.length ? deps.artifacts[artNum] ?? null : null;
    } else {
      artifact = reg.lookupArtifactName(as);
    }
  }

  /* The WIZ_TWEAK sequence: every modifier, then to_a / to_h / to_d. */
  const modifiers = [...obj.modifiers];
  if (!stopped) {
    for (let i = 0; i < modifiers.length; i++) {
      // OBJ_MOD_NAMES entries are the game's own object-modifier names
      // (list-object-modifiers.h), core registry data rather than UI prose.
      const name = OBJ_MOD_NAMES[i] ?? String(i);
      const v = await getString(
        term,
        t("wizard.tweak.settingPrompt", "Enter new {name} setting: ", { name }),
        String(modifiers[i] ?? 0),
        80,
      );
      if (v === null) {
        stopped = true;
        break;
      }
      const n = intFromString(v);
      if (n !== null) modifiers[i] = n;
    }
  }
  let toA = obj.toA;
  let toH = obj.toH;
  let toD = obj.toD;
  const scalars: [string, (n: number) => void, number][] = [
    [t("wizard.tweak.acBonus", "AC bonus"), (n) => (toA = n), obj.toA],
    [t("wizard.tweak.toHit", "to-hit"), (n) => (toH = n), obj.toH],
    [t("wizard.tweak.toDam", "to-dam"), (n) => (toD = n), obj.toD],
  ];
  for (const [name, set, current] of scalars) {
    if (stopped) break;
    const v = await getString(
      term,
      t("wizard.tweak.settingPrompt", "Enter new {name} setting: ", { name }),
      String(current),
      80,
    );
    if (v === null) break; // WIZ_TWEAK's early return keeps what was applied
    const n = intFromString(v);
    if (n !== null) set(n);
  }

  return wizTweakItem(state, { obj, ego, artifact, modifiers, toA, toH, toD }, deps);
}
