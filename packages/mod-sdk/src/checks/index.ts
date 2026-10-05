/**
 * The fixed checks, run together: the requirements in standards.ts, the
 * archive, payload and manifest checks, the code checks and the composition
 * checks. One deterministic run over one mod, with one report.
 *
 * Three callers share it: `neo-angband-mod-check`, which runs everything; the
 * game's installer, which runs the install subset in install.ts; and any review
 * tool that wants the same verdict an author saw.
 *
 * This module is the package's `./checks` export, not part of the main entry.
 * The game hands the main entry to every plugin as ctx.authoring, so whatever it
 * exports ships in the game bundle; the code checks bring a JavaScript parser
 * with them, and the game has no use for it.
 */

import type { LoadedPack } from "../loader.js";
import type { ModFinding, ModFindingReport } from "../mod-findings.js";
import { checkMod, type ModUnderTest } from "../standards.js";
import { readModArchive } from "./archive.js";
import { checkCode } from "./code.js";
import { checkComposition } from "./composition.js";
import { installFindings } from "./install.js";
import {
  capabilitySetOf,
  checkBudgetDefault,
  checkCapabilityTier,
  checkFirstPartyCapability,
  checkListingFiles,
} from "./package-rules.js";
import { CHECKS_TOOL, CHECKS_VERSION } from "./rules.js";
import { checkSubject, type CheckSubject, type ModFileEntries } from "./subject.js";

/** One mod to check. */
export interface ModCheckInput {
  /**
   * The mod's files, relative to its folder with `/` separators: the payload as
   * the game installs it. Archives listed in `archives` are unpacked into it.
   */
  readonly files: ModFileEntries;
  /** Paths in `files` that are archives the game unpacks at install. */
  readonly archives?: readonly string[];
  /** Every path in the repository, when it differs from the payload. */
  readonly repoFiles?: readonly string[];
  /** The commit the files came from, for the report. */
  readonly commit?: string;
}

export interface ModCheckOptions {
  /** The base game first, then the mod's dependencies, for the composition checks. */
  readonly base?: readonly LoadedPack[];
  /** True for a first-party mod, which may request first-party capabilities. */
  readonly firstParty?: boolean;
}

/** How much of the mod the run could see. Extra to the report, which carries only findings. */
export interface ModCheckCoverage {
  /** Payload paths, after archives were unpacked. */
  readonly files: number;
  /** Scripts parsed and traced. */
  readonly scripts: number;
  /** True when the composition checks ran against a base game. */
  readonly composed: boolean;
  /** Payload paths whose contents could not be read. */
  readonly unread: readonly string[];
}

/** The report, plus what the run covered. */
export interface ModCheckResult {
  readonly report: ModFindingReport;
  readonly coverage: ModCheckCoverage;
}

/** A requirement from standards.ts, reported as a finding. Required ones block. */
function requirementFindings(input: ModCheckInput, subject: CheckSubject): ModFinding[] {
  const declared = subject.raw?.["payload"] as ModUnderTest["declaredPayload"] | undefined;
  const mod: ModUnderTest = {
    files: subject.paths,
    manifestText: subject.manifestText,
    ...(input.repoFiles !== undefined ? { repoFiles: input.repoFiles } : {}),
    ...(declared !== undefined ? { declaredPayload: declared } : {}),
  };
  const report = checkMod(mod);
  return [...report.errors, ...report.advice].map((f) => ({
    rule: `checks/${f.id}`,
    severity: f.level === "required" ? "block" : "note",
    kind: "packaging",
    outcome: "found",
    message: `${f.title}: ${f.problem}.`,
    evidence: [],
  }));
}

/** Run every fixed check on one mod. */
export async function runModChecks(input: ModCheckInput, options: ModCheckOptions = {}): Promise<ModCheckResult> {
  const findings: ModFinding[] = [];
  const archives = new Set(input.archives ?? []);
  const unread = new Set<string>();
  const entries: Array<readonly [string, Uint8Array]> = [];
  const budget = { archiveBytes: 0, entries: 0, totalBytes: 0 };
  for (const [path, bytes] of input.files) {
    if (!archives.has(path)) {
      entries.push([path, bytes]);
      continue;
    }
    const reading = await readModArchive(path, bytes, budget);
    findings.push(...reading.findings);
    for (const p of reading.unread) unread.add(p);
    for (const [inner, data] of reading.entries) entries.push([inner, data]);
  }

  const subject = checkSubject(entries);
  findings.push(...requirementFindings(input, subject));
  findings.push(...installFindings(subject));
  findings.push(...checkBudgetDefault(subject));
  findings.push(...checkCapabilityTier(subject));
  findings.push(...checkFirstPartyCapability(subject, options.firstParty === true));
  findings.push(...checkListingFiles(subject));
  const parsed = new Set<string>();
  const code = checkCode(subject, { caps: capabilitySetOf(subject), unread, parsed });
  findings.push(...code);
  findings.push(...checkComposition(subject, options.base === undefined ? {} : { base: options.base }));

  return {
    report: {
      source: { tool: CHECKS_TOOL, version: CHECKS_VERSION },
      mod: {
        id: subject.id,
        ...(subject.version !== undefined ? { version: subject.version } : {}),
        ...(input.commit !== undefined ? { commit: input.commit } : {}),
      },
      findings,
    },
    coverage: {
      files: subject.paths.length,
      scripts: parsed.size,
      composed: options.base !== undefined && options.base.length > 0,
      unread: [...unread],
    },
  };
}

export { readModArchive } from "./archive.js";
export type { ArchiveReading } from "./archive.js";
export { basePackFromFiles } from "./composition.js";
