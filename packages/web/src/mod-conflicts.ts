/**
 * The conflict report the player reads, over EVERY composition layer.
 *
 * WHAT THIS REPLACES. `modConflictLines` (pack.ts) walked the composed content
 * and nothing else, so the "View conflicts" pane answered one question of five.
 * Two mods claiming a grafID, contributing the same hook, declaring the same
 * rule flag, or each shipping an autoplayer all resolved silently - and three of
 * those four DISCARD somebody's work rather than merging it.
 *
 * THE INPUTS ARE OBSERVATIONS. Every claim below is read off what a mod actually
 * contributed: the refs in its files, the keys its hooks factory returned, the
 * grafIDs its manifest claims, whether it handed over a controller. A `touches`
 * declaration would have been less code and would have gone stale silently,
 * which is the failure mode this pane exists to end.
 *
 * The gathering (`conflictReport`) is separated from the shaping
 * (`conflictLines`, and the pure `layerSlots` below) so the whole thing is
 * testable without a browser, a glob or localStorage.
 */

import {
  MOD_HOOK_FOLDS,
  type ModHooks,
} from "@rpgm-tools/neo-angband-core";
import {
  contestedSlots,
  describeContested,
  describeDeclaredConflict,
  foldDiscards,
  type Claim,
  type ContestedSlot,
  type DeclaredConflict,
  type Fold,
  type NameOf,
  type PackManifest,
} from "@rpgm-tools/neo-angband-mod-sdk";
import { frontendClaimants } from "./frontend-runtime";
import { hudClaimants } from "./hud-runtime";
import { menuClaimants } from "./menu-runtime";
import { screenClaimants } from "./screen-runtime";
import { activeModCode } from "./mod-code";
import { enabledModHookContributions } from "./mod-hooks";
import {
  discoverContentModManifests,
  enabledModIds,
  loadEnabledModRuleDecls,
  modConflictLines,
} from "./pack";
import { discoverEnabledTileModeClaims } from "./tile-mods";

/** What the pane needs, gathered from the live host or supplied by a test. */
export interface ConflictInputs {
  /** Enabled manifests, in load order. */
  manifests: readonly PackManifest[];
  /** The content report's own lines (pack.ts's modConflictLines). */
  recordLines: readonly string[];
  /** Every grafID every enabled tiles mod claims, losers included, in load order. */
  tileClaims: readonly { modId: string; grafID: number; menuname: string }[];
  /** What each enabled mod's hooks factory returned, in load order. */
  hookContributions: readonly { id: string; hooks: ModHooks }[];
  /** Every rule flag every enabled mod declares, in load order. */
  ruleDecls: readonly { modId: string; flag: string }[];
  /** Enabled mods that handed the host an autoplayer, in load order. */
  controllers: readonly string[];
  /** Enabled mods that declare a replacement front end, in load order. */
  frontends: readonly string[];
  /**
   * Enabled mods claiming each HUD region, in load order, per region.
   *
   * Per region rather than one "hud" list, because that is how the seam grants
   * it: two mods both declaring `hud()` are only in conflict if they want the
   * SAME part of the screen, and folding them into one line would report a
   * contest between a vitals mod and a status-line mod that never had one.
   */
  hudRegions: readonly { region: string; ids: readonly string[] }[];
  /**
   * Enabled mods claiming the MENUS, in load order. One list rather than one per
   * menu id: the seam grants every menu together, so two presenters are in
   * conflict even though each will end up declining questions the other takes.
   */
  menus: readonly string[];
  /** Enabled mods claiming the SCREENS, in load order. One list, as `menus` is. */
  screens: readonly string[];
}

/** A pack's display name from its manifest, falling back to its id. */
export function nameFromManifests(manifests: readonly PackManifest[]): NameOf {
  const byId = new Map(manifests.map((m) => [m.id, m.name]));
  return (id) => byId.get(id) ?? id;
}

/**
 * The contested slots for the four layers the content report cannot see.
 *
 * Pure over its inputs. Records are excluded on purpose: `computeConflictReport`
 * already produces field-granular lines for them, and re-deriving those here
 * would be a second implementation of the one layer that already works.
 */
