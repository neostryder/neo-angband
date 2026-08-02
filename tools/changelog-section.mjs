#!/usr/bin/env node
/**
 * Print one version's section of CHANGELOG.md.
 *
 * The release notes on a GitHub Release should be the same words as the
 * changelog, not a second description of the same work written by whoever cut
 * the tag - two accounts of one release drift, and the one on the Release page
 * is the one most people read. So the release job asks this script.
 *
 *   node tools/changelog-section.mjs 0.15.0
 *
 * Falls back to the `## [Unreleased]` section when the version has no heading
 * yet, and exits 0 with a short placeholder rather than failing the release: a
 * missing changelog entry is worth a nudge, not a dead build at the one moment
 * the artifacts are already made.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The lines under `## [<version>]` (or `## <version>`), up to the next `## `.
 * Returns null when there is no such heading.
 */
export function changelogSection(markdown, version) {
  const lines = markdown.split(/\r?\n/u);
  const heading = new RegExp(`^##\\s+\\[?${version.replace(/\./gu, "\\.")}\\]?(\\s|$)`, "u");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (heading.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s/u.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const version = process.argv[2];
  if (!version) {
    console.error("usage: node tools/changelog-section.mjs <version>");
    process.exit(2);
  }
  const md = readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
  const body =
    changelogSection(md, version) ??
    changelogSection(md, "Unreleased") ??
    `Release ${version}. See CHANGELOG.md.`;
  process.stdout.write(body + "\n");
}
