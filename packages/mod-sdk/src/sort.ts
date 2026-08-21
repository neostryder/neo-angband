/**
 * The auto-sort: turn everyone's preferences into one order, and never fail.
 *
 * WHY THIS IS SEPARATE FROM resolveLoadOrder. That function ENFORCES: it takes a
 * list the player already chose and refuses to compose an impossible one
 * (a missing dependency, a cycle). This one PROPOSES: it takes the same inputs
 * plus everything anyone merely prefers, and answers with an order the player
 * can accept or ignore. The distinction is the whole compatibility model in one
 * line - an author has total authority over their own mod's contributions and
 * none over the player's order, so nothing an author writes can stop a launch,
 * and the strongest thing an author's preference can do is lose quietly.
 *
 * THE TIERS, strongest first. Every edge carries one, and that is the only thing
 * that decides which edge is dropped when they contradict each other:
 *
 *  1. `hard`   - `dependencies` and present `optionalDependencies`. Correctness:
 *                a pack cannot patch records that have not composed yet.
 *  2. `player` - what the player pinned by moving a mod. Their machine, their
 *                call; it outranks every author's opinion about anyone else.
 *  3. `author` - `loadAfter` / `loadBefore`, and `prefer-mine` / `prefer-theirs`
 *                compat claims. A named guess about a named mod.
 *  4. `group`  - membership in the shipped group order. The weakest, because it
 *                is the one nobody wrote about this particular pair.
 *
 * WHY IT CANNOT FAIL. `loadAfter` and `loadBefore` used to be HARD edges in
 * resolveLoadOrder, so two mods that each claimed priority over the other
 * produced `dependency cycle among packs` and the whole set refused to launch -
 * with neither author having done anything unreasonable. Here a cycle is
 * resolved by dropping its weakest edge and SAYING SO, which is the rule LOOT
 * settled on for exactly this reason: soft metadata that contradicts hard
 * metadata is ignored rather than turned into an error neither author can fix.
 *
 * WHAT MOVES WHAT. An ordering claim moves a whole MOD; a section's band moves
 * one PART of a mod (sections.ts). A claim may name a `scope`, but the scope
 * describes what the claim is about for the report - the sorter still has only
 * mod positions to work with, and an author who needs part of their mod placed
 * differently from the rest says so with a band, which needs nobody's agreement.
 *
 * PURE AND DETERMINISTIC, like resolveLoadOrder and for the same reason: the
 * resolved order reaches the savefile's mod-set fingerprint. Same inputs, same
 * proposal, on every machine - no clock, no Math.random, and no reliance on
 * Set/Map iteration for anything that decides an outcome.
 */

import type { PackManifest } from "./manifest.js";
import { DEFAULT_PACK_GROUP, PACK_GROUPS } from "./manifest.js";
import { satisfies, SemverError } from "./semver.js";

/** How strong an ordering constraint is. Lower rank is stronger. */
export type SortTier = "hard" | "player" | "author" | "group";

/** Every tier, strongest first; the index is the strength. */
export const SORT_TIERS: readonly SortTier[] = ["hard", "player", "author", "group"];

function tierRank(tier: SortTier): number {
  return SORT_TIERS.indexOf(tier);
}

/**
 * A player's decision about where a pack sits, which survives re-sorting.
 *
 * Recorded when the player moves a mod, and replayed as `player`-tier edges on
 * every later sort - the same idea as LOOT's user rules outranking its
 * masterlist. Without this an auto-sort would silently undo the placement the
 * player just made, which is the behaviour that teaches people never to press
 * the button.
 */
export interface SortPin {
  /** The pack the player placed. */
  id: string;
  /** Ids it must follow. */
  after?: readonly string[];
  /** Ids it must precede. */
  before?: readonly string[];
}

/** One ordering constraint between two packs. */
export interface SortEdge {
  /** The pack that loads first. */
  from: string;
  /** The pack that loads after it. */
  to: string;
  tier: SortTier;
  /** Plain language, for the player: why this edge exists. */
  reason: string;
}

