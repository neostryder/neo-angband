/**
 * Wizard / debug mode UI: the faithful web command surface over the wizard
 * engine in @rpgm-tools/neo-angband-core (game/wizard.ts).
 *
 * Every prompt, confirmation and message in this file is transcribed from the
 * C, not described in our own words. The sources are cmd-wizard.c (the
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
} from "@rpgm-tools/neo-angband-core";
import { gearGet } from "@rpgm-tools/neo-angband-core";
import { GlyphTerm } from "./term";
import {
  getCheck,
  getFile,
  getKeyInline,
  getQuantity,
  getString,
  selectFromMenu,
  showTextScreen,
} from "./overlay";
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

/** One grid the shell should highlight for wiz_hack_map (cmd-wizard.c:319). */
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
  term: GlyphTerm;
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
   * quit("user choice") (do_cmd_wiz_quit_no_save, cmd-wizard.c L2150): abandon
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
   * wiz_hack_map (cmd-wizard.c:319) hosted: overlay one glyph per highlighted
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
 * get_int_from_string (cmd-wizard.c:67): strtol base 10, rejecting an empty
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
 * get_long_from_string (cmd-wizard.c:95): as intFromString without the int
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
  term: GlyphTerm,
  pack: GamePack,
  say: (text: string) => void,
): Promise<void> {
  const idx = await selectFromMenu(
    term,
    "Create spoilers",
    SPOIL_ACTIONS.map((a) => ({ label: a.label })),
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
    say("Cannot create spoiler file."); /* wiz-spoil.c:220 */
    return;
  }
  if (outcome === "close-failed") {
    say("Cannot close spoiler file."); /* wiz-spoil.c:330 */
    return;
  }
  exportUserFile(action.file, text);
  say("Successfully created a spoiler file."); /* wiz-spoil.c:335 */
}

/** get_check (textui_get_check): inline row-0 "<prompt>[y/n] ", y/Y only. */
function confirmYesNo(term: GlyphTerm, title: string): Promise<boolean> {
  return getCheck(term, title);
}

/**
 * get_com (textui_get_com, ui-input.c:1398): prompt at row 0, one keypress,
 * false on ESCAPE. Returns null where the C returns false.
 */
async function getCom(term: GlyphTerm, prompt: string): Promise<string | null> {
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
    ctx.say(WIZARD_ENTRY_MSG_1);
    ctx.say(WIZARD_ENTRY_MSG_2);
    ctx.refresh();
    if (!(await confirmYesNo(ctx.term, WIZARD_ENTRY_CONFIRM))) {
      ctx.refresh();
      return currentMode;
    }
    /* Mark savefile (player->noscore |= NOSCORE_WIZARD, cmd-misc.c L51). */
    ctx.deps.markNoscore?.(NOSCORE.WIZARD);
  }
  const next = !currentMode;
  ctx.say(next ? WIZARD_ON_MSG : WIZARD_OFF_MSG);
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
 */