export function layerSlots(inputs: ConflictInputs): ContestedSlot[] {
  const slots: ContestedSlot[] = [];

  /* GRAPHICS. Last-wins since 2026-08-01 (it was first-wins, backwards from
   * every other layer and from the manager's own "Move later" row). */
  slots.push(
    ...contestedSlots(
      "graphics",
      "last-wins",
      inputs.tileClaims.map((t) => ({
        key: `graphics:${t.grafID}`,
        what: `the "${t.menuname}" graphics mode`,
        claim: { packId: t.modId } as Claim,
      })),
    ),
  );

  /* BEHAVIOUR. One slot per ModHooks member, each with ITS OWN fold - core's
   * table, not a copy (MOD_HOOK_FOLDS), because "these combine" and "one of
   * these never runs" are different news and five of the seven combine. */
  const byHook = new Map<keyof ModHooks, { id: string }[]>();
  for (const { id, hooks } of inputs.hookContributions) {
    for (const key of Object.keys(hooks) as (keyof ModHooks)[]) {
      if (typeof hooks[key] !== "function") continue;
      byHook.set(key, [...(byHook.get(key) ?? []), { id }]);
    }
  }
  for (const [hook, claimants] of byHook) {
    const fold: Fold = MOD_HOOK_FOLDS[hook];
    slots.push(
      ...contestedSlots(
        "behaviour",
        fold,
        claimants.map((c) => ({
          key: `hook:${String(hook)}`,
          what: hookDescription(hook),
          claim: { packId: c.id } as Claim,
        })),
      ),
    );
  }

  /* RULES. `resolveModRules` is a flat last-wins namespace keyed by the flag
   * STRING, so two mods declaring one flag share a single toggle - the player
   * sees two rows that move together and each mod reads the other's answer. */
  slots.push(
    ...contestedSlots(
      "rule",
      "last-wins",
      inputs.ruleDecls.map((r) => ({
        key: `rule:${r.flag}`,
        what: `the "${r.flag}" setting`,
        claim: { packId: r.modId } as Claim,
      })),
    ),
  );

  /* CONTROLLER. One slot, and installController's uninstall restores whatever
   * preceded it - so a second install silently wins and unwinding out of order
   * restores the wrong provider. */
  slots.push(
    ...contestedSlots(
      "controller",
      "single-slot",
      inputs.controllers.map((id) => ({
        key: "controller",
        what: "an autoplayer that takes over your keyboard",
        claim: { packId: id } as Claim,
      })),
    ),
  );

  /* FRONTEND. The last enabled declaration owns the one display slot; lower
   * candidates are never invoked, so a loser cannot leave a hidden root behind. */
  slots.push(
    ...contestedSlots(
      "frontend",
      "single-slot",
      inputs.frontends.map((id) => ({
        key: "frontend",
        what: "a replacement map front end",
        claim: { packId: id } as Claim,
      })),
    ),
  );

  /* HUD, one slot PER REGION. Same last-load-wins rule as the front end, applied
   * three times, so a mod drawing the vitals and a mod drawing the status line
   * are correctly reported as not fighting. */
  for (const { region, ids } of inputs.hudRegions) {
    slots.push(
      ...contestedSlots(
        "hud",
        "single-slot",
        ids.map((id) => ({
          key: `hud:${region}`,
          what: `a replacement ${hudRegionDescription(region)}`,
          claim: { packId: id } as Claim,
        })),
      ),
    );
  }

  /* The menus, one slot for the lot. A presenter declining a question is the
   * winner choosing, not a conflict resolving, so the contest is over the seam
   * itself and is reported once. */
  slots.push(
    ...contestedSlots(
      "menu",
      "single-slot",
      inputs.menus.map((id) => ({
        key: "menu",
        what: "a replacement way of asking the game's menus",
        claim: { packId: id } as Claim,
      })),
    ),
  );

  /* The screens, one slot for the lot, for the same reason the menus get one. */
  slots.push(
    ...contestedSlots(
      "screen",
      "single-slot",
      inputs.screens.map((id) => ({
        key: "screen",
        what: "a replacement way of showing the game's full screens",
        claim: { packId: id } as Claim,
      })),
    ),
  );

  return slots;
}

/** What a player would call one HUD region. */
function hudRegionDescription(region: string): string {
  const words: Record<string, string> = {
    messages: "message line",
    sidebar: "vitals panel",
    status: "status line",
  };
  return words[region] ?? region;
}

