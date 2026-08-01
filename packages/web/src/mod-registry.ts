/**
 * The recommended-mod catalogue: what first run offers to download.
 *
 * The game does not bundle its own mods. Instead it ships this catalogue - a list of
 * repositories, a tag in each, and a SHA-256 for every file - and offers to fetch
 * them. That trade is deliberate and worth stating, because it moves code out of the
 * build and onto the network:
 *
 *   - A mod is developed, versioned, released and reported against on its own, at its
 *     own pace, in its own repository. A fix to the QoL mod is not a game release.
 *   - Third-party mods are then not a second-class path. The catalogue's entries and
 *     someone else's mod are the same shape, installed by the same code.
 *
 * WHY THE HASHES ARE HERE AND NOT FETCHED. This is the only thing standing between
 * "download from the internet" and "execute arbitrary code as the player". The digest
 * ships INSIDE the game build, so the bytes are checked against a value that did not
 * come over the same connection that delivered them: a compromised repository, a
 * replaced tag, or an intercepted response all fail the comparison. A hash fetched
 * alongside the file would authenticate nothing at all - whoever supplied the file
 * supplied the hash.
 *
 * That is also why entries pin a TAG and not a branch. `refs/heads/master` is whatever
 * the author pushed last, so its bytes change under a fixed digest and every install
 * would break on the next commit; and pinning a moving target is how a mod that was
 * reviewed becomes a mod that was not.
 *
 * WHY raw.githubusercontent.com AND NOT A RELEASE ZIP. Measured from the real origin
 * (https://neostryder.github.io) rather than assumed, because the answer decides
 * whether the static web build can install a mod AT ALL:
 *
 *   raw.githubusercontent.com at a tag  Access-Control-Allow-Origin: *   works
 *   api.github.com                      Access-Control-Allow-Origin: *   works
 *   a release ASSET                     (no CORS header)                 blocked
 *   codeload zipball                    ACAO: render.githubusercontent    blocked
 *
 * A release asset is the obvious choice and it is the one that cannot work: the
 * browser refuses the read. So a mod's payload is its committed files, fetched at a
 * tag - and a large pack travels as ONE committed archive rather than hundreds of
 * files, because hundreds of round trips is its own kind of broken.
 *
 * Binary bytes survive this path intact: the same measurement fetched a committed PNG
 * cross-origin and confirmed the signature (89 50 4e 47) and content-type, so an
 * archive and a tile are as fetchable as a manifest.
 */

import { compareSemver } from "@rpgm-tools/neo-angband-mod-sdk";

/** Where one file of a mod lives, and what it must hash to. */
export interface RegistryFile {
  /** Path inside the repository, which is also the path inside the mod folder. */
  readonly path: string;
  /** Lower-case hex SHA-256 of the exact bytes. 64 characters. */
  readonly sha256: string;
}

/**
 * A mod's payload: either its files listed one by one, or committed archives.
 *
 * Two shapes rather than one because the sizes differ by three orders of magnitude. A
 * code mod is a manifest and a script - listing them is clearer, and each file gets
 * its own digest. A converted tile pack is 1505 files and 2.3 MB, where listing them
 * would mean 1505 requests and a catalogue longer than the game.
 */
export type RegistryPayload =
  | { readonly kind: "files"; readonly files: readonly RegistryFile[] }
  /**
   * ZIPs committed in the repository, unpacked after each digest matches. A digest
   * covers a whole ARCHIVE, so one comparison authenticates every file inside it -
   * and it is checked before a single entry is decompressed, so a malicious archive
   * never gets to be parsed.
   *
   * A LIST rather than one archive, because a tiles mod is many separable packs.
   * Measured on neo-linoleum: 9161 loose files and 42 MiB of art become 7 archives
   * and 24.6 MiB, the largest 10.6 MiB. As one archive that would be a 24.6 MiB blob
   * rewritten in full whenever a single tile changed, carrying one digest whose
   * failure says only "something in here is wrong". Per pack, a digest names what
   * failed, a fix rewrites one pack, and the installer is free to offer a subset.
   */
  | { readonly kind: "archive"; readonly archives: readonly RegistryFile[] };

export interface RecommendedMod {
  /** The mod id, which is also its folder name and its manifest's `id`. */
  readonly id: string;
  /** Human name, as the manifest says it. */
  readonly name: string;
  /** `owner/repo` on GitHub. */
  readonly repo: string;
  /** The tag to install. Never a branch - see the header. */
  readonly tag: string;
  /**
   * One line for the checkbox row. The long description comes from the manifest once
   * the mod is installed, so it is not duplicated here and cannot disagree with it.
   */
  readonly summary: string;
  /**
   * Whether this row starts CHECKED on first run.
   *
   * Only for a mod whose absence a player would experience as the game being worse
   * rather than as the game being faithful. A pre-checked row is still a row they can
   * clear, and nothing installs without them pressing the button.
   */
  readonly preChecked: boolean;
  /** Roughly how big the download is, so the row can say so before it starts. */
  readonly approxBytes: number;
  readonly payload: RegistryPayload;
}

