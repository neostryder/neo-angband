/**
 * Bind compiled store records (packages/content/pack/store.json) into the
 * runtime store model, ported from the parsing side of reference/src/store.c
 * (init_parse_stores / store_parser_new / store_owner_parser_new) and
 * store_at (Angband 4.2.6).
 *
 * This is the data-binding slice of the store subsystem. It resolves each
 * store's entrance feature, owners, always/normal stocking tables (tval + sval
 * names -> object kinds), and buy list. The behavioural half of store.c
 * (pricing, stock maintenance, buying/selling, town placement) belongs to
 * later increments; see store/types.ts.
 *
 * A STOCK LINE A MOD CONTRIBUTED CANNOT TAKE THE BOOT DOWN. `append` on a
 * store's `normal` / `always` table (mod-sdk patch.ts) is the op that lets one
 * mod put an item in a shop, and it made this file's `lookupSval` miss reachable
 * from an ordinary pair of mods: mod A stocks an item mod B defines, the player
 * turns mod B off, and `store: unknown sval` came out of `bindCore` inside
 * `startGame` at module top level - so the whole game showed the crash screen
 * instead of the shop showing one line fewer. That is the failure the mod
 * resilience contract exists to forbid, so a mod-contributed line that resolves
 * to nothing is now DROPPED and collected in `StoreRegistry.refused`, which the
 * host turns into a per-mod fault.
 *
 * CORE'S OWN DATA STILL THROWS, and `stockOwner` below is the whole of how the
 * two are told apart.
 */

import { FEAT, OF } from "../generated/index.js";
import { tvalFindIdx } from "../obj/bind.js";
import type { ObjRegistry } from "../obj/bind.js";
import type { ObjectKind } from "../obj/types.js";
import { attachExt, provenanceOf } from "../mod/extension.js";
import type { RecordProvenance } from "../mod/extension.js";
import { CORE_NS } from "../mod/ids.js";
import type {
  BoundStore,
  ObjectBuy,
  StoreBuyJson,
  StoreItemJson,
  StoreOwner,
  StoreRecordJson,
} from "./types.js";

/** Resolve a FEAT_* name (the store record's `store` key) to its index. */
function featByName(name: string): number {
  const feat = (FEAT as Record<string, number>)[name];
  if (feat === undefined) {
    throw new Error(`store: unknown entrance feature ${name}`);
  }
  return feat;
}

/** Resolve an OF_* flag name to its index (for flag-qualified buy rules). */
function flagByName(name: string): number {
  const flag = (OF as Record<string, number>)[name];
  if (flag === undefined) {
    throw new Error(`store: unknown buy flag ${name}`);
  }
  return flag;
}

/** Which of a store record's two stocking tables a line came from. */
export type StoreStockTable = "normal" | "always";

/**
 * One stock line that resolved to no object kind and was dropped rather than
 * thrown, because a mod contributed it.
 *
 * ATTRIBUTED, NOT PREFIXED, the same way the host's own `ModProblem` is: the mod
 * manager has to be able to ask "what is wrong with THIS mod" and get an answer
 * without parsing punctuation, so the pack id rides beside the sentence.
 */
export interface StoreStockRefusal {
  /** FEAT_* name of the store whose table lost the line. */
  readonly store: string;
  /** Which table it was dropped from. */
  readonly table: StoreStockTable;
  /** The pack the fault is attributed to - never `core`. */
  readonly id: string;
  /** What went wrong, in the player's terms, with no id prefix. */
  readonly why: string;
}

/** A resolved table entry, or the reason it resolved to nothing. */
type StockResolution = { readonly kind: ObjectKind } | { readonly why: string };

/**
 * Resolve a `{tval, sval}` table entry (sval required) to its object kind.
 *
 * Returns the miss rather than throwing it: whether a miss is fatal depends on
 * WHOSE line it is, which is a question about the record's provenance and not
 * about the entry, so the decision belongs to the caller. The four `why`
 * strings are the four messages this function used to throw, verbatim, so a
 * core-owned miss still reads exactly as it did.
 */
function resolveKind(item: StoreItemJson, reg: ObjRegistry): StockResolution {
  const tval = tvalFindIdx(item.tval);
  if (tval < 0) return { why: `unknown tval ${item.tval}` };
  if (item.sval === undefined) {
    return { why: `table entry ${item.tval} needs an sval` };
  }
  const sval = reg.lookupSval(tval, item.sval);
  if (sval < 0) return { why: `unknown sval ${item.tval}:${item.sval}` };
  const kind = reg.lookupKind(tval, sval);
  if (!kind) return { why: `no kind ${item.tval}:${item.sval}` };
  return { kind };
}

