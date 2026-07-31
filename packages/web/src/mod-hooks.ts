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
 * THE ENTRY POINT. packages/web/mods/<id>/plugin.ts default-exports a ModPlugin
 * (mod-plugin.ts) - `{ api, hooks?, register? }` - and its `hooks` is called ONCE
 * per ENABLED mod, in enabled/load order, with a ModPluginContext carrying THAT
 * mod's resolved rule choices (`choices[flag] ?? rule.default` for every rule its
 * manifest declares). A mod with no behaviour - the neo-linoleum tile pack, and
 * every pure content mod - simply ships no plugin.ts and is never called.
 *
 * ONE SHAPE, NOT TWO. This used to glob `hooks.ts` for a bundled mod, whose entry
 * point took `flags` and imported core directly, while a folder mod shipped a
 * `plugin.js` whose `hooks` took a context and got the engine as `ctx.core`. Same
 * job, two signatures, and the bundled one could not be built into a distributable
 * plugin.js at all - it imported a bare specifier, which is the one thing a module
 * fetched from a folder cannot do. So the bundled mods now use the folder ABI, and
 * the only remaining difference between the two paths is how the module is
 * obtained: Vite resolves one at build time, mod-code.ts imports the other from a
 * URL. That is what lets ONE source produce both the bundled mod and the plugin.js
 * in the mod's own repository.
 *
 * WHY THE PER-MOD FLAG MAP IS SLICED PER MOD rather than passed whole: a mod must
 * not be able to read, or act on, another mod's toggles. Slicing by declaration
 * means a mod sees exactly the flags it declared in its own manifest, so its
 * behaviour cannot silently depend on which other mods the player enabled.
 *
 * A DISABLED MOD'S PATCHES DO NOT EXIST (neostryder's standing ruling). Not "exist and
 * read false": enabledModIds() drives the loop, so a disabled mod's entry point
 * is never invoked, contributes no hook, and composeModHooks returns undefined
 * when nothing contributed - leaving GameState.modHooks ABSENT and every core
 * call site on its faithful path.
 */

import {
  composeModHooks,
  guardModHooks,
  type ModHookFault,
  type ModHooks,
} from "@rpgm-tools/neo-angband-core";
import { enabledModIds, loadEnabledModRuleDecls } from "./pack";
import { defaultModStore, isShippedMod, resolveModRules } from "./mod-store";
import { activeModCode } from "./mod-code";
import { validateModPlugin, type ModPlugin } from "./mod-plugin";
import { modPluginContext, modOwnFiles } from "./mod-context";
import { faultMessage, reportModFault } from "./mod-problems";
import { taintSession } from "./mod-taint";

/**
 * The one-argument adapter both paths are reduced to before the fold: a mod's
 * behaviour as a function of its own flags.
 *
 * `undefined` means "contributed nothing", which is distinct from `{}` - a plugin
 * that has no `hooks`, or whose `hooks` threw, must leave core on its faithful path
 * rather than install an empty opinion.
 */
export type ModHookEntry = (
  flags: Readonly<Record<string, boolean>>,
) => ModHooks | undefined;

/* Each plugin.ts is resolved by Vite at build time and imported as a plain module
 * (its default export) - in-process, no serialization boundary. The SAME source is
 * built to a standalone plugin.js for the mod's own repository, which is why it
 * takes the engine from its context rather than importing it. */
