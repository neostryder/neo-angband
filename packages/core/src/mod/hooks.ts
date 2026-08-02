/**
 * The behaviour seam: the closed set of points where a mod may change what the
 * ENGINE does, as opposed to what content it runs on.
 *
 * WHY THIS EXISTS
 *
 * Content mods are already fully expressible - a pack contributes records and
 * composeContentPacks merges them, and core never learns a mod was involved.
 * Behaviour is different. A fix like "don't log a duplicate unique kill" is not a
 * record; it is a decision taken inside a function, and no amount of data can
 * reach inside that function from outside. So the first cut of the bundled
 * bug-fixes / QoL mods did the only thing that was available: the FIX LIVED IN
 * CORE behind `if (modRuleEnabled(state, "bugfix.x"))`.
 *
 * That was wrong, and neostryder named exactly why (2026-07-29): "the whole point of
 * making them mods was to exclude them from the core game." A flag-gated fix is
 * not excluded from core. It ships in core, it is tested in core, and core
 * carries the string "bugfix.uniqueKillHistory" - so core knows the mod's name.
 * Deleting the mod folder would not delete one line of it.
 *
 * WHAT THIS CHANGES, AND WHAT IT HONESTLY DOES NOT
 *
 * After this, core contains no mod's fix and no mod's name: no `bugfix.*` or
 * `qol.*` literal, no staircase repair, no message rewriter. Each fix body lives
 * in its mod's own folder and arrives as that mod's code.
 *
 * What core still contains - and cannot stop containing - is the SEAM ITSELF:
 * one named, documented extension point per behaviour a mod may override. That
 * is not a residue of the bundled mods; it is the price of behaviour modding at
 * all, and it is the same bargain SKSE, Forge and every other real modding
 * system strikes. The difference from a flag read is the difference that matters:
 * a seam is generic and available to ANY mod, and it holds no opinion about what
 * should plug into it, whereas `if (modRuleEnabled(state, "bugfix.stairsReachable"))`
 * is core implementing one specific mod.
 *
 * SHAPE
 *
 * A plain interface of optional functions rather than a string-keyed registry,
 * for three reasons:
 *
 *  - It is typed end to end. A registry keyed by strings pushes every payload
 *    through `unknown` and moves the errors to runtime.
 *  - "A disabled mod's patches DO NOT EXIST" becomes literally true, not merely
 *    false-y: with no mod loaded the field is ABSENT, the optional call is not
 *    made, and the faithful path is the only path that was ever compiled into
 *    the branch. No flag map is consulted because there is no flag map.
 *  - It costs nothing. `state.modHooks?.historyAdd?.(...)` on an absent object is
 *    one undefined check, not a map lookup per call.
 *
 * COMPOSITION IS THE HOST'S JOB
 *
 * Two enabled mods may both want the same hook. Core deliberately holds ONE
 * ModHooks and knows nothing about mod identity, ordering or enablement - the
 * host (web/cli) collects each enabled mod's contributions in load order and
 * folds them into a single object (see composeModHooks). This is the same
 * layering as content: core consumes a composed result and never the pack list.
 *
 * A hook is arbitrary third-party code running inside a turn, so it can throw.
 * guardModHooks wraps one mod's contribution and turns a throw into that hook's
 * neutral answer - see its comment for why that is the least-bad of the three
 * options, and for the half of the job it deliberately leaves to the host.
 *
 * DETERMINISM
 *
 * Two of these run inside the generation and object pipelines, where an extra
 * RNG draw does not merely change a value, it desynchronises every draw after
 * it - so a seed would stop meaning the same level. Those hooks are documented
 * RNG-FREE and are given no rng to draw from. That is a contract a mod can still
 * break by reaching for a global; the test suite pins it by running generation
 * with a hook installed and asserting the level is bit-identical.
 */

import type { GameState } from "../game/context.js";
import type { OptionStateData } from "../player/options.js";

/**
 * A mod's behaviour contributions. Every member is optional; an absent member
 * means "this mod does not touch that point" and core takes its faithful path.
 *
 * Each entry documents the ONE core call site it serves, because a hook whose
 * call site is not written down is a hook nobody can verify is still wired -
 * exactly the failure the call-site census exists to catch.
 */
