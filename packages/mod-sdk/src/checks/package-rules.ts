/**
 * The payload and manifest checks: paths, sizes, declared files, the entry
 * module, the time budget, the API range and load order. Every check here is
 * synchronous and parses no JavaScript, so the game's installer can run the
 * install subset without carrying the code analysis.
 */

import { CapabilitySet } from "../capabilities.js";
import { capabilityTiers, matchCapability } from "../capability-vocabulary.js";
import {
  IN_PROCESS_ENTRY,
  MAX_TURN_BUDGET_MS,
  MOD_API_1_VERSION,
  WORKER_PREVIEW_API,
  runtimePayloadComplaint,
} from "../manifest-v2.js";
import { MOD_API2_VERSION } from "../api2/version.js";
import type { ModFinding } from "../mod-findings.js";
import { satisfies } from "../semver.js";
import { PAYLOAD_LIMITS, finding, isScriptPath, type CheckSubject } from "./subject.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Why `path` cannot be stored in a mod folder, or null. Same test the game's installer applies. */
export function payloadPathProblem(path: string): string | null {
  if (path === "") return "the path is empty";
  if (path.startsWith("/") || /^[A-Za-z]:/u.test(path)) return "the path is absolute";
  if (path.includes("\\")) return "the path uses a backslash";
  if (path.split("/").some((s) => s === "" || s === "." || s === "..")) return "the path leaves the mod folder";
  if (/[\0<>:"|?*]/u.test(path)) return "the path has a character some file systems refuse";
  return null;
}

/** checks/payload-path */
export function checkPayloadPaths(subject: CheckSubject): ModFinding[] {
  const out: ModFinding[] = [];
  for (const path of subject.paths) {
    const problem = payloadPathProblem(path);
    if (problem === null) continue;
    out.push(finding("payload-path", `${JSON.stringify(path)}: ${problem}.`, {
      evidence: [{ excerpt: path }],
      suggestedFix: "Store the file under a relative path made of plain names joined by /.",
    }));
  }
  return out;
}

/** checks/payload-collision: names equal once case is ignored. */
export function checkPayloadCollisions(subject: CheckSubject): ModFinding[] {
  const seen = new Map<string, string>();
  const out: ModFinding[] = [];
  for (const path of subject.paths) {
    const folded = path.toLowerCase();
    const first = seen.get(folded);
    if (first === undefined) {
      seen.set(folded, path);
      continue;
    }
    out.push(finding("payload-collision",
      first === path ? `${path} appears twice in the payload.` : `${path} and ${first} differ only in case.`, {
        evidence: [{ file: path }, { file: first }],
        suggestedFix: "Rename one of the files.",
      }));
  }
  return out;
}

/** checks/payload-size */
export function checkPayloadSize(subject: CheckSubject): ModFinding[] {
  const out: ModFinding[] = [];
  if (subject.paths.length > PAYLOAD_LIMITS.maxEntries) {
    out.push(finding("payload-size", `The payload has ${subject.paths.length} files; the limit is ${PAYLOAD_LIMITS.maxEntries}.`, {
      evidence: [{ excerpt: `${subject.paths.length} files` }],
    }));
  }
  let total = 0;
  for (const [path, bytes] of subject.files) {
    total += bytes.length;
    if (bytes.length > PAYLOAD_LIMITS.maxFileBytes) {
      out.push(finding("payload-size", `${path} is ${mb(bytes.length)}; one file may be at most ${mb(PAYLOAD_LIMITS.maxFileBytes)}.`, {
        evidence: [{ file: path, excerpt: `${bytes.length} bytes` }],
      }));
    }
  }
  if (total > PAYLOAD_LIMITS.maxTotalBytes) {
    out.push(finding("payload-size", `The payload totals ${mb(total)}; the limit is ${mb(PAYLOAD_LIMITS.maxTotalBytes)}.`, {
      evidence: [{ excerpt: `${total} bytes` }],
    }));
  }
  return out;
}

/** Files are matched the way the game looks them up: exact first, then ignoring case. */
function hasPath(subject: CheckSubject, path: string): boolean {
  if (subject.files.has(path)) return true;
  const folded = path.toLowerCase();
  return subject.paths.some((p) => p.toLowerCase() === folded);
}

/** checks/payload-incomplete: declared payload files and locale files. */
export function checkPayloadComplete(subject: CheckSubject): ModFinding[] {
  const m = subject.manifest;
  if (m === null) return [];
  const out: ModFinding[] = [];
  /* Archives are unpacked before the files are stored, so a declared archive's
   * own path is not expected among them. */
  const archives = new Set(m.payload?.archives ?? []);
  for (const file of m.payload?.files ?? []) {
    if (archives.has(file) || hasPath(subject, file)) continue;
    out.push(finding("payload-incomplete", `payload.files lists ${file}, which is not in the mod.`, {
      evidence: [{ file: "manifest.json", excerpt: file }],
      suggestedFix: `Commit ${file}, or remove it from payload.files.`,
    }));
  }
  const text = m.text;
  if (text !== undefined) {
    for (const [locale, file] of Object.entries(text.locales)) {
      if (hasPath(subject, file)) continue;
      out.push(finding("payload-incomplete", `text.locales gives ${file} for ${locale}, and the mod does not ship it.`, {
        evidence: [{ file: "manifest.json", excerpt: `${locale}: ${file}` }],
      }));
    }
    if (!Object.hasOwn(text.locales, text.default)) {
      out.push(finding("payload-incomplete", `text.default is ${text.default}, which is not one of the locales in text.locales.`, {
        evidence: [{ file: "manifest.json", excerpt: text.default }],
      }));
    }
  }
  return out;
}

/**
 * checks/entry-module: the runtime follows the payload. Schema 2 only, the same
 * scope the manifest reader gives this rule; a schema 1 plugin's plugin.js is
 * covered by the requirement checks.
 */
export function checkEntryModule(subject: CheckSubject): ModFinding[] {
  const m = subject.manifest;
  if (m === null || m.manifestSchema !== 2) return [];
  const code = subject.paths.filter(isScriptPath);
  const complaint = runtimePayloadComplaint(m, code);
  if (complaint === null) return [];
  return [finding("entry-module", `${complaint.replace(/^manifest [^:]+: /u, "The manifest ")}.`, {
    evidence: [{ file: "manifest.json", excerpt: `runtime: ${m.runtime ?? "data"}, entry: ${m.entry ?? (m.runtime === "data" ? "none" : IN_PROCESS_ENTRY)}` }],
  })];
}

/** The `budget` object as written, whether or not the manifest validates. */
function writtenBudget(json: unknown): unknown {
  if (!isRecord(json)) return undefined;
  /* A manifest document keeps its fields under `data`; a bare schema 1 manifest is the fields. */
  const fields = isRecord(json["data"]) ? json["data"] : json;
  return fields["budget"];
}

/** checks/budget-ceiling, read from the manifest as written so an over-limit value is named even when the manifest is refused for it. */
export function checkBudgetCeiling(subject: CheckSubject): ModFinding[] {
  const budget = writtenBudget(subject.json);
  if (budget === undefined) return [];
  const ms = isRecord(budget) ? budget["msPerTurn"] : undefined;
  if (typeof ms === "number" && Number.isFinite(ms) && ms > 0 && ms <= MAX_TURN_BUDGET_MS) return [];
  const shown = isRecord(budget) ? JSON.stringify(ms) ?? "missing" : JSON.stringify(budget);
  return [finding("budget-ceiling",
    typeof ms === "number" && ms > MAX_TURN_BUDGET_MS
      ? `budget.msPerTurn is ${ms} ms, over the ${MAX_TURN_BUDGET_MS} ms ceiling.`
      : `budget.msPerTurn is ${shown}; it must be a number of milliseconds above 0 and at most ${MAX_TURN_BUDGET_MS}.`, {
      evidence: [{ file: "manifest.json", excerpt: `budget: ${JSON.stringify(budget)}` }],
      suggestedFix: `Lower budget.msPerTurn to ${MAX_TURN_BUDGET_MS} or less, and move work that needs more time off the turn.`,
    })];
}

/** checks/budget-default */
export function checkBudgetDefault(subject: CheckSubject): ModFinding[] {
  const m = subject.manifest;
  if (m === null || (m.runtime ?? "data") === "data" || m.manifestSchema !== 2 || m.budget !== undefined) return [];
  return [finding("budget-default", "The manifest declares no budget.msPerTurn, so the mod gets the default 50 ms per game turn.", {
    evidence: [{ file: "manifest.json" }],
  })];
}

/** The API versions this build runs for `runtime`. */
function hostApis(runtime: string): readonly string[] {
  if (runtime === "in-process") return [MOD_API_1_VERSION, MOD_API2_VERSION];
  if (runtime === "worker") return [WORKER_PREVIEW_API, MOD_API2_VERSION];
  return [];
}

/** checks/api-range */
export function checkApiRange(subject: CheckSubject): ModFinding[] {
  const m = subject.manifest;
  if (m === null || m.api === undefined) return [];
  const runtime = m.runtime ?? "data";
  const apis = hostApis(runtime);
  if (apis.length === 0) return [];
  const fits = apis.some((v) => {
    try {
      return satisfies(v, m.api as string);
    } catch {
      return false;
    }
  });
  if (fits) return [];
  return [finding("api-range", `api is "${m.api}", and this game runs ${apis.join(" and ")} for a ${runtime} mod.`, {
    evidence: [{ file: "manifest.json", excerpt: `api: ${m.api}` }],
    suggestedFix: `Declare a range that admits ${apis[apis.length - 1] ?? MOD_API2_VERSION}, and make sure the code is written for it.`,
  })];
}

/** checks/dependency-order */
export function checkDependencyOrder(subject: CheckSubject): ModFinding[] {
  const m = subject.manifest;
  if (m === null) return [];
  const out: ModFinding[] = [];
  const after = new Set(m.loadAfter ?? []);
  const before = new Set(m.loadBefore ?? []);
  const required = Object.keys(m.dependencies ?? {});
  const evidence = [{ file: "manifest.json" }];
  for (const dep of required) {
    if (before.has(dep)) {
      out.push(finding("dependency-order", `${dep} is a required dependency, so this mod loads after it, and loadBefore also names it.`, {
        evidence, suggestedFix: `Remove ${dep} from loadBefore.`,
      }));
    }
  }
  for (const id of after) {
    if (before.has(id)) out.push(finding("dependency-order", `${id} is named in both loadAfter and loadBefore.`, { evidence }));
  }
  if (after.has(m.id) || before.has(m.id)) {
    out.push(finding("dependency-order", "The mod names itself in its own load order.", { evidence }));
  }
  return out;
}

/** checks/capability-tier: a Worker mod asking for a capability only in-process code can hold. */
export function checkCapabilityTier(subject: CheckSubject): ModFinding[] {
  const m = subject.manifest;
  if (m === null || m.runtime !== "worker") return [];
  const out: ModFinding[] = [];
  for (const cap of m.capabilities ?? []) {
    const tiers = capabilityTiers(cap);
    if (tiers.length === 0 || tiers.includes("worker")) continue;
    out.push(finding("capability-tier", `${cap} is held only by mods running in the game's page, and this mod runs in a Worker.`, {
      evidence: [{ file: "manifest.json", excerpt: cap }],
      suggestedFix: `Remove ${cap}, or run the mod in process if it needs it.`,
    }));
  }
  return out;
}

/** checks/first-party-capability */
export function checkFirstPartyCapability(subject: CheckSubject, firstParty: boolean): ModFinding[] {
  const m = subject.manifest;
  if (m === null || firstParty) return [];
  const out: ModFinding[] = [];
  for (const cap of m.capabilities ?? []) {
    let namespace: string | undefined;
    try {
      namespace = matchCapability(cap)?.entry.namespace;
    } catch {
      continue;
    }
    if (namespace !== "manage") continue;
    out.push(finding("first-party-capability", `${cap} is granted only to the game's first-party mods.`, {
      evidence: [{ file: "manifest.json", excerpt: cap }],
      suggestedFix: `Remove ${cap}.`,
    }));
  }
  return out;
}

/** checks/listing-files: screenshots and changelog the listing names. */
export function checkListingFiles(subject: CheckSubject): ModFinding[] {
  const m = subject.manifest;
  if (m === null) return [];
  const wanted = [...(m.screenshots ?? []), ...(m.changelog !== undefined ? [m.changelog] : [])];
  return wanted.filter((file) => !hasPath(subject, file)).map((file) =>
    finding("listing-files", `The listing names ${file}, which the mod does not ship.`, {
      evidence: [{ file: "manifest.json", excerpt: file }],
    }));
}

/** The manifest's capability set, or null when it cannot be built. */
export function capabilitySetOf(subject: CheckSubject): CapabilitySet | null {
  if (subject.manifest === null) return null;
  try {
    return CapabilitySet.fromManifest(subject.manifest);
  } catch {
    return null;
  }
}
