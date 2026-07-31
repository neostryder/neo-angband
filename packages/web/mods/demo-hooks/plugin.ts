/**
 * The bundled proof that the ModHooks entry point still works.
 *
 * WHY A DEMO OWNS THIS PATH NOW. qol and bug-fixes used to be the only mods with a
 * plugin.ts, so `discoverModHookEntries` and every guard around it were exercised by
 * the mods that happened to be bundled. Both now live in their own repositories and
 * arrive as downloads, and the tests that watched this path went vacuous the moment
 * they left: a glob matching nothing passes every assertion made about what it matched.
 *
 * So the mechanism gets a mod of its own. It is `demo-*`, so a release build never
 * offers it (isShippedMod), and it is deliberately shaped like the real thing:
 *
 *  - `hooks(ctx)`, not `hooks(flags)` - the folder ABI, which is the only one a
 *    downloaded mod can use.
 *  - the engine arrives as `ctx.core`. The import below is `import type`, which esbuild
 *    erases; a VALUE import would resolve here and silently inline a second copy of
 *    engine state, which is exactly what neo-angband-mod-build refuses.
 *  - every hook is behind a flag, and with the flags off it contributes nothing rather
 *    than an empty opinion. A disabled patch does not exist.
 *
 * Two hooks on purpose, because the host folds different KINDS differently
 * (composeModHooks): an ORDERING hook that stops at the first non-zero answer, and a
 * TRANSFORM hook that composes in load order.
 */

import type { ModHooks } from "@rpgm-tools/neo-angband-core";

interface HooksContext {
  readonly flags: Readonly<Record<string, boolean>>;
  /* The engine namespace, handed in. Typed to just what this mod uses rather than to
   * the whole module: a demo that names one function is clearer about the pattern than
   * one that imports the world for its types. */
  readonly core: {
    readonly objectListStandardCompare: (
      a: Parameters<NonNullable<ModHooks["objectListTiebreak"]>>[0],
      b: Parameters<NonNullable<ModHooks["objectListTiebreak"]>>[1],
    ) => number;
  };
}

export default {
  api: 1,
  hooks(ctx: HooksContext): ModHooks | null {
    const { flags, core } = ctx;
    const hooks: ModHooks = {};

    if (flags["demo-hooks.tiebreak"] === true) {
      /* Delegation rather than reimplementation, which is the habit worth demonstrating:
       * a comparator written out here would drift from the engine's. */
      hooks.objectListTiebreak = (a, b) => core.objectListStandardCompare(a, b);
    }

    if (flags["demo-hooks.shout"] === true) {
      hooks.messageText = (raw) => raw.toUpperCase();
    }

    /* Null, not {}. An empty contribution and no contribution are indistinguishable in
     * effect and different in kind, and core's composeModHooks returns undefined for the
     * empty case so that every call site stays one undefined check on its faithful path. */
    return Object.keys(hooks).length === 0 ? null : hooks;
  },
};
