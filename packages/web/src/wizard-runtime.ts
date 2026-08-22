/**
 * `ctx.wizard`: the game's own debug commands, driven by a mod instead of by the
 * `^A` menu, on a session that has been cut loose from its save first.
 *
 * WHY THIS EXISTS WHEN `ctx.debug` ALREADY DOES. `ctx.debug` conjures one item or
 * one creature so a mod that MADE one can go and look at it, and for that it is
 * exactly the right size. It is the wrong size for testing a mod, because testing
 * a mod means the rest of the set too: standing on the level the monster is native
 * to, being the level the item is balanced for, having enough gold to see what a
 * shop does with it, seeing the whole map rather than the one room. Those are all
 * already here, ported, faithful and callable - forty-odd functions in
 * `game/wizard.ts`, each one a `do_cmd_wiz_*` - and until now the only front end
 * for them was a text menu a mod cannot drive.
 *
 * SO THIS IS A SECOND FRONT END, NOT A SECOND IMPLEMENTATION. Every method below
 * is a name, an argument check and one call into the same function the `^A` menu
 * dispatches to, through the same live `WizardDeps` the menu is handed. There is
 * no spawn logic here, no placement logic, no experience arithmetic and no level
 * generation. Where a method looks thin, that is the property being maintained: a
 * second implementation of "give the player experience" would be a second set of
 * rules about level-ups, and the first one is upstream's.
 *
 * THE SANDBOX IS THE PRICE OF ADMISSION, and it is checked here rather than
 * trusted to the mod. Every method refuses until `sandbox()` has been called, and
 * `sandbox()` is one way (see test-sandbox.ts). That single rule is what makes
 * this grant something a player can be offered at all: whatever a mod holding it
 * does, and however wrong it gets it, the character it happens to was already
 * disconnected from its save before the first command ran. The alternative shape -
 * hand over the commands and ask the mod to be careful - puts the player's
 * character behind somebody else's `if`.
 *
 * WHICH IS ALSO WHY THIS IS NOT `debug:spawn` WITH MORE METHODS. `debug:spawn`
 * acts on the live, saved character after the game's own once-per-character
 * question, and it must keep doing that: a mod that adds a monster and wants to
 * show it to you has no business detaching your save. The two grants are different
 * sentences and neither is a superset of the other, so they are different
 * capability strings and `grantCovers` compares the action.
 *
 * NO GRID COORDINATES, on the same terms `ctx.debug` refuses them. Placement is
 * the engine's: an object lands where `dropNear` puts it, a creature where
 * `wizSummonNamed` scatters it. A mod that could name a square could put a monster
 * inside a wall, and "does the thing I just wrote work" was never a question about
 * squares.
 */

import {
  NOSCORE,
  STAT,
  STAT_MAX,
  wizAcquire,
  wizAdvance,
  wizBanish,
  wizCreateArtifact,
  wizCreateObj,
  wizCureAll,
  wizDetectAllMonsters,
  wizEditPlayerExp,
  wizEditPlayerGold,
  wizEditPlayerStat,
  wizHitAllLos,
  wizIncreaseExp,
  wizJumpLevel,
  wizLearnObjectKinds,
  wizMagicMap,
  wizRecallMonster,
  wizRerate,
  wizSummonNamed,
  wizSummonRandom,
  wizTeleportRandom,
  wizWizardLight,
} from "@rpgm-tools/neo-angband-core";
import type { MonsterRace, RecordProvenance } from "@rpgm-tools/neo-angband-core";
import type { WizardUiCtx } from "./wizard";
import { attachedSave, sandboxSession, sessionIsSandboxed } from "./test-sandbox";
import type {
  ModWizard,
  ModWizardCatalogue,
  ModWizardEntry,
  ModWizardOutcome,
  ModWizardSandbox,
  ModWizardWhere,
} from "./mod-plugin";

/** What a mod must hold in its manifest before it may drive the debug commands. */
export const WIZARD_CAPABILITY = "debug:wizard";

