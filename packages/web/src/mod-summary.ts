/**
 * The enabled mods, with their versions, for the two artefacts that name them:
 * the character dump's `[Mods enabled]` block (charsheet.ts) and the diagnostics
 * report (report.ts).
 *
 * WHY IT IS ITS OWN MODULE. It used to be a helper inside main.ts, and it was
 * WRONG for the whole time it shipped: it resolved a version out of the two
 * PLUGIN registries only, so every mod that carries no `plugin.js` - which is
 * most of them, and all of the tutorial ones - fell through to
 * "(not installed)". Measured in the running desktop build on 2026-08-20 with
 * two tutorial content packs installed, enabled, and demonstrably composed (the
 * debug object list offered `Padded Jerkin`, and creating it gave the mod's own
 * description): the dump still called both of them "(not installed)".
 *
 * That is worse than a cosmetic slip, because naming the mods is the one thing
 * this list exists to do. A dump is the artefact players hand each other, and a
 * mod's change is indistinguishable from a core bug in one; a dump that says a
 * loaded content mod is not installed points the reader at core for behaviour a
 * mod caused - the exact misdiagnosis the block was added to prevent.
 *
 * It lives here so the shipped path is the tested path. main.ts is the entry
 * module: a test cannot import it, so nothing could see what this function
 * actually returned, which is why a list that was wrong for every content-only
 * mod stayed green.
 */

import { defaultModStore } from "./mod-store";
import { discoverPlugins } from "./agents/sandbox/discover";
import { discoverTrustedPlugins } from "./agents/trusted/discover";
import { modManifestFor } from "./pack";

/** What the dump and the report each print, one line per mod. */
export interface EnabledMod {
  readonly id: string;
  readonly version: string;
}

/** The version a mod reports when nothing on this machine resolves its id. */
export const NOT_INSTALLED = "(not installed)";

/**
 * The mods that are ON, with their versions.
 *
 * Wrapped in a try because a report must survive a broken mod set - which is
 * very often the reason somebody is filing one.
 */
export function enabledModSummary(): EnabledMod[] {
  try {
    const enabled = defaultModStore().getEnabled();
    if (enabled.length === 0) return [];
    /* Re-read the registries rather than close over the boot-time ones: those
     * are block-scoped inside main.ts's auto-install try, and reaching them from
     * here would mean widening their scope for a report. Discovery is a walk
     * over static maps, so asking again costs nothing. */
    const sandbox = discoverPlugins();
    const trusted = discoverTrustedPlugins();
    return enabled.map((id) => ({
      id,
      /* THREE registries, because "installed" is three different things and the
       * first two only know about code.
       *
       * discoverPlugins/discoverTrustedPlugins glob the BUNDLED agent entries
       * (packages/web/mods/<id>/sandbox.ts and trusted.ts). modManifestFor is
       * the content-pack side (pack.ts's discoverMods): every bundled pack AND
       * every pack from the player's mods directory, a folder they picked, or a
       * repository install - with no facet filter, so it answers for a pure
       * content pack, a pure `plugin.js` pack and a hybrid alike. It is the
       * broad one; the plugin maps are kept ahead of it only because they are
       * the registries the plugin actually loaded from.
       *
       * An enabled id that resolves in NONE of them keeps saying so. That is a
       * real state - a mod turned on and then deleted, or one an external
       * manager listed and never deployed - and it is worth a line in the
       * report rather than vanishing from the list. */
      version:
        sandbox.get(id)?.manifest.version ??
        trusted.get(id)?.manifest.version ??
        modManifestFor(id)?.version ??
        NOT_INSTALLED,
    }));
  } catch {
    return [];
  }
}
