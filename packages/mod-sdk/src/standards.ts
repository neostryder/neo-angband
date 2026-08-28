/**
 * The requirements a mod must meet, as executable rules rather than prose.
 *
 * WHY THIS EXISTS. "Tell authors exactly what they need" has an obvious wrong
 * implementation: write it down. A document is not behaviour - it goes stale the
 * first time the loader gains a rule, and an author who followed it is then wrong
 * through no fault of their own. So the requirements live here, each one a function
 * that can be run against a real mod, and everything else is derived:
 *
 *   - `neo-angband-mod-check` runs them, so an author can see the answer before
 *     publishing rather than after somebody's install fails.
 *   - the game runs them at install time, so a mod that cannot work is refused with
 *     the reason instead of being stored and silently skipped.
 *   - docs/modding/REQUIREMENTS.md is GENERATED from this list, so the document
 *     cannot describe a rule that is not enforced or omit one that is.
 *
 * WHAT IT DOES NOT DUPLICATE. Everything validateManifest already decides is
 * delegated to validateManifest. This module adds only the rules that need to see
 * something the manifest validator cannot: the FILE LIST. That is not a small
 * addition - two of the rules below are defects this project actually shipped, both
 * invisible to a validator with no files to look at:
 *
 *   - `modApi` is documented as REQUIRED of any pack shipping plugin.js, and nothing
 *     enforced it, because validateManifest never sees whether plugin.js is there.
 *   - a mod whose payload is committed .zip archives must DECLARE them, or the
 *     installer stores the zips unopened and the mod is present and dead. Found on
 *     Linoleum by a live canary, after it had shipped that way.
 *
 * A rule is either `required` - the mod cannot work, and an install is refused - or
 * `recommended`, which is advice and never blocks anything. Nothing in between: a
 * "warning" tier that sometimes blocks is how a check becomes something authors
 * learn to ignore.
 */

import { compareSemver, satisfies } from "./semver.js";
import { ManifestError, hasFacet, validateManifest, type PackManifest } from "./manifest.js";

/** The file a mod's code lives in, when it has any. */
export const PLUGIN_FILE = "plugin.js";

/**
 * The `owner/name` a repository URL points at, when the game can query it, else null.
 *
 * WHY A FUNCTION AND NOT A REGEX AT EACH CALL SITE. Three things need this answer and
 * need the SAME answer: the requirement below, which refuses a manifest that names
 * nowhere; the installer, which records a mod's origin so it can only ever be replaced
 * from where it came from; and the update check, which asks a repository what tags it
 * has. Two of those disagreeing is a mod that installs and then reports itself
 * unavailable forever, which is worse than either failure alone.
 *
 * ONLY GITHUB, and that is a statement about the game rather than about mods. The tags
 * query, the raw-file URL and the author register are all GitHub-shaped today. A mod
 * hosted anywhere else is a perfectly good mod - it simply has no update check yet, so
 * this returns null and the caller falls back to saying so out loud. Refusing such a
 * mod would make this function a gate on where people may host, which it must not be.
 *
 * Accepts every spelling an author is likely to reach for, because the alternative is
 * a rule that fails on a manifest that is obviously correct to a human:
 *
 *     https://github.com/owner/name        git+https://github.com/owner/name.git
 *     http://github.com/owner/name/        git@github.com:owner/name.git
 *     github:owner/name                    owner/name
 */
export function githubRepo(repository: string): string | null {
  const text = repository.trim();
  if (text === "") return null;
  /* Everything is reduced to the `owner/name` tail before one check, rather than one
   * regex per spelling: a second pattern is a second thing to keep in step. */
  const tail =
    /^(?:git\+)?https?:\/\/(?:www\.)?github\.com\/(.+)$/iu.exec(text)?.[1] ??
    /^git@github\.com:(.+)$/iu.exec(text)?.[1] ??
    /^github:(.+)$/iu.exec(text)?.[1] ??
    (text.includes("://") || text.includes("@") ? null : text);
  if (tail === null) return null;
  const parts = tail
    .replace(/\.git$/iu, "")
    .replace(/\/+$/u, "")
    .split("/");
  /* Exactly two segments. A `tree/v1.0.0` or `blob/master/x` suffix is a URL to a PAGE
   * inside the repository, and silently truncating it to the first two segments would
   * accept a link to one file as if it named the project. */
  if (parts.length !== 2) return null;
  const [owner, name] = parts as [string, string];
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(owner)) return null;
  if (!/^[A-Za-z0-9._-]{1,100}$/u.test(name) || name === "." || name === "..") return null;
  return `${owner}/${name}`;
}