async function confirmDebugGate(ctx: WizardUiCtx): Promise<boolean> {
  const p = ctx.state.actor.player;
  if (p.noscore & NOSCORE.DEBUG) return true;
  ctx.say(DEBUG_CONFIRM_MSG_1);
  ctx.say(DEBUG_CONFIRM_MSG_2);
  ctx.refresh();
  if (!(await confirmYesNo(ctx.term, DEBUG_CONFIRM))) {
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
  const key = await getKeyInline(ctx.term, DEBUG_PROMPT);
  /* get_com_ex returns false on ESCAPE (ui-input.c L1439), and the caller then
   * abandons the nested lookup entirely (ui-game.c L586-588). */
  if (key === "Escape") {
    ctx.refresh();
    return;
  }
  const cmd = DEBUG_BY_KEY.get(key);
  if (!cmd) {
    ctx.say(DEBUG_NESTED_ERROR);
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
  ctx.say("That debug command is not available in this build.");
}

/**
 * stat_idx_to_name (player.c L122): the list-stats.h macro names verbatim, in
 * list order. These, not long words, are what do_cmd_wiz_edit_player_stat puts
 * in its prompts - the stat-picker default (cmd-wizard.c:1259) and the value
 * prompt "%s (3-118): " (cmd-wizard.c:1276).
 */
const STAT_NAMES = ["STR", "INT", "WIS", "DEX", "CON"];

/**
 * do_cmd_wiz_query_feature's letter -> feature set (cmd-wizard.c L1935-2049).
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
      /* wiz_create_artifact (ui-wizard.c:456) -> wiz_create_item(true). */
      await runCreateItem(ctx, true);
      break;
    case "create-all-tval":
      /* wiz_create_all_for_tval (ui-wizard.c:495) presets choice = 1, so
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
      /* do_cmd_wiz_cure_all (cmd-wizard.c:941) says "You feel *much* better!"
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
      const n = await getQuantity(term, "Gain how much experience? ", 9999);
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
      /* wiz_learn_all_object_kinds (ui-wizard.c:505) presets level = 100, so
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
      /* wiz_phase_door (ui-wizard.c:515) presets range 10. */
      await runTeleportRandom(ctx, 10);
      break;
    case "tele-far":
      /* wiz_teleport (ui-wizard.c:525) presets range 100. */
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
      /* do_cmd_wiz_summon_random (cmd-wizard.c:2629). */
      const n = await getQuantity(term, "How many monsters? ", 40);
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
      /* do_cmd_wiz_banish (cmd-wizard.c:449): default z_info->max_sight, and
       * no message afterwards. */
      const range = await getQuantity(term, "Zap within what distance? ", state.z.maxSight);
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
       * (cmd-wizard.c L2150): quit("user choice") - end the program, writing
       * nothing.
       *
       * The port used to ask the question and then TELL THE PLAYER to reload the
       * page, which is a stand-in, not a port: the row promised an action and
       * performed a suggestion. ctx.quitNoSave is the shell's real equivalent -
       * on desktop it exits the process, in a tab it abandons the session and
       * lands on the title without persisting. Both leave whatever was last
       * written on disk untouched, which is exactly what upstream's quit does. */
      if (await confirmYesNo(term, "Really quit without saving? ")) {
        if (ctx.quitNoSave) {
          await ctx.quitNoSave();
        } else {
          /* No seam wired (headless / test harness): say so rather than claim a
           * quit that did not happen. */
          say("That debug command is not available in this build.");
        }
      }
      break;
    default:
      say("Unknown debug command.");
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
    rows.push({ label: art ? "All artifacts" : "All objects" });
    const pick = await selectFromMenu(
      term,
      art ? "What kind of artifact?" : "What kind of object?",
      rows,
      "[ a-z to choose, ESC to cancel ]",
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
    subRows.push({ label: art ? `All artifact ${baseName}` : `All ${baseName}` });

    const sub = await selectFromMenu(
      term,
      art ? `Which artifact ${baseName}? ` : `What kind of ${baseName}?`,
      subRows,
      "[ a-z to choose, ESC to go back ]",
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
 * wiz_display_keylog (ui-wizard.c:96): the last KEYLOG_SIZE keypresses, most
 * recent first, each as `    %-12s (code=%lu mods=%u)`, padded out to a full
 * eight rows with the blanks upstream draws, then
 * "Press any key to continue.".
 */
async function runDisplayKeylog(ctx: WizardUiCtx): Promise<void> {
  const log = [...(ctx.keylog?.() ?? [])].reverse(); // the ring, most recent first
  const lines: ScreenLine[] = [];
  for (let i = 0; i < KEYLOG_SIZE; i++) {
    const k = log[i];
    lines.push({
      text: k ? `    ${k.text.padEnd(12)} (code=${k.code} mods=${k.mods})` : "",
    });
  }
  lines.push({ text: "Press any key to continue." });
  await showTextScreen(ctx.term, "Previous keypresses (top most recent):", lines);
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
  await selectFromMenu(ctx.term, "PROJ_ types display", rows, "[ ESC to close ]");
}

/* ------------------------------------------------------------------ *
 * The four commands whose menu row presets an argument. Upstream writes each as
 * `if (cmd_get_arg_*(...) != CMD_OK) { ask }`, so the SAME function serves the
 * menu (argument supplied, no prompt) and a bare command from a keymap or a
 * repeat (argument absent, prompt asked). Passing the argument as an optional
 * parameter keeps both paths in one place, as the C does - the prompts are not
 * dead code waiting for a keymap layer.
 * ------------------------------------------------------------------ */

/** do_cmd_wiz_create_obj (cmd-wizard.c:873). */
async function runCreateObj(ctx: WizardUiCtx, index?: number): Promise<void> {
  const { term, state, deps } = ctx;
  if (!deps.makeDeps) return unavailable(ctx);
  let ind = index;
  if (ind === undefined) {
    const kMax = deps.makeDeps.reg.kinds.length;
    const s = await getString(term, `Create which object (0-${kMax - 1})? `, "", 80);
    if (s === null) return;
    const parsed = intFromString(s);
    if (parsed === null) return;
    ind = parsed;
  }
  /* Out of range prints "That's not a valid kind of object." from the engine. */
  wizCreateObj(state, { index: ind }, deps);
}

/** do_cmd_wiz_create_artifact (cmd-wizard.c:842). */
async function runCreateArtifact(ctx: WizardUiCtx, index?: number): Promise<void> {
  const { term, state, deps } = ctx;
  if (!deps.makeDeps || !deps.artifacts) return unavailable(ctx);
  let ind = index;
  if (ind === undefined) {
    const aMax = deps.artifacts.length;
    const s = await getString(term, `Create which artifact (1-${aMax - 1})? `, "", 80);
    if (s === null) return;
    const parsed = intFromString(s);
    if (parsed === null) return;
    ind = parsed;
  }
  /* Out of range prints "That's not a valid artifact." from the engine. */
  wizCreateArtifact(state, { index: ind }, deps);
}

/** do_cmd_wiz_acquire (cmd-wizard.c:389). */
async function runAcquire(ctx: WizardUiCtx, great?: boolean): Promise<void> {
  const { term, state, deps } = ctx;
  let isGreat = great;
  if (isGreat === undefined) {
    isGreat = await confirmYesNo(term, "Acquire great objects? ");
  }
  const n = await getQuantity(
    term,
    isGreat ? "How many great objects? " : "How many good objects? ",
    40,
  );
  if (n < 1) return;
  if (!deps.makeDeps) return unavailable(ctx);
  wizAcquire(state, { quantity: n, great: isGreat }, deps);
}

/** do_cmd_wiz_create_all_obj_from_tval (cmd-wizard.c:803). */
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
      `Create all items of which tval (1-${tvalMax - 1})? `,
      "",
      80,
    );
    if (s === null) return;
    tval = intFromString(s);
  }
  if (tval === null || tval < 1 || tval >= tvalMax) return;
  let withArt = art;
  if (withArt === undefined) {
    withArt = await confirmYesNo(term, "Create instant artifacts? ");
  }
  wizCreateAllObjFromTval(state, { tval, art: withArt }, deps);
}

/** do_cmd_wiz_learn_object_kinds (cmd-wizard.c:1386). */
async function runLearnObjectKinds(ctx: WizardUiCtx, level?: number): Promise<void> {
  const { term, state, deps } = ctx;
  let lvl = level;
  if (lvl === undefined) {
    const s = await getString(term, "Learn object kinds up to level (0-100)? ", "100", 80);
    if (s === null) return;
    const parsed = intFromString(s);
    if (parsed === null) return;
    lvl = parsed;
  }
  if (!deps.makeDeps || !deps.flavor) return unavailable(ctx);
  wizLearnObjectKinds(state, { level: lvl }, deps);
}

/** do_cmd_wiz_teleport_random (cmd-wizard.c:2651). */
async function runTeleportRandom(ctx: WizardUiCtx, range?: number): Promise<void> {
  const { term, state, deps } = ctx;
  let r = range;
  if (r === undefined) {
    const s = await getString(term, "Teleport range? ", "100", 80);
    if (s === null) return;
    const parsed = intFromString(s);
    if (parsed === null || parsed < 1) return;
    r = parsed;
  }
  if (!deps.effect) return unavailable(ctx);
  wizTeleportRandom(state, { range: r }, deps);
}

/**
 * do_cmd_wiz_create_trap (cmd-wizard.c:904): "Create which trap? " takes an
 * index OR a trap name (lookup_trap); an unknown name becomes trap_max, which
 * the command reports as "Trap not found.". All three refusals come from the
 * engine.
 */
async function runCreateTrap(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps } = ctx;
  if (!deps.trapDeps) return unavailable(ctx);
  const s = await getString(term, "Create which trap? ", "", 80);
  if (s === null) return;
  let tidx = intFromString(s);
  if (tidx === null) {
    const trap = lookupTrap(deps.trapDeps.kinds, s);
    tidx = trap ? trap.tidx : deps.trapDeps.kinds.length;
  }
  wizCreateTrap(state, { index: tidx }, deps);
}

