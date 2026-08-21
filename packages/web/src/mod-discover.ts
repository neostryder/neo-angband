/**
 * Asking a repository what mod it holds.
 *
 * The build ships no catalogue, so everything a row can say about a mod before it
 * is installed has to be fetched from the mod: its id, name and description from
 * its manifest, the engine range it claims from the same manifest, the versions
 * that exist from the repository's tags, and the size from the tree. Three
 * requests, all CORS-open (see mod-source.ts for the measurement), and none of
 * them per-file.
 *
 * WHY THIS IS SEPARATE FROM mod-install.ts. Discovery is a READ that the mod
 * screen does to draw a row; installing is a WRITE that stores bytes under a
 * mod's name. Keeping them apart means a row can be shown, judged incompatible
 * and refused without anything ever touching storage - and it means this module's
 * tests need no IndexedDB, only a fake fetch.
 */

import { engineAllows, engineProblem, type GateableManifest } from "./mod-engine";
import { newerGameCouldRun } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  newestTag,
  payloadFromTree,
  tagsApiUrl,
  tagsInChannel,
  treeApiUrl,
  type RepoRef,
  type TreeEntry,
} from "./mod-source";
import type { UpdateChannel } from "./update";

/** The bits of the platform this module touches, injected so tests need no network. */
export interface DiscoverEnv {
  readonly fetch: (url: string) => Promise<DiscoverResponse>;
  /** The running engine version, for the compatibility verdict. */
  readonly engineVersion: string;
  /**
   * The player's update channel, which is also their MOD channel.
   *
   * One setting, not two: a player on early gets early mod builds, a player on
   * stable gets only mods' releases. Asking somebody to keep two channel settings
   * in step is asking them to get it wrong, and the failure would be silent - a
   * stable game quietly running experimental mod code.
   *
   * Optional so a caller that genuinely has no player (a canary, a test) does not
   * have to invent one; absent means every orderable tag is a candidate, which is
   * what discovery did before channels applied to mods at all.
   */
  readonly channel?: UpdateChannel;
}

export interface DiscoverResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/** What one file of the mod's payload is, and how it arrives. */
export type PayloadEntry =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "archive"; readonly path: string };

/**
 * A version that exists and that THIS build cannot run.
 *
 * Discovery walks down a repository's versions until it finds one this build
 * accepts, so the version it offers is installable. That walk is only honest if
 * what it walked PAST is reported: a player offered v0.14.4 while the mod's front
 * page shows v0.15.0 would otherwise conclude the game is broken or the listing
 * is stale, when the real answer is that v0.15.0 wants a newer game and updating
 * gets it. Same shape of debt as `channelHeld`, different creditor.
 */
export interface EngineHeld {
  /** The tag that was passed over. */
  readonly tag: string;
  /** Its manifest's own version string, or null when it did not state one. */
  readonly version: string | null;
  /** The engine range it declares, or null when it declares none. */
  readonly engine: string | null;
  /** The loader's own sentence about why this build is outside that range. */
  readonly why: string;
  /**
   * Whether updating the GAME is what would unlock this version.
   *
   * True when a newer engine version satisfies the range, so "update the game" is
   * advice that works. False when no newer version within the probed window does,
   * which is a mod wanting an OLDER game and is nearly always an author's mistake
   * in the range. Null when the range cannot be read at all. See
   * `newerGameCouldRun`, whose bound is the reason the false and null cases must be
   * worded as facts about the two versions rather than as instructions.
   */
  readonly newerGameHelps: boolean | null;
}