/**
 * The catalogue this build ships.
 *
 * EVERY FIRST-PARTY MOD THAT EXISTS IS HERE, because the game now bundles none of them
 * (FIRST_PARTY_MOD_IDS in mod-store.ts is empty). That is the whole point of the list
 * rather than a milestone: a fresh install is Angband 4.2.6 and nothing else, and every
 * mod - mine included - arrives the same way, through the same verification, as
 * somebody else's. neo-angband-mod-borg is absent because it has no release; the
 * repository reserves the name.
 *
 * EVERY DIGEST BELOW WAS MEASURED, not transcribed. `node tools/pack.mjs --json` in
 * the mod repository printed them, and each was then re-fetched from
 * raw.githubusercontent.com at the pinned tag and hashed again, so what is pinned is
 * the bytes GitHub actually serves rather than the bytes a local build produced. The
 * same check confirmed `Access-Control-Allow-Origin: *` on that path, which is what
 * makes an install from the static web build possible at all.
 *
 * A placeholder entry with an invented tag or digest would be worse than an empty
 * list: it would fail verification, and a verification failure is the signal that
 * something has TAMPERED with a download. Filling this with fake hashes would train
 * whoever sees it to ignore the one alarm that matters.
 */
export const RECOMMENDED_MODS: readonly RecommendedMod[] = [
  {
    id: "qol",
    name: "Quality of Life",
    repo: "neostryder/neo-angband-mod-qol",
    /* v0.11.0: at v0.10.0 this mod's manifest declared no `engine` range at all,
     * while shipping a plugin.js - the one case where the range matters most, since
     * a plugin written against one ABI is what a mismatched engine actually breaks.
     * plugin.js is unchanged, byte for byte; only manifest.json moved. */
    tag: "v0.11.0",
    summary: "Conveniences Angband does not have, each one a switch you can turn off",
    /* Not pre-checked, and the reason is the mandate rather than modesty: its absence is
     * the game being FAITHFUL, not the game being worse. A pre-checked row would make
     * the default experience something other than 4.2.6. */
    preChecked: false,
    approxBytes: 1_713,
    payload: {
      kind: "files",
      files: [
        {
          path: "manifest.json",
          sha256: "baeebe16d615c832bce7fa9af07a4841599646a3f89ebe17c20a545abb31981e",
        },
        {
          path: "plugin.js",
          sha256: "e060d8603473fb3e8377097ab5100090575779b7c85b77bfc149b680e6aee8e5",
        },
      ],
    },
  },
  {
    id: "bug-fixes",
    name: "Bug Fixes",
    repo: "neostryder/neo-angband-mod-bug-fixes",
    /* v0.12.0. Two tags before it are wrong to pin: v0.10.0 declares
     * `"engine": "4.2.x"` - the Angband baseline in a field that ranges over the
     * PORT's version - which the engine gate (mod-engine.ts) now evaluates, so it
     * installs and is then refused; and v0.11.0 predates the mod taking its gamedata
     * from npm rather than from a checkout of this repository. plugin.js has carried
     * the same digest through all three: only manifest.json has ever moved. */
    tag: "v0.12.0",
    summary: "Fixes for upstream Angband bugs the port keeps on purpose",
    /* Also clear, and this is the row where that is worth defending. Core keeps
     * upstream's warts BY DESIGN - a faithful port of 4.2.6 includes its bugs - so
     * turning these on by default would quietly make the game unfaithful for everyone
     * who never opened the mod list. It also flags the save, permanently. */
    preChecked: false,
    approxBytes: 8_001,
    payload: {
      kind: "files",
      files: [
        {
          path: "manifest.json",
          sha256: "bc34f7c3b1773752224a3fa8651c3c8e2bd17a42a5b42095b791ff4f21b34890",
        },
        {
          path: "plugin.js",
          sha256: "12803351c2a6c0ceb122ce6c8f4bc614d4249a5d1e2781247ee6f27e292aa1d7",
        },
      ],
    },
  },
  {
    id: "borg",
    name: "The Borg",
    repo: "neostryder/neo-angband-mod-borg",
    tag: "v0.1.0",
    summary: "Angband's automatic player, ported faithfully - it plays the game for you",
    /* Not pre-checked, and for this row that is not a judgement call at all: a
     * pre-checked autoplayer is a game that plays itself out of the box. Note that
     * even ENABLING it does not hand over the character - the mod ships with its
     * own `borg.autoplay` toggle off, so taking the keyboard is a second,
     * deliberate act. */
    preChecked: false,
    /* Half a megabyte, which is by far the largest `files` payload here and worth
     * being honest about on the row: it is the whole port bundled into one
     * plugin.js. None of it is the engine - the builder refuses that - it is 86
     * source files of danger model, think ladder and world model. */
    approxBytes: 514_370,
    payload: {
      kind: "files",
      files: [
        {
          path: "manifest.json",
          sha256: "ed00567fd4b1fdb11f4edc4059b31ce5b90a7dea99f2a1e9b14cf37396c40b24",
        },
        {
          path: "plugin.js",
          sha256: "6362048531ed833c5ee08b669d267980de8b18d4a2e44a51da711b85e619ce1b",
        },
      ],
    },
  },
  {
    id: "neo-linoleum",
    name: "neo-linoleum",
    repo: "neostryder/neo-angband-mod-linoleum",
    /* v0.11.0, and every tag before it is wrong to pin for a DIFFERENT reason, which
     * is why the history earns its space here:
     *   v0.9.0   points at content that shipped one pack, not six.
     *   v0.9.1   declares `"engine": "4.2.x"` - the Angband baseline in a field that
     *            ranges over the PORT's version - which the engine gate now refuses.
     *   v0.10.0  fixes that, but its six tile archives were built by the converter as
     *            it was before the @rpgm-tools rename, so they are not what a fresh
     *            conversion produces. Its own CI says so.
     * Three ways for a pinned tag to be quietly wrong, none of which moving a tag
     * would fix - which is the argument for pinning one in the first place. */
    tag: "v0.11.0",
    summary:
      "A second tile engine, and all six of Angband's tile sets converted to its loose-pack format",
    /* Its absence is the game being faithful, not the game being worse: every tile set
     * it converts is already selectable, drawn by the tilesheet engine. And it is a
     * 25 MiB download. So the row starts clear. */
    preChecked: false,
    approxBytes: 25_781_010,
    payload: {
      kind: "archive",
      archives: [
        {
          /* The only archive whose digest moved: manifest.json travels inside it.
           * The six tile archives rebuilt byte-identically from the same source art,
           * which is the packer's determinism claim (tools/pack.mjs) holding on a
           * different day - so their pins below are unchanged. */
          path: "dist/neo-linoleum-mod.zip",
          sha256: "9ace556b96596968761b1180a5067bdc7979467ecdfdc38f2bd3a36467eb4c66",
        },
        {
          path: "dist/neo-linoleum-original-tiles.zip",
          sha256: "78cf1842702873617817701d78b305f2bbf1d45710690f273823613752e8ad0b",
        },
        {
          path: "dist/neo-linoleum-adam-bolt.zip",
          sha256: "10fe50b2992917238a9569980976b114cf34b64a400e8bcd5899eec397cf8cd2",
        },
        {
          path: "dist/neo-linoleum-gervais.zip",
          sha256: "1dea2487f6b94753ee94228560f213d40cf70de3996ba42bbe4cedb89af5f6ae",
        },
        {
          path: "dist/neo-linoleum-nomad.zip",
          sha256: "b8a074ac4184fe99e7fd592775a4bc829275e9b1c02b2ba004ba15f03d4ad02c",
        },
        {
          path: "dist/neo-linoleum-shockbolt-dark.zip",
          sha256: "38975c01720bdeb48efe0b327d34ec7f39d7b7f40723d2c9d3ac17da57aa3835",
        },
        {
          path: "dist/neo-linoleum-shockbolt-light.zip",
          sha256: "9e0b27f41005e5730702b8de264c2cbfd1c269973b3e440eb25d119a5bb62213",
        },
      ],
    },
  },
];