/**
 * do_cmd_wiz_jump_level (cmd-wizard.c:1339): the level, then
 * "Choose cave profile? " - answering yes sets NOSCORE_JUMPING (L1366). The
 * engine says "You jump to dungeon level %d.".
 */
async function runJumpLevel(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps } = ctx;
  const maxDepth = state.z.maxDepth;
  const s = await getString(
    term,
    `Jump to level (0-${maxDepth - 1}): `,
    String(state.chunk.depth),
    80,
  );
  if (s === null) return;
  const level = intFromString(s);
  if (level === null) return;
  if (level < 0 || level >= maxDepth) return; // L1358 paranoia
  const chooseGen = await confirmYesNo(term, "Choose cave profile? ");
  if (chooseGen) {
    /* choose_profile (generate.c:824-836) asks this at GENERATION time, off the
     * NOSCORE_JUMPING bit the answer above just set. Nothing else can consume
     * that bit in between - the jump generates the very next level - and the
     * port's generator is synchronous, so the answer is collected here and
     * carried on state.jumpProfileName for the generation to consume once.
     * `char name[30]` is the C's buffer (L825). */
    const name = await getString(term, "Profile name (eg classic): ", "", 30);
    state.jumpProfileName = name ?? undefined;
  }
  if (wizJumpLevel(state, { level, chooseGen }, deps) && ctx.changeLevel && state.generateLevel) {
    ctx.changeLevel(state.targetDepth ?? level);
  }
}

