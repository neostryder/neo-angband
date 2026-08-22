/**
 * `ctx.installMod`: a mod handing the game a mod.
 *
 * WHY THIS DOOR EXISTS. `ModProject` (`packages/mod-sdk/src/project.ts`) has
 * emitted `manifest.json` plus one JSON file per record file since it was
 * written, and its own header names the caller it was waiting for - "a builder
 * that returned paths and contents is equally usable from a CLI, from a test,
 * and from an in-game mod editor". There was no in-game anything, because there
 * was no way for a mod to land bytes as an installed mod: `HostDir` has no
 * `MODS` entry, `RAW_FS_OPS` has no `mkdir`, the desktop loopback server has no
 * write route into `mods/`, and installs go to IndexedDB rather than to a
 * filesystem at all. `installModFromZip` was the one function that turns bytes
 * into an installed mod, and it was host-only.
 *
 * SO THIS IS A WRAPPER, AND DELIBERATELY THIN. Everything that makes an install
 * safe already runs inside that function and is not re-implemented here: the
 * third-party consent switch is checked before the archive is even opened, the
 * zip ceilings and the zip-slip check run on the entries, `checkMod` runs the
 * same standards inspection the author's own CLI runs, and the mod's origin is
 * pinned on first import and compared on every later one. A second notion of
 * "installed" is how a mod system comes to have two answers to every question.
 *
 * WHAT IS ADDED HERE IS TWO REFUSALS AND A COPY.
 *
 * FIRST, IT IS CONTENT ONLY. An archive that ships executable code, or whose
 * manifest asks for any capability, is refused - and this is the single thing
 * that makes the grant proportionate rather than total. Without it, "may install
 * a mod" reads as "may write code, install it, and have the player enable
 * something it authored", which is a far larger sentence than the one the player
 * agreed to. With it, the grant is what it says: this mod can add CONTENT to
 * your library. A content pack is validated JSON that cannot execute, which is
 * the first of the three trust tiers (docs/modding/MOD_LIFECYCLE.md), and it is
 * also exactly what an in-game authoring tool can honestly produce - there is no
 * bundler in a browser tab, so a builder that claimed to write code would be
 * writing a fixed template and calling it authorship.
 *
 * SECOND, THE BYTES ARE COPIED before anything asynchronous happens. The caller
 * still holds the `Uint8Array` it passed, and the install reads it across
 * several awaits; validating one buffer and storing another is the shape of that
 * bug, and it is a copy rather than a warning in a doc comment.
 *
 * INSTALLING IS NOT ENABLING, and that is the load-bearing fact about the whole
 * capability rather than a detail of this file. The arriving mod lands in
 * IndexedDB, listed exactly as a downloaded one is, and switched OFF: the
 * enabled set is separate storage and the rule is that no mod is enabled by
 * default (`mod-store.ts`). So the player still meets it on the Mods screen, is
 * still shown its own capability list in plain language, and still has to say
 * yes. One mod's grant cannot become another mod's grant that way, which is the
 * escalation this door would otherwise have opened.
 *
 * THIRD, THE HOST'S WORDS TRAVEL WITH THE ANSWER. Every outcome carries `lines`:
 * the very lines the mod manager prints for the same install, built by
 * `installOutcomeLines` and `installFailureLines` and carrying, under a standards
 * refusal, `requirementsRefusal`'s summary and `MOD_CHECK_ADVICE`'s closing line.
 * A mod that fails a requirement must fail in the same words a downloaded mod
 * fails in, or a player learns two vocabularies for one concept and stops
 * trusting both. Returning the lines rather than a code is what makes that cost
 * nothing.
 *
 * AND THE RELOAD IS HERE TOO, behind the same capability rather than one of its
 * own - see `createModReload` for why installing and applying are one act.
 *
 * WHAT IS STILL A DECLARATION RATHER THAN A FENCE, said here because the honest
 * version of this file has to say it: the stores this writes are ordinary
 * same-origin browser storage, and a plugin runs in the page. A mod that means
 * to can reach IndexedDB itself. The value of the door is that a mod using it
 * gets the validation, the origin pin and the digest for free, and that a player
 * reading the consent list was told - the same account every capability in this
 * system gives of itself (docs/modding/PLUGINS.md, "What a capability gates").
 */

import { installedMeta, installModFromZip, type InstallEnv } from "./mod-install";
import { installFailureLines, installOutcomeLines } from "./mod-browse";
import { readModZip, type ZipRead } from "./mod-zip";
import { sessionSurvivesReload, stageSessionMod } from "./mod-session";
import type { ModInstallOutcome, ModSessionOutcome } from "./mod-plugin";
import type { Finding } from "@rpgm-tools/neo-angband-mod-sdk";