/** A mod, as its own repository describes it. */
export interface DiscoveredMod {
  readonly repo: string;
  readonly tag: string;
  /** Every version the repository offers that can be ordered, newest first. */
  readonly tags: readonly string[];
  /** From the manifest. The id is also the folder name. */
  readonly id: string;
  readonly name: string;
  /**
   * Who the manifest says wrote it, shown beside the name everywhere a mod is
   * listed. SELF-DECLARED, and never the author register: the register is a
   * standing this project has looked at, and putting either one where the other
   * belongs would turn attribution into an endorsement or hide it entirely.
   * Required of every manifest (docs/modding/REQUIREMENTS.md), so null here means
   * a manifest that predates that rule.
   */
  readonly author: string | null;
  readonly version: string;
  readonly description: string | null;
  /** The engine range the MOD claims. */
  readonly engine: string | null;
  /**
   * Whether the mod would LOAD in this build, and what to say about the range if
   * there is anything to say - both straight from the loader's own verdict
   * (mod-engine.ts), so a row cannot promise what load time then refuses. Note
   * that a problem is not always a refusal: a pack with no code that declares a
   * range this build sits outside still loads, and still deserves the line.
   */
  readonly compatible: boolean;
  readonly engineNote: string | null;
  /**
   * The newest version this repository has that the player's CHANNEL declined, or
   * null. A row that shows 0.13.0 while the repository's front page shows
   * 0.14.0-beta.1 looks out of date, and the honest answer is "your channel" - so
   * the row is given what it needs to say so.
   */
  readonly channelHeld: string | null;
  /**
   * The newest version this build cannot run, when an OLDER one is being offered
   * instead, or null.
   *
   * Null in both of the cases that are not this one: the newest version runs here
   * (nothing was held), and no version runs here (then `compatible` is false and
   * the row says so, and naming the same tag twice would read as two problems).
   */
  readonly engineHeld: EngineHeld | null;
  /**
   * How many versions' manifests were actually read before settling on `tag`.
   *
   * One in the ordinary case, because the newest version is nearly always the one
   * that runs. More only when it did not, and then this is what lets a refusal say
   * "none of the last four versions runs here" instead of leaving the player to
   * wonder whether the older ones were even looked at.
   *
   * Optional for the same reason `sha` is: a fixture written before it existed
   * still type-checks. `discoverMod` always sets it.
   */
  readonly versionsChecked?: number;
  readonly payload: readonly PayloadEntry[];
  /**
   * Bytes, when the tree could be read. Null when the payload came from the
   * manifest and the tree call failed - a size the row cannot show is better
   * than one it makes up.
   */
  readonly bytes: number | null;
  /** True when the payload was guessed from the tree rather than declared. */
  readonly guessedPayload: boolean;
  /**
   * The commit `tag` resolves to right now, or null when it could not be
   * learned - the tags call failed (a pinned tag still installs on that
   * failure; see the try/catch below) or the API's own entry had no SHA.
   *
   * THIS IS THE VALUE AN INSTALL PINS. `installModFromRepo` (mod-install.ts)
   * carries it straight into `InstalledModMeta.sha`, so an install records not
   * just which tag it asked for but which commit that tag named at the moment
   * it asked - the fact a moved tag changes and a tag name alone cannot show.
   *
   * Optional rather than required-and-nullable like this interface's other
   * fields, purely so a fixture built before this field existed still type-checks
   * as a DiscoveredMod without every caller having to be revisited the day it was
   * added. `discoverMod` itself always sets it - to a SHA or explicitly to null -
   * so nothing this module produces ever leaves it undefined.
   */
  readonly sha?: string | null;
}

export type DiscoverResult =
  | { readonly ok: true; readonly mod: DiscoveredMod }
  | { readonly ok: false; readonly problem: string };

