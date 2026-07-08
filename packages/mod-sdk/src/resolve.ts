/**
 * Deterministic pack load-order resolution.
 *
 * Dependencies load before dependents (topological order); ties break
 * lexicographically by pack id so the order is reproducible on every
 * machine given the same pack set. Cycles and missing dependencies are
 * hard errors - a mod set either composes deterministically or fails
 * loudly before play.
 */

import type { PackManifest } from "./manifest.js";
import { ManifestError } from "./manifest.js";

export class ResolveError extends Error {}

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
    for (const dep of Object.keys(m.dependencies ?? {})) {
      if (!byId.has(dep)) {
        throw new ResolveError(`pack ${m.id} requires missing pack ${dep}`);
      }
    }
  }

  // Kahn's algorithm with a sorted frontier for determinism.
  const remainingDeps = new Map<string, Set<string>>();
  const dependents = new Map<string, string[]>();
  for (const m of manifests) {
    remainingDeps.set(m.id, new Set(Object.keys(m.dependencies ?? {})));
    for (const dep of Object.keys(m.dependencies ?? {})) {
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
