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
    tag: "v0.10.0",
    summary: "Conveniences Angband does not have, each one a switch you can turn off",
    /* Not pre-checked, and the reason is the mandate rather than modesty: its absence is
     * the game being FAITHFUL, not the game being worse. A pre-checked row would make
     * the default experience something other than 4.2.6. */
    preChecked: false,
    approxBytes: 1_689,
    payload: {
      kind: "files",
      files: [
        {
          path: "manifest.json",
          sha256: "a8d90e0114edd2afdc777b96937a94c79295061cd5896383d2f845d9f707e8e9",
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
    tag: "v0.10.0",
    summary: "Fixes for upstream Angband bugs the port keeps on purpose",
    /* Also clear, and this is the row where that is worth defending. Core keeps
     * upstream's warts BY DESIGN - a faithful port of 4.2.6 includes its bugs - so
     * turning these on by default would quietly make the game unfaithful for everyone
     * who never opened the mod list. It also flags the save, permanently. */
    preChecked: false,
    approxBytes: 7_942,
    payload: {
      kind: "files",
      files: [
        {
          path: "manifest.json",
          sha256: "674e4b4b8de37e73a0db8443c0dbe3328acf2b603d86767545003046fe4342e1",
        },
        {
          path: "plugin.js",
          sha256: "12803351c2a6c0ceb122ce6c8f4bc614d4249a5d1e2781247ee6f27e292aa1d7",
        },
      ],
    },
  },
  {
    id: "neo-linoleum",
    name: "neo-linoleum",
    repo: "neostryder/neo-angband-mod-linoleum",
    /* v0.9.1, not v0.9.0: that tag exists in that repository at content which shipped
     * one pack, and moving a published tag is exactly what pinning a tag rather than a
     * branch is here to prevent. */
    tag: "v0.9.1",
    summary:
      "A second tile engine, and all six of Angband's tile sets converted to its loose-pack format",
    /* Its absence is the game being faithful, not the game being worse: every tile set
     * it converts is already selectable, drawn by the tilesheet engine. And it is a
     * 25 MiB download. So the row starts clear. */
    preChecked: false,
    approxBytes: 25_780_914,
    payload: {
      kind: "archive",
      archives: [
        {
          path: "dist/neo-linoleum-mod.zip",
          sha256: "444ad879c7550827e4532dd8d53124b63095fe63b73674feb872345a55fe245a",
        },
        {
          path: "dist/neo-linoleum-original-tiles.zip",
          sha256: "8d894e8b657b47b1affbe68640e5304daca76a6a164c2ccab5b72763bc06ae32",
        },
        {
          path: "dist/neo-linoleum-adam-bolt.zip",
          sha256: "ae390e51191096006c1c602c7cdbceaabc217166bbca89c8c2e34c2679df6dde",
        },
        {
          path: "dist/neo-linoleum-gervais.zip",
          sha256: "a45a1a4758e409e7789dce3ba673c26ac795f38ccdf3b9894e71926c797fc7da",
        },
        {
          path: "dist/neo-linoleum-nomad.zip",
          sha256: "8349236290be9e4b9d12146006f9d30152525930d64661f997d23b9c41cab023",
        },
        {
          path: "dist/neo-linoleum-shockbolt-dark.zip",
          sha256: "0c892fdd128d6f6b3673052bb2e36c5d318f0ba81bdd046da1b300e802d4c39f",
        },
        {
          path: "dist/neo-linoleum-shockbolt-light.zip",
          sha256: "087aa80e370bd4d5d79c4c5a9ffd5828e06908b7a3caddd02b82cd7c6fb1ae8b",
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