const SHA256_HEX = /^[0-9a-f]{64}$/u;
/* `owner/repo`, GitHub's own character set for both halves. */
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/u;

/**
 * Why this entry is unusable, or null when it is fine.
 *
 * Exists because the catalogue will eventually be editable outside a TypeScript build
 * - a private registry, a mod manager's own list - and because a typo in a digest here
 * would otherwise surface as an install that fails with "the bytes do not match",
 * pointing the player at the mod author for a mistake in the game.
 *
 * Returns a message rather than throwing, so a single bad row costs one row.
 */
export function validateRecommendedMod(mod: RecommendedMod): string | null {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(mod.id)) {
    return `id "${mod.id}" is not a lower-case folder-safe name`;
  }
  if (!REPO_RE.test(mod.repo)) return `${mod.id}: repo "${mod.repo}" is not owner/name`;
  if (mod.tag === "") return `${mod.id}: no tag`;
  /* A ref that is a branch or a bare SHA is the mistake this catches: both resolve
   * over HTTP and both make the pinned digest a lie the moment anything is pushed. */
  if (mod.tag.includes("/")) return `${mod.id}: tag "${mod.tag}" looks like a ref path`;

  const seen = new Set<string>();
  const files = mod.payload.kind === "files" ? mod.payload.files : mod.payload.archives;
  if (files.length === 0) return `${mod.id}: nothing to download`;
  for (const f of files) {
    if (!SHA256_HEX.test(f.sha256)) {
      return `${mod.id}/${f.path}: "${f.sha256}" is not a lower-case hex SHA-256`;
    }
    const bad = badPath(f.path);
    if (bad) return `${mod.id}/${f.path}: ${bad}`;
    if (seen.has(f.path)) return `${mod.id}: ${f.path} is listed twice`;
    seen.add(f.path);
  }
  if (mod.payload.kind === "files" && !seen.has("manifest.json")) {
    /* Caught here rather than at load time so the catalogue cannot describe an
     * install that readModDir will then reject as "not a mod folder". */
    return `${mod.id}: no manifest.json in the file list`;
  }
  return null;
}