/** raw.githubusercontent at a TAG - `refs/tags/` spelled out; see rawUrl's note. */
function rawAt(repo: string, tag: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${repo}/refs/tags/${encodeURIComponent(tag)}/${encoded}`;
}

function why(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** GET and return the body text, or throw with a reason a player can act on. */
async function getText(url: string, what: string, env: DiscoverEnv): Promise<string> {
  let res: DiscoverResponse;
  try {
    res = await env.fetch(url);
  } catch (e) {
    throw new Error(`could not reach GitHub to read ${what} (${why(e)})`, { cause: e });
  }
  if (!res.ok) {
    /* Each of these needs different advice, so none of them is "it failed". */
    if (res.status === 404) throw new Error(`${what}: not there (HTTP 404)`);
    if (res.status === 403) {
      throw new Error(
        `${what}: GitHub is rate-limiting this connection (HTTP 403). ` +
          `It clears on its own - try again in a few minutes.`,
      );
    }
    throw new Error(`${what}: GitHub refused it (HTTP ${String(res.status)})`);
  }
  return await res.text();
}

async function getJson(url: string, what: string, env: DiscoverEnv): Promise<unknown> {
  const body = await getText(url, what, env);
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error(`${what}: is not the JSON it should be (${why(e)})`, { cause: e });
  }
}

/**
 * One tag from the repository's tags API, and the commit it currently names.
 *
 * THE SHA WAS ALWAYS IN THIS RESPONSE. GitHub's tags API returns `commit.sha`
 * beside every `name` - already dereferenced past an annotated tag to the real
 * commit - and until now `listTags` read the name and threw the rest of the
 * entry away. That SHA is the one fact that tells a tag apart from itself: a
 * tag is a label GitHub lets its owner move, so `v1.2.0` today and `v1.2.0`
 * next week can be two different commits with the same name, and a check that
 * only ever compares names cannot see that happen (see mod-updates.ts,
 * classifyModPin, which is what reads this).
 */
export interface TagRef {
  readonly name: string;
  /**
   * The commit this tag resolves to, or null when the API's own entry did not
   * carry one. Accepted rather than refused - `classifyModPin` already has an
   * "unknown" answer for exactly this, and a caller pinning to a mod does not
   * get to fail an install over a field it only ever uses defensively.
   */
  readonly sha: string | null;
}

/** The repository's tags, newest orderable first, unorderable ones dropped - each
 * with the commit it currently resolves to. */
export async function listTagRefs(
  repo: string,
  env: DiscoverEnv,
): Promise<readonly TagRef[]> {
  const body = await getJson(tagsApiUrl(repo), "the list of versions", env);
  if (!Array.isArray(body)) throw new Error("the list of versions: not a list");
  const shas = new Map<string, string | null>();
  for (const entry of body) {
    const e = entry as { name?: unknown; commit?: { sha?: unknown } } | null;
    const name = e?.name;
    if (typeof name !== "string" || name === "") continue;
    /* First entry for a name wins. A real response never repeats a tag name;
     * this is only about not letting a malformed one overwrite a good SHA with
     * a worse one further down the array. */
    if (shas.has(name)) continue;
    const sha = e?.commit?.sha;
    shas.set(name, typeof sha === "string" && sha !== "" ? sha : null);
  }
  /* Ordered by repeatedly taking the newest, so the ordering rule lives in exactly
   * one place (newestTag) instead of being re-derived by a comparator here. */
  const ordered: TagRef[] = [];
  let rest = [...shas.keys()];
  for (;;) {
    const top = newestTag(rest);
    if (top === null) break;
    ordered.push({ name: top, sha: shas.get(top) ?? null });
    rest = rest.filter((t) => t !== top);
  }
  return ordered;
}

/** The repository's tags, newest orderable first, unorderable ones dropped. */
export async function listTags(
  repo: string,
  env: DiscoverEnv,
): Promise<readonly string[]> {
  return (await listTagRefs(repo, env)).map((r) => r.name);
}

/** The tree at a tag, or null when it could not be read. */
async function tryTree(
  repo: string,
  tag: string,
  env: DiscoverEnv,
): Promise<readonly TreeEntry[] | null> {
  try {
    const body = await getJson(treeApiUrl(repo, tag), "the file list", env);
    const tree = (body as { tree?: unknown } | null)?.tree;
    if (!Array.isArray(tree)) return null;
    return tree.filter(
      (e): e is TreeEntry =>
        typeof (e as TreeEntry).path === "string" && typeof (e as TreeEntry).type === "string",
    );
  } catch {
    /* Swallowed on purpose, and ONLY here: a missing tree costs the row its size
     * and its fallback payload, not the install. A manifest that declared its
     * payload does not need this call to have worked. */
    return null;
  }
}

/**
 * How far back the version walk will look for something this build can run.
 *
 * A bound rather than the whole tag list, because each step is a request and a
 * mod screen draws several rows at once. Eight covers the realistic case - a mod
 * a release or two ahead of the game - and a mod whose last eight versions all
 * want a newer game is telling the player to update the game, which is what the
 * refusal then says.
 */
export const MAX_VERSIONS_TRIED = 8;

/** One candidate version's manifest, reduced to what a row and the gate need. */
export interface ManifestFacts {
  readonly tag: string;
  readonly manifest: Record<string, unknown>;
  readonly id: string;
  readonly name: string;
  readonly author: string | null;
  readonly version: string;
  readonly description: string | null;
  readonly engine: string | null;
  readonly gateable: GateableManifest;
}

type ManifestRead =
  | { readonly ok: true; readonly facts: ManifestFacts }
  | { readonly ok: false; readonly problem: string };

/**
 * One version's manifest.json, read and reduced.
 *
 * Hands back the problem instead of throwing, because what a failure MEANS depends
 * on which version failed: the newest one is the mod's problem and is reported,
 * while an older one is expected (a tag from before the repository was a mod at
 * all has no manifest) and only ends the walk. A throw could not tell those apart
 * without the caller catching it, and a catch that decides policy is policy in the
 * wrong place.
 */
async function readManifestFacts(
  repo: string,
  tag: string,
  env: DiscoverEnv,
): Promise<ManifestRead> {
  let text: string;
  try {
    text = await getText(rawAt(repo, tag, "manifest.json"), `${repo}'s manifest.json at ${tag}`, env);
  } catch (e) {
    return { ok: false, problem: why(e) };
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, problem: `manifest.json at ${tag} is not valid JSON (${why(e)})` };
  }
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return { ok: false, problem: `manifest.json at ${tag} is not a manifest` };
  }
  const id = typeof manifest["id"] === "string" ? manifest["id"] : "";
  if (id === "") {
    return { ok: false, problem: `manifest.json at ${tag} declares no id` };
  }
  const engine = typeof manifest["engine"] === "string" ? manifest["engine"] : null;
  return {
    ok: true,
    facts: {
      tag,
      manifest,
      id,
      name: typeof manifest["name"] === "string" ? manifest["name"] : id,
      author:
        typeof manifest["author"] === "string" && manifest["author"] !== ""
          ? manifest["author"]
          : null,
      version: typeof manifest["version"] === "string" ? manifest["version"] : "",
      description:
        typeof manifest["description"] === "string" ? manifest["description"] : null,
      engine,
      gateable: {
        id,
        ...(engine === null ? {} : { engine }),
        ...(typeof manifest["modApi"] === "number" ? { modApi: manifest["modApi"] } : {}),
      },
    },
  };
}