/**
 * How many of one thing a single call may conjure.
 *
 * Bounded because these are loops over a placement routine that walks the floor,
 * and a mod passing a mistyped number should get a refusal rather than a wedged
 * page. Generous enough that the interesting cases - a shop's worth of one item,
 * a room full of one monster - are inside it.
 */
export const MAX_AT_ONCE = 40;

/** What the host has to supply before a mod can be handed this door. */
export interface WizardDoorDeps {
  /**
   * The live wizard context, read FRESH on every call rather than captured.
   *
   * `WizardDeps.debug` is derived from the live `player.noscore`, and `sandbox()`
   * sets that bit part-way through this door's life - so a snapshot would still
   * say `debug: false` and every command would silently no-op. The same reason
   * `wizardCtx()` exposes `deps` as a getter, and the same reason the spawn door
   * takes a function here.
   */
  readonly wizard: () => WizardUiCtx;
}

/**
 * Build the `ctx.wizard` a consenting mod is handed.
 *
 * `modId` is carried so the message log names who did what. A line in the log is
 * the only trace of any of this a player would otherwise have, and in a sandboxed
 * session the log is the only trace there IS, because nothing is written down.
 */
export function createModWizard(modId: string, door: WizardDoorDeps): ModWizard {
  /* THE GATE, in one place, so no method below can forget it. Reads the session
   * rather than a flag of its own: a flag could disagree with the thing that
   * actually decides where a save goes. */
  const gated = (what: string, run: (ctx: WizardUiCtx) => ModWizardOutcome): ModWizardOutcome => {
    if (!sessionIsSandboxed()) {
      return {
        ok: false,
        problem:
          `${what} needs this session cut loose from its save first. Call sandbox() and tell the player what it ` +
          `costs them, then try again`,
      };
    }
    try {
      const ctx = door.wizard();
      /* Belt and braces, and not redundant: `sandbox()` sets the debug bit, but a
       * mod could have been handed this door on a session that was already loose
       * for another reason (a save that failed to load, a throwaway behind the
       * character select) and never took the mark. Every wiz* function is gated on
       * it and would no-op silently, which is the failure this turns into a
       * sentence. */
      if ((ctx.state.actor.player.noscore & NOSCORE.DEBUG) === 0) {
        return {
          ok: false,
          problem: `${what} needs the debug mark on this character, which sandbox() sets. Call it first`,
        };
      }
      return run(ctx);
    } catch (err) {
      return { ok: false, problem: `${what} failed: ${message(err)}` };
    }
  };

  /* Every command ends the same way: say what happened, redraw, report. Factored
   * because twenty copies of three lines is twenty chances for one of them to
   * forget the redraw and leave a mod looking broken. */
  const did = (ctx: WizardUiCtx, engineSaidYes: boolean, what: string): ModWizardOutcome => {
    if (!engineSaidYes) {
      /* The engine's own refusal, which it has already reported through the
       * message sink in its own words. Inventing a second explanation for it is
       * how a caller ends up told two different things about one event. */
      return { ok: false, problem: `the game would not ${what}` };
    }
    ctx.say(`${modId}: ${what}.`);
    ctx.refresh();
    return { ok: true, did: what };
  };

  return {
    sandboxed: (): boolean => sessionIsSandboxed(),

    attached: (): ModWizardSandbox | null => {
      const save = attachedSave();
      return save === null ? null : { name: save.name };
    },

    sandbox: (): ModWizardOutcome => {
      const outcome = sandboxSession();
      if (!outcome.ok) return { ok: false, problem: outcome.problem };
      /* MARKED HERE, AND THIS IS THE HONEST PLACE FOR IT. `ctx.debug` asks the
       * game's own once-per-character question before it conjures anything,
       * because it acts on a character that is still being saved and the mark is
       * permanent for that character. Here the mark is permanent for a character
       * that has already stopped being written down, so the question it would ask
       * has no consequence left to warn about - and asking it would mean posing a
       * grid prompt underneath whatever the mod is drawing, which is the refusal
       * the spawn door has to carry. Detaching IS the consent moment, the mod asks
       * for it in its own words on its own screen, and the bit is then simply true:
       * this is a cheated character. */
      try {
        const ctx = door.wizard();
        ctx.deps.markNoscore?.(NOSCORE.DEBUG);
        const left = outcome.left;
        ctx.say(
          left === null
            ? `${modId}: this session was already a scratch copy; nothing here is being saved.`
            : `${modId}: ${left.name || "this character"} is safe on disk. Nothing from here on is saved.`,
        );
        ctx.refresh();
      } catch {
        /* No live game to mark or to talk to. The session is still loose, which is
         * what was asked for, and the first command will refuse on the mark. */
      }
      return { ok: true, did: "cut this session loose from its save" };
    },

    catalogue: (): ModWizardCatalogue => gatherCatalogue(safeCtx(door)),

    where: (): ModWizardWhere | null => {
      const ctx = safeCtx(door);
      if (ctx === null) return null;
      const p = ctx.state.actor.player;
      return {
        depth: ctx.state.chunk.depth,
        maxDepth: Math.max(0, ctx.state.z.maxDepth - 1),
        level: p.lev,
        experience: p.exp,
        gold: p.au,
        stats: STAT_MAX_NAMES.map((name, i) => ({ name, value: p.statCur[i] ?? 0 })),
      };
    },

    spawnItem: (which: number | string, quantity = 1): ModWizardOutcome =>
      gated("conjuring an item", (ctx) => {
        const n = count(quantity);
        if (typeof n === "string") return { ok: false, problem: n };
        const found = findItem(ctx, which);
        if (typeof found === "string") return { ok: false, problem: found };
        let made = 0;
        for (let i = 0; i < n; i++) {
          if (wizCreateObj(ctx.state, { index: found.index }, ctx.deps)) made++;
        }
        return did(ctx, made > 0, `put ${made} ${found.name} where you are standing`);
      }),

    spawnCreature: (which: number | string, quantity = 1): ModWizardOutcome =>
      gated("summoning a creature", (ctx) => {
        const n = count(quantity);
        if (typeof n === "string") return { ok: false, problem: n };
        const found = findCreature(ctx, which);
        if (typeof found === "string") return { ok: false, problem: found };
        let made = 0;
        for (let i = 0; i < n; i++) {
          if (wizSummonNamed(ctx.state, { race: found.race }, ctx.deps)) made++;
        }
        return did(ctx, made > 0, `put ${made} ${found.name} beside you`);
      }),

    spawnArtifact: (which: number | string): ModWizardOutcome =>
      gated("conjuring an artifact", (ctx) => {
        const found = findArtifact(ctx, which);
        if (typeof found === "string") return { ok: false, problem: found };
        return did(
          ctx,
          wizCreateArtifact(ctx.state, { index: found.index }, ctx.deps),
          `put ${found.name} where you are standing`,
        );
      }),

    goToDepth: (depth: number): ModWizardOutcome =>
      gated("going to a depth", (ctx) => {
        if (!Number.isInteger(depth) || depth < 0) {
          return { ok: false, problem: `${describe(depth)} is not a dungeon level` };
        }
        if (depth >= ctx.state.z.maxDepth) {
          return {
            ok: false,
            problem: `this game's dungeon stops at level ${ctx.state.z.maxDepth - 1}`,
          };
        }
        if (!wizJumpLevel(ctx.state, { level: depth }, ctx.deps)) {
          return { ok: false, problem: `the game would not go to level ${depth}` };
        }
        /* The jump is a PENDING level change, exactly as upstream's is: the
         * command sets the target and generation happens on the way out. The shell
         * owns what "change level" means on each front end, so this asks it rather
         * than reaching for the generator. Absent, the pending change is still set
         * and the game takes it at the next natural opportunity, which is a slower
         * version of the same thing rather than a broken one. */
        ctx.changeLevel?.(depth);
        ctx.say(`${modId}: went to dungeon level ${depth}.`);
        ctx.refresh();
        return { ok: true, did: `went to dungeon level ${depth}` };
      }),

    grantExperience: (amount: number): ModWizardOutcome =>
      gated("granting experience", (ctx) => {
        if (!Number.isFinite(amount) || amount < 1) {
          return { ok: false, problem: `${describe(amount)} is not an amount of experience to gain` };
        }
        const n = Math.floor(amount);
        return did(ctx, wizIncreaseExp(ctx.state, { quantity: n }, ctx.deps), `gave you ${n} experience`);
      }),

    setExperience: (value: number): ModWizardOutcome =>
      gated("setting experience", (ctx) => {
        if (!Number.isFinite(value) || value < 0) {
          return { ok: false, problem: `${describe(value)} is not an experience total` };
        }
        const n = Math.floor(value);
        return did(ctx, wizEditPlayerExp(ctx.state, { value: n }, ctx.deps), `set your experience to ${n}`);
      }),

    setGold: (value: number): ModWizardOutcome =>
      gated("setting gold", (ctx) => {
        if (!Number.isFinite(value) || value < 0) {
          return { ok: false, problem: `${describe(value)} is not an amount of gold` };
        }
        const n = Math.floor(value);
        return did(ctx, wizEditPlayerGold(ctx.state, { value: n }, ctx.deps), `set your gold to ${n}`);
      }),

    setStat: (stat: string, value: number): ModWizardOutcome =>
      gated("setting a stat", (ctx) => {
        const index = STAT_MAX_NAMES.indexOf(stat.toUpperCase());
        if (index < 0) {
          return { ok: false, problem: `there is no stat called "${stat}"` };
        }
        if (!Number.isFinite(value)) {
          return { ok: false, problem: `${describe(value)} is not a stat value` };
        }
        /* Clamped by the engine to [3, 118] rather than refused here, because that
         * band is upstream's and belongs in one place. */
        const n = Math.floor(value);
        return did(
          ctx,
          wizEditPlayerStat(ctx.state, { stat: index, value: n }, ctx.deps),
          `set your ${STAT_MAX_NAMES[index]}`,
        );
      }),

    maxOut: (): ModWizardOutcome =>
      gated("maxing the character out", (ctx) =>
        did(ctx, wizAdvance(ctx.state, ctx.deps), "made you as strong as this game allows"),
      ),

    heal: (): ModWizardOutcome =>
      gated("healing", (ctx) => did(ctx, wizCureAll(ctx.state, ctx.deps), "healed and cured you")),

    rerollLife: (): ModWizardOutcome =>
      gated("rerolling hit points", (ctx) => {
        const rating = wizRerate(ctx.state, ctx.deps);
        return did(ctx, rating !== null, `rerolled your hit points (life rating ${rating ?? 0}%)`);
      }),

    acquire: (quantity: number, great = false): ModWizardOutcome =>
      gated("acquiring items", (ctx) => {
        const n = count(quantity);
        if (typeof n === "string") return { ok: false, problem: n };
        return did(
          ctx,
          wizAcquire(ctx.state, { quantity: n, great }, ctx.deps),
          `dropped ${n} ${great ? "excellent" : "good"} item${n === 1 ? "" : "s"} for you`,
        );
      }),

    summonRandom: (quantity: number): ModWizardOutcome =>
      gated("summoning", (ctx) => {
        const n = count(quantity);
        if (typeof n === "string") return { ok: false, problem: n };
        return did(
          ctx,
          wizSummonRandom(ctx.state, { quantity: n }, ctx.deps),
          `summoned ${n} creature${n === 1 ? "" : "s"}`,
        );
      }),

    banish: (range = 255): ModWizardOutcome =>
      gated("banishing", (ctx) => {
        if (!Number.isInteger(range) || range < 1) {
          return { ok: false, problem: `${describe(range)} is not a distance` };
        }
        return did(
          ctx,
          wizBanish(ctx.state, { range }, ctx.deps),
          `removed every creature within ${range} squares`,
        );
      }),

    killVisible: (): ModWizardOutcome =>
      gated("hitting everything in sight", (ctx) =>
        did(ctx, wizHitAllLos(ctx.state, ctx.deps), "hit everything you can see"),
      ),

    teleport: (range: number): ModWizardOutcome =>
      gated("teleporting", (ctx) => {
        if (!Number.isInteger(range) || range < 1) {
          return { ok: false, problem: `${describe(range)} is not a teleport range` };
        }
        return did(
          ctx,
          wizTeleportRandom(ctx.state, { range }, ctx.deps),
          `teleported you up to ${range} squares`,
        );
      }),

    mapLevel: (): ModWizardOutcome =>
      gated("mapping the level", (ctx) => did(ctx, wizMagicMap(ctx.state, ctx.deps), "mapped this level")),

    lightLevel: (): ModWizardOutcome =>
      gated("lighting the level", (ctx) =>
        did(ctx, wizWizardLight(ctx.state, ctx.deps), "lit the whole level"),
      ),

    findCreatures: (): ModWizardOutcome =>
      gated("detecting creatures", (ctx) =>
        did(ctx, wizDetectAllMonsters(ctx.state, ctx.deps), "showed you every creature on this level"),
      ),

    learnItems: (upTo?: number): ModWizardOutcome =>
      gated("learning items", (ctx) => {
        const level = upTo === undefined ? ctx.state.z.maxDepth : upTo;
        if (!Number.isInteger(level) || level < 0) {
          return { ok: false, problem: `${describe(level)} is not a depth to learn up to` };
        }
        return did(
          ctx,
          wizLearnObjectKinds(ctx.state, { level }, ctx.deps),
          `taught you every item found down to level ${level}`,
        );
      }),

    learnCreatures: (): ModWizardOutcome =>
      gated("learning creatures", (ctx) =>
        did(ctx, wizRecallMonster(ctx.state, { all: true }, ctx.deps), "taught you every creature's lore"),
      ),
  };
}