/**
 * do_cmd_wiz_teleport_to (cmd-wizard.c L2673): pick a destination grid, and if
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
 * do_cmd_wiz_perform_effect (cmd-wizard.c L1524): the effect (name or index),
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
  const nameEntry = await getString(term, "Do which effect: ", "", 80);
  if (nameEntry !== null) {
    const parsed = intFromString(nameEntry);
    index = parsed ?? effectLookup(nameEntry);
    if (index <= EF.NONE || index >= EF_MAX) {
      say("No effect found.");
      return;
    }
  }

  /* "Enter damage dice (eg 1+2d6M2): "; ESCAPE leaves the default "0". */
  const diceEntry = await getString(term, "Enter damage dice (eg 1+2d6M2): ", "0", 80);
  const diceString = diceEntry ?? "0";

  /* "Enter name or number for effect subtype: " -> effect_subtype (L1557). */
  let subtype = 0;
  const subEntry = await getString(
    term,
    "Enter name or number for effect subtype: ",
    "0",
    80,
  );
  if (subEntry !== null) {
    const st = effectSubtype(index, subEntry, deps.effect.inject);
    subtype = st === -1 ? 0 : st;
  }

  /* The four get_quantity prompts, max 100 (L1567-1570). */
  const radius = await getQuantity(term, "Enter second parameter (radius): ", 100);
  const other = await getQuantity(term, "Enter third parameter (other): ", 100);
  const y = await getQuantity(term, "Enter y parameter: ", 100);
  const x = await getQuantity(term, "Enter x parameter: ", 100);

  const ident = runWizEffect(state, deps.effect, index, {
    diceString,
    subtype,
    radius,
    other,
    y,
    x,
  });
  if (ident) say("Identified!");
}