/** What the version walk found. */
export interface VersionPick {
  /** The newest candidate this build will actually run, or null when none will. */
  readonly chosen: ManifestFacts | null;
  /** The newest candidate whose manifest could be read at all. */
  readonly newest: ManifestFacts | null;
  /** The newest candidate this build refuses, when an older one was chosen. */
  readonly engineHeld: EngineHeld | null;
  /** How many manifests were actually read. One, in the ordinary case. */
  readonly versionsChecked: number;
  /**
   * Set only when the NEWEST candidate could not be read, which is the one failure
   * that belongs to the caller: everything downstream of it was going to describe
   * that version, and there is nothing honest to say instead.
   */
  readonly problem: string | null;
}

/**
 * THE VERSION WALK: the newest of these versions that will actually RUN here.
 *
 * Before this existed, one manifest was read - the newest tag's - and if that
 * version wanted a newer game, the answer was "will not run on this version" and
 * that was the end of it, even when the same repository still had a version that
 * ran perfectly. The mod was installable by hand all along, by typing a
 * `/tree/<tag>` URL, so what was missing was never the capability. It was that
 * nothing looked, and nothing said.
 *
 * ONE REQUEST IN THE ORDINARY CASE. The loop stops at the first candidate it
 * accepts, and the newest version is nearly always that candidate, so a mod that is
 * keeping up costs exactly what it cost before. Extra reads happen only after a
 * refusal, which is the situation this exists for.
 *
 * raw.githubusercontent AND NOT THE API, deliberately. A manifest read is CORS-open
 * and unmetered there, while api.github.com allows sixty an hour per address
 * unauthenticated (see mod-source.ts's table) - a budget a screenful of mod rows
 * would spend on nothing but walking.
 *
 * SHARED WITH THE UPDATE CHECK, which is the other half of the same defect: a
 * screen that offers an update the loader will then refuse is worse than one that
 * offers nothing, because the player acts on it. Two walks would be two chances to
 * disagree about what "runnable" means.
 */
