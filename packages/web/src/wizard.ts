/**
 * Wizard / debug mode UI (WP-14, gaps 15.1 / 15.2 / 15.3 web halves).
 *
 * The wizard/debug ENGINE is fully ported in @neo-angband/core (game/wizard.ts,
 * ~35 wiz* actions). This module is the faithful WEB command surface that fronts
 * it: the Control-W wizard-mode toggle (do_cmd_wizard, cmd-misc.c L37-68), the
 * Control-A debug command menu (the two-level cmd_debug / cmd_debug_* tables,
 * ui-game.c L234-322), and the noscore marking both flows perform
 * (player->noscore, player.h L92-100; score gate score.c L289).
 *
 * The engine functions take (state, params, deps); this UI collects the
 * selection/count the shell owns (the "which item / how many / which monster"
 * prompts the C Term layer owned) and dispatches. Commands whose engine bundle
 * is not yet surfaced to the web shell (the effect interpreter, ExpDeps and
 * TrapDeps, all assembled privately inside session/game.ts wireGame) report a
 * short unavailable note here and are listed as WIRING-NEEDED in the WP-14
 * report; the menu structure and dispatch are complete and light up the moment
 * that seam lands.
 *
 * Attribution: neostryder / RPGM Tools.
 */

import {
  NOSCORE,
  wizAcquire,
  wizAdvance,
  wizBanish,
  wizCreateAllObjFromTval,
  wizCreateArtifact,
  wizCreateObj,
  wizCreateTrap,
  wizCureAll,
  wizCurseItem,
  wizDetectAllLocal,
  wizDetectAllMonsters,
  wizDumpLevelMap,
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
  wizSummonNamed,
  wizSummonRandom,
  wizTeleportRandom,
  wizWizardLight,
  wizWipeRecall,
  wizDisplayItem,
  wizPlayItemBegin,
  wizPlayItemReject,
  wizPlayItemAccept,
  SQUARE,
  EF,
  effectLookup,
  effectSubtype,
  sourcePlayer,
  buildEffectContext,
  attachGameEnv,
} from "@neo-angband/core";
import type {
  GameState,
  WizardDeps,
  WizEffectDeps,
  MonsterRace,
  GameObject,
  EffectContext,
  EffectEnvDeps,
  CastContext,
  Loc,
} from "@neo-angband/core";
import { gearGet } from "@neo-angband/core";
import { GlyphTerm } from "./term";
import { selectFromMenu, promptNumber, promptText, showTextScreen } from "./overlay";
import type { MenuItem, ScreenLine } from "./overlay";
import { packMenu } from "./screens";

/**
 * The runtime context the web shell hands the wizard UI. `deps.wizard` gates
 * every action; `deps.markNoscore` is the WP-10 handoff hook that ORs cheat
 * bits into player.noscore (persisted by save.ts, read by the score gate).
 */