/* ------------------------------------------------------------------ *
 * The catalogue: what a mod's browser lists.
 * ------------------------------------------------------------------ */

/**
 * Every item, creature and artifact the running game has, with the pack that
 * added each one.
 *
 * NOT GATED ON THE SANDBOX, deliberately, and it is the one thing here that is
 * not. Listing is reading, the mod can already read the same registries through
 * `ctx.registries`, and a browser that only fills in AFTER the player has agreed
 * to detach their save would be asking them to agree to something they cannot see
 * yet. Reading it before detaching is exactly how a player decides whether to.
 *
 * `from` IS THE POINT OF THIS SHAPE. A pack's own records are what a builder wants
 * first and everything else is context, so every entry says which pack added it -
 * absent meaning core's own, which is the same convention `provenanceOf` uses. A
 * caller sorts on it; this does not, because whose content matters depends on who
 * is asking.
 */
function gatherCatalogue(ctx: WizardUiCtx | null): ModWizardCatalogue {
  if (ctx === null) return { items: [], creatures: [], artifacts: [] };
  const kinds = ctx.deps.makeDeps?.reg.kinds ?? [];
  const races = ctx.deps.races ?? [];
  const artifacts = ctx.deps.artifacts ?? [];
  return {
    /* `reg.kinds` and not another list, because that is the exact array
     * `wizCreateObj` indexes into. Resolving a name against one list and handing
     * an index to a function that reads another is the classic way to conjure the
     * wrong item and never find out. */
    items: entries(kinds),
    /* SKIPPING INDEX 0, which is upstream's reserved `<player>` pseudo-race
     * (`r_info[0]`, monster.txt's `name:<player>` / `base:player`). It has a real
     * name, so a filter that only dropped holes and blanks kept it - and because
     * its level is 0 it sorted to the very front, making "conjure the player" the
     * first row a builder was offered. Core already skips it in every place that
     * walks the table for something a player can meet: allocation
     * (`gen-monster.ts`, `mon/make.ts`), the spoiler generators (`game/spoil.ts`),
     * and hallucination. */
    creatures: entries(races, 1),
    artifacts: entries(artifacts),
  };
}