export async function pickRunnableVersion(
  repo: string,
  candidates: readonly string[],
  env: DiscoverEnv,
): Promise<VersionPick> {
  let chosen: ManifestFacts | null = null;
  let newest: ManifestFacts | null = null;
  let engineHeld: EngineHeld | null = null;
  let versionsChecked = 0;
  for (const candidate of candidates) {
    const read = await readManifestFacts(repo, candidate, env);
    if (!read.ok) {
      /* The NEWEST version failing to be read is the mod's problem and is reported.
       * An older one failing is expected - a tag from before the repository was a
       * mod at all has no manifest.json - and only ends the walk, because "keep
       * going and see" would be guessing at how far back a repository stops being
       * this mod. */
      if (newest === null) {
        return {
          chosen: null,
          newest: null,
          engineHeld: null,
          versionsChecked,
          problem: read.problem,
        };
      }
      break;
    }
    versionsChecked += 1;
    if (newest === null) newest = read.facts;
    if (engineAllows(read.facts.gateable, env.engineVersion)) {
      chosen = read.facts;
      break;
    }
    /* The first refusal is the newest one, because candidates are newest-first, and
     * the newest is the one worth telling the player about. */
    if (engineHeld === null) {
      engineHeld = {
        tag: read.facts.tag,
        version: read.facts.version === "" ? null : read.facts.version,
        engine: read.facts.engine,
        why: engineProblem(read.facts.gateable, env.engineVersion)?.why ?? "",
        newerGameHelps:
          read.facts.engine === null
            ? null
            : newerGameCouldRun(read.facts.engine, env.engineVersion),
      };
    }
  }
  return { chosen, newest, engineHeld, versionsChecked, problem: null };
}

/**
 * Ask a repository what mod it holds.
 *
 * Never throws: the mod screen shows the problem on the row it belongs to, and a
 * batch of repositories must not lose the good ones to one bad one.
 */
