/**
 * `ctx.debug`: conjuring an item or a creature into the live game, so a mod that
 * MADE one can go and look at it.
 *
 * WHAT THIS IS AND IS NOT, because getting that wrong would be the whole story.
 * It is not a new power. Every primitive behind it is already on `ctx.core` -
 * `wizCreateObj`, `wizSummonNamed`, `wizDropObject`, and under them `makeObject`,
 * `dropNear` and `placeNewMonsterLive` - and the gate they check, `debugEnabled`,
 * reads a `debug` boolean out of a deps bag the CALLER assembles. So a mod could
 * always pass `{ debug: true, ... }` and conjure whatever it liked, with no
 * capability at all and no mark on the character. What was actually missing was
 * not the ability; it was the honesty and the wiring.
 *
 * SO WHAT THE CAPABILITY BUYS IS TWO THINGS THE UNGATED PATH DOES NOT GIVE.
 *
 * The first is that the character gets MARKED, and marked before anything is
 * conjured. `NOSCORE.DEBUG` is the same bit `^A` sets, set through the same
 * function, after the same two warning lines and the same question - so "the
 * debug commands mark your character and it cannot be scored" stays a true
 * sentence about this game rather than one with a mod-shaped hole in it. The
 * ordering is not cosmetic: the confirmation runs first and the spawn only
 * happens if it was accepted, so there is no path where something has been
 * conjured into a character the player did not agree to spend.
 *
 * The second is a sentence on the consent list. `debug:spawn` is its own
 * capability kind with no wildcard over it, so a player asking "which of my mods
 * can conjure things" reads the answer off one line, and no broader grant can
 * ever carry this one along.
 *
 * THE CONFIRMATION IS A GRID PROMPT, WHICH IS WHY THERE IS A REFUSAL ABOUT
 * PANELS. The game asks its questions by painting them on the character grid.
 * A mod's modal DOM panel is sitting on top of that grid and holding the
 * keyboard, so posing the question underneath one would be posing it where
 * nobody can read it and nobody can answer it. A refusal naming the panel is
 * better than a prompt the player cannot see, and the natural flow does not hit
 * it anyway: a builder that closes its panel to show the player the dungeon has
 * already done the thing the refusal would have asked for.
 *
 * PLACEMENT IS THE HOST'S, and there are no coordinates in this API. An object
 * is dropped where the debug command drops it, at the player's own grid through
 * `dropNear`; a creature is scattered near the player the way `wizSummonNamed`
 * scatters it, with the engine's own ten attempts to find a legal spot. A mod
 * that could name a grid could put a monster inside a wall, and the interesting
 * question a builder asks - does the thing I just wrote work - has nothing to do
 * with where it lands.
 */

import { NOSCORE, wizCreateObj, wizSummonNamed } from "@rpgm-tools/neo-angband-core";
import type { WizardUiCtx } from "./wizard";
import { modalModPanelOpen } from "./panel-runtime";
import type { ModDebug, ModSpawnOutcome } from "./mod-plugin";

/** What a mod must hold in its manifest before it may conjure anything. */
export const SPAWN_CAPABILITY = "debug:spawn";

/**
 * What the host has to supply before a mod can be handed a debug surface.
 *
 * Named for the family rather than for spawning, because `ctx.wizard` reads the
 * same latch: `WizardDoorDeps` is this interface's `wizard` field and nothing
 * else, so one latched door satisfies both by construction. `confirm` is the half
 * only spawning wants - detaching the save is `ctx.wizard`'s own consent moment.
 */
export interface DebugDoorDeps {
  /**
   * The live wizard context, read FRESH on every call rather than captured.
   *
   * `WizardDeps.debug` is derived from the live `player.noscore`, and the
   * confirmation below sets that bit part-way through the call - so a snapshot
   * would still say `debug: false` at the moment the spawn runs and every spawn
   * would silently do nothing. This is the same reason `wizardCtx()` in main.ts
   * exposes `deps` as a getter.
   */
  readonly wizard: () => WizardUiCtx;
  /**
   * The game's own once-per-character debug confirmation (`confirmDebugGate`).
   * Passed rather than imported so a test can answer it without a terminal, and
   * so this module cannot grow a second version of a question that must only
   * ever have one.
   */
  readonly confirm: (ctx: WizardUiCtx) => Promise<boolean>;
}