/** What a player would call one ModHooks member. */
function hookDescription(hook: keyof ModHooks): string {
  const words: Record<keyof ModHooks, string> = {
    walkBlockedByDiggable: "what happens when you walk into diggable rock",
    objectListTiebreak: "the order of items on the floor list",
    levelGenerated: "whether a freshly generated level is accepted",
    artifactCommit: "whether an artifact is allowed to be created",
    historyAdd: "which events reach your character history",
    saveNoiseScent: "whether noise and scent maps go into the save",
    messageText: "the wording of game messages",
    optionsChanged: "being told when you change your options",
  };
  return words[hook];
}

/** Every `conflicts` claim whose named pack is actually enabled. */
export function declaredConflicts(
  manifests: readonly PackManifest[],
): DeclaredConflict[] {
  const enabled = new Set(manifests.map((m) => m.id));
  const out: DeclaredConflict[] = [];
  for (const m of manifests) {
    for (const c of m.compat ?? []) {
      if (c.claim !== "conflicts" || !enabled.has(c.with)) continue;
      out.push({
        packId: m.id,
        with: c.with,
        because: c.because,
        ...(c.scope ? { scope: [...c.scope] } : {}),
      });
    }
  }
  return out;
}

/** The pane's full text: what authors declared, then what was measured. */
export interface ConflictReportLines {
  /**
   * Authors' own `conflicts` claims. First, because they carry a human's reason
   * and are the only entries that might mean "do not run these together" - and
   * still never block: the engine labels, it does not forbid (decision 18).
   */
  declared: string[];
  /** Contested slots where somebody's contribution is DISCARDED. */
  contested: string[];
  /**
   * Contested slots where the contributions COMBINE. Reported so the picture is
   * complete, and kept apart so they do not bury the ones needing a decision.
   */
  combined: string[];
}

/**
 * Gather the inputs from the live host and shape them.
 *
 * The browser entry point: it globs, reads storage, and calls each enabled mod's
 * hooks factory. Everything it does is a lookup - all the decisions are in
 * `conflictLines` and `layerSlots`, which take plain data.
 */
export function liveConflictLines(): ConflictReportLines {
  const enabled = enabledModIds();
  const discovered = discoverContentModManifests();
  const byId = new Map(discovered.map((m) => [m.id, m]));
  return conflictLines({
    manifests: enabled.map((id) => byId.get(id)).filter((m): m is PackManifest => !!m),
    recordLines: modConflictLines(enabled),
    tileClaims: discoverEnabledTileModeClaims().map((t) => ({
      modId: t.modId,
      grafID: t.grafID,
      menuname: t.menuname,
    })),
    hookContributions: enabledModHookContributions(),
    ruleDecls: loadEnabledModRuleDecls().map((d) => ({ modId: d.modId, flag: d.rule.flag })),
    controllers: activeModCode()
      .plugins.filter((p) => typeof p.plugin.controller === "function")
      .map((p) => p.id),
    /* Eligible claimants only: a mod that declares frontend() without
     * `display:replace` is refused and reported as its own fault, and counting
     * it here as well would tell the player two mods are fighting over the
     * display when only one of them can ever hold it. */
    frontends: frontendClaimants(activeModCode().plugins),
    /* Same rule, per region: only mods that could actually hold one are listed. */
    hudRegions: hudClaimants(activeModCode().plugins),
    menus: menuClaimants(activeModCode().plugins),
    screens: screenClaimants(activeModCode().plugins),
  });
}

/** Shape the gathered inputs into the pane's three groups. */
export function conflictLines(inputs: ConflictInputs): ConflictReportLines {
  const nameOf = nameFromManifests(inputs.manifests);
  const slots = layerSlots(inputs);
  return {
    declared: declaredConflicts(inputs.manifests).map((c) =>
      describeDeclaredConflict(c, nameOf),
    ),
    contested: [
      ...inputs.recordLines,
      ...slots.filter((s) => foldDiscards(s.fold)).map((s) => describeContested(s, nameOf)),
    ],
    combined: slots
      .filter((s) => !foldDiscards(s.fold))
      .map((s) => describeContested(s, nameOf)),
  };
}
