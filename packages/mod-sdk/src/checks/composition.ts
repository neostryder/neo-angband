/**
 * The composition checks: the mod's record files composed over the base game
 * and its dependencies, exactly as the loader composes them, and the result
 * compared with the same packs composed without the mod.
 */

import type { LoadedPack } from "../loader.js";
import { composeContentPacks } from "../loader.js";
import { hasFacet } from "../manifest.js";
import type { ModFinding } from "../mod-findings.js";
import { danglingReferences } from "../references.js";
import type { JsonRecord } from "../compose.js";
import { composedObjects } from "../validate.js";
import { finding, textOf, type CheckSubject } from "./subject.js";

/** Top-level `.json` files that are not record contributions. */
const NOT_RECORDS = new Set(["manifest", "load-order"]);

/** The mod's record files as the loader reads them: every top-level `<file>.json` but the manifest. */
export function modRecordFiles(subject: CheckSubject): { readonly files: Record<string, unknown>; readonly unreadable: string[] } {
  const files: Record<string, unknown> = {};
  const unreadable: string[] = [];
  for (const path of subject.paths) {
    if (path.includes("/") || !path.toLowerCase().endsWith(".json")) continue;
    const stem = path.slice(0, -".json".length);
    if (NOT_RECORDS.has(stem.toLowerCase())) continue;
    try {
      files[stem] = JSON.parse(textOf(subject.files.get(path) ?? new Uint8Array()));
    } catch {
      unreadable.push(path);
    }
  }
  return { files, unreadable };
}

/**
 * Build a base pack from a folder of record files, such as the content
 * package's `pack/`: `files` maps each file name (with or without `.json`) to
 * its parsed JSON, and `manifest.json` names the pack.
 */
export function basePackFromFiles(files: Readonly<Record<string, unknown>>): LoadedPack {
  let manifest: { id?: unknown; name?: unknown; version?: unknown; engine?: unknown } = {};
  const contrib: Record<string, { records: unknown[] }> = {};
  for (const [name, value] of Object.entries(files)) {
    const stem = name.replace(/\.json$/iu, "");
    if (stem === "manifest") {
      manifest = (value ?? {}) as typeof manifest;
      continue;
    }
    const records = (value as { records?: unknown } | null)?.records;
    if (Array.isArray(records)) contrib[stem] = { records };
  }
  return {
    manifest: {
      id: typeof manifest.id === "string" ? manifest.id : "core",
      name: typeof manifest.name === "string" ? manifest.name : "Angband",
      version: typeof manifest.version === "string" ? manifest.version : "0.0.0",
      shape: "content",
      ...(typeof manifest.engine === "string" ? { engine: manifest.engine } : {}),
    },
    files: contrib,
  } as unknown as LoadedPack;
}

/** What the composition checks are given beyond the mod. */
export interface CompositionOptions {
  /** The base game first, then the packs the mod depends on. Absent: the checks report that they did not run. */
  readonly base?: readonly LoadedPack[];
}

interface HistoryRow {
  readonly chart: number;
  readonly next: number;
  readonly roll: number;
}

function historyRows(records: readonly JsonRecord[]): HistoryRow[] {
  const out: HistoryRow[] = [];
  for (const r of records) {
    const c = r["chart"] as { chart?: unknown; next?: unknown; roll?: unknown } | undefined;
    if (c === undefined || typeof c.chart !== "number") continue;
    out.push({ chart: c.chart, next: typeof c.next === "number" ? c.next : 0, roll: typeof c.roll === "number" ? c.roll : 0 });
  }
  return out;
}