export interface ModHooks {
  /**
   * A walk into a grid the player could tunnel through (cave-cmd.ts,
   * movementAutoDig's call site).
   *
   * Return the energy the move should cost, or null to decline - and declining
   * MUST be free of observable effect, because faithful core's behaviour here is
   * to bump into the wall without drawing any RNG. A hook that rolls a dig check
   * and then returns null has already moved the RNG stream.
   *
   * `deps` is the live CaveCmdDeps the session built, passed through because the
   * work a mod would want to do here (tunnelAux - one real dig attempt with the
   * upstream roll and payouts) needs dependencies only the session can construct.
   * Typed as unknown so this seam does not drag the cave-command types into every
   * consumer of ModHooks; a mod casts it back to CaveCmdDeps, which core exports.
   *
   * Serves: the QoL mod's "auto-dig on walk".
   */
  walkBlockedByDiggable?: (
    state: GameState,
    grid: { y: number; x: number },
    deps: unknown,
  ) => number | null;

  /**
   * Two floor-list entries that compared exactly equal, including on distance
   * (obj-list.ts, the comparator's final tiebreak).
   *
   * Return a negative/positive number to order them, or 0 to leave them equal
   * (which is what faithful core does - it keeps collect order via a stable
   * sort). Must be a consistent total order or the sort is meaningless.
   *
   * Serves: the bug-fixes mod's strict object-list ordering (#4664).
   */
  objectListTiebreak?: (
    a: { readonly dy: number; readonly dx: number },
    b: { readonly dy: number; readonly dx: number },
  ) => number;

  /**
   * A finished, otherwise-accepted level, before cave_generate returns it
   * (generate.ts, the accept branch).
   *
   * Return false to REJECT the level, which makes cave_generate re-roll exactly
   * as it does for a monster-maximum overflow. May mutate the level to repair it
   * and then return true.
   *
   * RNG-FREE: no rng is passed and none may be reached. A draw here shifts every
   * subsequent draw and a seed stops reproducing its dungeon.
   *
   * Serves: the bug-fixes mod's reachable-staircase repair.
   */
  levelGenerated?: (gen: unknown, quest: boolean) => boolean;

  /**
   * An object about to be committed as an artifact, when it ALREADY carries one
   * (obj/make.ts, the `obj.artifact` branch).
   *
   * Return false to refuse the commit; the caller then clears the artifact and
   * reports failure. Faithful core commits it unconditionally.
   *
   * RNG-FREE, for the same reason as levelGenerated: this runs inside object
   * creation, on the main stream.
   *
   * Serves: the bug-fixes mod's duplicate-artifact guard (#4510).
   */
  artifactCommit?: (aidx: number, alreadyCreated: boolean) => boolean;

  /**
   * A character-history entry about to be written (session/game.ts and any
   * other historyAdd call site that passes its context).
   *
   * Return false to suppress the entry. Faithful core writes every entry it
   * reaches, duplicates included.
   *
   * Serves: the bug-fixes mod's no-duplicate-unique-kill fix (#4245).
   */
  historyAdd?: (entry: { readonly what: string; readonly type: number; readonly duplicate: boolean }) => boolean;

  /**
   * Whether the noise and scent heatmaps belong in the save (session/save.ts,
   * snapshotSquares' argument).
   *
   * Return true to persist them. Faithful core omits them, which is the upstream
   * behaviour and the upstream bug.
   *
   * Serves: the bug-fixes mod's noise/scent persistence (#4605).
   */
  saveNoiseScent?: () => boolean;

  /**
   * Player-visible message text, on its way to the message line (the host's
   * message sink).
   *
   * Return the text to show. Faithful core shows what it was given, warts and
   * all. A hook here can only RESTATE a message - it must never change what a
   * message means, or the port would be showing text upstream never wrote and no
   * census could see it.
   *
   * Serves: the bug-fixes mod's cosmetic string corrections.
   */
  messageText?: (raw: string) => string;

  /**
   * The player finished changing their options (the '=' menu closed).
   *
   * A NOTIFICATION, and the only one here: every other hook is asked a question
   * and its answer changes what the engine does, whereas this one is told a
   * thing that already happened and core does not read the return value. The
   * fold is "all-observe" for that reason - there is no answer to pick between,
   * so every contributor simply runs.
   *
   * The payload is a SNAPSHOT (OptionState.snapshot()), not the live store. A
   * mod that wants to react to a setting should read what the player chose; a
   * mod that wants to CHANGE a setting has state.options and does not need this.
   * Handing over the live object would blur the two, and a hook that mutated the
   * store while the host was mid-repaint is a bug with no obvious author.
   *
   * Fired by the HOST, because the option screens are the host's - core's
   * OptionState is the pure port of option.c and has no idea a menu exists. The
   * host's own tests pin the call sites; a screen that edits options and forgets
   * to fire this is a mod silently missing an event, which is why they are
   * asserted rather than trusted.
   *
   * Serves: the QoL mod's "remember my settings" (persisting the player's
   * choices past the character they were made on).
   */
  optionsChanged?: (options: OptionStateData) => void;
}

