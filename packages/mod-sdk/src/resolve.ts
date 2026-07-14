/**
 * Deterministic pack load-order resolution.
 *
 * Dependencies load before dependents (topological order); ties break
 * lexicographically by pack id so the order is reproducible on every
 * machine given the same pack set. Cycles and missing dependencies are
 * hard errors - a mod set either composes deterministically or fails
 * loudly before play.
 *
 * Beyond hard `dependencies`, MOD_LIFECYCLE.md section 3 defines two more
 * ordering inputs, both soft (their absence is never an error):
 *
 *  - `optionalDependencies`: if the named pack is present, it loads first
 *    and its version is checked against the declared range exactly like a
 *    hard dependency; if it is absent, it is silently skipped.
 *  - `loadAfter` / `loadBefore`: pure ordering hints among present packs,
 *    with no version semantics. `loadBefore` is implemented as the mirror
 *    of `loadAfter` (X.loadBefore = [Y] adds the same edge as Y.loadAfter
 *    = [X]).
 *
 * All of these contribute edges to the same topological sort, so a cycle
 * created by mixing dependencies with loadAfter/loadBefore is rejected
 * exactly like a dependency cycle.
 */

import type { PackManifest } from "./manifest.js";
import { ManifestError } from "./manifest.js";
import { satisfies, SemverError } from "./semver.js";

export class ResolveError extends Error {}

/**
 * Verify a present dependency's version range, throwing ResolveError with a
 * plain-language message naming the fix. Used for both hard `dependencies`
 * and `optionalDependencies` that happen to be present.
 */
function checkVersionRange(
  dependentId: string,
  depId: string,
  range: string,
  byId: ReadonlyMap<string, PackManifest>,
): void {
  const dep = byId.get(depId) as PackManifest;
  let ok: boolean;
  try {
    ok = satisfies(dep.version, range);
  } catch (err) {
    const reason = err instanceof SemverError ? err.message : String(err);
    throw new ResolveError(
      `pack ${dependentId} declares an invalid version range "${range}" for ${depId}: ${reason}`,
    );
  }
  if (!ok) {
    throw new ResolveError(
      `pack ${dependentId} requires ${depId} ${range} but ${dep.version} is installed`,
    );
  }
}

/** Order manifests so every pack follows all of its dependencies. */
export function resolveLoadOrder(
  manifests: readonly PackManifest[],
): PackManifest[] {
  const byId = new Map<string, PackManifest>();
  for (const m of manifests) {
    if (byId.has(m.id)) {
      throw new ManifestError(`duplicate pack id: ${m.id}`);
    }
    byId.set(m.id, m);
  }

  for (const m of manifests) {
    for (const [dep, range] of Object.entries(m.dependencies ?? {})) {
      if (!byId.has(dep)) {
        throw new ResolveError(`pack ${m.id} requires missing pack ${dep}`);
      }
      checkVersionRange(m.id, dep, range, byId);
    }
    for (const [dep, range] of Object.entries(m.optionalDependencies ?? {})) {
      if (!byId.has(dep)) continue; // absence of an optional dependency is not an error
      checkVersionRange(m.id, dep, range, byId);
    }
  }

  // Collect, per pack, the full set of ids that must load before it: hard
  // deps, present optional deps, present loadAfter, and the reverse edge
  // for every present pack's loadBefore. Built as per-id Sets so that the
  // same edge declared twice (e.g. both a hard dependency and a loadAfter
  // entry) collapses to one edge instead of a duplicate that would corrupt
  // the Kahn in-degree bookkeeping below.
  const prereqs = new Map<string, Set<string>>();
  for (const m of manifests) {
    prereqs.set(m.id, new Set());
  }
  for (const m of manifests) {
    const set = prereqs.get(m.id) as Set<string>;
    for (const dep of Object.keys(m.dependencies ?? {})) {
      set.add(dep);
    }
    for (const dep of Object.keys(m.optionalDependencies ?? {})) {
      if (byId.has(dep)) set.add(dep);
    }
    for (const after of m.loadAfter ?? []) {
      if (byId.has(after)) set.add(after);
    }
  }
  for (const m of manifests) {
    for (const before of m.loadBefore ?? []) {
      // m must load before `before`: that is the same edge as
      // `before`.loadAfter including m, so add it to before's prereq set.
      const set = prereqs.get(before);
      if (set !== undefined) set.add(m.id);
    }
  }

  // Kahn's algorithm with a sorted frontier for determinism.
  const remainingDeps = new Map<string, Set<string>>();
  const dependents = new Map<string, string[]>();
  for (const m of manifests) {
    remainingDeps.set(m.id, new Set(prereqs.get(m.id)));
    for (const dep of prereqs.get(m.id) as Set<string>) {
      const list = dependents.get(dep) ?? [];
      list.push(m.id);
      dependents.set(dep, list);
    }
  }

  const frontier = [...remainingDeps.entries()]
    .filter(([, deps]) => deps.size === 0)
    .map(([id]) => id)
    .sort();
  const order: PackManifest[] = [];

  while (frontier.length > 0) {
    const id = frontier.shift() as string;
    order.push(byId.get(id) as PackManifest);
    for (const dependent of dependents.get(id) ?? []) {
      const deps = remainingDeps.get(dependent) as Set<string>;
      deps.delete(id);
      if (deps.size === 0) {
        // Insert keeping the frontier sorted.
        const at = frontier.findIndex((f) => f > dependent);
        if (at === -1) frontier.push(dependent);
        else frontier.splice(at, 0, dependent);
      }
    }
  }

  if (order.length !== manifests.length) {
    const stuck = [...remainingDeps.entries()]
      .filter(([, deps]) => deps.size > 0)
      .map(([id]) => id)
      .sort();
    throw new ResolveError(`dependency cycle among packs: ${stuck.join(", ")}`);
  }
  return order;
}
