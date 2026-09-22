/**
 * `ctx.readMod`: a mod asking what another mod IS, without installing it.
 *
 * WHY THIS DOOR EXISTS. `discoverMod` (mod-discover.ts) is the whole answer to
 * "what does this repository hold": the tags call, the channel filter that
 * reuses the updater's own `channelAccepts`, the manifest read at each
 * candidate tag until one is engine-compatible, and the payload taken from a
 * declared `payload` or from the recursive tree listing. None of that reaches
 * a plugin - the context literal in mod-context.ts never mentioned it, and a
 * plugin loading as a separate module graph cannot import mod-discover.ts for
 * itself.
 *
 * THE NETWORK WAS NEVER THE OBSTACLE. There is no CSP in either front end, and
 * both `api.github.com` and `raw.githubusercontent.com` answer CORS-open, so a
 * plugin that wanted to fetch a manifest for itself already could. What it
 * could not do honestly is RESOLVE a reference: walk the tag list, apply the
 * player's channel, and pick the newest version this build can run - and a
 * plugin that reimplemented that walk would drift from it the moment either
 * copy changed, in the direction of accepting something the real install door
 * would refuse. That is the same argument that already keeps a mod from
 * shipping its own copy of the record validator (mod-sdk's `checkRecords`).
 *
 * SO THIS IS A WRAPPER, AND DELIBERATELY THIN. `createModReader` parses `ref`
 * with `parseRepoRef` and resolves it with `discoverMod` - the exact two
 * functions the mods screen's own "install from a repository" door calls -
 * and adds exactly one rule of its own: a reference that resolves to a mod
 * this build cannot run is folded into a refusal here, even though
 * `discoverMod` itself can answer `{ok: true, mod}` with `mod.compatible ===
 * false` (its own way of saying "nothing in the walked window runs, so show
 * the newest version and say why not", which is the right answer for a row on
 * a screen that can still explain itself to a player). A plugin asking what a
 * mod IS has no use for one it could not itself run, so every caller does not
 * have to re-check `mod.compatible` by hand.
 *
 * WHAT THIS IS NOT. It does not install anything, and it does not fetch every
 * file's bytes - `mod.payload` is the same listing the mods screen computes
 * before offering an install (paths and archive names, a byte total when the
 * tree could be read), not the content of each file. Getting the actual bytes
 * still means installing the mod, through `ctx.installMod` or the player's own
 * zip import; this door only answers "what is this, and would it run here".
 */

import { discoverMod, type DiscoverEnv } from "./mod-discover";
import { parseRepoRef } from "./mod-source";
import type { ReadModResult } from "./mod-plugin";

/** What a mod must hold in its manifest before it may resolve a repository reference. */
export const READ_CAPABILITY = "mod:read";

/**
 * What the host has to supply before a mod can be handed this door.
 *
 * `env` IS A FACTORY, NOT A VALUE, unlike `InstallDoorDeps.env` - and that
 * difference is deliberate rather than an inconsistency. `DiscoverEnv` carries
 * the player's update CHANNEL, which is exactly the setting `InstallDoorDeps`
 * reads through a thunk (`allowed`) so a mid-session change takes effect on
 * the very next call. Building the whole env fresh here buys the same thing
 * for `channel` without adding a second thunk field beside it.
 */
export interface ReadDoorDeps {
  readonly env: () => DiscoverEnv;
}

/**
 * Build the `ctx.readMod` a consenting mod is handed.
 *
 * NEVER THROWS. `discoverMod` already never throws - every path through it is
 * wrapped in its own try/catch (see that function's header) - so the one
 * thing added here, folding an engine-incompatible resolution into a refusal,
 * is plain data flow with nothing left that could reject.
 */
export function createModReader(
  deps: ReadDoorDeps,
): (ref: string) => Promise<ReadModResult> {
  return async (ref: string): Promise<ReadModResult> => {
    const parsed = parseRepoRef(ref);
    if (!parsed.ok) return { ok: false, problem: parsed.problem };
    const result = await discoverMod(parsed.ref, deps.env());
    if (!result.ok) return { ok: false, problem: result.problem };
    if (!result.mod.compatible) {
      return {
        ok: false,
        problem:
          result.mod.engineNote ??
          `${result.mod.repo}'s ${result.mod.tag} is not compatible with this build.`,
      };
    }
    return { ok: true, mod: result.mod };
  };
}