export async function discoverMod(
  ref: RepoRef,
  env: DiscoverEnv,
): Promise<DiscoverResult> {
  try {
    /* A pinned tag is taken as given - the player named a version and is owed
     * that version, not the newest. Its tag list is still fetched, so the row can
     * say what else exists (and so the pinned tag's own SHA can be read off it). */
    let allRefs: readonly TagRef[] = [];
    try {
      allRefs = await listTagRefs(ref.repo, env);
    } catch (e) {
      if (ref.tag === undefined) throw e;
    }
    const allTags = allRefs.map((r) => r.name);

    /* The channel filter. A player on stable is not offered a mod's beta, for the
     * same reason the game does not offer itself a beta on stable - and it is the
     * game's own rule doing the deciding (channelAccepts), not a second copy of it.
     *
     * A PINNED tag is exempt: the player named a version, which is a more specific
     * instruction than a channel preference, and refusing it would leave them typing
     * a URL that the game silently declines to honour. */
    const picked =
      env.channel === undefined
        ? { tags: allTags, held: null }
        : tagsInChannel(env.channel, allTags);
    const tags = picked.tags;

    /* Newest-first candidates. A PINNED tag is the only candidate there is: the
     * player named a version and is owed that version rather than a nearby one,
     * so a pin that will not run gets refused as a pin instead of quietly
     * becoming a different install than the one that was asked for. */
    const candidates = ref.tag === undefined ? tags.slice(0, MAX_VERSIONS_TRIED) : [ref.tag];
    if (candidates[0] === undefined) {
      /* Distinguished, because they need opposite advice: a repository with no
       * versions at all is the author's problem, while one whose only versions this
       * channel declines is answered by changing channel. */
      const held = picked.held;
      return {
        ok: false,
        problem:
          held === null
            ? `${ref.repo} has no released version this can install. ` +
              `A mod needs a tag like v1.0.0; a branch is not a version.`
            : `${ref.repo}'s newest version (${held}) is a pre-release, and this ` +
              `game is on the ${String(env.channel)} channel. Change channel on the ` +
              `update screen to install it.`,
      };
    }

    const pick = await pickRunnableVersion(ref.repo, candidates, env);
    if (pick.problem !== null) return { ok: false, problem: pick.problem };
    const { chosen, newest, versionsChecked } = pick;
    let engineHeld = pick.engineHeld;

    /*
     * NOTHING RUNS HERE. Then the NEWEST version is the one shown and refused: it
     * is the version named on the repository's own front page and in whatever
     * listing sent the player here, so refusing some older one instead would
     * answer a question nobody asked.
     *
     * And `engineHeld` goes back to null. It means "a newer version is being held
     * back in favour of an older one that works", and there is no older one that
     * works - the row already says the version it is showing will not run, and
     * naming the same tag a second time would read as two separate problems.
     */
    const facts = chosen ?? newest;
    if (facts === null) {
      /* Unreachable: `candidates` is non-empty by the check above, and a first
       * candidate that could not be read returned inside the loop. Written as an
       * answer rather than a non-null assertion so that an edit which makes it
       * reachable produces a sentence a player can read instead of a crash. */
      return { ok: false, problem: `${ref.repo} has no version whose manifest could be read.` };
    }
    if (chosen === null) engineHeld = null;
    const { tag, manifest, id, name, author, version, description, engine, gateable } = facts;

    /* Read off the same tags-call response the picked tag came from - a second
     * request would be a second chance for the tag to have moved BETWEEN the two
     * calls, which would pin a SHA that was never actually what "install" saw. */
    const sha = allRefs.find((r) => r.name === tag)?.sha ?? null;

    const declared = readDeclaredPayload(manifest["payload"]);
    const tree = await tryTree(ref.repo, tag, env);

    let payload: readonly PayloadEntry[];
    let bytes: number | null = null;
    let guessedPayload = false;
    if (declared !== null) {
      payload = declared;
      if (tree) {
        const named = new Set(declared.map((p) => p.path));
        bytes = tree.reduce(
          (n, e) => (e.type === "blob" && named.has(e.path) ? n + (e.size ?? 0) : n),
          0,
        );
      }
    } else {
      if (!tree) {
        return {
          ok: false,
          problem:
            `${ref.repo} does not say which of its files are the mod, and its ` +
            `file list could not be read, so there is nothing to install from.`,
        };
      }
      const derived = payloadFromTree(tree);
      payload = derived.files.map((path) => ({ kind: "file", path }) as const);
      bytes = derived.bytes;
      guessedPayload = true;
    }

    /* readModDir refuses a folder with no manifest, so a payload that omits one
     * describes an install that cannot become a mod - worth catching here, where
     * the message can name the manifest field that is wrong rather than surfacing
     * as a failed download.
     *
     * ONLY WHEN EVERY ENTRY IS A FILE. An archive's manifest.json is INSIDE the
     * zip, which nothing has opened yet, so this check cannot see it and said so
     * by refusing a perfectly good tiles mod - caught by the live canary against
     * neo-linoleum, whose whole payload is seven archives. The installer performs
     * exactly this check on the unpacked result (storeMod), which is the only
     * place it can be answered for an archive. */
    const allFiles = payload.every((p) => p.kind === "file");
    if (allFiles && !payload.some((p) => p.path === "manifest.json")) {
      return {
        ok: false,
        problem:
          `${ref.repo}'s payload does not include manifest.json, so the ` +
          `installed folder would not be a mod.`,
      };
    }

    return {
      ok: true,
      mod: {
        repo: ref.repo,
        tag,
        tags,
        id,
        name,
        author,
        version,
        description,
        engine,
        /* The MOD's claim, evaluated against THIS build by the SAME code that
         * decides at load time. Two copies of a compatibility rule is one copy
         * that learns, so this calls the loader's rather than re-deriving it. */
        compatible: engineAllows(gateable, env.engineVersion),
        engineNote: engineProblem(gateable, env.engineVersion)?.why ?? null,
        channelHeld: picked.held,
        engineHeld,
        versionsChecked,
        payload,
        bytes,
        guessedPayload,
        sha,
      },
    };
  } catch (e) {
    return { ok: false, problem: why(e) };
  }
}

/** A manifest's `payload`, or null when it declared none. */
function readDeclaredPayload(value: unknown): readonly PayloadEntry[] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const p = value as { files?: unknown; archives?: unknown };
  const out: PayloadEntry[] = [];
  const take = (list: unknown, kind: PayloadEntry["kind"]): void => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (typeof entry === "string" && entry !== "") out.push({ kind, path: entry });
    }
  };
  take(p.files, "file");
  take(p.archives, "archive");
  return out.length > 0 ? out : null;
}
