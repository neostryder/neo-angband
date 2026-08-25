/**
 * Carrying INSTALLED MODS up the port ladder, not just characters.
 *
 * origin-merge.ts rescues the roster, which lives in localStorage. It was the whole
 * story while a character was the only thing an origin held. It is not any more:
 * installed mods live in the SAME origin bucket, in IndexedDB (`neo-angband`, stores
 * `mods` and `modsMeta` - see web/idb.ts), and nothing carried them. So a port move
 * kept every character and silently dropped every mod, which is the worse half of the
 * loss to be silent about: a missing character is obvious on the next screen, while a
 * missing mod looks like the game simply changed its mind about what it does.
 *
 * WHY "THEY CAN BE RE-DOWNLOADED" IS NOT AN ANSWER. idb.ts calls these stores caches
 * of re-derivable things, and for the schema question it was right - there is no
 * migration ladder because there is nothing to migrate. It does not follow that the
 * player should have to re-derive them. A mod IMPORTED FROM A ZIP may have no live
 * repository at all, and the zip it came from has been moved aside into
 * `mods/imported/`; a mod whose author has since deleted the repo is gone for good.
 * Re-downloadable is a property of the lucky ones.
 *
 * `handles` IS DELIBERATELY LEFT BEHIND. A FileSystemDirectoryHandle is bound to the
 * origin that was granted it: copying the object to another origin either fails or
 * produces a handle with no permission, and the difference between those two is not
 * something this module can test for. It is also the one entry here that genuinely IS
 * trivially re-derivable - the player re-picks the folder - so the honest thing is to
 * not pretend and to say so in the report.
 *
 * Pure, for the same reason origin-merge.ts is: the rules are then tested rather than
 * trusted, and main.ts is left with only the Electron work of reading and writing an
 * origin's IndexedDB through a hidden window on that port.
 */

/*
 * The database this reaches into belongs to web/idb.ts, and these constants are a
 * SECOND copy of its schema - unavoidable, because the reader is an injected script in
 * a hidden window and cannot import from the web package. Opening with the wrong
 * version is not a soft failure: too low and the open is refused, too high and the
 * game's own open stops triggering its upgrade. So the copy is pinned by a test that
 * reads idb.ts and fails when the two part - because a comment asking the next reader
 * to keep two places in step is not a mechanism, and this is one of the places where
 * drifting apart is silent until a player's mods are gone.
 */
export const MOD_DB_NAME = "neo-angband";
export const MOD_DB_VERSION = 3;
export const STORE_MODS = "mods";
export const STORE_MOD_META = "modsMeta";
export const STORE_LINOLEUM = "linoleum";
/** Every store the version must create, in idb.ts's order. `handles` and `linoleum` are created and never read here - see the header. */
export const MOD_DB_STORES = ["handles", STORE_MODS, STORE_MOD_META, STORE_LINOLEUM] as const;

/**
 * One installed mod as it sits in an origin.
 *
 * `files` is keyed by the path WITHIN the mod (the `<modId>/` prefix of the store key
 * removed) with base64 bytes as the value. Base64 rather than Uint8Array because this
 * crosses `executeJavaScript`, where a typed array does not survive as itself; the
 * conversion happens at the edge in main.ts and this module never inspects a byte.
 */
export interface ModRecord {
  readonly id: string;
  /** The `modsMeta` value. Opaque here - this module never reads inside it. */
  readonly meta: unknown;
  readonly files: Readonly<Record<string, string>>;
}

export interface ModSnapshot {
  /** The loopback port whose origin this was. For reporting. */
  readonly port: number;
  readonly mods: readonly ModRecord[];
}

export interface SkippedMod {
  readonly id: string;
  readonly fromPort: number;
  /** A player-facing reason, already a whole sentence fragment. */
  readonly why: string;
}

export interface ModMergePlan {
  /** Mods to write into the target origin, whole. */
  readonly install: readonly ModRecord[];
  /** Mods deliberately not carried, each with the reason it was not. */
  readonly skipped: readonly SkippedMod[];
}

/**
 * Decide which mods to carry into the target origin.
 *
 * `sources` is newest-origin-first, the same convention planOriginMerge takes, so the
 * first snapshot holding a given mod is the one that supplies it.
 *
 * THE TARGET ALWAYS WINS. A mod already installed in the new origin is left exactly as
 * it is, and no version comparison is attempted - not because versions do not matter
 * but because the update machinery already owns that question, with the catalogue,
 * digests and the author's own tags behind it. A merge that quietly rolled a mod back
 * to whatever an abandoned origin happened to hold would be a downgrade the player did
 * not ask for and cannot see, performed by the recovery pass that was supposed to be
 * conservative.
 *
 * A MOD IS CARRIED WHOLE OR NOT AT ALL. Half a mod is worse than none: the loader would
 * find its manifest, start it, and fail on the first missing file - and it would fail
 * for a reason the player cannot act on, in a mod they never chose to break. So a
 * metadata row with no bytes behind it is skipped and SAID, rather than imported as an
 * entry that can only disappoint.
 */
export function planModMerge(
  target: readonly string[],
  sources: readonly ModSnapshot[],
): ModMergePlan {
  const install: ModRecord[] = [];
  const skipped: SkippedMod[] = [];
  const have = new Set(target);

  for (const src of sources) {
    for (const mod of src.mods) {
      if (have.has(mod.id)) {
        /* Silent only when the target's copy came from the target. A duplicate across
         * two SOURCES is worth a line, because the player may wonder where the other
         * one went - and the answer, that the newer origin's copy was taken, is not
         * guessable from the outside. */
        skipped.push({
          id: mod.id,
          fromPort: src.port,
          why: "already installed here, so the copy already in place was kept",
        });
        continue;
      }
      if (Object.keys(mod.files).length === 0) {
        skipped.push({
          id: mod.id,
          fromPort: src.port,
          why: "its files were missing, so only a broken entry could have been copied",
        });
        continue;
      }
      have.add(mod.id);
      install.push(mod);
    }
  }

  return { install, skipped };
}

/**
 * The lines the player is shown about the mods half of a recovery.
 *
 * Separate from the plan so the wording is testable without building an origin, and so
 * a silent outcome is IMPOSSIBLE TO WRITE BY ACCIDENT: this returns lines for a plan
 * that moved nothing but skipped something, which is exactly the case the old code got
 * wrong by having no code at all. An empty array means genuinely nothing happened -
 * no mods anywhere - and only then may the caller say nothing.
 */
export function modMergeLines(plan: ModMergePlan, failed: readonly string[] = []): string[] {
  const out: string[] = [];
  if (plan.install.length > 0) {
    const kept = plan.install.filter((m) => !failed.includes(m.id));
    if (kept.length > 0) {
      out.push(
        `Brought ${String(kept.length)} installed mod${kept.length === 1 ? "" : "s"} over:`,
        ...kept.map((m) => `  ${m.id}`),
      );
    }
  }
  if (failed.length > 0) {
    /* Named, not counted. A mod that did not make it has to be re-installed by name,
     * and a bare number tells the player they have a problem without telling them
     * which one it is. */
    out.push(
      `Could not bring ${String(failed.length)} over - re-install ${failed.length === 1 ? "it" : "them"} from the Mods screen:`,
      ...failed.map((id) => `  ${id}`),
    );
  }
  for (const s of plan.skipped) {
    out.push(`Left ${s.id} where it was: ${s.why}.`);
  }
  return out;
}