/**
 * Fold several mods' contributions into the single ModHooks core holds.
 *
 * Order is LOAD order, and THE LATER MOD WINS EVERY DISAGREEMENT. That is the
 * rule the mod manager's own row promises the player ("Move later (loads last,
 * wins conflicts)") and the rule every other composition layer follows, so this
 * one obeys it too - see the note below for the two folds that look like
 * exceptions and are not.
 *
 *  - LAST-HANDLER hooks (walkBlockedByDiggable) are asked in REVERSE load order
 *    and stop at the first non-null, so the last mod to have an opinion is the
 *    one whose handling takes effect and no earlier mod can double-spend the
 *    energy it already paid out.
 *  - ORDERING hooks (objectListTiebreak) chain the same way round: the last
 *    mod's comparator is the primary key and earlier ones break the ties it
 *    leaves, which is a valid total order and is "later wins" for a comparator.
 *  - TRANSFORM hooks (messageText) compose in load order, each seeing the
 *    previous one's output - so the last mod still speaks last and has the final
 *    say over the text that reaches the player.
 *  - VETO hooks (levelGenerated, artifactCommit, historyAdd) are conjunctive:
 *    every contributor runs and any refusal decides.
 *  - ANY hooks (saveNoiseScent) are disjunctive: one mod asking for the data is
 *    enough, because the data is additive and a second mod cannot object.
 *
 * WHY THE LAST TWO ARE NOT EXCEPTIONS. "Later wins" answers the question "two
 * mods disagree about one thing - whose answer is used?", and a veto hook is not
 * asking that question. `true` from historyAdd means "I have nothing to say
 * about this entry", not "I insist it be written": the hook is called once per
 * entry, and two mods suppressing two different things are not in conflict at
 * all. Resolving it last-wins would mean a later mod's silence cancelled an
 * earlier mod's rule, breaking BOTH mods to satisfy a consistency nobody asked
 * for. Same for saveNoiseScent, where `false` is "I do not need this" and the
 * data is additive. The consistency that matters is that no mod's opinion is
 * ever DISCARDED in favour of an earlier one, and these two discard nothing.
 *
 * Returns undefined when nothing contributed, so the caller can leave the field
 * absent rather than storing an empty object - keeping "no mod loaded" and "a
 * mod loaded that touches nothing" indistinguishable from core's side.
 */
/**
 * How composeModHooks folds several mods' contributions to one hook.
 *
 * A subset of the vocabulary the pack tooling uses for every composition layer
 * (mod-sdk's `Fold`), so the host can hand these values straight to the conflict
 * report and the compiler checks the two agree.
 */
export type ModHookFold =
  | "all-must-agree" // every contributor runs; the first refusal decides
  | "chained" // each sees the previous one's output, so the last one speaks last
  | "last-answer" // the LAST contributor with an opinion decides; earlier ones are not asked
  | "any-yes" // one contributor asking for it is enough
  | "all-observe"; // a notification: every contributor is told, and none of them answers

/**
 * WHICH FOLD EACH HOOK USES, next to the function that implements it.
 *
 * The conflict report needs this to tell the player whether two mods touching
 * one hook COMBINE or whether one of them is being silently ignored. Every fold
 * here obeys "the later mod wins"; what differs is whether there is anything for
 * a winner to win, and only `last-answer` leaves a contribution unrun. That
 * distinction is the whole reason the report names the fold instead of printing
 * one sentence about load order.
 *
 * It lives in core, beside composeModHooks, because a second copy in the host is
 * the shape that drifts: the host is where the report is rendered, so a hook
 * added here and forgotten there would be described by whatever the table
 * happened to default to. Keyed by `keyof ModHooks`, so adding a member to the
 * interface without adding it here does not compile.
 */
export const MOD_HOOK_FOLDS: Readonly<Record<keyof ModHooks, ModHookFold>> = {
  walkBlockedByDiggable: "last-answer",
  objectListTiebreak: "last-answer",
  levelGenerated: "all-must-agree",
  artifactCommit: "all-must-agree",
  historyAdd: "all-must-agree",
  saveNoiseScent: "any-yes",
  messageText: "chained",
  optionsChanged: "all-observe",
};

