/**
 * One finding shape for every tool that judges a mod: the fixed checks, the
 * headless runner, the installer's refusals and the review gate. A tool that
 * could not examine something says so with `outcome: "could-not-check"`
 * rather than staying silent, so a missing finding never reads as clean.
 */

/** How bad a finding is, from worst to mildest. */
export type ModFindingSeverity = "block" | "serious" | "warning" | "note";

/** Which kind of problem it is. A broken mod is not a harmful one. */
export type ModFindingKind = "safety" | "functionality" | "content" | "packaging";

export interface ModFindingEvidence {
  /** Path inside the staged payload, forward slashes. */
  readonly file?: string;
  /** 1-based line range in that file. */
  readonly lines?: readonly [number, number];
  /** A short excerpt or measured value that shows the problem. */
  readonly excerpt?: string;
}

export interface ModFinding {
  /** Stable rule id, `<tool>/<rule>` (for example `checks/undeclared-capability`). */
  readonly rule: string;
  readonly severity: ModFindingSeverity;
  readonly kind: ModFindingKind;
  /** "found" for a real finding; "could-not-check" when the tool could not decide. */
  readonly outcome: "found" | "could-not-check";
  /** One plain sentence saying what is wrong. */
  readonly message: string;
  readonly evidence: readonly ModFindingEvidence[];
  /** How to see it happen, when there is a way. */
  readonly reproduction?: string;
  /** What the author can change to clear it. */
  readonly suggestedFix?: string;
}

/** The tool that produced a report, so a verdict can name its versions. */
export interface ModFindingSource {
  readonly tool: string;
  readonly version: string;
}

export interface ModFindingReport {
  readonly source: ModFindingSource;
  /** The mod's id and the version or commit examined. */
  readonly mod: { readonly id: string; readonly version?: string; readonly commit?: string };
  readonly findings: readonly ModFinding[];
}

const SEVERITY_ORDER: readonly ModFindingSeverity[] = ["block", "serious", "warning", "note"];

/** The worst severity among `findings`, or null when there are none. */
export function worstSeverity(findings: readonly ModFinding[]): ModFindingSeverity | null {
  let best = SEVERITY_ORDER.length;
  for (const f of findings) best = Math.min(best, SEVERITY_ORDER.indexOf(f.severity));
  return best < SEVERITY_ORDER.length ? SEVERITY_ORDER[best]! : null;
}