/**
 * do_cmd_wiz_edit_player_start (cmd-wizard.c:1202): upstream queues one
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

  const gs = await getString(term, "Gold: ", String(p.au), 80);
  if (gs === null) return;
  const gv = longFromString(gs);
  if (gv === null) return;
  wizEditPlayerGold(state, { value: gv }, deps);

  const es = await getString(term, "Experience: ", String(p.exp), 80);
  if (es === null) return;
  const ev = longFromString(es);
  if (ev === null) return;
  wizEditPlayerExp(state, { value: ev }, deps);
}

/**
 * do_cmd_wiz_edit_player_stat (cmd-wizard.c:1247). Called per stat by the edit
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
      `Edit which stat (name or 0-${STAT_MAX - 1}): `,
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
    `${STAT_NAMES[idx] ?? ""} (3-118): `,
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
 * do_cmd_wiz_recall_monster (cmd-wizard.c:2161) and do_cmd_wiz_wipe_recall
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
      ? "Wipe recall for [a]ll monsters or [s]pecific monster? "
      : "Full recall for [a]ll monsters or [s]pecific monster? ",
  );
  if (c === null) return;

  let ridx = deps.races.length; // r_idx = z_info->r_max (L2163/L2862)
  if (c === "a" || c === "A") {
    ridx = -1;
  } else if (c === "s" || c === "S") {
    const s = await getString(term, "Which monster? ", "", 80);
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
    say("No monster found.");
    return;
  }
  if (wipe) wizWipeRecall(state, { race }, deps);
  else wizRecallMonster(state, { race }, deps);
}

/**
 * do_cmd_wiz_summon_named (cmd-wizard.c:2569): "Summon which monster? " takes
 * an index or a name; nothing resolved prints "No monster found." and returns.
 * "Could not place monster." comes from the engine's ten placement tries.
 */
async function runSummonNamed(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps, say } = ctx;
  if (!deps.monPlace || !deps.races) return unavailable(ctx);
  const s = await getString(term, "Summon which monster? ", "", 80);
  if (s === null) return;
  let race: MonsterRace | undefined;
  const parsed = intFromString(s);
  if (parsed !== null) {
    if (parsed > 0 && parsed < deps.races.length) race = deps.races[parsed];
  } else {
    race = ctx.raceByName?.(s) ?? undefined;
  }
  if (!race) {
    say("No monster found.");
    return;
  }
  wizSummonNamed(state, { race }, deps);
}

/**
 * do_cmd_wiz_dump_level_map (cmd-wizard.c:1112-1130): get_file("level.html"),
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
  const file = await getFile(term, "level.html");
  if (file === null) return;
  const title = await getString(
    term,
    "Title for map: ",
    `Map of level ${state.chunk.depth}`,
    80,
  );
  if (title === null) return;
  const html = dumpLevel(state, title);
  /* file_open failing is silent upstream; only the close reports (L1124-1128). */
  if (!userWrite(file, html, FileType.HTML)) return;
  exportUserFile(file, html, "text/html");
  ctx.say(`Level dumped to ${userPath(file)}.`);
}

/* ------------------------------------------------------------------ *
 * The map QUERY commands. Each highlights the visible panel through
 * wiz_hack_map, waits for a key, then restores the map.
 * ------------------------------------------------------------------ */

/**
 * wiz_hack_map + "Press any key." (cmd-wizard.c:2057-2066): paint the marks,
 * wait for one keypress, clear row 0 and redraw the map. `msg("Press any
 * key.")` puts the line in the message log, so it is said rather than printed.
 */
async function highlightAndWait(
  ctx: WizardUiCtx,
  marks: readonly WizHackMark[],
): Promise<void> {
  ctx.hackMap?.(marks);
  ctx.say("Press any key.");
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
 * do_cmd_wiz_query_feature (cmd-wizard.c:1930): one key picks a feature class,
 * the matching grids are highlighted (yellow where passable, red otherwise),
 * and an unlisted key prints the invalid-selection line.
 */
async function runQueryFeature(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps, say } = ctx;
  const choice = await getCom(term, "Debug Command Feature Query: ");
  if (choice === null) return;
  const features = FEATURE_QUERY_CHOICES[choice];
  if (!features) {
    say("That was an invalid selection.  Use one of fobuztcdhmqgpra .");
    return;
  }
  const grids = wizQueryFeature(state, { features }, deps);
  await highlightAndWait(ctx, grids.map((grid) => ({ grid, color: featColor(ctx, grid) })));
}

/**
 * do_cmd_wiz_query_square_flag (cmd-wizard.c:2105): one key picks a SQUARE
 * flag; anything unlisted leaves flag 0, which highlights the KNOWN grids
 * instead of refusing (L2088). Colours are the same passable/impassable pair.
 */