/**
 * A mod's hook function threw. Reported to whoever guarded it (guardModHooks).
 *
 * Carries no mod id, because core does not know one - the host wraps ONE mod's
 * contribution at a time and already holds the id in the closure it passes in.
 */
export interface ModHookFault {
  /** Which extension point threw, by its ModHooks member name. */
  readonly hook: keyof ModHooks;
  /** Whatever the mod threw, unwrapped and uninterpreted. */
  readonly error: unknown;
}

/**
 * ONE mod's contribution, with every hook wrapped so a throw cannot escape into
 * the middle of a turn.
 *
 * WHY THIS IS NOT "CATCH AND CARRY ON REGARDLESS". An uncaught throw here lands
 * in the middle of core - halfway through a move, a generation pass or an object
 * roll - and unwinds the rest of the turn. It does not undo what the mod already
 * did before it threw, so the state is no LESS inconsistent for the abort; it is
 * more, because the turn's remaining bookkeeping never ran. And it reaches the
 * host as a bare exception from a function the host did not know a mod was
 * inside, so the player gets a frozen screen and no name.
 *
 * So a throwing hook is treated as a mod that DECLINED to answer at that point,
 * and the neutral answer is per-hook - it has to be, because "no opinion" is
 * `true` for a veto, `null` for a handler, `0` for a comparator and the input
 * itself for a transform. Those values live HERE, next to the fold rule in
 * composeModHooks that already spells out each hook's kind, rather than in the
 * host: two copies of "what does this hook mean by nothing" is the pair that
 * drifts.
 *
 * WHAT THIS DOES NOT DO, deliberately: it does not make the session safe. The
 * mod ran arbitrary code against live state and stopped partway. Neutralising
 * the hook keeps the game on its feet long enough to say so; it is the HOST's
 * job to treat the fault as terminal for the session - stop writing saves and
 * tell the player to reload (packages/web/src/mod-taint.ts). A guard without
 * that second half would be the worst outcome of the three: quietly wrong.
 *
 * LATCHED PER HOOK. Once a hook has thrown it is not called again for the rest
 * of the session. A hook that throws on a bad monster will throw on the next
 * one too, and an exception per call turns one fault into a storm of them; more
 * importantly, "sometimes the mod's rule applies and sometimes it doesn't" is
 * harder to reason about than "it stopped applying at the point it broke". The
 * mod's other hooks are untouched - the latch is per (mod, hook), not per mod.
 */
export function guardModHooks(
  hooks: ModHooks,
  onFault: (fault: ModHookFault) => void,
): ModHooks {
  const out: ModHooks = {};
  const stopped = new Set<keyof ModHooks>();

  function guard<T>(hook: keyof ModHooks, run: () => T, neutral: T): T {
    if (stopped.has(hook)) return neutral;
    try {
      return run();
    } catch (error) {
      stopped.add(hook);
      onFault({ hook, error });
      return neutral;
    }
  }

  const walk = hooks.walkBlockedByDiggable;
  if (walk) {
    /* null is DECLINE, so core bumps the wall as it would with no mod loaded. */
    out.walkBlockedByDiggable = (state, grid, deps): number | null =>
      guard("walkBlockedByDiggable", () => walk(state, grid, deps), null);
  }

  const tiebreak = hooks.objectListTiebreak;
  if (tiebreak) {
    /* 0 is "still equal", which is exactly faithful core's answer. */
    out.objectListTiebreak = (a, b): number =>
      guard("objectListTiebreak", () => tiebreak(a, b), 0);
  }

  const level = hooks.levelGenerated;
  if (level) {
    /* ACCEPT. Rejecting on a throw would re-roll the level, and cave_generate
     * would then re-roll it again on the next throw, and so on until it gives
     * up - one broken hook would make the game unable to reach any level. */
    out.levelGenerated = (gen, quest): boolean =>
      guard("levelGenerated", () => level(gen, quest), true);
  }

  const artifact = hooks.artifactCommit;
  if (artifact) {
    /* COMMIT, which is what core does unconditionally without the hook. */
    out.artifactCommit = (aidx, alreadyCreated): boolean =>
      guard("artifactCommit", () => artifact(aidx, alreadyCreated), true);
  }

  const history = hooks.historyAdd;
  if (history) {
    /* WRITE the entry: faithful core writes every entry it reaches. Suppressing
     * on a throw would delete history the player earned. */
    out.historyAdd = (entry): boolean =>
      guard("historyAdd", () => history(entry), true);
  }

  const noise = hooks.saveNoiseScent;
  if (noise) {
    /* OMIT them, the upstream behaviour. */
    out.saveNoiseScent = (): boolean => guard("saveNoiseScent", () => noise(), false);
  }

  const text = hooks.messageText;
  if (text) {
    /* The raw message, unrestated - never an empty string, which would silently
     * eat a message the player needed to read. */
    out.messageText = (raw): string => guard("messageText", () => text(raw), raw);
  }

  const options = hooks.optionsChanged;
  if (options) {
    /* Nothing to neutralise: core does not read an answer, so the neutral value
     * is undefined and the guard exists only for the latch and the report. */
    out.optionsChanged = (data): void => {
      guard("optionsChanged", () => options(data), undefined);
    };
  }

  return out;
}

