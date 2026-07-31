/**
 * The shape every mod's plugin.ts has: types from the engine, values from ctx.core.
 *
 * The import below is `import type`, which esbuild erases without resolving - which is
 * why this fixture builds in a package that does not depend on the engine at all.
 */
import type { ModHooks } from "@rpgm-tools/neo-angband-core";
import { FIXTURE_MARKER } from "./helper";

export default {
  api: 1,
  hooks(ctx: { flags: Record<string, boolean> }): ModHooks | null {
    if (ctx.flags["ok-mod.on"] !== true) return null;
    return { historyAdd: () => FIXTURE_MARKER.length > 0 } as unknown as ModHooks;
  },
};