async function runQuerySquareFlag(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps } = ctx;
  const c = await getCom(term, "Debug Command Query [grasvwdftniolx]: ");
  if (c === null) return;
  const flag = SQUARE_FLAG_CHOICES[c] ?? 0;
  const grids = wizQuerySquareFlag(state, { flag }, deps);
  await highlightAndWait(ctx, grids.map((grid) => ({ grid, color: featColor(ctx, grid) })));
}

/**
 * do_cmd_wiz_peek_noise_scent (cmd-wizard.c:1477): step depth 0..99 over the
 * noise map, then 0..49 over the scent map, highlighting each depth's grids and
 * waiting on get_com(format("Depth %d: ", i)) between them; ESCAPE breaks out
 * of that loop. Noise is red, scent yellow.
 */
async function runPeekNoiseScent(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps } = ctx;
  for (let i = 0; i < 100; i++) {
    const grids = wizPeekFlow(state, { depth: i, which: "noise" }, deps);
    ctx.hackMap?.(grids.map((grid) => ({ grid, color: COLOUR_RED })));
    const k = await getCom(term, `Depth ${i}: `);
    if (k === null) break;
    ctx.refresh(); // prt_map()
  }
  for (let i = 0; i < 50; i++) {
    const grids = wizPeekFlow(state, { depth: i, which: "scent" }, deps);
    ctx.hackMap?.(grids.map((grid) => ({ grid, color: COLOUR_YELLOW })));
    const k = await getCom(term, `Depth ${i}: `);
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
  ctx.say(STATS_DISABLED_MSG);
  return null;
}

/* The C's `static int default_nsim` values, which persist between invocations
 * (cmd-wizard.c:586, :623-624). */
let defaultDisconnectNsim = 50;
let defaultObjMonNsim = 50;
let defaultObjMonSimtype = 1;

/** do_cmd_wiz_collect_disconnect_stats (cmd-wizard.c:584). */
async function runCollectDisconnectStats(ctx: WizardUiCtx): Promise<void> {
  const { term } = ctx;
  const stats = statsAreEnabled(ctx);
  if (!stats) return;
  const s = await getString(term, "Number of simulations: ", String(defaultDisconnectNsim), 80);
  if (s === null) return;
  const nsim = intFromString(s);
  if (nsim === null || nsim < 1) return;
  defaultDisconnectNsim = nsim;
  const stop = await confirmYesNo(term, "Stop if disconnected level found? ");
  stats.disconnectStats(nsim, stop);
}

/** do_cmd_wiz_collect_obj_mon_stats (cmd-wizard.c:622). */
async function runCollectObjMonStats(ctx: WizardUiCtx): Promise<void> {
  const { term } = ctx;
  const stats = statsAreEnabled(ctx);
  if (!stats) return;
  const s = await getString(term, "Number of simulations: ", String(defaultObjMonNsim), 80);
  if (s === null) return;
  const nsim = intFromString(s);
  if (nsim === null || nsim < 1) return;
  defaultObjMonNsim = nsim;

  const t = await getString(
    term,
    "Type of Sim: Diving (1) or Clearing (2) ",
    String(defaultObjMonSimtype),
    80,
  );
  if (t === null) return;
  let simtype = intFromString(t);
  if (simtype === null || simtype < 1 || simtype > 2) return;
  if (simtype === 2 && (await confirmYesNo(term, "Regen randarts (warning SLOW)? "))) {
    simtype = 3;
  }
  defaultObjMonSimtype = simtype === 1 ? 1 : 2;
  stats.statsCollect(nsim, simtype);
}

/** do_cmd_wiz_collect_pit_stats (cmd-wizard.c:668). */
async function runCollectPitStats(ctx: WizardUiCtx): Promise<void> {
  const { term, state } = ctx;
  const stats = statsAreEnabled(ctx);
  if (!stats) return;
  const s = await getString(term, "Number of simulations per depth: ", "1000", 80);
  if (s === null) return;
  const nsim = intFromString(s);
  if (nsim === null || nsim < 1) return;

  const p = await getString(term, "Pit type (1-3): ", "1", 80);
  if (p === null) return;
  const pittype = intFromString(p);
  if (pittype === null || pittype < 1 || pittype > 3) return;

  const lo = await getString(term, "Minimum depth: ", String(state.chunk.depth), 80);
  if (lo === null) return;
  const depthMin = intFromString(lo);
  if (depthMin === null || depthMin < 1) return;

  const hi = await getString(term, "Maximum depth: ", String(depthMin), 80);
  if (hi === null) return;
  const depthMax = intFromString(hi);
  if (depthMax === null || depthMax < depthMin) return;

  stats.pitStats(nsim, pittype, depthMin, depthMax);
}