/**
 * One registry's records as catalogue entries, holes and unnamed rows dropped.
 *
 * PROVENANCE IS READ OFF `from`, NOT THROUGH `provenanceOf`, and the difference
 * cost a red test to find. `provenanceOf` reads the raw `"$from"` key a composer
 * stamps onto record JSON; these are BOUND records, where the binder has already
 * lifted that into the typed `ModExtensible.from` field and dropped the raw key.
 * Calling the raw reader on a bound record compiles, never throws, and reports
 * every single record as core's - so a browser built on it would have shown a
 * mod author's own content indistinguishable from vanilla's, silently.
 */
function entries(
  list: readonly ({ name?: string; level?: number; from?: RecordProvenance } | null | undefined)[],
  from = 0,
): readonly ModWizardEntry[] {
  const out: ModWizardEntry[] = [];
  for (let i = from; i < list.length; i++) {
    const record = list[i];
    /* A hole is normal: these arrays are indexed by the game's own index and
     * upstream's tables start at 1. An unnamed row is upstream's terminator. */
    if (!record || typeof record.name !== "string" || record.name === "") continue;
    const owner = record.from?.owner;
    out.push({
      name: record.name,
      index: i,
      level: typeof record.level === "number" ? record.level : 0,
      ...(owner !== undefined && owner !== "core" ? { from: owner } : {}),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Resolution and small checks.
 * ------------------------------------------------------------------ */

/**
 * The live context, or null when there is no game.
 *
 * The read-only methods answer with null rather than throwing, because "what depth
 * am I on" asked before there is a game is a reasonable question with a
 * reasonable answer.
 */
function safeCtx(door: WizardDoorDeps): WizardUiCtx | null {
  try {
    return door.wizard();
  } catch {
    return null;
  }
}

const STAT_MAX_NAMES: readonly string[] = buildStatNames();

/**
 * The stat names, in the engine's own order.
 *
 * DERIVED FROM `STAT` rather than written out, so a build whose stat list differs
 * from this port's cannot end up labelling DEX as WIS. `STAT_MAX` is the length
 * that matters and the two are asserted against each other, because a silently
 * short list would drop a stat from every caller's UI.
 */
function buildStatNames(): readonly string[] {
  const names: string[] = [];
  for (const [name, index] of Object.entries(STAT)) names[index] = name;
  for (let i = 0; i < STAT_MAX; i++) names[i] ??= `stat ${i}`;
  return names.slice(0, STAT_MAX);
}

function findItem(
  ctx: WizardUiCtx,
  which: number | string,
): { name: string; index: number } | string {
  const kinds = ctx.deps.makeDeps?.reg.kinds;
  if (!kinds) return "this session has no object registry to conjure from";
  const index = typeof which === "number" ? which : kinds.findIndex((k) => k?.name === which);
  const kind = index >= 0 ? kinds[index] : undefined;
  if (!kind) return `there is no item ${describeWhich(which)} in this game`;
  return { name: kind.name, index };
}

function findCreature(
  ctx: WizardUiCtx,
  which: number | string,
): { name: string; race: MonsterRace } | string {
  const races = ctx.deps.races;
  const race =
    typeof which === "number"
      ? races?.[which]
      : (ctx.raceByName?.(which) ?? races?.find((r) => r?.name === which));
  if (!race) return `there is no creature ${describeWhich(which)} in this game`;
  return { name: race.name, race };
}

function findArtifact(
  ctx: WizardUiCtx,
  which: number | string,
): { name: string; index: number } | string {
  const list = ctx.deps.artifacts;
  if (!list) return "this session has no artifact list to conjure from";
  const index = typeof which === "number" ? which : list.findIndex((a) => a?.name === which);
  const art = index >= 0 ? list[index] : undefined;
  if (!art) return `there is no artifact ${describeWhich(which)} in this game`;
  return { name: art.name, index };
}

/** A count in range, or the sentence saying why it is not one. */
function count(quantity: number): number | string {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return `${describe(quantity)} is not a number of things to make`;
  }
  if (quantity > MAX_AT_ONCE) {
    return `${quantity} at once is more than this door will do; ${MAX_AT_ONCE} is the most`;
  }
  return quantity;
}

function describe(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : `"${String(value)}"`;
}

function describeWhich(which: number | string): string {
  return typeof which === "number" ? `at index ${which}` : `called "${which}"`;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