export interface WizardUiCtx {
  term: GlyphTerm;
  state: GameState;
  /** The wizard engine dependency bundle assembled by the shell. */
  deps: WizardDeps;
  /** msg(): route a line to the game message log. */
  say: (text: string) => void;
  /** Redraw the game view (and, where relevant, ride the next derived recompute). */
  refresh: () => void;
  /** dungeon_change_level: regenerate at the pending targetDepth (jump-level). */
  changeLevel?: (depth: number) => void;
  /**
   * The on-map grid picker (the shell's targeting/look UI), used by the
   * teleport "To location" command (do_cmd_wiz_teleport_to). Returns the chosen
   * grid, or null on ESC. Absent, the command falls back to numeric coordinate
   * prompts so it still functions before the picker is wired.
   */
  pickGrid?: () => Promise<Loc | null>;
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

/** get_check: a plain Yes/No confirmation; ESC counts as "No" (see main.ts). */
async function confirmYesNo(term: GlyphTerm, title: string): Promise<boolean> {
  const idx = await selectFromMenu(
    term,
    title,
    [{ label: "Yes" }, { label: "No" }],
    "[ a-z to choose, ESC = No ]",
  );
  return idx === 0;
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
  letter: string;
  label: string;
  action: string;
}

/** One debug category: faithful title + its commands. */
export interface DebugCategory {
  title: string;
  commands: DebugCommand[];
}

/**
 * The faithful two-level debug menu (cmd_debug categories -> cmd_debug_*
 * commands, ui-game.c L234-322). Letters and labels match the C tables exactly.
 */
export const DEBUG_MENU: DebugCategory[] = [
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
];

/**
 * player_can_debug_prereq + confirm_debug (player-util.c L1296-1307,
 * game-input.c L281-295): on the first debug-command use (player.noscore lacks
 * the DEBUG bit) upstream mentions the danger, flushes, and asks get_check;
 * accepting marks the savefile (noscore |= DEBUG). Returns whether the debug
 * menu may open.
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
 * Open the debug command menu (Control-A). Verifies wizard mode is on, runs the
 * one-time debug confirm/noscore gate, then walks the two-level category ->
 * command menu and dispatches the chosen action.
 */
export async function runWizardDebugMenu(ctx: WizardUiCtx): Promise<void> {
  if (!ctx.deps.wizard) {
    ctx.say("You need to be in wizard mode for that. (^W)");
    ctx.refresh();
    return;
  }
  if (!(await confirmDebugGate(ctx))) return;

  for (;;) {
    const catIdx = await selectFromMenu(
      ctx.term,
      "Debug Command",
      DEBUG_MENU.map((c) => ({ label: c.title })),
      "[ a-z to choose a category, ESC to close ]",
    );
    if (catIdx === null) break;
    const cat = DEBUG_MENU[catIdx];
    if (!cat) break;
    const cmdIdx = await selectFromMenu(
      ctx.term,
      cat.title,
      cat.commands.map((cmd): MenuItem => ({ label: cmd.label, tag: cmd.letter })),
      "[ letter to run a command, ESC to go back ]",
    );
    if (cmdIdx === null) continue; // ESC returns to the category list
    const cmd = cat.commands[cmdIdx];
    if (!cmd) continue;
    await dispatchDebug(ctx, cmd.action);
  }
  ctx.refresh();
}

/** Short "engine bundle not surfaced to the web shell yet" note. */
function unavailable(ctx: WizardUiCtx): void {
  ctx.say("That debug command is not available in this build.");
}

/** STR/INT/WIS/DEX/CON, the upstream stat_names order (player.h). */
const STAT_NAMES = ["Strength", "Intelligence", "Wisdom", "Dexterity", "Constitution"];

/** SQUARE flag choices for the 'q' query (cmd-wizard.c L2115-2128). */
const SQUARE_FLAG_CHOICES: { letter: string; name: string; flag: number }[] = [
  { letter: "g", name: "GLOW", flag: SQUARE.GLOW },
  { letter: "r", name: "ROOM", flag: SQUARE.ROOM },
  { letter: "a", name: "VAULT", flag: SQUARE.VAULT },
  { letter: "s", name: "SEEN", flag: SQUARE.SEEN },
  { letter: "v", name: "VIEW", flag: SQUARE.VIEW },
  { letter: "w", name: "WASSEEN", flag: SQUARE.WASSEEN },
  { letter: "d", name: "DTRAP", flag: SQUARE.DTRAP },
  { letter: "f", name: "FEEL", flag: SQUARE.FEEL },
  { letter: "t", name: "TRAP", flag: SQUARE.TRAP },
  { letter: "n", name: "INVIS", flag: SQUARE.INVIS },
  { letter: "i", name: "WALL_INNER", flag: SQUARE.WALL_INNER },
  { letter: "o", name: "WALL_OUTER", flag: SQUARE.WALL_OUTER },
  { letter: "l", name: "WALL_SOLID", flag: SQUARE.WALL_SOLID },
  { letter: "x", name: "MON_RESTRICT", flag: SQUARE.MON_RESTRICT },
];

/** Route a debug action key to its collect-and-dispatch handler. */
async function dispatchDebug(ctx: WizardUiCtx, action: string): Promise<void> {
  const { term, state, deps, say } = ctx;
  switch (action) {
    /* ---- Items ---- */
    case "create-obj": {
      const idx = await promptNumber(term, "Create object of which kind (kidx)?", 1, 0, 99999, undefined, 5);
      if (idx === null) return;
      if (!deps.makeDeps) return unavailable(ctx);
      wizCreateObj(state, { index: idx }, deps);
      say("Allocated.");
      break;
    }
    case "create-artifact": {
      const idx = await promptNumber(term, "Create which artifact (aidx)?", 1, 1, 99999, undefined, 5);
      if (idx === null) return;
      if (!deps.makeDeps || !deps.artifacts) return unavailable(ctx);
      wizCreateArtifact(state, { index: idx }, deps);
      break;
    }
    case "create-all-tval": {
      const tval = await promptNumber(term, "Create all objects of which tval?", 1, 1, 999, undefined, 3);
      if (tval === null) return;
      if (!deps.makeDeps) return unavailable(ctx);
      wizCreateAllObjFromTval(state, { tval, art: false }, deps);
      say("Allocated.");
      break;
    }
    case "acquire-good": {
      const n = await promptNumber(term, "How many good objects?", 1, 1, 999, undefined, 3);
      if (n === null) return;
      if (!deps.makeDeps) return unavailable(ctx);
      wizAcquire(state, { quantity: n, great: false }, deps);
      break;
    }
    case "acquire-great": {
      const n = await promptNumber(term, "How many great objects?", 1, 1, 999, undefined, 3);
      if (n === null) return;
      if (!deps.makeDeps) return unavailable(ctx);
      wizAcquire(state, { quantity: n, great: true }, deps);
      break;
    }
    case "play-item":
      await runPlayItem(ctx);
      break;

    /* ---- Player ---- */
    case "cure-all":
      if (!deps.effect) return unavailable(ctx);
      wizCureAll(state, deps);
      say("Cured.");
      break;
    case "advance":
      if (!deps.expDeps) return unavailable(ctx);
      wizAdvance(state, deps);
      say("You feel more experienced.");
      break;
    case "increase-exp": {
      const n = await promptNumber(term, "Gain how much experience?", 100, 1, 9999999, undefined, 7);
      if (n === null) return;
      if (!deps.expDeps) return unavailable(ctx);
      wizIncreaseExp(state, { quantity: n }, deps);
      break;
    }
    case "rerate":
      wizRerate(state, deps);
      break;
    case "edit-player":
      await runEditPlayer(ctx);
      break;
    case "learn-kinds": {
      const lvl = await promptNumber(term, "Learn kinds up to which object level?", 100, 0, 127, undefined, 3);
      if (lvl === null) return;
      if (!deps.makeDeps || !deps.flavor) return unavailable(ctx);
      wizLearnObjectKinds(state, { level: lvl }, deps);
      break;
    }
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
      if (!deps.effect) return unavailable(ctx);
      wizTeleportRandom(state, { range: 10 }, deps);
      break;
    case "tele-far":
      if (!deps.effect) return unavailable(ctx);
      wizTeleportRandom(state, { range: 100 }, deps);
      break;
    case "jump-level": {
      const max = state.z.maxDepth - 1;
      const lvl = await promptNumber(term, "Jump to which dungeon level?", state.chunk.depth, 0, max, undefined, 4);
      if (lvl === null) return;
      if (wizJumpLevel(state, { level: lvl }, deps) && ctx.changeLevel && state.generateLevel) {
        ctx.changeLevel(state.targetDepth ?? lvl);
      }
      break;
    }

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
      say("The graphics demo is a terminal-tile diagnostic (not ported).");
      break;

    /* ---- Summon ---- */
    case "summon-named":
      await runSummonNamed(ctx);
      break;
    case "summon-random": {
      const n = await promptNumber(term, "Summon how many random monsters?", 1, 1, 99, undefined, 2);
      if (n === null) return;
      if (!deps.effect) return unavailable(ctx);
      wizSummonRandom(state, { quantity: n }, deps);
      break;
    }

    /* ---- Files ---- */
    case "spoilers":
      // wiz-spoil.c spoilers are headless dev tooling (packages/cli
      // spoilers.ts); not bundled into the interactive web build (15.4).
      say("Spoilers are generated by the headless CLI tooling.");
      break;
    case "write-map": {
      const rows = wizDumpLevelMap(state, deps);
      const lines: ScreenLine[] = [
        { text: `Level feature map: ${rows.length} rows x ${rows[0]?.length ?? 0} cols.` },
        { text: "(do_cmd_wiz_dump_level_map returns the feature grid; the HTML" },
        { text: " file write is not ported.)" },
      ];
      await showTextScreen(term, "Write map", lines);
      break;
    }

    /* ---- Statistics (headless Monte-Carlo collectors, packages/cli) ---- */
    case "stat-objmon":
    case "stat-pits":
    case "stat-disconnect":
      say("Statistics collectors run in the headless CLI tooling.");
      break;

    /* ---- Query ---- */
    case "query-feature": {
      const feat = await promptNumber(term, "Highlight which feature index?", 1, 0, 999, undefined, 3);
      if (feat === null) return;
      const grids = wizQueryFeature(state, { features: [feat] }, deps);
      say(`${grids.length} grid(s) with feature ${feat}.`);
      break;
    }
    case "query-square-flag": {
      const pick = await selectFromMenu(
        term,
        "Which square flag?",
        SQUARE_FLAG_CHOICES.map((c): MenuItem => ({ label: c.name, tag: c.letter })),
        "[ letter to choose a flag, ESC to cancel ]",
      );
      if (pick === null) return;
      const choice = SQUARE_FLAG_CHOICES[pick];
      if (!choice) return;
      const grids = wizQuerySquareFlag(state, { flag: choice.flag }, deps);
      say(`${grids.length} grid(s) with SQUARE_${choice.name}.`);
      break;
    }
    case "peek-flow": {
      const which = await selectFromMenu(
        term,
        "Peek which flow?",
        [{ label: "Noise" }, { label: "Scent" }],
        "[ a/b to choose, ESC to cancel ]",
      );
      if (which === null) return;
      const depthAt = await promptNumber(term, "Highlight grids at which flow depth?", 0, 0, 999, undefined, 3);
      if (depthAt === null) return;
      const grids = wizPeekFlow(state, { depth: depthAt, which: which === 1 ? "scent" : "noise" }, deps);
      say(`${grids.length} grid(s) at ${which === 1 ? "scent" : "noise"} depth ${depthAt}.`);
      break;
    }
    case "keylog":
      say("The keystroke log is not recorded by the web shell.");
      break;

    /* ---- Miscellaneous ---- */
    case "wizard-light":
      wizWizardLight(state, deps);
      say("You have lit up the level.");
      break;
    case "create-trap": {
      const idx = await promptNumber(term, "Create which trap (t_idx)?", 1, 1, 999, undefined, 3);
      if (idx === null) return;
      if (!deps.trapDeps) return unavailable(ctx);
      wizCreateTrap(state, { index: idx }, deps);
      break;
    }
    case "banish": {
      const range = await promptNumber(term, "Banish monsters within how many grids?", 100, 1, 999, undefined, 3);
      if (range === null) return;
      wizBanish(state, { range }, deps);
      say("Monsters banished.");
      break;
    }
    case "push-object":
      wizPushObject(state, { grid: state.actor.grid }, deps);
      say("Pushed any pile off your square.");
      break;
    case "quit-no-save":
      if (await confirmYesNo(term, "Really quit without saving? ")) {
        say("Reload the page to abandon this character without saving.");
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

/**
 * do_cmd_wiz_teleport_to (cmd-wizard.c L2673): pick a destination grid, and if
 * it is passable, effect_simple(EF_TELEPORT_TO) to it; otherwise report it is
 * impassable. The grid comes from the shell's targeting UI (ctx.pickGrid) when
 * wired, else from numeric coordinate prompts.
 */
async function runTeleportTo(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps, say } = ctx;
  if (!deps.effect) return unavailable(ctx);

  let grid: Loc | null;
  if (ctx.pickGrid) {
    grid = await ctx.pickGrid();
  } else {
    const cur = state.actor.grid;
    const x = await promptNumber(term, "Teleport to which column (x)?", cur.x, 0, 9999, undefined, 4);
    if (x === null) return;
    const y = await promptNumber(term, "Teleport to which row (y)?", cur.y, 0, 9999, undefined, 4);
    if (y === null) return;
    grid = { x, y };
  }
  if (!grid) return;

  /* square_ispassable(cave, grid) (L2682). */
  if (!state.chunk.isPassable(grid)) {
    say("The square you are aiming for is impassable.");
    return;
  }
  runWizEffect(state, deps.effect, EF.TELEPORT_TO, { y: grid.y, x: grid.x });
}

/**
 * do_cmd_wiz_perform_effect (cmd-wizard.c L1524): prompt for an effect (name or
 * index), its dice, its subtype, and the radius / other / y / x parameters,
 * then effect_simple() it from a player source. Mirrors the upstream prompt
 * order and wording exactly.
 */
async function runPerformEffect(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps, say } = ctx;
  if (!deps.effect) return unavailable(ctx);

  /* "Do which effect: " - a name or a number (L1537-1548). */
  const nameEntry = await promptText(term, "Do which effect (name or number)? ", "", 30);
  if (nameEntry === null) return;
  const trimmed = nameEntry.trim();
  let index: number;
  const parsed = Number.parseInt(trimmed, 10);
  if (trimmed !== "" && String(parsed) === trimmed) index = parsed;
  else index = effectLookup(trimmed);
  if (index <= EF.NONE || index >= EF_MAX) {
    say("No effect found.");
    return;
  }

  /* "Enter damage dice (eg 1+2d6M2): "; empty -> "0" (L1551-1555). */
  const diceEntry = await promptText(term, "Enter damage dice (eg 1+2d6M2): ", "0", 30);
  const diceString = diceEntry && diceEntry.trim() ? diceEntry.trim() : "0";

  /* "Enter name or number for effect subtype: " -> effect_subtype (L1557-1564). */
  let subtype = 0;
  const subEntry = await promptText(term, "Enter name or number for effect subtype: ", "0", 30);
  if (subEntry !== null && subEntry.trim() !== "") {
    const st = effectSubtype(index, subEntry.trim(), deps.effect.inject);
    subtype = st === -1 ? 0 : st;
  }

  /* The four get_quantity prompts, default 100 (L1567-1570). */
  const radius = await promptNumber(term, "Enter second parameter (radius): ", 100, 0, 100, undefined, 3);
  if (radius === null) return;
  const other = await promptNumber(term, "Enter third parameter (other): ", 100, 0, 100, undefined, 3);
  if (other === null) return;
  const y = await promptNumber(term, "Enter y parameter: ", 100, 0, 100, undefined, 3);
  if (y === null) return;
  const x = await promptNumber(term, "Enter x parameter: ", 100, 0, 100, undefined, 3);
  if (x === null) return;

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

/** do_cmd_wiz_edit_player_start: batch-edit a stat or gold (exp needs ExpDeps). */
async function runEditPlayer(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps } = ctx;
  const p = state.actor.player;
  const field = await selectFromMenu(
    term,
    "Edit player",
    [
      ...STAT_NAMES.map((n, i): MenuItem => ({ label: `${n} (now ${p.statCur[i]})` })),
      { label: `Gold (now ${p.au})` },
      { label: "Experience", disabled: !deps.expDeps },
    ],
    "[ a-z to choose, ESC to cancel ]",
  );
  if (field === null) return;
  if (field < STAT_NAMES.length) {
    const v = await promptNumber(term, `Set ${STAT_NAMES[field]} to?`, p.statCur[field] ?? 10, 3, 118, undefined, 3);
    if (v === null) return;
    wizEditPlayerStat(state, { stat: field, value: v }, deps);
  } else if (field === STAT_NAMES.length) {
    const v = await promptNumber(term, "Set gold to?", p.au, 0, 2000000000, undefined, 10);
    if (v === null) return;
    wizEditPlayerGold(state, { value: v }, deps);
  }
}

/** do_cmd_wiz_recall_monster / wipe_recall: pick a race or apply to all. */
async function runRecall(ctx: WizardUiCtx, wipe: boolean): Promise<void> {
  const { term, state, deps } = ctx;
  if (!deps.races) return unavailable(ctx);
  const verb = wipe ? "Erase recall of" : "Recall";
  const scope = await selectFromMenu(
    term,
    `${verb} which monster?`,
    [{ label: "All monsters" }, { label: "Choose one by race index" }],
    "[ a/b to choose, ESC to cancel ]",
  );
  if (scope === null) return;
  if (scope === 0) {
    if (wipe) wizWipeRecall(state, { all: true }, deps);
    else wizRecallMonster(state, { all: true }, deps);
    ctx.say(wipe ? "Erased all monster memory." : "Recalled all monsters.");
    return;
  }
  const ridx = await promptNumber(term, "Which race index?", 1, 1, deps.races.length - 1, undefined, 4);
  if (ridx === null) return;
  const race = deps.races[ridx] as MonsterRace | undefined;
  if (!race) {
    ctx.say("No such monster.");
    return;
  }
  if (wipe) wizWipeRecall(state, { race }, deps);
  else wizRecallMonster(state, { race }, deps);
}

/** do_cmd_wiz_summon_named: pick a race index and summon one adjacent. */
async function runSummonNamed(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps } = ctx;
  if (!deps.monPlace) return unavailable(ctx);
  if (!deps.races) return unavailable(ctx);
  const ridx = await promptNumber(term, "Summon which race index?", 1, 1, deps.races.length - 1, undefined, 4);
  if (ridx === null) return;
  const race = deps.races[ridx] as MonsterRace | undefined;
  if (!race) {
    ctx.say("No such monster.");
    return;
  }
  wizSummonNamed(state, { race }, deps);
}

/**
 * do_cmd_wiz_play_item (cmd-wizard.c L1642-1718): snapshot a pack item, show its
 * raw stats (wiz_display_item), and offer reroll / curse edits with a final
 * accept (commit) or reject (restore the snapshot).
 */
async function runPlayItem(ctx: WizardUiCtx): Promise<void> {
  const { term, state, deps, say } = ctx;
  if (!deps.makeDeps) return unavailable(ctx);
  const { items, handles } = packMenu(state, () => true);
  if (items.length === 0) {
    say("You have nothing to play with.");
    return;
  }
  const pick = await selectFromMenu(term, "Play with which item?", items, "[ a-z to choose, ESC to cancel ]");
  if (pick === null) return;
  const handle = handles[pick];
  if (handle === undefined) return;
  const obj = gearGet(state.gear, handle);
  if (!obj) return;

  const snapshot = wizPlayItemBegin(obj, deps);
  if (!snapshot) return;
  let changed = false;

  for (;;) {
    const disp = wizDisplayItem(obj, deps, { all: true });
    const info: ScreenLine[] = disp
      ? [
          { text: `kidx ${disp.kidx}  tval ${disp.tval}  sval ${disp.sval}  number ${disp.number}` },
          { text: `dd ${disp.dd}  ds ${disp.ds}  to-h ${disp.toH}  to-d ${disp.toD}` },
          { text: `ac ${disp.ac}  to-a ${disp.toA}  weight ${disp.weight}  pval ${disp.pval}` },
          { text: `artifact ${disp.name1}  ego ${disp.egoidx}  cost ${disp.cost}` },
          { text: "" },
        ]
      : [];
    const action = await selectFromMenu(
      term,
      "Play with item",
      [
        { label: "Reroll (normal/good/excellent)" },
        { label: "Curse item", disabled: !deps.curses },
        { label: "Accept changes" },
        { label: "Reject changes" },
      ],
      "[ a-z to choose, ESC = reject ]",
      { detail: () => info },
    );
    if (action === null || action === 3) {
      wizPlayItemReject(obj, snapshot, deps);
      say("Changes rejected.");
      return;
    }
    if (action === 2) {
      const equipped = state.actor.player.equipment.includes(handle);
      wizPlayItemAccept(state, obj, { changed, equipped }, deps);
      say("Changes accepted.");
      return;
    }
    if (action === 0) {
      const roll = await promptNumber(term, "Reroll: 0 normal, 1 good, 2 excellent?", 0, 0, 2, undefined, 1);
      if (roll === null) continue;
      if (wizRerollItem(state, { obj, roll }, deps)) changed = true;
    } else if (action === 1) {
      if (!deps.curses) continue;
      const cidx = await promptNumber(term, "Which curse index (0 removes)?", 1, 0, deps.curses.length - 1, undefined, 4);
      if (cidx === null) continue;
      const power = await promptNumber(term, "Curse power (0 removes it)?", 10, 0, 200, undefined, 3);
      if (power === null) continue;
      if (wizCurseItem(state, { obj, index: cidx, power }, deps)) changed = true;
    }
  }
}