/** An edge the sorter had to ignore, and the cycle that forced it. */
export interface DroppedEdge extends SortEdge {
  /** The pack ids forming the cycle this edge was part of, in order. */
  cycle: string[];
}

/** What the sorter proposes. */
export interface SortResult {
  /** The proposed order: every input id, exactly once. */
  order: string[];
  /**
   * Suggestions that could not be honoured, weakest-first as they were dropped.
   * Empty when everything composed. Shown to the player, because a sort that
   * silently discards an author's stated intent is how "auto-sort broke my game"
   * becomes unanswerable.
   */
  dropped: DroppedEdge[];
  /**
   * Cycles made ENTIRELY of hard edges. Nothing here can be dropped - a pack
   * genuinely cannot load both before and after another - so the sort leaves
   * them and resolveLoadOrder refuses the launch with its own message. Reported
   * separately so the manager can tell "your mod set is impossible" apart from
   * "two authors disagreed and I picked one".
   */
  unresolvable: string[][];
}

/**
 * Collect every ordering constraint the inputs imply.
 *
 * Exported for the conflict report, which shows the player WHY a pack sits where
 * it does - including the edges the sort honoured, not only the ones it dropped.
 */
export function collectSortEdges(
  manifests: readonly PackManifest[],
  pins: readonly SortPin[] = [],
): SortEdge[] {
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const has = (id: string): boolean => byId.has(id);
  const edges: SortEdge[] = [];

  /* HARD: dependencies, and optional dependencies that are actually present. A
   * missing hard dependency is resolveLoadOrder's refusal, not the sorter's. */
  for (const m of manifests) {
    for (const dep of Object.keys(m.dependencies ?? {})) {
      if (has(dep)) {
        edges.push({ from: dep, to: m.id, tier: "hard", reason: `${m.id} requires ${dep}` });
      }
    }
    for (const dep of Object.keys(m.optionalDependencies ?? {})) {
      if (has(dep)) {
        edges.push({
          from: dep,
          to: m.id,
          tier: "hard",
          reason: `${m.id} works with ${dep} and must follow it`,
        });
      }
    }
  }

  /* PLAYER: what they placed by hand. */
  for (const pin of pins) {
    if (!has(pin.id)) continue;
    for (const other of pin.after ?? []) {
      if (has(other)) {
        edges.push({
          from: other,
          to: pin.id,
          tier: "player",
          reason: `you placed ${pin.id} after ${other}`,
        });
      }
    }
    for (const other of pin.before ?? []) {
      if (has(other)) {
        edges.push({
          from: pin.id,
          to: other,
          tier: "player",
          reason: `you placed ${pin.id} before ${other}`,
        });
      }
    }
  }

  /* AUTHOR: ordering hints and ordering claims. Both are now soft - loadAfter
   * and loadBefore were hard edges, which is what made two mods each claiming
   * priority a launch failure instead of a decision. */
  for (const m of manifests) {
    for (const after of m.loadAfter ?? []) {
      if (has(after)) {
        edges.push({
          from: after,
          to: m.id,
          tier: "author",
          reason: `${m.id} asks to load after ${after}`,
        });
      }
    }
    for (const before of m.loadBefore ?? []) {
      if (has(before)) {
        edges.push({
          from: m.id,
          to: before,
          tier: "author",
          reason: `${m.id} asks to load before ${before}`,
        });
      }
    }
    for (const c of m.compat ?? []) {
      if (c.claim !== "prefer-mine" && c.claim !== "prefer-theirs") continue;
      const other = byId.get(c.with);
      if (!other || !claimApplies(other.version, c.range)) continue;
      const where = c.scope?.length ? ` (${c.scope.join(", ")})` : "";
      /* Later wins, so "mine should win" means mine loads AFTER theirs. */
      edges.push(
        c.claim === "prefer-mine"
          ? {
              from: c.with,
              to: m.id,
              tier: "author",
              reason: `${m.id}${where} asks to win over ${c.with}: ${c.because}`,
            }
          : {
              from: m.id,
              to: c.with,
              tier: "author",
              reason: `${m.id}${where} defers to ${c.with}: ${c.because}`,
            },
      );
    }
  }

  edges.push(...groupEdges(manifests));
  return edges;
}