/**
 * Build the `ctx.debug` a consenting mod is handed.
 *
 * `modId` is carried so a refusal can say whose panel is in the way and so the
 * message log names the mod that conjured something - a line in the log is the
 * only trace a player would otherwise have.
 */
export function createModDebug(modId: string, deps: DebugDoorDeps): ModDebug {
  return {
    spawnObject: (kind: number | string): Promise<ModSpawnOutcome> =>
      spawn(modId, deps, "object", kind),
    spawnMonster: (race: number | string): Promise<ModSpawnOutcome> =>
      spawn(modId, deps, "monster", race),
  };
}

async function spawn(
  modId: string,
  deps: DebugDoorDeps,
  what: "object" | "monster",
  which: number | string,
): Promise<ModSpawnOutcome> {
  try {
    /* BEFORE the confirmation, because a question the player cannot see is worse
     * than a refusal they can read. See this module's header. */
    if (modalModPanelOpen()) {
      const ctx = deps.wizard();
      if ((ctx.state.actor.player.noscore & NOSCORE.DEBUG) === 0) {
        return {
          ok: false,
          problem:
            `the game has to ask about marking this character before anything can be conjured into it, and it ` +
            `asks on the game screen - which one of ${modId}'s own panels is covering. Close the panel first, ` +
            `then try again`,
        };
      }
    }
    const ctx = deps.wizard();
    if (!(await deps.confirm(ctx))) {
      /* Not an error. The player was asked and said no, which is an answer. */
      return { ok: false, problem: "the player declined to mark this character for debug use" };
    }
    /* Re-read: `confirm` set the noscore bit, and `deps` is a getter over it. */
    const live = deps.wizard();
    const resolved = resolve(live, what, which);
    if (typeof resolved === "string") return { ok: false, problem: resolved };
    const done =
      resolved.kind === "object"
        ? wizCreateObj(live.state, { index: resolved.index }, live.deps)
        : wizSummonNamed(live.state, { race: resolved.race }, live.deps);
    if (!done) {
      /* The engine's own refusal, which it reports through the message sink in
       * its own words - so this does not invent a second explanation for it. */
      return { ok: false, problem: `the game would not place ${resolved.name}` };
    }
    live.say(`${modId} conjured ${resolved.name}.`);
    live.refresh();
    return { ok: true, what: resolved.name };
  } catch (err) {
    return {
      ok: false,
      problem: `conjuring failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/* TAGGED, so the two arms narrow. An optional-`undefined` pair reads the same to
 * a human and does not narrow on a property test, which is how a resolved
 * monster ends up being handed to the object path. */
type Resolved =
  | { readonly kind: "object"; readonly name: string; readonly index: number }
  | {
      readonly kind: "monster";
      readonly name: string;
      readonly race: NonNullable<ReturnType<NonNullable<WizardUiCtx["raceByName"]>>>;
    };

/**
 * Turn what the mod asked for into what the engine takes, or a sentence saying
 * why not.
 *
 * BY NAME OR BY INDEX, and the name is the case that matters: a builder knows
 * what it just called the thing, and an index is a fact about a registry that
 * moved the moment another mod was enabled. Resolution goes through the SAME
 * lists the running game was bound from, so a mod's own content resolves on
 * exactly the same terms as core's - which is the whole point of being able to
 * test what you just wrote.
 */
function resolve(
  ctx: WizardUiCtx,
  what: "object" | "monster",
  which: number | string,
): Resolved | string {
  if (what === "monster") {
    const races = ctx.deps.races;
    const race =
      typeof which === "number"
        ? races?.[which]
        : (ctx.raceByName?.(which) ?? races?.find((r) => r?.name === which));
    if (!race) return `there is no creature ${describe(which)} in this game`;
    return { kind: "monster", name: race.name, race };
  }
  /* `reg.kinds` rather than any other list, because that is the exact array
   * `wizCreateObj` indexes into - resolving a name against one list and handing
   * an index to a function that reads another is the classic way to conjure the
   * wrong item and never find out. */
  const kinds = ctx.deps.makeDeps?.reg.kinds;
  if (!kinds) return "this session has no object registry to conjure from";
  const index =
    typeof which === "number" ? which : kinds.findIndex((k) => k?.name === which);
  const kind = index >= 0 ? kinds[index] : undefined;
  if (!kind) return `there is no item ${describe(which)} in this game`;
  return { kind: "object", name: kind.name, index };
}

function describe(which: number | string): string {
  return typeof which === "number" ? `at index ${which}` : `called "${which}"`;
}
