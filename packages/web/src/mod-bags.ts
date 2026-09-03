/**
 * Bringing each mod's private save bag up to the schema that mod is now at.
 *
 * WHAT A BAG IS. A mod may keep arbitrary JSON of its own in the save
 * (`GameState.mods["<id>"]`), which core round-trips verbatim and never reads.
 * The bag records the mod's `saveSchema` at the moment it was written, so a mod
 * that later changes the SHAPE of its own data can recognise the old shape and
 * rewrite it. Core ships the rewrite step (`migrateModBag`) and refuses to
 * participate in the rewrite itself - it cannot, it has no idea what is in there.
 *
 * WHAT WAS MISSING. Everything above existed and nothing called it.
 * `migrateModBag` had tests and no production caller, `saveSchema` was parsed
 * from the manifest and carried into the pack record and read by nobody, and the
 * plugin ABI had no way for a mod to supply the migrator the seam is named after.
 * So a mod that bumped its schema got its OLD data handed back, at the new
 * version, with no signal - which is worse than getting nothing, because the mod
 * cannot tell the difference and neither can the player.
 *
 * WHERE IT RUNS. At mod-load time, after the save has been read and before any
 * plugin's `register()` - the first point where a bag exists and the last one
 * before a mod's own code could read it.
 *
 * WHAT IT WILL NOT DO. It never invents a migration. A bag behind the mod's
 * current schema with no migrator to run is left EXACTLY as it was and reported;
 * rewriting it to look current, or dropping it, would both destroy the only copy
 * of data the mod might still be able to recover. Same for a migrator that
 * throws: the old bag stands. The mod can still read `schema` off its own bag and
 * decide for itself, which is the fallback for a mod that would rather handle it
 * inline than ship a migrator.
 */

import { migrateModBag, type JsonValue, type ModBag } from "@rpgm-tools/neo-angband-core";
import { faultMessage, type ModProblem } from "./mod-problems";

/** A mod's own migrator, as the plugin ABI declares it. */
export type BagMigrateFn = (data: JsonValue, fromSchema: number) => JsonValue;
/** The API-2 form crosses a Worker boundary, so it returns asynchronously. */
export type AsyncBagMigrateFn = (data: JsonValue, fromSchema: number) => Promise<JsonValue>;

/** One mod, as this pass needs to see it. */
export interface BagOwner {
  readonly id: string;
  /** The schema its manifest declares now; undefined when it declares none. */
  readonly saveSchema: number | undefined;
  /** Its `migrateBag`, already bound to the plugin; undefined when it ships none. */
  readonly migrate: BagMigrateFn | undefined;
}

export interface AsyncBagOwner extends Omit<BagOwner, "migrate"> {
  readonly migrate: AsyncBagMigrateFn | undefined;
}

export interface BagMigrationResult {
  /** The bags to install on the state - a new object only when something changed. */
  readonly bags: Record<string, ModBag>;
  /** The ids whose bag was actually rewritten, for the log line. */
  readonly migrated: readonly string[];
  /** Anything the player should be told, attributed per mod. */
  readonly problems: readonly ModProblem[];
}

/**
 * Migrate every bag whose owning mod has moved past it.
 *
 * Pure: takes the bags and the owners, returns new bags and what went wrong.
 * The alternative - reaching into GameState here - would make the interesting
 * cases (no migrator, a throwing migrator, a bag from a NEWER version of the mod)
 * reachable only by booting a game.
 */
export function migrateModBags(
  bags: Readonly<Record<string, ModBag>>,
  owners: readonly BagOwner[],
): BagMigrationResult {
  const out: Record<string, ModBag> = { ...bags };
  const migrated: string[] = [];
  const problems: ModProblem[] = [];

  for (const owner of owners) {
    const bag = bags[owner.id];
    if (!bag) continue; // the mod has never saved anything
    const target = owner.saveSchema;
    if (target === undefined) continue; // declares no schema, so nothing to be behind

    if (bag.schema > target) {
      /* The bag is AHEAD of the mod. This is a downgrade - the player rolled the
       * mod back, or restored a save written with a later version of it - and it is
       * worth saying out loud, because the mod is about to read data in a shape it
       * predates. Nothing is changed: a "migration" backwards is something only the
       * mod's author could write, and inventing one here would be guessing at data
       * this module cannot even see. */
      problems.push({
        id: owner.id,
        why:
          `its saved data was written by a newer version of it (data schema ${String(bag.schema)}, ` +
          `this version reads ${String(target)}) - the data is kept as it is, but the mod may ` +
          `not understand all of it`,
      });
      continue;
    }
    if (bag.schema === target) continue;

    if (!owner.migrate) {
      /* Behind, and the mod ships nothing to bring it forward. Left untouched and
       * reported: this module will not fabricate a migration, and stamping the
       * schema forward over unchanged data would tell the mod a lie it cannot
       * check. */
      problems.push({
        id: owner.id,
        why:
          `its saved data is at schema ${String(bag.schema)} and this version expects ` +
          `${String(target)}, but the mod ships no migrateBag - the old data is kept ` +
          `untouched and the mod has to cope with it`,
      });
      continue;
    }

    try {
      const next = migrateModBag(bag, target, (data, from) => owner.migrate!(data, from));
      if (next.data === undefined) {
        /* A migrator that returns nothing has not migrated anything, and storing
         * `undefined` as the bag would lose the data outright. */
        problems.push({
          id: owner.id,
          why: `its migrateBag returned nothing, so the old saved data is kept unchanged`,
        });
        continue;
      }
      out[owner.id] = next;
      migrated.push(owner.id);
    } catch (e) {
      /* The old bag stands. A half-applied migration written back over the only
       * copy is the one outcome worse than not migrating. */
      problems.push({
        id: owner.id,
        why:
          `its migrateBag threw while bringing saved data from schema ${String(bag.schema)} ` +
          `to ${String(target)}, so the old data is kept unchanged: ${faultMessage(e)}`,
      });
    }
  }

  return { bags: migrated.length > 0 ? out : bags, migrated, problems };
}

/** API-2 equivalent of migrateModBags. The old bag remains authoritative on failure. */
export async function migrateModBagsAsync(
  bags: Readonly<Record<string, ModBag>>,
  owners: readonly AsyncBagOwner[],
): Promise<BagMigrationResult> {
  const out: Record<string, ModBag> = { ...bags };
  const migrated: string[] = [];
  const problems: ModProblem[] = [];
  for (const owner of owners) {
    const bag = bags[owner.id];
    const target = owner.saveSchema;
    if (!bag || target === undefined || bag.schema === target) continue;
    if (bag.schema > target) {
      problems.push({ id: owner.id, why: `its saved data was written by a newer version of it (data schema ${String(bag.schema)}, this version reads ${String(target)}) - the data is kept as it is` });
      continue;
    }
    if (!owner.migrate) {
      problems.push({ id: owner.id, why: `its saved data is at schema ${String(bag.schema)} and this version expects ${String(target)}, but the mod ships no migrateBag - the old data is kept untouched` });
      continue;
    }
    try {
      const data = await owner.migrate(bag.data, bag.schema);
      if (data === undefined) throw new Error("returned nothing");
      out[owner.id] = { schema: target, data };
      migrated.push(owner.id);
    } catch (err) {
      problems.push({ id: owner.id, why: `its migrateBag failed while bringing saved data from schema ${String(bag.schema)} to ${String(target)}, so the old data is kept unchanged: ${faultMessage(err)}` });
    }
  }
  return { bags: migrated.length > 0 ? out : bags, migrated, problems };
}
