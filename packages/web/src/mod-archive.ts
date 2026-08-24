/**
 * Bounded ZIP reading shared by every mod archive door.
 *
 * Archive headers are untrusted. The filter sees them before fflate starts
 * decompressing, which is the last cheap place to reject a hostile archive.
 */

import { unzipSync } from "fflate";

export interface ZipLimits {
  /** The .zip itself, refused before it is opened. */
  readonly maxArchiveBytes: number;
  readonly maxEntries: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  /** How much bigger than its compressed form one entry may claim to be. */
  readonly maxRatio: number;
}

/**
 * The limits are set by what real tile mods need: the largest shipped tileset is
 * 17.5 MB, so 64 MB for one file and 128 MB total are generous but finite.
 */
export const ZIP_LIMITS: ZipLimits = {
  maxArchiveBytes: 64 * 1024 * 1024,
  maxEntries: 4096,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxRatio: 200,
};

/** The resources already claimed by earlier archives in one install. */
export interface ZipBudget {
  archiveBytes: number;
  entries: number;
  totalBytes: number;
}

export function zipBudget(): ZipBudget {
  return { archiveBytes: 0, entries: 0, totalBytes: 0 };
}

export type BoundedZipRead =
  | {
      readonly ok: true;
      readonly unpacked: Record<string, Uint8Array>;
      readonly names: ReadonlySet<string>;
    }
  | { readonly ok: false; readonly problem: string };

export interface BoundedZipOptions {
  readonly limits?: ZipLimits;
  /** Accumulates archive-byte, entry, and expanded-byte ceilings across ZIPs. */
  readonly budget?: ZipBudget;
  /** Packaging noise the caller deliberately does not need unpacked. */
  readonly skip?: (name: string) => boolean;
}

/**
 * Unpack a ZIP only after bounding every header fflate exposes, then verify the
 * measured output as well. `budget` makes the aggregate limits apply when one
 * install declares more than one archive.
 */
export function readBoundedZip(bytes: Uint8Array, options: BoundedZipOptions = {}): BoundedZipRead {
  const limits = options.limits ?? ZIP_LIMITS;
  const budget = options.budget;
  if (bytes.length > limits.maxArchiveBytes) {
    return {
      ok: false,
      problem: `this file is ${mb(bytes.length)}, over the ${mb(limits.maxArchiveBytes)} limit for a mod`,
    };
  }
  if (budget && budget.archiveBytes + bytes.length > limits.maxArchiveBytes) {
    return {
      ok: false,
      problem: `the archive payloads total more than ${mb(limits.maxArchiveBytes)}`,
    };
  }
  if (budget) budget.archiveBytes += bytes.length;

  const names = new Set<string>();
  let refusal: string | null = null;
  let count = budget?.entries ?? 0;
  const refuse = (why: string): boolean => {
    refusal ??= why;
    return false;
  };

  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(bytes, {
      filter: (file) => {
        if (refusal !== null) return false;
        if (++count > limits.maxEntries) {
          return refuse(`the archive has more than ${limits.maxEntries} entries`);
        }
        if (budget) budget.entries = count;
        if (names.has(file.name)) return refuse(`"${file.name}" appears twice in the archive`);
        names.add(file.name);
        if (file.name.endsWith("/")) return false;
        if (options.skip?.(file.name)) return false;
        if (file.originalSize > Math.max(file.size, 1) * limits.maxRatio) {
          return refuse(
            `"${file.name}" is ${mb(file.size)} compressed and claims to unpack to ` +
              `${mb(file.originalSize)}, which no mod file does`,
          );
        }
        if (file.originalSize > limits.maxFileBytes) {
          return refuse(
            `"${file.name}" says it unpacks to ${mb(file.originalSize)}, ` +
              `over the ${mb(limits.maxFileBytes)} limit for one file`,
          );
        }
        return true;
      },
    });
  } catch (e) {
    return { ok: false, problem: `this is not a readable zip (${message(e)})` };
  }
  if (refusal !== null) return { ok: false, problem: refusal };

  let total = budget?.totalBytes ?? 0;
  for (const [name, body] of Object.entries(unpacked)) {
    if (body.length > limits.maxFileBytes) {
      return { ok: false, problem: `"${name}" unpacked to ${mb(body.length)}, over the limit` };
    }
    total += body.length;
    if (total > limits.maxTotalBytes) {
      return { ok: false, problem: `the archive unpacks to more than ${mb(limits.maxTotalBytes)}` };
    }
  }
  if (budget) budget.totalBytes = total;
  return { ok: true, unpacked, names };
}

/** Sizes as a player reads them, so a refusal names a number they can act on. */
function mb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