/** Whether a claim's version range covers the other pack's version. */
function claimApplies(version: string, range: string | undefined): boolean {
  if (range === undefined) return true;
  try {
    return satisfies(version, range);
  } catch (e) {
    /* A typo in a claim about someone else's mod must not decide anything, and
     * must not throw. Treat the claim as not applying. */
    if (e instanceof SemverError) return false;
    throw e;
  }
}

/**
 * Edges from the shipped group order.
 *
 * Only between CONSECUTIVE occupied groups: transitivity does the rest, and the
 * all-pairs version is quadratic in the mod count for no added ordering. With
 * groups A and C occupied and B empty, A's members still precede C's.
 */
function groupEdges(manifests: readonly PackManifest[]): SortEdge[] {
  const members = new Map<string, string[]>();
  for (const m of manifests) {
    const g = m.group ?? DEFAULT_PACK_GROUP;
    members.set(g, [...(members.get(g) ?? []), m.id]);
  }
  const occupied = PACK_GROUPS.filter((g) => members.has(g));
  const edges: SortEdge[] = [];
  for (let i = 0; i + 1 < occupied.length; i++) {
    const earlier = occupied[i] as string;
    const later = occupied[i + 1] as string;
    for (const a of members.get(earlier) as string[]) {
      for (const b of members.get(later) as string[]) {
        edges.push({
          from: a,
          to: b,
          tier: "group",
          reason: `${earlier} packs load before ${later} packs`,
        });
      }
    }
  }
  return edges;
}

/**
 * Propose a load order.
 *
 * `current` is the order the player is looking at; it decides every tie, so the
 * proposal moves as little as it can. A sort that reshuffles packs it had no
 * reason to move is one the player cannot check, and an unreviewable proposal is
 * one they will decline.
 */
export function sortModOrder(
  manifests: readonly PackManifest[],
  options: { pins?: readonly SortPin[]; current?: readonly string[] } = {},
): SortResult {
  const ids = manifests.map((m) => m.id);
  const currentAt = new Map<string, number>();
  (options.current ?? ids).forEach((id, i) => {
    if (!currentAt.has(id)) currentAt.set(id, i);
  });
  /* A pack the caller's `current` did not mention sorts after the ones it did,
   * in manifest order, so a freshly installed mod lands at the end rather than
   * silently at the front. */
  ids.forEach((id, i) => {
    if (!currentAt.has(id)) currentAt.set(id, (options.current ?? ids).length + i);
  });
  const at = (id: string): number => currentAt.get(id) ?? 0;

  let edges = collectSortEdges(manifests, options.pins ?? []);
  const dropped: DroppedEdge[] = [];
  const unresolvable: string[][] = [];

  /* Drop the weakest edge on a cycle until nothing is left that may be dropped.
   * Bounded by the edge count: every pass removes one edge or records one
   * unbreakable cycle and stops. */
  for (;;) {
    const cycle = findCycle(ids, edges);
    if (!cycle) break;
    const onCycle = edgesOnCycle(cycle, edges);
    const weakest = weakestEdge(onCycle);
    if (!weakest || weakest.tier === "hard") {
      unresolvable.push(cycle);
      /* Cut it anyway so the search terminates and the rest of the set still
       * gets a usable proposal; resolveLoadOrder is what refuses the launch. */
      const cut = onCycle[0];
      if (!cut) break;
      edges = edges.filter((e) => e !== cut);
      continue;
    }
    dropped.push({ ...weakest, cycle });
    edges = edges.filter((e) => e !== weakest);
  }

  return { order: topoSort(ids, edges, at), dropped, unresolvable };
}