/** The manifest, at the root of the mod folder. Not negotiable; readModDir needs it. */
export const MANIFEST_FILE = "manifest.json";

export type RequirementLevel = "required" | "recommended";

/** What the checker is given: a mod folder, described. */
export interface ModUnderTest {
  /**
   * Every file in the mod folder, relative to it, with `/` separators.
   *
   * For a mod whose payload is archives this must be the UNPACKED list - the paths
   * as they will exist once installed. A rule about "does this mod ship plugin.js"
   * is meaningless against a list containing only `dist/pack.zip`.
   */
  readonly files: readonly string[];
  /** The bytes of manifest.json as text, or null when there is none. */
  readonly manifestText: string | null;
  /**
   * Paths in the REPOSITORY, before unpacking, when they are known and differ from
   * `files`. Only the archive rule uses it: it is the one question that has to be
   * asked of the repository rather than of the installed folder.
   */
  readonly repoFiles?: readonly string[];
  /** The payload the manifest declared, when the caller has already read it. */
  readonly declaredPayload?: { readonly files?: readonly string[]; readonly archives?: readonly string[] };
}

export interface Requirement {
  /** A stable slug. Referenced by the generated document and by a suppression. */
  readonly id: string;
  readonly level: RequirementLevel;
  /** One line, in the imperative, as an author would read it in a checklist. */
  readonly title: string;
  /** Why the rule exists. An author who understands it can satisfy it in their own way. */
  readonly why: string;
  /** null when satisfied; otherwise what is wrong, naming the field or file. */
  check(mod: ModUnderTest): string | null;
}

export interface Finding {
  readonly id: string;
  readonly level: RequirementLevel;
  readonly title: string;
  readonly problem: string;
}

export interface CheckReport {
  /** Failed `required` rules. A non-empty list means the mod cannot work. */
  readonly errors: readonly Finding[];
  /** Failed `recommended` rules. Advice; never blocks an install. */
  readonly advice: readonly Finding[];
  /** True when nothing required failed. */
  readonly ok: boolean;
}