/** What a mod must hold in its manifest before it may install another mod. */
export const INSTALL_CAPABILITY = "mod:install";

/**
 * What a mod must hold before it may load one into this session only.
 *
 * A SEPARATE GRANT, not a relaxation of the one above. The install door's consent
 * sentence is proportionate because what arrives is switched OFF and waits for the
 * player; a session load is switched ON the moment the game reloads. That is more
 * than the install line describes, so it cannot be sold under it - and the SDK's
 * `grantCovers` compares the action so neither string can carry the other.
 *
 * What it is NOT is a weaker security requirement. The archive is forgotten at the
 * end of the session; the records it composed were as real as any, and a character
 * that met them keeps whatever they did to it. Every sentence this door produces
 * says that, because "only for this session" reads as "so it cannot do much".
 */
export const SESSION_CAPABILITY = "mod:session";

/**
 * File extensions that make an archive a CODE mod rather than a content pack.
 *
 * By extension rather than by the manifest's `shape`, because the manifest is
 * the thing being checked: a pack declaring `shape: "content"` while shipping a
 * `plugin.js` is precisely the archive this refusal is for. `.mjs` and `.cjs`
 * are here because the loader resolves a relative specifier and a folder may
 * hold as many scripts as it likes, so `plugin.js` is not the only name code
 * arrives under. `.json` is not code, `.png` is not code, and neither is any of
 * the resource kinds - a content mod that ships a tile pack is refused by the
 * emitter's own limits (`EmittedFile.contents` is a string) long before it gets
 * here, so nothing turns on the list being exhaustive about binaries.
 */
const CODE_SUFFIXES = [".js", ".mjs", ".cjs", ".ts", ".wasm"] as const;

/**
 * Why this archive may not go through this door, or null when it may.
 *
 * Read from the archive rather than from what the caller says about it, and
 * separately from `installModFromZip`'s own reading - which costs one extra
 * unzip of an archive already bounded by the zip ceilings, and buys a refusal
 * that names the file rather than a mod that installs and then cannot be
 * enabled.
 */
export function contentOnlyRefusal(bytes: Uint8Array): string | null {
  const read = readModZip(bytes);
  if (!read.ok) return read.problem;
  return contentOnlyFault(read);
}

/**
 * The same judgement over an archive somebody has already read.
 *
 * SPLIT OUT SO THE ID SURVIVES. A refusal the install door returns is printed in
 * the manager's own words, and those words start with the mod's NAME - which the
 * archive knows and a `string | null` does not. Re-reading the zip to recover it
 * would be a third unzip of the same bytes, and a second call to `readModZip`
 * whose answer this one is trusted to agree with.
 */
function contentOnlyFault(read: Extract<ZipRead, { ok: true }>): string | null {
  const code = read.files
    .map(([path]) => path)
    .filter((path) => CODE_SUFFIXES.some((suffix) => path.toLowerCase().endsWith(suffix)));
  if (code.length > 0) {
    return (
      `${read.id}: this door installs CONTENT mods only, and the archive ships code (${code.join(", ")}). ` +
      `A mod may add records, patches and removals to your library; writing a mod that RUNS is something ` +
      `the player does through the Mods screen, so they can read what it asks for first`
    );
  }
  const manifest = manifestCapabilities(read.files);
  if (manifest === null) {
    return `${read.id}: the archive's manifest.json could not be read as JSON`;
  }
  if (manifest.length > 0) {
    return (
      `${read.id}: this door installs CONTENT mods only, and the archive's manifest asks for ` +
      `${manifest.length === 1 ? "a capability" : "capabilities"} (${manifest.join(", ")}). ` +
      `A content pack is validated data and needs none`
    );
  }
  return null;
}

/**
 * The `capabilities` the archive's manifest requests, or null when the manifest
 * will not parse.
 *
 * A missing manifest is NOT this function's refusal to write: `readModZip`
 * already requires one to find the mod folder at all, and `installModFromZip`
 * refuses an archive without one in its own words. Anything shaped unexpectedly
 * reads as "asks for nothing", because the standards inspection downstream is
 * what judges a malformed manifest and it says so better than this could.
 */