/* ------------------------------------------------------------------ *
 * do_cmd_wiz_play_item (cmd-wizard.c:1600-1864) and the four commands it
 * queues.
 * ------------------------------------------------------------------ */

/**
 * wiz_display_item (cmd-wizard.c:189): the item's raw properties on their own
 * screen - the spoiled description at row 2, the combat / kind / number lines
 * at rows 4-6, then the FLAGS block: a ruled header at 16, five rows of
 * vertically-written flag labels at 17-21, and two prt_binary rows, '*' for the
 * object's own flags at 22 and '+' for the known twin's at 23.
 *
 * The labels are list-object-flags.h's second field (the port's generated
 * `debugLabel`), written five characters down the column exactly as the C does,
 * blanking a column once its label runs out.
 */
function drawWizItem(ctx: WizardUiCtx, obj: GameObject, all: boolean): void {
  const { term, state, deps } = ctx;
  const disp = wizDisplayItem(obj, deps, { all });
  term.clear();
  if (!disp) return;
  const fg = UI_TEXT;
  const put = (row: number, text: string): void => {
    const { cols } = term.size();
    term.print(0, row, text.slice(0, cols - 1), fg);
  };
  const plus = (n: number): string => (n >= 0 ? `+${n}` : String(n));

  put(2, describeObject(state, obj, ODESC.PREFIX | ODESC.FULL | ODESC.SPOIL));
  put(
    4,
    `combat = (${disp.dd}d${disp.ds}) (${plus(disp.toH)},${plus(disp.toD)}) ` +
      `[${disp.ac},${plus(disp.toA)}]`,
  );
  put(
    5,
    `kind = ${pad(disp.kidx, 5)}  tval = ${pad(disp.tval, 5)}  ` +
      `sval = ${pad(disp.sval, 5)}  wgt = ${pad(disp.weight, 3)}     ` +
      `timeout = ${disp.timeout}`,
  );
  put(
    6,
    `number = ${pad(disp.number, 3)}  pval = ${pad(disp.pval, 5)}  ` +
      `name1 = ${pad(disp.name1, 4)}  egoidx = ${pad(disp.egoidx, 4)}  ` +
      `cost = ${disp.cost}`,
  );

  /* nflg = MIN(OF_MAX - FLAG_START, 80) (L235). FLAG_START is 1, so this is
   * every flag but the unused zeroth. */
  const labels = OBJECT_FLAG_ENTRIES.map((e) => e.debugLabel);
  const nflg = Math.min(labels.length, 80);

  /* The ruled "+---FLAGS---+" header (L237-266). */
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
  put(16, head.join("").slice(0, nflg >= 7 ? nflg : k + 5));

  /* Five rows of vertically-written labels (L269-288). */
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
    put(17 + row, line);
  }

  /* prt_binary (ui-output.c): one glyph per set flag (L291-295). */
  const bits = (set: { has: (i: number) => boolean }, ch: string): string => {
    let line = "";
    for (let i = 0; i < nflg; i++) line += set.has(i + 1) ? ch : ".";
    return line;
  };
  put(22, bits(disp.flags, "*"));
  put(23, bits(disp.flagsKnown, "+"));
}