/** The parsed manifest, or null. Kept private so each rule cannot re-parse. */
function manifestObject(mod: ModUnderTest): Record<string, unknown> | null {
  if (mod.manifestText === null) return null;
  try {
    const v: unknown = JSON.parse(mod.manifestText);
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const hasFile = (mod: ModUnderTest, name: string): boolean =>
  mod.files.some((f) => f === name);

/**
 * Every requirement, in the order an author meets them.
 *
 * Ordered deliberately: a mod with no manifest fails one rule, not fifteen. A report
 * that lists every downstream consequence of one missing file teaches an author to
 * skim it.
 */
export const MOD_REQUIREMENTS: readonly Requirement[] = [
  {
    id: "manifest-present",
    level: "required",
    title: `Ship ${MANIFEST_FILE} at the root of the mod folder`,
    why:
      "It is how the game recognises a folder as a mod at all. A folder without one " +
      "is not loaded, not listed, and not reported as broken - it is simply not a mod.",
    check: (mod) =>
      hasFile(mod, MANIFEST_FILE)
        ? null
        : `no ${MANIFEST_FILE} at the root (found: ${
            mod.files.slice(0, 5).join(", ") || "nothing"
          })`,
  },
  {
    id: "manifest-json",
    level: "required",
    title: `Make ${MANIFEST_FILE} valid JSON`,
    why: "It is read before anything else. A trailing comma stops the whole mod loading.",
    check: (mod) => {
      if (mod.manifestText === null) return null; // manifest-present says this
      try {
        const v: unknown = JSON.parse(mod.manifestText);
        if (typeof v !== "object" || v === null || Array.isArray(v)) {
          return "the top level must be a JSON object";
        }
        return null;
      } catch (e) {
        return `not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  },
  {
    id: "manifest-fields",
    level: "required",
    title: "Declare id, name, version and shape, and nothing malformed",
    why:
      "These four are what the manager lists and what the loader keys everything by. " +
      "The check is the game's OWN validator, so this cannot pass here and fail there.",
    check: (mod) => {
      const m = manifestObject(mod);
      if (m === null) return null; // an earlier rule owns this
      try {
        /* Delegated, not re-implemented. Every field rule - kebab-case ids, semver
         * versions, the shape enum, facets containing shape, dependency maps - lives
         * in validateManifest, and a second copy here would be a second copy that
         * learns. This is the whole reason the checker is in the SDK. */
        validateManifest(m);
        return null;
      } catch (e) {
        return e instanceof ManifestError ? e.message : String(e);
      }
    },
  },
  {
    id: "declare-a-repository",
    level: "required",
    title: "Say where the mod lives, in `repository`",
    why:
      "It is the mod's identity across every way of getting it. The game pins an " +
      "installed mod to the repository it came from and will not let a different one " +
      "replace it, so a mod that names nowhere can be quietly overwritten by anything " +
      "that claims its id. It is also the only route by which an update can ever be " +
      "offered, and the only thing a player has to go and read about the mod. " +
      "Required of an archive exactly as it is of a checkout: a mod handed over as a " +
      "zip is the same mod, and it must not be able to arrive knowing less about " +
      "itself than the same files fetched from a repository would.",
    check: (mod) => {
      const m = manifestObject(mod);
      if (m === null) return null; // an earlier rule owns this
      const repo = m["repository"];
      if (repo === undefined) return "no repository declared";
      if (typeof repo !== "string" || repo.trim() === "") {
        return "repository must be the URL the mod is published at";
      }
      /* A non-GitHub URL PASSES. The game cannot query it for updates yet, and
       * `updates-can-be-offered` says so as advice - but where a mod is hosted is the
       * author's business, and a required rule that refused GitLab would make this
       * project's convenience into somebody else's rule. What is refused is text that
       * names no repository at all. */
      if (githubRepo(repo) !== null) return null;
      return /^(?:[a-z][a-z0-9+.-]*:\/\/|git@)/iu.test(repo.trim())
        ? null
        : `"${repo}" is not a repository URL`;
    },
  },
  {
    id: "credit-an-author",
    level: "required",
    title: "Name the author",
    why:
      "The game shows it beside the mod's name, so a player can tell two mods of the " +
      "same name apart and knows whose work they are about to run. A row with no " +
      "author is a row that asks somebody to trust nobody in particular. Use the name " +
      "you want shown - it shares a line with the mod's name and version, so keep it " +
      "short; anything longer belongs in `description`.",
    check: (mod) => {
      const m = manifestObject(mod);
      if (m === null) return null;
      const author = m["author"];
      if (author === undefined) return "no author declared";
      if (typeof author !== "string" || author.trim() === "") {
        return "author must be the name to show beside the mod";
      }
      return null;
    },
  },
  {
    id: "engine-range",
    level: "required",
    title: "Declare the engine range the mod was written against",
    why:
      "Without it the mod is offered to every version of the game forever, including " +
      "the one that changes the thing it depends on. With it, a player is told the " +
      "mod is too old instead of watching it misbehave. This was advice until it was " +
      "measured: every mod that had shipped declared one, and the mods that did not " +
      "were the ones nothing had checked.",
    check: (mod) => {
      const m = manifestObject(mod);
      if (m === null) return null;
      const engine = m["engine"];
      if (engine === undefined) return "no engine range declared";
      if (typeof engine !== "string" || engine === "") return "engine must be a version range";
      try {
        /* Asked through `satisfies`, the same function the loader gates on, rather
         * than a range parser of this module's own. The version is arbitrary - the
         * answer is discarded and only a throw is interesting. */
        satisfies("1.0.0", engine);
        return null;
      } catch (e) {
        return `engine range cannot be read: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  },
  {
    id: "plugin-declares-modapi",
    level: "required",
    title: `Declare modApi if the mod ships ${PLUGIN_FILE}`,
    why:
      "The host refuses an incompatible plugin BEFORE importing it, which it can only " +
      "do from the manifest - a version check inside the module runs after the " +
      "module's top-level code already has. Without modApi there is nothing to check " +
      "against, and the mod's code is loaded on faith.",
    check: (mod) => {
      if (!hasFile(mod, PLUGIN_FILE)) return null;
      const m = manifestObject(mod);
      if (m === null) return null;
      const api = m["modApi"];
      if (typeof api === "number" && Number.isInteger(api) && api > 0) return null;
      return `ships ${PLUGIN_FILE} but declares no modApi`;
    },
  },
  {
    id: "plugin-declares-facet",
    level: "required",
    title: `Say the mod contains code, if it ships ${PLUGIN_FILE}`,
    why:
      "The manager tells a player whether a mod is data or code, and that answer " +
      "decides how much they are trusting. A mod shipping code while presenting as " +
      "content is misleading whether or not the author meant it to be.",
    check: (mod) => {
      if (!hasFile(mod, PLUGIN_FILE)) return null;
      const m = manifestObject(mod);
      if (m === null) return null;
      /* hasFacet, not a hand-rolled shape-or-facets test. The load-time gate in
       * mod-code.ts asks the same question through the same function, so this cannot
       * pass a mod that the loader will then refuse - which is the only thing that
       * makes checking at install time worth doing at all. */
      return hasFacet(m as unknown as PackManifest, "plugin")
        ? null
        : `ships ${PLUGIN_FILE} but neither shape nor facets says "plugin"`;
    },
  },
  {
    id: "archives-declared",
    level: "required",
    title: "Declare committed .zip archives in payload.archives",
    why:
      "Nothing can tell from a file list whether a .zip is a pack to UNPACK or a file " +
      "to store as-is - only the manifest can say. An undeclared archive is installed " +
      "unopened, so the mod is present, listed, enabled, and does nothing.",
    check: (mod) => {
      /* Asked of the REPOSITORY, because after unpacking the zips are gone and the
       * question no longer has an answer. This is the rule that had already shipped
       * broken on a real mod. */
      const repo = mod.repoFiles;
      if (repo === undefined) return null;
      const zips = repo.filter((f) => f.toLowerCase().endsWith(".zip"));
      if (zips.length === 0) return null;
      const declared = mod.declaredPayload?.archives ?? [];
      const missing = zips.filter((z) => !declared.includes(z));
      return missing.length === 0
        ? null
        : `${String(missing.length)} committed .zip file(s) are not in payload.archives: ` +
          `${missing.slice(0, 4).join(", ")}`;
    },
  },
  {
    id: "updates-can-be-offered",
    level: "recommended",
    title: "Publish somewhere the game can check for updates",
    why:
      "`repository` may name any host, and the game will install the mod from a zip " +
      "either way - but the only host it can ASK for newer versions is GitHub. A mod " +
      "published elsewhere is listed with a note saying it cannot be checked, and its " +
      "players update it by hand or not at all. This is a limitation of the game, not " +
      "a judgement about the host.",
    check: (mod) => {
      const m = manifestObject(mod);
      if (m === null) return null;
      const repo = m["repository"];
      if (typeof repo !== "string" || repo.trim() === "") return null; // required rule owns this
      return githubRepo(repo) === null
        ? `"${repo}" is not a GitHub repository, so no update can be offered from it`
        : null;
    },
  },
  {
    id: "version-orderable",
    level: "recommended",
    title: "Use a version the update check can order",
    why:
      "Updates are offered by comparing versions. One that cannot be ordered against " +
      "its predecessor is never reported as newer, so the mod silently stops updating.",
    check: (mod) => {
      const m = manifestObject(mod);
      if (m === null) return null;
      const v = m["version"];
      if (typeof v !== "string") return null; // manifest-fields owns this
      return compareSemver(v, v) === null
        ? `version "${v}" cannot be ordered, so no update will ever be offered`
        : null;
    },
  },
  {
    id: "describe-itself",
    level: "recommended",
    title: "Write a description",
    why:
      "It is the only thing a player has to decide by, since nothing else in the game " +
      "knows what the mod does. A row with no description is a row nobody installs.",
    check: (mod) => {
      const m = manifestObject(mod);
      if (m === null) return null;
      const d = m["description"];
      return typeof d === "string" && d.trim().length >= 20
        ? null
        : "no description, or one too short to tell a player anything";
    },
  },
  {
    id: "state-a-licence",
    level: "recommended",
    title: "State a licence",
    why:
      "A mod with no licence cannot legally be redistributed by anyone, including a " +
      "player sharing their setup. Converting somebody else's art has its own terms " +
      "on top of that.",
    check: (mod) => {
      const m = manifestObject(mod);
      const declared = typeof m?.["license"] === "string" && m["license"] !== "";
      const shipped = mod.files.some((f) => /^licen[cs]e(\.[a-z]+)?$/iu.test(f));
      return declared || shipped ? null : "no license field and no LICENCE file";
    },
  },
];

/**
 * Run every requirement.
 *
 * Deliberately gives back a report rather than throwing: an author wants the whole
 * list at once, and the installer wants to refuse with the reason. A rule that throws
 * unexpectedly is caught and reported as that rule failing, because one broken check
 * must not stop the other nine from being useful.
 */
export function checkMod(mod: ModUnderTest): CheckReport {
  const errors: Finding[] = [];
  const advice: Finding[] = [];
  for (const req of MOD_REQUIREMENTS) {
    let problem: string | null;
    try {
      problem = req.check(mod);
    } catch (e) {
      problem = `the check itself failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (problem === null) continue;
    const finding: Finding = {
      id: req.id,
      level: req.level,
      title: req.title,
      problem,
    };
    (req.level === "required" ? errors : advice).push(finding);
  }
  return { errors, advice, ok: errors.length === 0 };
}

/**
 * The requirements as Markdown - the source of docs/modding/REQUIREMENTS.md.
 *
 * Generated rather than hand-written so the document cannot describe a rule that is
 * not enforced, or omit one that is. A test asserts the committed file matches this
 * output, which is what makes that claim true rather than intended.
 */
export function requirementsMarkdown(): string {
  const section = (level: RequirementLevel): string =>
    MOD_REQUIREMENTS.filter((r) => r.level === level)
      .map((r) => `### ${r.title}\n\n\`${r.id}\`\n\n${r.why}\n`)
      .join("\n");

  return [
    "<!-- GENERATED from packages/mod-sdk/src/standards.ts - do not edit by hand. -->",
    "<!-- Run: node packages/mod-sdk/bin/neo-angband-mod-check.mjs --write-docs -->",
    "",
    "# What a mod must provide",
    "",
    "Every rule below is CODE, in `packages/mod-sdk/src/standards.ts`. The same",
    "function that generated this page is the one the game runs when it installs a",
    "mod, and the one `neo-angband-mod-check` runs for you before you publish. So",
    "this page cannot fall behind the game: if a rule changes, this text changes with",
    "it, and a test fails if it does not.",
    "",
    "Check your mod:",
    "",
    "```",
    "npx neo-angband-mod-check path/to/your-mod",
    "```",
    "",
    "## Required",
    "",
    "A mod that fails any of these cannot work, and the game refuses to install it.",
    "",
    section("required"),
    "## Recommended",
    "",
    "Advice. None of these blocks an install; all of them are things players notice.",
    "",
    section("recommended"),
  ].join("\n");
}