/** Two table entries as the same line, compared the way the JSON spells them. */
function sameItem(a: unknown, b: StoreItemJson): boolean {
  if (typeof a !== "object" || a === null) return false;
  const other = a as StoreItemJson;
  return other.tval === b.tval && other.sval === b.sval;
}

/**
 * The pack answerable for one stock line, or null when the base game is.
 *
 * THIS IS THE WHOLE CORE-VERSUS-MOD DISTINCTION, so it is worth saying exactly
 * what each answer rests on.
 *
 *   - No provenance at all means no pack touched the record (`stampProvenance`
 *     leaves the base game's own untouched records unmarked, on purpose). Every
 *     line is core's, and a miss throws. This is the case for all eight shipped
 *     stores in a modless game, and it is what makes "core's data fails loudly"
 *     true of the path that actually guards core - the whole test suite and
 *     every unmodded boot run through it.
 *   - `was[table]` is the DEFINING pack's own value for a table a later pack
 *     changed (mod-sdk provenance.ts). A line deep-equal to one of those entries
 *     is the definer's, so it is core's when core defined the record - and a
 *     mod's own when a mod did, which is why a mod's bad line in a store it
 *     defines itself does not throw either.
 *   - Anything else in the table arrived from a modifier. The LAST modifier is
 *     named, because load order applies patches in order and it is the only one
 *     of them core can single out; the message carries the full list so a fault
 *     landing on the wrong row is still traceable.
 *
 * THE ONE CASE THIS DECIDES IN THE MOD'S FAVOUR WITHOUT PROOF: `was` records
 * only fields the definer HAD and a patch CHANGED, so an absent `was[table]`
 * means either "core's table, which nothing changed" or "a table core never had
 * and a mod added outright". Provenance cannot separate those two, and this
 * returns the last modifier for both. Deciding it the other way would turn a
 * mod's added table back into a failed boot, which is the defect this file is
 * fixing; deciding it this way can only ever downgrade a broken CORE line to a
 * reported drop, and only on a record a mod has already patched.
 */
function stockOwner(
  from: RecordProvenance | undefined,
  table: StoreStockTable,
  item: StoreItemJson,
): string | null {
  if (from === undefined) return null;
  const definer = from.was?.[table];
  const mods = from.modifiedBy ?? [];
  const answerable =
    Array.isArray(definer) && definer.some((d) => sameItem(d, item))
      ? from.owner
      : (mods[mods.length - 1] ?? from.owner);
  /* Never blame core, and never excuse it. A stamped record with no modifiers is
   * a mod's own (an unmodified base-game record is not stamped at all), so this
   * guard should be unreachable - but a hand-written `$from` is a shape this
   * file has to survive, and putting "core" on the mod manager's own row would
   * be worse than throwing. */
  return answerable === CORE_NS ? null : answerable;
}

/**
 * One dropped line, said the way a player reading the mod manager needs it.
 *
 * Names the store, the table and the entry, because "which line" is the only
 * question a mod author has after "which mod".
 *
 * The pack list is appended only when TWO OR MORE packs patched the store, and
 * that condition is the honest one rather than a tidy one: attribution picks the
 * last modifier and cannot prove it, so the set is worth showing exactly when
 * there was a choice to get wrong. One modifier is the ordinary case, the
 * attribution is then certain, and it should not pay a parenthetical.
 */
function refusalWhy(
  rec: StoreRecordJson,
  table: StoreStockTable,
  why: string,
  from: RecordProvenance,
): string {
  const mods = from.modifiedBy ?? [];
  const also =
    mods.length > 1
      ? ` (packs touching this store: ${[from.owner, ...mods].join(", ")})`
      : "";
  return `${rec.store}: ${table} stock line dropped - ${why}${also}`;
}

/** Resolve one buy entry (bare tval string, or `{tval, flag}` object). */
function resolveBuy(entry: StoreBuyJson): ObjectBuy {
  if (typeof entry === "string") {
    const tval = tvalFindIdx(entry);
    if (tval < 0) throw new Error(`store: unknown buy tval ${entry}`);
    return { tval, flag: 0 };
  }
  const tval = tvalFindIdx(entry.tval);
  if (tval < 0) throw new Error(`store: unknown buy tval ${entry.tval}`);
  return { tval, flag: entry.flag ? flagByName(entry.flag) : 0 };
}

/**
 * Bind a single store record. This is the semantic half of parse_store
 * (store.c:132) and its sibling directive handlers (parse_slots, parse_turnover,
 * parse_normal, parse_always, parse_buy): the grammar itself lives in
 * packages/content/src/specs/misc.ts storeSpec, and the record arrives here
 * already tokenised.
 *
 * Two upstream parse-time behaviours are deliberately absent, both recorded in
 * parity/phase3-2026-07-25/findings/W1-CITED.md: the TF_SHOP check on the
 * entrance feature (store.c:135-137, a validation on trusted data), and
 * ordering the store array by the feature's shopnum (L142). Stores here keep
 * store.txt order and are looked up by feature (store_at -> byFeat), which
 * matches shopnum order for the shipped data.
 *
 * `refused` collects the mod-contributed stock lines that resolved to nothing,
 * which are dropped instead of thrown - see the file header and `stockOwner`.
 * Optional because a caller that passes none is not asking for a different
 * policy, only declining to listen: the drop happens either way, and
 * `StoreRegistry` is the caller that keeps the list for the host to report.
 */
