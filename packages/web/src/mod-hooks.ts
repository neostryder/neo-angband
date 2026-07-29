/**
 * Discover the BEHAVIOUR each enabled mod contributes, and fold it into the one
 * ModHooks core holds (core/mod/hooks.ts).
 *
 * This is the counterpart of agents/trusted/discover.ts, and deliberately the
 * same shape: a mod that changes behaviour lives at packages/web/mods/<id>/ with
 * a manifest.json and a code entry point, and the host finds it with a glob
 * rather than a hardcoded list. Nothing here knows any mod's id, and no mod's
 * flag name appears in the host either - the mod reads its own flags.
 *
 * THE ENTRY POINT. packages/web/mods/<id>/hooks.ts default-exports
 *
 *   (flags: Readonly<Record<string, boolean>>) => ModHooks
 *
 * and is called ONCE per ENABLED mod, in enabled/load order, with THAT mod's
 * resolved rule choices (`choices[flag] ?? rule.default` for every rule its
 * manifest declares). A mod with no behaviour - the linoleum tile pack, and every
 * pure content mod - simply ships no hooks.ts and is never called.
 *
 * WHY THE PER-MOD FLAG MAP IS SLICED PER MOD rather than passed whole: a mod must
 * not be able to read, or act on, another mod's toggles. Slicing by declaration
 * means a mod sees exactly the flags it declared in its own manifest, so its
 * behaviour cannot silently depend on which other mods the player enabled.
 *
 * A DISABLED MOD'S PATCHES DO NOT EXIST (Aaron's standing ruling). Not "exist and
 * read false": enabledModIds() drives the loop, so a disabled mod's entry point
 * is never invoked, contributes no hook, and composeModHooks returns undefined
 * when nothing contributed - leaving GameState.modHooks ABSENT and every core
 * call site on its faithful path.
 */

import { composeModHooks, type ModHooks } from "@neo-angband/core";
import { enabledModIds, loadEnabledModRuleDecls } from "./pack";
import { defaultModStore, isShippedMod, resolveModRules } from "./mod-store";

/**
 * The entry-point signature every behaviour mod exports as default. Identical
 * across the bundled mods and the only shape this discovery accepts; see the
 * header comment in packages/web/mods/bug-fixes/hooks.ts.
 */
export type ModHookEntry = (
  flags: Readonly<Record<string, boolean>>,
) => ModHooks;

/* Each hooks.ts is imported as a plain module (its default export), exactly as
 * trusted.ts is - in-process, no serialization boundary, so it can use core's
 * public API directly. */
const entryGlob = import.meta.glob("../mods/*/hooks.ts", {
  eager: true,
  import: "default",
}) as Record<string, ModHookEntry>;

/** modId -> its default-exported entry point, for every mod shipping hooks.ts. */
export function discoverModHookEntries(): Map<string, ModHookEntry> {
  const byId = new Map<string, ModHookEntry>();
  for (const [key, entry] of Object.entries(entryGlob)) {
    const m = /\/mods\/([^/]+)\/hooks\.ts$/.exec(key);
    if (!m || !m[1] || !isShippedMod(m[1])) continue;
    if (typeof entry !== "function") {
      console.warn(`[mod-hooks] ${m[1]}/hooks.ts does not default-export a function; skipping`);
      continue;
    }
    byId.set(m[1], entry);
  }
  return byId;
}

/**
 * modId -> that mod's own resolved rule flags (choice ?? default), for enabled
 * mods only. Exported for the tests, which need to prove the slicing.
 */
export function resolveModRuleFlagsByMod(): Map<string, Record<string, boolean>> {
  const choices = defaultModStore().getRuleChoices();
  const byMod = new Map<string, Record<string, boolean>>();
  for (const decl of loadEnabledModRuleDecls()) {
    const flags = byMod.get(decl.modId) ?? {};
    /* One resolver for the whole host (mod-store.resolveModRules), so the flags a
     * mod is handed cannot disagree with the flags recorded on
     * GameState.modRules or shown in the Fixes & tweaks menu. */
    Object.assign(flags, resolveModRules([decl], choices));
    byMod.set(decl.modId, flags);
  }
  return byMod;
}

/**
 * The composed behaviour for this session, for startGame/loadGame's `modHooks`.
 * Undefined when no enabled mod contributes anything - the fresh-install case,
 * and the one that must leave core byte-identical to faithful 4.2.6.
 */
export function activeModHooks(): ModHooks | undefined {
  const entries = discoverModHookEntries();
  const flagsByMod = resolveModRuleFlagsByMod();
  const contributions: ModHooks[] = [];
  for (const id of enabledModIds()) {
    const entry = entries.get(id);
    if (!entry) continue;
    contributions.push(entry(flagsByMod.get(id) ?? {}));
  }
  return composeModHooks(contributions);
}