/** Each problem with the history charts, keyed so the two compositions can be compared. */
function historyProblems(records: readonly JsonRecord[]): Map<string, string> {
  const rows = historyRows(records);
  const charts = new Map<number, number>();
  for (const row of rows) charts.set(row.chart, Math.max(charts.get(row.chart) ?? 0, row.roll));
  const out = new Map<string, string>();
  for (const [chart, top] of charts) {
    if (top < 100) out.set(`roll:${chart}`, `History chart ${chart} has no phrase for rolls above ${top}, and character creation rolls 1 to 100.`);
  }
  for (const row of rows) {
    if (row.next !== 0 && !charts.has(row.next)) {
      out.set(`next:${row.chart}:${row.next}`, `A phrase in history chart ${row.chart} leads to chart ${row.next}, which no loaded pack defines, and the game stops at character creation.`);
    }
  }
  return out;
}

/** Run the composition checks for `subject`. */
export function checkComposition(subject: CheckSubject, options: CompositionOptions): ModFinding[] {
  const manifest = subject.manifest;
  if (manifest === null || !hasFacet(manifest, "content")) return [];
  const { files, unreadable } = modRecordFiles(subject);
  const out: ModFinding[] = [];
  for (const path of unreadable) {
    out.push(finding("composition-refused", `${path} is not valid JSON, so the loader skips it.`, { evidence: [{ file: path }] }));
  }
  if (Object.keys(files).length === 0) return out;

  const base = options.base;
  if (base === undefined || base.length === 0) {
    out.push(finding("composition-unchecked", "The mod's records were not composed over the base game, because no base game was supplied.", {
      suggestedFix: "Run the checker with --base pointing at the content package's pack folder, or install @rpgm-tools/neo-angband-content beside the SDK.",
    }));
    return out;
  }
  const supplied = new Set(base.map((p) => p.manifest.id));
  const missing = Object.keys(manifest.dependencies ?? {}).filter((id) => !supplied.has(id));
  if (missing.length > 0) {
    out.push(finding("composition-unchecked", `The mod's records were not composed, because ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} needed and ${missing.length === 1 ? "was" : "were"} not supplied.`, {}));
    return out;
  }

  const modPack = { manifest, files } as unknown as LoadedPack;
  let alone: ReturnType<typeof composeContentPacks>;
  let withMod: ReturnType<typeof composeContentPacks>;
  try {
    alone = composeContentPacks(base);
  } catch (error) {
    out.push(finding("composition-unchecked", `The base packs do not compose on their own: ${error instanceof Error ? error.message : String(error)}`, {}));
    return out;
  }
  try {
    withMod = composeContentPacks([...base, modPack]);
  } catch (error) {
    out.push(finding("composition-refused", `The loader refuses the mod: ${error instanceof Error ? error.message : String(error)}`, {}));
    return out;
  }

  const id = manifest.id;
  for (const fault of withMod.faults) {
    if (fault.packId !== id) continue;
    out.push(finding("composition-refused", `The loader refuses an operation: ${fault.why}`, {}));
  }

  const before = composedObjects(alone.records);
  const after = composedObjects(withMod.records);
  const known = new Set(danglingReferences(before).map((d) => d.message));
  const fresh = danglingReferences(after).filter((d) => !known.has(d.message) && !(d.file === "history" && d.path === "chart.next"));
  for (const d of fresh) {
    out.push(finding("dangling-reference", d.message, { evidence: [{ file: `${d.file}.json`, excerpt: `${d.path}: ${d.value}` }] }));
  }

  if (files["history"] !== undefined) {
    const old = historyProblems(before["history"] ?? []);
    for (const [key, message] of historyProblems(after["history"] ?? [])) {
      if (!old.has(key)) out.push(finding("history-chart", message, { evidence: [{ file: "history.json" }] }));
    }
  }

  const records = withMod.findings.filter((f) => f.packId === id && f.rule !== "reference/dangling");
  const shown = records.slice(0, 20);
  for (const f of shown) {
    out.push(finding("record-check", f.message, { evidence: [{ file: `${f.file}.json`, excerpt: f.field === undefined ? f.record : `${f.record}: ${f.field}` }] }));
  }
  if (records.length > shown.length) {
    out.push(finding("record-check", `${records.length - shown.length} more record findings are not listed here.`, {}));
  }
  return out;
}
