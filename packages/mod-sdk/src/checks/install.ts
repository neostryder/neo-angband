/**
 * The checks the game runs while it installs a mod. Synchronous, and free of
 * the JavaScript parser, so importing this adds no parser to the game.
 */

import type { ModFinding, ModFindingReport } from "../mod-findings.js";
import {
  checkApiRange,
  checkBudgetCeiling,
  checkDependencyOrder,
  checkEntryModule,
  checkPayloadCollisions,
  checkPayloadComplete,
  checkPayloadPaths,
  checkPayloadSize,
} from "./package-rules.js";
import { CHECKS_TOOL, CHECKS_VERSION } from "./rules.js";
import { checkSubject, type CheckSubject, type ModFileEntries } from "./subject.js";

/** The install subset, in the order the full run reports it. */
export function installFindings(subject: CheckSubject): ModFinding[] {
  return [
    ...checkPayloadPaths(subject),
    ...checkPayloadCollisions(subject),
    ...checkPayloadSize(subject),
    ...checkPayloadComplete(subject),
    ...checkEntryModule(subject),
    ...checkBudgetCeiling(subject),
    ...checkApiRange(subject),
    ...checkDependencyOrder(subject),
  ];
}

/**
 * Run the install checks on the files about to be stored. A report whose worst
 * severity is `block` means the mod cannot work as shipped.
 */
export function installChecks(files: ModFileEntries): ModFindingReport {
  const subject = checkSubject(files);
  return {
    source: { tool: CHECKS_TOOL, version: CHECKS_VERSION },
    mod: { id: subject.id, ...(subject.version !== undefined ? { version: subject.version } : {}) },
    findings: installFindings(subject),
  };
}