function manifestCapabilities(
  files: ReadonlyArray<readonly [string, Uint8Array]>,
): readonly string[] | null {
  const entry = files.find(([path]) => path.toLowerCase() === "manifest.json");
  if (!entry) return [];
  try {
    const parsed = JSON.parse(new TextDecoder().decode(entry[1])) as {
      readonly capabilities?: unknown;
    };
    const caps = parsed.capabilities;
    if (!Array.isArray(caps)) return [];
    return caps.map((cap) => String(cap));
  } catch {
    return null;
  }
}

/** What the host has to supply before a mod can be handed this door. */
export interface InstallDoorDeps {
  /** The same env every other install path is given. */
  readonly env: InstallEnv;
  /** Whether the player's third-party switch is on, read at the moment of use. */
  readonly allowed: () => boolean;
  /**
   * The host's own mod-change reload: tear the plugins down, write the live
   * character, and bring the page back on the same character.
   *
   * REQUIRED RATHER THAN OPTIONAL, so a boot path cannot latch a door that
   * installs and then cannot apply. An optional field would degrade to
   * `ctx.reloadGame: undefined`, which a mod cannot tell apart from a capability
   * the player never granted - the failure `mod-context.ts` already carries two
   * comments about. The compiler is a cheaper reminder than either.
   */
  readonly reload: () => void;
}

/**
 * The host's wording for an install outcome, flattened to plain strings.
 *
 * FROM THE MANAGER'S OWN BUILDERS, never restated here. `installFailureLines`
 * and `installOutcomeLines` are what the Mods screen prints, and a requirements
 * refusal carries `requirementsRefusal`'s summary and `MOD_CHECK_ADVICE`'s
 * closing line through them. Colour is dropped because a mod's surface is its
 * own; the words are not.
 */
function refusalLines(
  name: string,
  problem: string,
  unmet: readonly Finding[] = [],
): readonly string[] {
  return Object.freeze(installFailureLines(name, problem, unmet).map((line) => line.text));
}

/** What a refusal calls an archive whose own manifest it could not read. */
const UNREADABLE_ARCHIVE = "That archive";

/**
 * Build the `ctx.installMod` a consenting mod is handed.
 *
 * NEVER THROWS AND NEVER REJECTS. Every refusal comes back as
 * `{ ok: false, problem }` with one whole sentence in it, because the caller is
 * a mod that will be showing this to a player: a thrown error would arrive in
 * devtools, which is not a channel a player has, and it would arrive in the
 * middle of whatever the mod was doing rather than as the answer to what it
 * asked.
 */
export function createModInstaller(deps: InstallDoorDeps): (bytes: Uint8Array) => Promise<ModInstallOutcome> {
  return async (bytes: Uint8Array): Promise<ModInstallOutcome> => {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      const problem = "installMod needs the bytes of a mod archive";
      return { ok: false, problem, lines: refusalLines(UNREADABLE_ARCHIVE, problem) };
    }
    /* COPIED, exactly-sized, before anything asynchronous runs. The caller still
     * holds the array it passed and the install reads it across several awaits;
     * checking one buffer and storing another is the bug this forecloses, and a
     * copy is cheaper than reasoning about whether anybody would. */
    const own = new Uint8Array(bytes);
    try {
      /* Read here rather than inside `contentOnlyRefusal`, for the mod's ID: the
       * manager's wording names the mod, and a refusal that called every archive
       * "that archive" would be the one place this door speaks differently from
       * the screen it is borrowing its words from. */
      const read = readModZip(own);
      if (!read.ok) {
        return {
          ok: false,
          problem: read.problem,
          lines: refusalLines(UNREADABLE_ARCHIVE, read.problem),
        };
      }
      const refusal = contentOnlyFault(read);
      if (refusal !== null) {
        return { ok: false, problem: refusal, lines: refusalLines(read.id, refusal) };
      }
      /* What is on disk BEFORE, so the outcome can say "installed" or "updated
       * 1.0.0 -> 1.1.0" in the manager's own words. Read here because the answer
       * stops being available the moment the install writes over it. */
      const before = await installedMeta(read.id, deps.env.scope ?? globalThis);
      const result = await installModFromZip(own, deps.env, deps.allowed());
      if (!result.ok) {
        return {
          ok: false,
          problem: result.problem,
          lines: refusalLines(read.id, result.problem, result.unmet ?? []),
        };
      }
      return {
        ok: true,
        id: result.meta.id,
        version: result.meta.tag,
        /* `enabled: false` is a fact, not a default. This door never enables
         * anything - that is what keeps the grant the size of its sentence - so
         * the lines are the ones the manager prints when the player declined the
         * offer, which say the mod is off until they turn it on. */
        lines: Object.freeze(
          installOutcomeLines(
            read.id,
            result.meta.tag,
            before === null ? null : before.tag,
            result.meta.tag,
            false,
          ).map((line) => line.text),
        ),
      };
    } catch (err) {
      /* An install that threw is an install that did not happen, and the mod
       * asking has to be able to say so to the player without knowing which of
       * IndexedDB's dozen failure modes it hit. */
      const problem = `the install failed: ${err instanceof Error ? err.message : String(err)}`;
      return { ok: false, problem, lines: refusalLines(UNREADABLE_ARCHIVE, problem) };
    }
  };
}