export function composeModHooks(
  contributions: readonly ModHooks[],
): ModHooks | undefined {
  const list = contributions.filter((c) => Object.keys(c).length > 0);
  if (list.length === 0) return undefined;

  const out: ModHooks = {};

  /* REVERSE load order for both of the last-answer folds, so the mod the player
   * moved to the bottom of the list is the one that gets asked first and
   * therefore the one that decides. Reversed here, once, rather than by walking
   * the array backwards at call time: the reversal is a property of the FOLD, and
   * a `for (let i = n - 1; ...)` in the hot path is the kind of detail a later
   * edit quietly straightens out. */
  const walk = list.map((c) => c.walkBlockedByDiggable).filter(isFn).reverse();
  if (walk.length > 0) {
    out.walkBlockedByDiggable = (state, grid, deps): number | null => {
      /* Declining is contractually free of observable effect (see the member's
       * doc), so asking a mod that then declines costs nothing - which is what
       * makes it safe to ask them in any order at all. */
      for (const fn of walk) {
        const energy = fn(state, grid, deps);
        if (energy !== null) return energy;
      }
      return null;
    };
  }

  const tiebreak = list.map((c) => c.objectListTiebreak).filter(isFn).reverse();
  if (tiebreak.length > 0) {
    out.objectListTiebreak = (a, b): number => {
      /* The last mod's comparator is the primary sort key and the earlier ones
       * only break the ties it leaves equal - a lexicographic chain, still a
       * consistent total order, and "the later mod wins" for a comparator. */
      for (const fn of tiebreak) {
        const r = fn(a, b);
        if (r !== 0) return r;
      }
      return 0;
    };
  }

  const level = list.map((c) => c.levelGenerated).filter(isFn);
  if (level.length > 0) {
    out.levelGenerated = (gen, quest): boolean => {
      /* Every contributor runs even after one has repaired the level, because a
       * second mod's invariant is not satisfied by the first mod's repair. The
       * first REFUSAL short-circuits, since the level is being thrown away. */
      for (const fn of level) if (!fn(gen, quest)) return false;
      return true;
    };
  }

  const artifact = list.map((c) => c.artifactCommit).filter(isFn);
  if (artifact.length > 0) {
    out.artifactCommit = (aidx, alreadyCreated): boolean => {
      for (const fn of artifact) if (!fn(aidx, alreadyCreated)) return false;
      return true;
    };
  }

  const history = list.map((c) => c.historyAdd).filter(isFn);
  if (history.length > 0) {
    out.historyAdd = (entry): boolean => {
      for (const fn of history) if (!fn(entry)) return false;
      return true;
    };
  }

  const noise = list.map((c) => c.saveNoiseScent).filter(isFn);
  if (noise.length > 0) {
    out.saveNoiseScent = (): boolean => noise.some((fn) => fn());
  }

  const text = list.map((c) => c.messageText).filter(isFn);
  if (text.length > 0) {
    out.messageText = (raw): string => text.reduce((s, fn) => fn(s), raw);
  }

  const optionsChanged = list.map((c) => c.optionsChanged).filter(isFn);
  if (optionsChanged.length > 0) {
    /* LOAD order, and every one of them is told. There is no answer to choose
     * between, so "later wins" has nothing to win: two mods both remembering the
     * player's settings are not in conflict, they are two mods doing their own
     * job with the same fact. Each gets its OWN copy - a mod that keeps the
     * object it was handed and edits it later must not be editing what the next
     * mod is about to read. */
    out.optionsChanged = (data): void => {
      for (const fn of optionsChanged) {
        fn({ ...data, values: { ...data.values }, birth: { ...data.birth } });
      }
    };
  }

  return out;
}

function isFn<T>(v: T | undefined): v is T {
  return typeof v === "function";
}