/**
 * Why this path may not be written, or null when it is safe.
 *
 * A path from the catalogue becomes a key under the mod's own prefix, and on the
 * desktop build the same shape becomes a real filename. `..` is the whole reason this
 * function exists: a mod that lists `../../saves/x` would otherwise escape its folder.
 * Rejected rather than normalised, because a path that needed normalising was written
 * by something with intent, and quietly repairing it hides that.
 */
export function badPath(path: string): string | null {
  if (path === "") return "empty path";
  if (path.startsWith("/") || /^[A-Za-z]:/u.test(path)) return "absolute path";
  if (path.includes("\\")) return "backslash in path";
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    return "path escapes the mod folder";
  }
  /* NUL and the Windows-reserved set: a mod installed in a browser and then exported
   * to a desktop mods folder has to be writable on both. */
  if (/[\0<>:"|?*]/u.test(path)) return "path has a character a filesystem refuses";
  return null;
}

/** The catalogue rows that are actually usable, and one message per row that is not. */
export function usableRecommendedMods(
  catalogue: readonly RecommendedMod[] = RECOMMENDED_MODS,
): { readonly mods: readonly RecommendedMod[]; readonly problems: readonly string[] } {
  const mods: RecommendedMod[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const mod of catalogue) {
    const bad = validateRecommendedMod(mod);
    if (bad !== null) {
      problems.push(bad);
      continue;
    }
    if (seen.has(mod.id)) {
      problems.push(`${mod.id}: listed twice in the catalogue`);
      continue;
    }
    seen.add(mod.id);
    mods.push(mod);
  }
  return { mods, problems };
}

/**
 * The URL for one file of a mod, at its pinned tag.
 *
 * `refs/tags/` is spelled out rather than left to raw.githubusercontent's shorthand,
 * because the short form resolves a BRANCH of the same name first - so a repository
 * with both `v1.0.0` the tag and `v1.0.0` the branch would serve the branch, which is
 * exactly the moving target the pinned digest is meant to exclude.
 */
export function rawUrl(repo: string, tag: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${repo}/refs/tags/${encodeURIComponent(tag)}/${encoded}`;
}

/** Where a player can go to read the mod's own page. */
export function repoUrl(mod: RecommendedMod): string {
  return `https://github.com/${mod.repo}/tree/${encodeURIComponent(mod.tag)}`;
}

/**
 * Order two release tags: negative if `a` is older, 0 if equal, positive if `a`
 * is newer, and null when they cannot be ordered.
 *
 * WHY ORDER THEM AT ALL, when a catalogue row only has to notice a difference.
 * Because "different" was being RENDERED as "update", and the two are not the
 * same claim. A player who installed a mod from its repository at a tag the
 * shipped catalogue predates would be shown their newer copy with an arrow
 * pointing at the older one and the word "update" next to it - and pressing
 * Enter would quietly roll them back. A string `!==` cannot tell those apart,
 * and neither can a string `<`: it puts v0.9.0 above v0.10.0.
 *
 * Null is a real answer, not a fallback. A tag need not be a version at all
 * (`latest`, a date, a commit-ish), and saying "these differ, in an order I
 * cannot work out" is honest where guessing a direction is not.
 */
export function compareTags(a: string, b: string): number | null {
  /* The one convention this strips: a leading `v`, which is how every tag in the
   * catalogue is written and is not part of the version. Nothing else is
   * normalised - a tag that is not a version should come back null rather than be
   * bent into one. */
  const version = (tag: string): string => (/^v\d/u.test(tag) ? tag.slice(1) : tag);
  return compareSemver(version(a), version(b));
}
