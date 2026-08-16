/**
 * Bundled legacy tileset pack configurations.
 *
 * Faithful port of the $allPacks table in the upstream fork's
 * scripts/build-linoleum-packs.ps1.
 */

/** Configuration for one convertible legacy tileset. */
export interface PackConfig {
  /** Pack key used on the command line and as the output directory name. */
  key: string;
  /** Pack id written into manifest.txt. */
  packId: string;
  /** Human-readable display name. */
  displayName: string;
  /** Legacy graphics mode name. */
  sourceMode: string;
  /** Source directory name under the tiles root. */
  sourceDirectory: string;
  /** Tilesheet image file name inside the source directory. */
  imageFile: string;
  /** Nominal resolution written into the manifest and images/<res>/ dir. */
  resolution: number;
  /** Tile width when it differs from the nominal resolution. */
  tileWidth?: number;
  /** Tile height when it differs from the nominal resolution. */
  tileHeight?: number;
  /** First double-height overdraw row (0 = no overdraw). */
  overdrawRow?: number;
  /** Last double-height overdraw row. */
  overdrawMax?: number;
  /** Primary graphics pref file. */
  primaryPref: string;
  /** All pref files read for selectors and mirrored into the pack. */
  prefFiles: readonly string[];
}

/** All six bundled pack configurations, in the ps1's order. */
export const ALL_PACKS: readonly PackConfig[] = [
  {
    key: "original-tiles",
    packId: "linoleum-original-tiles",
    displayName: "Original Tiles (Linoleum)",
    sourceMode: "Original Tiles",
    sourceDirectory: "old",
    imageFile: "8x8.png",
    resolution: 8,
    primaryPref: "graf-xxx.prf",
    prefFiles: ["graf-xxx.prf", "xtra-xxx.prf", "flvr-xxx.prf"],
  },
  {
    key: "adam-bolt",
    packId: "linoleum-adam-bolt",
    displayName: "Adam Bolt's tiles (Linoleum)",
    sourceMode: "Adam Bolt's tiles",
    sourceDirectory: "adam-bolt",
    imageFile: "16x16.png",
    resolution: 16,
    primaryPref: "graf-new.prf",
    prefFiles: ["graf-new.prf", "xtra-new.prf", "flvr-new.prf"],
  },
  {
    key: "gervais",
    packId: "linoleum-gervais",
    displayName: "David Gervais' tiles (Linoleum)",
    sourceMode: "David Gervais' tiles",
    sourceDirectory: "gervais",
    imageFile: "32x32.png",
    resolution: 32,
    primaryPref: "graf-dvg.prf",
    prefFiles: ["graf-dvg.prf", "xtra-dvg.prf", "flvr-dvg.prf"],
  },
  {
    key: "nomad",
    packId: "linoleum-nomad",
    displayName: "Nomad's tiles (Linoleum)",
    sourceMode: "Nomad's tiles",
    sourceDirectory: "nomad",
    imageFile: "8x16.png",
    resolution: 16,
    tileWidth: 8,
    tileHeight: 16,
    primaryPref: "graf-nmd.prf",
    prefFiles: ["graf-nmd.prf", "xtra-nmd.prf", "flvr-nmd.prf"],
  },
  {
    key: "shockbolt-dark",
    packId: "linoleum-shockbolt-dark",
    displayName: "Shockbolt Dark (Linoleum)",
    sourceMode: "Shockbolt Dark",
    sourceDirectory: "shockbolt",
    imageFile: "64x64.png",
    resolution: 64,
    overdrawRow: 27,
    overdrawMax: 31,
    primaryPref: "graf-shb-dark.prf",
    prefFiles: ["graf-shb-dark.prf", "xtra-shb.prf", "flvr-shb.prf"],
  },
  {
    key: "shockbolt-light",
    packId: "linoleum-shockbolt-light",
    displayName: "Shockbolt Light (Linoleum)",
    sourceMode: "Shockbolt Light",
    sourceDirectory: "shockbolt",
    imageFile: "64x64.png",
    resolution: 64,
    overdrawRow: 27,
    overdrawMax: 31,
    primaryPref: "graf-shb-light.prf",
    prefFiles: ["graf-shb-light.prf", "xtra-shb.prf", "flvr-shb.prf"],
  },
];

/**
 * Resolve pack keys to configurations, preserving request order.
 * Throws for unknown keys with the ps1's message.
 */
export function selectPacks(packKeys: readonly string[] | undefined): readonly PackConfig[] {
  if (packKeys === undefined || packKeys.length === 0) {
    return ALL_PACKS;
  }

  const lookup = new Map<string, PackConfig>();
  for (const pack of ALL_PACKS) {
    lookup.set(pack.key, pack);
  }

  return packKeys.map((key) => {
    const pack = lookup.get(key);
    if (pack === undefined) {
      throw new Error(`Unknown pack key '${key}'.`);
    }
    return pack;
  });
}