/**
 * Build the `ctx.reloadGame` a consenting mod is handed.
 *
 * BEHIND `mod:install`, NOT A CAPABILITY OF ITS OWN, and the reason is that the
 * two are one act rather than two. Content composes at load, so an install that
 * cannot be followed by a reload leaves the player holding a mod this process
 * will never load; and a mod with nothing to apply has no reason to reload
 * anybody's game. Splitting them would produce a consent line describing half of
 * something, which is the failure `grantCovers` exists to stop in the other
 * direction.
 *
 * WHAT IT IS NOT is permission to reload. A plugin runs in the page and reaches
 * `location` with no grant at all (capabilities.ts's header, and
 * capability-gate-reach.test.ts's measurement). What the host supplies is the
 * SEQUENCE: every plugin's `uninstall()`, the autoplayer's keyboard handed back,
 * the live character written down, and the session marked to resume that
 * character. A mod calling `location.reload()` itself skips all four, and the
 * fourth is the one a player notices.
 *
 * THE PROMISE RESOLVES rather than hanging. The page is going away, so nothing
 * after the await is guaranteed to run - but a promise that never settled would
 * be untestable, would strand a caller's own `finally`, and would report a reload
 * that was refused as one that is still in progress.
 */
export function createModReload(deps: InstallDoorDeps): () => Promise<void> {
  return (): Promise<void> => {
    deps.reload();
    return Promise.resolve();
  };
}

/**
 * Build the `ctx.loadModForSession` a consenting mod is handed.
 *
 * THE SAME DOOR WITH THE LIBRARY STEP REMOVED. It refuses everything the install
 * door refuses, through the same functions - `contentOnlyRefusal` here, and then
 * the third-party switch, the zip ceilings, the zip-slip check, the origin pin and
 * `checkMod` inside `stageSessionMod`. A session load that accepted an archive the
 * install door turns away would teach an author that a passing test means nothing.
 *
 * WHAT IT SWAPS. An install writes to IndexedDB and lands switched off; this writes
 * to session storage and is on as soon as the game reloads. So the two differ in
 * how long the archive is remembered and in who has to press what next, and in
 * nothing else - not in what the records may do once they are in the game.
 *
 * NEVER THROWS AND NEVER REJECTS, for the reason the installer does not: the caller
 * is a mod that will be showing this to a player, and devtools is not a channel a
 * player has.
 */
export function createModSessionLoader(
  deps: InstallDoorDeps,
): (bytes: Uint8Array) => Promise<ModSessionOutcome> {
  return async (bytes: Uint8Array): Promise<ModSessionOutcome> => {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      return { ok: false, problem: "loadModForSession needs the bytes of a mod archive" };
    }
    /* COPIED before anything asynchronous runs, for the reason the installer copies:
     * the caller still holds the array it passed. */
    const own = new Uint8Array(bytes);
    try {
      const refusal = contentOnlyRefusal(own);
      if (refusal !== null) return { ok: false, problem: refusal };
      const scope = deps.env.scope ?? globalThis;
      const staged = await stageSessionMod(
        {
          bytes: own,
          /* Named for the player, in the manager's list. A mod cannot choose this
           * wording: a source line that a mod could write would be a place to
           * claim the archive came from somewhere it did not. */
          source: "a mod, for this session",
          /* NOTHING GRANTED. A content pack asks for no capabilities - the door
           * above refuses one that does - so there is nothing to grant, and an
           * empty list here is what makes that true rather than assumed. */
          granted: [],
          contentOnly: true,
          allowed: deps.allowed(),
        },
        scope,
      );
      if (!staged.ok) return { ok: false, problem: staged.problem };
      return {
        ok: true,
        id: staged.mod.id,
        version: staged.mod.version ?? "unversioned",
        survivesReload: sessionSurvivesReload(scope),
      };
    } catch (err) {
      return {
        ok: false,
        problem: `loading it for this session failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
}
