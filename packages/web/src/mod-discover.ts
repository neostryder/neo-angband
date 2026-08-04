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

import { engineAllows, engineProblem } from "./mod-engine";
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
  readonly payload: readonly PayloadEntry[];
  /**
   * Bytes, when the tree could be read. Null when the payload came from the
   * manifest and the tree call failed - a size the row cannot show is better
   * than one it makes up.
   */
  readonly bytes: number | null;
  /** True when the payload was guessed from the tree rather than declared. */
  readonly guessedPayload: boolean;
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

/** The repository's tags, newest orderable first, unorderable ones dropped. */
export async function listTags(
  repo: string,
  env: DiscoverEnv,
): Promise<readonly string[]> {
  const body = await getJson(tagsApiUrl(repo), "the list of versions", env);
  if (!Array.isArray(body)) throw new Error("the list of versions: not a list");
  const names: string[] = [];
  for (const entry of body) {
    const name = (entry as { name?: unknown } | null)?.name;
    if (typeof name === "string" && name !== "") names.push(name);
  }
  /* Ordered by repeatedly taking the newest, so the ordering rule lives in exactly
   * one place (newestTag) instead of being re-derived by a comparator here. */
  const ordered: string[] = [];
  let rest = names;
  for (;;) {
    const top = newestTag(rest);
    if (top === null) break;
    ordered.push(top);
    rest = rest.filter((t) => t !== top);
  }
  return ordered;
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
     * say what else exists. */
    let allTags: readonly string[] = [];
    try {
      allTags = await listTags(ref.repo, env);
    } catch (e) {
      if (ref.tag === undefined) throw e;
    }

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

    const tag = ref.tag ?? tags[0];
    if (tag === undefined) {
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

    const manifestText = await getText(
      rawAt(ref.repo, tag, "manifest.json"),
      `${ref.repo}'s manifest.json at ${tag}`,
      env,
    );
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(manifestText) as Record<string, unknown>;
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
    const name = typeof manifest["name"] === "string" ? manifest["name"] : id;
    const author =
      typeof manifest["author"] === "string" && manifest["author"] !== ""
        ? manifest["author"]
        : null;
    const version = typeof manifest["version"] === "string" ? manifest["version"] : "";
    const description =
      typeof manifest["description"] === "string" ? manifest["description"] : null;
    const engine = typeof manifest["engine"] === "string" ? manifest["engine"] : null;

    const gateable = {
      id,
      ...(engine === null ? {} : { engine }),
      ...(typeof manifest["modApi"] === "number" ? { modApi: manifest["modApi"] } : {}),
    };

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
        payload,
        bytes,
        guessedPayload,
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