/** "%-5d"-style left-justified field padding for the wiz_display_item lines. */
function pad(value: number, width: number): string {
  const s = String(value);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

/**
 * do_cmd_wiz_play_item (cmd-wizard.c:1600): snapshot the object, then loop -
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
    say("You have nothing to play with.");
    return;
  }
  const pick = await selectFromMenu(
    term,
    "Play with which object? ",
    items,
    "[ a-z to choose, ESC to cancel ]",
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
      "[a]ccept [s]tatistics [r]eroll [t]weak [c]urse [q]uantity [k]nown? ",
    );

    if (ch === null) {
      /* get_com false: done, rejected (L1806-1811). */
      wizPlayItemReject(obj, snapshot, deps);
      if (changed) say("Changes ignored.");
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
 * do_cmd_wiz_reroll_item (cmd-wizard.c:2254), as queued by the play session:
 * one get_com for the roll quality, then the reroll. Artifacts are left alone
 * by the command itself (L2306).
 */
async function runRerollItem(ctx: WizardUiCtx, obj: GameObject): Promise<boolean> {
  const { term, state, deps } = ctx;
  const ch = await getCom(term, "Roll as [n]ormal, [g]ood, or [e]xcellent? ");
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
 * do_cmd_wiz_stat_item (cmd-wizard.c:2386): the treasure quality, then the
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
  const ch = await getCom(term, "Roll for [n]ormal, [g]ood, or [e]xcellent treasure? ");
  if (ch === null) return;
  const roll = rollChoice(ch);
  if (roll === null) return;
  const quality = roll === 0 ? "normal" : roll === 1 ? "good" : "excellent";

  const maxDepth = state.z.maxDepth;
  const s = await getString(
    term,
    `Depth for treasure (0-${maxDepth - 1}): `,
    String(state.chunk.depth),
    80,
  );
  if (s === null) return;
  const level = intFromString(s);
  if (level === null || level < 0 || level >= maxDepth) return;

  say(`Creating a lot of ${quality} items.  Base level = ${level}.`);
  const r = wizStatItem(state, { obj, roll, level }, deps);
  if (!r) return;
  say(
    `Rolls: ${r.rolls}, Matches: ${r.matches}, Better: ${r.better}, ` +
      `Worse: ${r.worse}, Other: ${r.other}`,
  );
}

/**
 * do_cmd_wiz_curse_item (cmd-wizard.c:1004), as queued by the play session:
 * the curse (name or index), then its power, where 0 removes the curse.
 */
async function runCurseItem(ctx: WizardUiCtx, obj: GameObject): Promise<boolean> {
  const { term, state, deps } = ctx;
  if (!deps.makeDeps || !deps.curses) return false;
  const s = await getString(term, "Enter curse name or index: ", "0", 80);
  if (s === null) return false;
  let index = intFromString(s);
  if (index === null) index = deps.makeDeps.reg.lookupCurse(s);
  if (index <= 0 || index >= deps.curses.length) return false; // L1031

  const ps = await getString(term, "Enter curse power (0 removes): ", "0", 80);
  if (ps === null) return false;
  const power = intFromString(ps);
  if (power === null || power < 0) return false; // L1039-1046
  return wizCurseItem(state, { obj, index, power }, deps);
}

/**
 * do_cmd_wiz_change_item_quantity (cmd-wizard.c:484), as queued by the play
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
  const s = await getString(term, `Quantity (1-${nmax}): `, String(obj.number), 80);
  if (s === null) return false;
  const n = intFromString(s);
  /* L530-534: reject outside [1, base->max_stack] before the command's own
   * clamp to its computed nmax. */
  if (n === null || n < 1 || n > nmax) return false;
  const res = wizChangeItemQuantity(state, { obj, handle, quantity: n, update: false }, deps);
  return res?.changed ?? false;
}

/**
 * do_cmd_wiz_tweak_item (cmd-wizard.c:2698): the ego, then the artifact, then
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
  const es = await getString(term, "Enter ego item: ", egoDefault, 80);
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
  const as = await getString(term, "Enter new artifact: ", "0", 80);
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
      const name = OBJ_MOD_NAMES[i] ?? String(i);
      const v = await getString(
        term,
        `Enter new ${name} setting: `,
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
    ["AC bonus", (n) => (toA = n), obj.toA],
    ["to-hit", (n) => (toH = n), obj.toH],
    ["to-dam", (n) => (toD = n), obj.toD],
  ];
  for (const [name, set, current] of scalars) {
    if (stopped) break;
    const v = await getString(term, `Enter new ${name} setting: `, String(current), 80);
    if (v === null) break; // WIZ_TWEAK's early return keeps what was applied
    const n = intFromString(v);
    if (n !== null) set(n);
  }

  return wizTweakItem(state, { obj, ego, artifact, modifiers, toA, toH, toD }, deps);
}