/** The weakest edge in a set: lowest tier, then a stable name comparison. */
function weakestEdge(edges: readonly SortEdge[]): SortEdge | undefined {
  let worst: SortEdge | undefined;
  for (const e of edges) {
    if (!worst) {
      worst = e;
      continue;
    }
    const d = tierRank(e.tier) - tierRank(worst.tier);
    /* Ties broken by name so two machines drop the same edge - the proposal
     * reaches the savefile's mod-set fingerprint. */
    if (d > 0 || (d === 0 && `${e.from}>${e.to}` > `${worst.from}>${worst.to}`)) worst = e;
  }
  return worst;
}

/** Every edge whose endpoints are consecutive in the cycle. */
function edgesOnCycle(cycle: readonly string[], edges: readonly SortEdge[]): SortEdge[] {
  const pairs = new Set<string>();
  for (let i = 0; i < cycle.length; i++) {
    pairs.add(`${cycle[i]}>${cycle[(i + 1) % cycle.length]}`);
  }
  return edges.filter((e) => pairs.has(`${e.from}>${e.to}`));
}

/**
 * One cycle, as the node ids around it, or undefined when the graph is acyclic.
 *
 * Iterative DFS over `ids` in order with the adjacency built in edge-insertion
 * order, so the cycle found is a function of the input alone.
 */
function findCycle(
  ids: readonly string[],
  edges: readonly SortEdge[],
): string[] | undefined {
  const next = new Map<string, string[]>();
  for (const id of ids) next.set(id, []);
  for (const e of edges) next.get(e.from)?.push(e.to);

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>(ids.map((id) => [id, WHITE]));

  for (const root of ids) {
    if (colour.get(root) !== WHITE) continue;
    /* An explicit stack of (node, index into its edge list) plus the grey path,
     * so the cycle can be read straight off the path when one is found. */
    const stack: { id: string; i: number }[] = [{ id: root, i: 0 }];
    const path: string[] = [root];
    colour.set(root, GREY);

    while (stack.length > 0) {
      const top = stack[stack.length - 1] as { id: string; i: number };
      const outs = next.get(top.id) as string[];
      if (top.i >= outs.length) {
        colour.set(top.id, BLACK);
        stack.pop();
        path.pop();
        continue;
      }
      const to = outs[top.i++] as string;
      const c = colour.get(to);
      if (c === GREY) return path.slice(path.indexOf(to));
      if (c === BLACK) continue;
      colour.set(to, GREY);
      stack.push({ id: to, i: 0 });
      path.push(to);
    }
  }
  return undefined;
}

/** Kahn over an acyclic edge set, ties broken by `at` (the current order). */
function topoSort(
  ids: readonly string[],
  edges: readonly SortEdge[],
  at: (id: string) => number,
): string[] {
  const remaining = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  const dependents = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const e of edges) {
    if (!remaining.has(e.from) || !remaining.has(e.to)) continue;
    remaining.get(e.to)?.add(e.from);
    dependents.get(e.from)?.add(e.to);
  }

  const frontier = ids.filter((id) => remaining.get(id)?.size === 0).sort((a, b) => at(a) - at(b));
  const out: string[] = [];
  while (frontier.length > 0) {
    const id = frontier.shift() as string;
    out.push(id);
    for (const dep of [...(dependents.get(id) ?? [])].sort((a, b) => at(a) - at(b))) {
      const left = remaining.get(dep) as Set<string>;
      left.delete(id);
      if (left.size !== 0) continue;
      const pos = frontier.findIndex((f) => at(f) > at(dep));
      if (pos === -1) frontier.push(dep);
      else frontier.splice(pos, 0, dep);
    }
  }
  /* Anything left was in a cycle the caller chose not to break; append it in the
   * current order so the proposal is still a complete permutation. */
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}
