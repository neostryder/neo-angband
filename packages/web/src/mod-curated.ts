/**
 * Curated lists of mod REPOSITORIES.
 *
 * A registry is the smallest useful thing: an ordered list of repositories to go
 * and ask about. It carries no mod names, no versions, no descriptions and no
 * digests, because every one of those is a fact about a mod and belongs to that
 * mod - the game learns them by looking the repository up (mod-discover.ts). What
 * a registry contributes is the one thing a mod cannot contribute about itself:
 * somebody's opinion that it is worth offering.
 *
 * THREE WAYS IN, AND THEY ARE THE SAME WAY IN. This build points at one registry
 * by default - mods/registry.json in the game's own repository, which is where a
 * recommendation belongs, and which can be re-curated without a game release. A
 * player can point at anyone else's list of the same shape, or paste a single
 * repository and skip lists entirely. All three produce RepoRefs and go through
 * the same discovery and the same install, so a third-party mod is not a
 * second-class path - it is the only path, and the curated list is a bookmark
 * file for it.
 *
 * WHY THE DEFAULT URL IS IN THE BUILD AND THAT IS NOT A CONTRADICTION. Something
 * has to know where to start. What is baked in is a place to ask, not an answer:
 * change the file in the repository and every build already out there sees the new
 * list on its next look. Compare the model this replaces, where the answers
 * themselves shipped inside the build and a mod could not be updated without
 * updating the game.
 */

import { parseRepoRef, type RepoRef } from "./mod-source";

/**
 * The default list: this game's own repository, at the default branch.
 *
 * A BRANCH here, deliberately, where every reference to a mod's own files pins a
 * tag. The two are different kinds of thing. A tag pins CODE, because code that
 * changes under an installed mod is the whole problem tags exist to prevent; this
 * file is a set of pointers whose entire value is being current, and pinning it to
 * a release would mean a newly curated mod could not be recommended to anyone who
 * had not updated the game. Nothing here is executed, and every repository it
 * names is still discovered and installed under the same rules as one typed by
 * hand - so the worst a compromised list can do is offer a repository the player
 * then decides about, with its origin pinned on first install.
 */
export const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/neostryder/neo-angband/master/mods/registry.json";

/** A curated list, once parsed. */
export interface ModRegistry {
  /** What the list calls itself, for the screen that shows it. */
  readonly name: string;
  /** Where it came from, so a player can see whose list they are reading. */
  readonly url: string;
  readonly mods: readonly RepoRef[];
  /** One line per entry that could not be read, rather than a silent drop. */
  readonly problems: readonly string[];
}

export type RegistryResult =
  | { readonly ok: true; readonly registry: ModRegistry }
  | { readonly ok: false; readonly problem: string };

/** The schema versions this build understands. */
const SCHEMA = 1;

/**
 * Parse a registry document.
 *
 * Pure, and separate from fetching, so every shape a hostile or careless file can
 * take is testable without a network. A bad ENTRY costs that entry and is
 * reported; only a bad DOCUMENT costs the whole list, because a list of twenty
 * repositories should not be lost to one typo in the nineteenth.
 */
export function parseRegistry(body: string, url: string): RegistryResult {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch (e) {
    return {
      ok: false,
      problem: `${url} is not valid JSON (${e instanceof Error ? e.message : String(e)})`,
    };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { ok: false, problem: `${url} is not a mod registry` };
  }
  const d = doc as Record<string, unknown>;

  const schema = d["schema"];
  if (typeof schema !== "number" || !Number.isInteger(schema)) {
    return { ok: false, problem: `${url}: no schema version, so it cannot be read safely` };
  }
  if (schema > SCHEMA) {
    /* Named as a GAME problem, not a file problem: the file is presumably fine and
     * this build is the old one. Telling the player their list is broken would send
     * them to the wrong person. */
    return {
      ok: false,
      problem:
        `${url} is a newer kind of registry (schema ${String(schema)}) than this ` +
        `build of the game understands. Updating the game should fix it.`,
    };
  }

  const list = d["mods"];
  if (!Array.isArray(list)) {
    return { ok: false, problem: `${url}: its "mods" is not a list` };
  }

  const mods: RepoRef[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of list.entries()) {
    const at = `${url} entry ${String(i + 1)}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      problems.push(`${at}: not an object`);
      continue;
    }
    const repo = (raw as { repo?: unknown }).repo;
    if (typeof repo !== "string" || repo === "") {
      problems.push(`${at}: names no repository`);
      continue;
    }
    /* Through the SAME parser a typed URL goes through, so a registry cannot
     * express a reference a player could not have typed - and cannot smuggle a
     * branch in where a tag is expected. */
    const parsed = parseRepoRef(repo);
    if (!parsed.ok) {
      problems.push(`${at}: ${parsed.problem}`);
      continue;
    }
    const key = parsed.ref.repo.toLowerCase();
    if (seen.has(key)) {
      /* Reported rather than deduplicated in silence: a list that names one
       * repository twice is a list somebody edited without looking. */
      problems.push(`${at}: ${parsed.ref.repo} is listed more than once`);
      continue;
    }
    seen.add(key);
    mods.push(parsed.ref);
  }

  const name = typeof d["name"] === "string" && d["name"] !== "" ? d["name"] : url;
  return { ok: true, registry: { name, url, mods, problems } };
}

/** What fetching a registry needs. */
export interface RegistryEnv {
  readonly fetch: (url: string) => Promise<{
    readonly ok: boolean;
    readonly status: number;
    text(): Promise<string>;
  }>;
}

/**
 * Fetch and parse a registry. Never throws.
 *
 * `cache: "no-store"` is deliberately NOT set here: the caller owns the fetch, and
 * a registry is exactly the kind of small document a browser cache should be
 * allowed to serve for a few minutes. What must never be stale is the game's own
 * build id, and that has its own reasoning in vite.config.ts.
 */
export async function fetchRegistry(
  url: string,
  env: RegistryEnv,
): Promise<RegistryResult> {
  let res: Awaited<ReturnType<RegistryEnv["fetch"]>>;
  try {
    res = await env.fetch(url);
  } catch (e) {
    return {
      ok: false,
      problem:
        `Could not reach ${url} (${e instanceof Error ? e.message : String(e)}). ` +
        `Mods you have already installed are unaffected.`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      problem:
        res.status === 404
          ? `${url}: there is no registry there (HTTP 404)`
          : `${url}: refused (HTTP ${String(res.status)})`,
    };
  }
  return parseRegistry(await res.text(), url);
}