const entryGlob = import.meta.glob("../mods/*/plugin.ts", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

/** modId -> its behaviour adapter, for every bundled mod shipping plugin.ts. */
export function discoverModHookEntries(): Map<string, ModHookEntry> {
  const byId = new Map<string, ModHookEntry>();
  for (const [key, entry] of Object.entries(entryGlob)) {
    const m = /\/mods\/([^/]+)\/plugin\.ts$/.exec(key);
    if (!m || !m[1] || !isShippedMod(m[1])) continue;
    const id = m[1];
    /* The same validator the folder path runs, so a bundled mod cannot ship a
     * shape the ABI would refuse from a third party - including the api-version
     * check, which is the one that catches a mod left behind by a bump. */
    const wrong = validateModPlugin(entry);
    if (wrong) {
      reportModFault(id, `${wrong} - the mod contributes no behaviour`);
      console.warn(`[mod-hooks] ${id}/plugin.ts: ${wrong}; skipping`);
      continue;
    }
    byId.set(id, pluginAdapter(id, entry as ModPlugin));
  }
  return byId;
}

/**
 * A ModPlugin's `hooks` as a one-argument function of flags.
 *
 * Shared by both paths on purpose: a plugin that throws loses ITS contribution and
 * nothing else, whether it came from a folder or the bundle. A bundled mod is first
 *-party, but "first-party code cannot throw" is an assumption, not a guarantee, and
 * a mod that takes the game down on boot is the worst version of that being wrong.
 *
 * THE CATCH WAS RIGHT AND THE REPORT WAS A console.error, which is a channel a
 * player does not have: a mod whose hooks() threw was enabled, listed, consented to,
 * and behaviourally absent, with nothing anywhere on screen saying so. It now also
 * reports, so the mod manager can put it on that mod's row.
 */
function pluginAdapter(id: string, plugin: ModPlugin): ModHookEntry {
  return (flags) => {
    if (!plugin.hooks) return undefined;
    try {
      return plugin.hooks(modPluginContext(id, flags));
    } catch (e) {
      reportModFault(id, `hooks() threw, so it changes no behaviour: ${faultMessage(e)}`);
      console.error(`[mod:${id}] hooks() threw; contributing nothing:`, e);
      return undefined;
    }
  };
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
 *
 * TWO SOURCES, ONE FOLD. A bundled mod's plugin.ts is found by the glob above; a
 * mod installed as a FOLDER supplies a built plugin.js that boot imported and
 * latched (mod-code.ts). Both are ModPlugins, both are adapted by pluginAdapter,
 * and both go into the same composeModHooks call in enabled/load order - so a
 * folder mod is not a second-class citizen with its own precedence rules, which is
 * the whole point of routing it through here rather than giving it a path of its
 * own.
 *
 * A mod that is both bundled AND present as a folder contributes ONCE, from the
 * folder: a folder is what an external mod manager deploys and what the player can
 * see and edit, so it is the copy they will expect to be running. Contributing
 * twice would silently double every hook it folds.
 */
export function activeModHooks(): ModHooks | undefined {
  const entries = discoverModHookEntries();
  const folder = folderHookEntries();
  const flagsByMod = resolveModRuleFlagsByMod();
  const contributions: ModHooks[] = [];
  for (const id of enabledModIds()) {
    const flags = flagsByMod.get(id) ?? {};
    const entry = folder.get(id) ?? entries.get(id);
    if (!entry) continue;
    const hooks = entry(flags);
    /* GUARDED BEFORE THE FOLD, per mod, so the guard is the only thing that holds
     * the mod's id: core's fold sees plain ModHooks and stays ignorant of which
     * mod contributed what, which is the arrangement its comment promises. Guard
     * first and fold second also means a throwing hook reaches the fold as that
     * hook's neutral answer, so a broken mod reads to the fold exactly like a mod
     * with no opinion at that point - rather than taking the other mods' answers
     * down with it. */
    if (hooks) contributions.push(guardModHooks(hooks, (fault) => hookThrew(id, fault)));
  }
  return composeModHooks(contributions);
}

/**
 * A mod's hook threw while the game was mid-turn.
 *
 * TWO CHANNELS, because they answer different questions and are read at
 * different times. reportModFault puts it on that mod's row in the manager, where
 * the player looks when they eventually wonder what is wrong with it.
 * taintSession stops the save and gets the player told NOW - the turn they are
 * standing in has already finished half-done, and every further turn they play
 * before reloading is time they will lose.
 */
function hookThrew(id: string, fault: ModHookFault): void {
  const why = faultMessage(fault.error);
  reportModFault(
    id,
    `its ${String(fault.hook)} hook threw mid-turn, so that hook is off for the rest ` +
      `of this session and the game has stopped saving: ${why}`,
  );
  taintSession({ id, hook: String(fault.hook), why });
  console.error(`[mod:${id}] ${String(fault.hook)}() threw mid-turn:`, fault.error);
}

/**
 * The folder-loaded plugins, adapted to the same one-argument shape the bundled
 * ones get, so activeModHooks folds both identically.
 *
 * Not pluginAdapter itself, because a folder plugin's context carries the pack's
 * own files: its parsed records and the live asset resolver. A bundled mod's folder
 * is inside the app bundle and has no such report, so it gets a context with an
 * empty `data` and an `assetUrl` that resolves null.
 */
function folderHookEntries(): Map<string, ModHookEntry> {
  const out = new Map<string, ModHookEntry>();
  for (const loaded of activeModCode().plugins) {
    const hooks = loaded.plugin.hooks;
    if (!hooks) continue;
    out.set(loaded.id, (flags) => {
      try {
        return hooks.call(
          loaded.plugin,
          modPluginContext(loaded.id, flags, undefined, modOwnFiles(loaded.data)),
        );
      } catch (e) {
        reportModFault(
          loaded.id,
          `hooks() threw, so it changes no behaviour: ${faultMessage(e)}`,
        );
        console.error(`[mod:${loaded.id}] hooks() threw; contributing nothing:`, e);
        return undefined;
      }
    });
  }
  return out;
}
