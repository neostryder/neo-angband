/**
 * What every fixed check is handed: the payload as the installer stores it
 * (paths and bytes), the manifest read once, and a way to turn a rule id and a
 * message into a ModFinding. Install-safe: nothing here parses JavaScript.
 */

import { manifestFields, validateManifest, type PackManifest } from "../manifest.js";
import type { ModFinding, ModFindingEvidence } from "../mod-findings.js";
import { checkRule } from "./rules.js";

/** A mod's files as the installer holds them: forward-slash paths and their bytes. */
export type ModFileEntries = ReadonlyArray<readonly [string, Uint8Array]>;

/** The payload limits the game applies when it stores a mod. */
export const PAYLOAD_LIMITS = Object.freeze({
  maxEntries: 4096,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
});

/** The archive limits the game applies when it unpacks a declared .zip. */
export const ARCHIVE_LIMITS = Object.freeze({
  maxArchiveBytes: 64 * 1024 * 1024,
  maxEntries: 4096,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxRatio: 200,
});

/**
 * Repository paths that never reach an installed mod folder when the manifest
 * declares no payload: dotfiles, dependencies, tooling, package metadata and
 * TypeScript sources.
 */
export const NOT_PAYLOAD: readonly RegExp[] = [
  /(^|\/)\./u,
  /^node_modules\//u,
  /^tools\//u,
  /^(package|package-lock)\.json$/u,
  /^tsconfig[^/]*\.json$/u,
  /^vitest\.config\.[cm]?[jt]s$/u,
  /\.ts$/u,
];

/** Whether a repository path belongs in the installed mod folder. */
export function isPayloadPath(path: string): boolean {
  return !NOT_PAYLOAD.some((re) => re.test(path));
}

/** Script modules the game can load: `.js` and `.mjs`. */
export const isScriptPath = (path: string): boolean => /\.m?js$/iu.test(path);

/** The payload and manifest, read once for every rule. */
export interface CheckSubject {
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Paths in the order they arrived. */
  readonly paths: readonly string[];
  readonly manifestText: string | null;
  /** manifest.json parsed as JSON, before any validation; undefined when it does not parse. */
  readonly json: unknown;
  /** The manifest's fields (the `data` of a schema 2 document), or null. */
  readonly raw: Record<string, unknown> | null;
  /** The validated manifest, or null when it does not validate. */
  readonly manifest: PackManifest | null;
  readonly id: string;
  readonly version?: string;
}

const decoder = new TextDecoder("utf-8", { fatal: false });

/** The bytes as UTF-8 text. */
export const textOf = (bytes: Uint8Array): string => decoder.decode(bytes);

/** Read the manifest out of `files` and validate it. */
export function checkSubject(files: ModFileEntries): CheckSubject {
  const map = new Map<string, Uint8Array>();
  for (const [path, bytes] of files) map.set(path, bytes);
  const manifestEntry = files.find(([p]) => p.toLowerCase() === "manifest.json");
  const manifestText = manifestEntry ? textOf(manifestEntry[1]) : null;
  let raw: Record<string, unknown> | null = null;
  let manifest: PackManifest | null = null;
  let json: unknown = undefined;
  if (manifestText !== null) {
    try {
      const parsed: unknown = JSON.parse(manifestText);
      json = parsed;
      raw = manifestFields(parsed) ?? null;
      manifest = validateManifest(parsed);
    } catch {
      /* The requirement checks name what is wrong with the manifest. */
    }
  }
  const id = manifest?.id ?? (typeof raw?.["id"] === "string" ? raw["id"] : "unknown");
  const version = manifest?.version ?? (typeof raw?.["version"] === "string" ? raw["version"] : undefined);
  return {
    files: map,
    paths: files.map(([p]) => p),
    manifestText,
    json,
    raw,
    manifest,
    id,
    ...(version !== undefined ? { version } : {}),
  };
}

/** The 1-based line holding `offset` in `text`. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** A short excerpt: one line, at most `max` characters. */
export function excerpt(text: string, max = 120): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

/** Extra fields a finding may carry beyond its rule's defaults. */
export interface FindingDetail {
  readonly evidence?: readonly ModFindingEvidence[];
  readonly reproduction?: string;
  readonly suggestedFix?: string;
}

/** A finding for rule `id` (with or without the `checks/` prefix), using the rule's severity, kind and outcome. */
export function finding(id: string, message: string, detail: FindingDetail = {}): ModFinding {
  const rule = checkRule(id.startsWith("checks/") ? id : `checks/${id}`);
  return {
    rule: rule.id,
    severity: rule.severity,
    kind: rule.kind,
    outcome: rule.outcome,
    message,
    evidence: detail.evidence ?? [],
    ...(detail.reproduction !== undefined ? { reproduction: detail.reproduction } : {}),
    ...(detail.suggestedFix !== undefined ? { suggestedFix: detail.suggestedFix } : {}),
  };
}