export function bindStore(
  rec: StoreRecordJson,
  reg: ObjRegistry,
  refused?: StoreStockRefusal[],
): BoundStore {
  const owners: StoreOwner[] = rec.owner.map((o, index) => ({
    index,
    name: o.name,
    maxCost: o.purse,
  }));

  const from = provenanceOf(rec);
  /**
   * One stock line, or null when it resolved to nothing and was a mod's to get
   * wrong. A core-owned miss throws here with exactly the message it always
   * threw - the `store: ` prefix included.
   */
  const stockKind = (it: StoreItemJson, table: StoreStockTable): ObjectKind | null => {
    const res = resolveKind(it, reg);
    if ("kind" in res) return res.kind;
    const owner = stockOwner(from, table, it);
    if (owner === null || from === undefined) throw new Error(`store: ${res.why}`);
    refused?.push({
      store: rec.store,
      table,
      id: owner,
      why: refusalWhy(rec, table, res.why, from),
    });
    return null;
  };

  /* `always:` entries with an sval resolve to a specific kind; entries with
   * no sval are the bookseller's town-book lines, expanded at store.ts:173. */
  const alwaysTable: ObjectKind[] = [];
  const alwaysBookTvals: number[] = [];
  for (const it of rec.always ?? []) {
    if (it.sval === undefined) {
      const tval = tvalFindIdx(it.tval);
      if (tval < 0) {
        /* A book line whose tval names nothing. Routed through the same policy
         * as a `{tval, sval}` miss rather than throwing on the spot, because a
         * mod appending to `always:` can get either shape wrong and only one of
         * them being survivable would be an arbitrary line. */
        const owner = stockOwner(from, "always", it);
        if (owner === null || from === undefined) {
          throw new Error(`store: unknown always tval ${it.tval}`);
        }
        refused?.push({
          store: rec.store,
          table: "always",
          id: owner,
          why: refusalWhy(rec, "always", `unknown always tval ${it.tval}`, from),
        });
        continue;
      }
      alwaysBookTvals.push(tval);
    } else {
      const kind = stockKind(it, "always");
      if (kind) alwaysTable.push(kind);
    }
  }
  const normalTable: ObjectKind[] = [];
  for (const it of rec.normal ?? []) {
    const kind = stockKind(it, "normal");
    if (kind) normalTable.push(kind);
  }
  const buy = rec.buy ? rec.buy.map(resolveBuy) : null;

  return {
    feat: featByName(rec.store),
    featName: rec.store,
    owners,
    alwaysTable,
    alwaysBookTvals,
    normalTable,
    buy,
    turnover: rec.turnover ?? 0,
    normalStockMin: rec.slots?.min ?? 0,
    normalStockMax: rec.slots?.max ?? 0,
  };
}

/**
 * The bound set of stores, indexable by entrance feature. Mirrors the global
 * `stores` array; `byFeat` is the store_at lookup (given a town grid's feature,
 * which store is it?).
 */
export class StoreRegistry {
  readonly stores: BoundStore[];

  /**
   * The mod-contributed stock lines this bind dropped, in record order.
   *
   * ON THE REGISTRY RATHER THAN RETURNED, because `bindCore` builds a dozen
   * registries and hands back one object; a second return channel would have to
   * be threaded through `bindCore`, `bootLevel`, `startGame` AND `loadGame` to
   * reach the host, and both game paths already expose `booted.registries`. The
   * list is a fact about this bind, so a second character's boot starts with an
   * empty one for free - which a module-level collector would not.
   *
   * Empty for the shipped pack with no mods loaded. See `bindStore`.
   */
  readonly refused: readonly StoreStockRefusal[];

  constructor(records: StoreRecordJson[], reg: ObjRegistry) {
    const refused: StoreStockRefusal[] = [];
    this.stores = records.map((rec) => attachExt("store", rec, bindStore(rec, reg, refused)));
    this.refused = refused;
  }

  /** store_at: the store whose entrance feature matches, or null. */
  byFeat(feat: number): BoundStore | null {
    return this.stores.find((s) => s.feat === feat) ?? null;
  }

  /** The store with the given FEAT_* name, or null. */
  byName(featName: string): BoundStore | null {
    return this.stores.find((s) => s.featName === featName) ?? null;
  }
}
