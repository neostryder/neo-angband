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
 *
 * The same argument applies to a section that is too LONG, and it took a failed
 * release to notice that it had not been applied. A GitHub release body caps at
 * 125,000 characters. Every entry since 0.14.0 has accumulated in one
 * `## [Unreleased]` section - the file's own preamble promises they move under a
 * version heading when a version is cut, and that has never once happened - so
 * the section crossed the cap on the way to 0.19.0, at 126,288 characters. The
 * three desktop builds, the macOS bundle and the site zip were all made, and the
 * release then failed on its last step by 1,288 characters, which is 1%.
 *
 * So `--max-chars` fits the section to a budget, cutting at a blank-line block
 * boundary and saying so with a link to the full file. **The budget is measured,
 * not written down**: the release workflow renders everything else it puts in the
 * body first and hands over what is left, because a constant here would have to
 * be edited every time that preamble gains a paragraph, and would be wrong
 * silently rather than loudly.
 *
 * Truncation is the fallback, not the fix. The fix is per-version headings, which
 * would also stop a release note being a nine-day wall of prose nobody reads.
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

/**
 * Cut `body` down to `maxChars`, including the notice that says it was cut.
 *
 * Cuts on a blank line, so the result ends at the end of an entry rather than
 * mid-sentence - a release note that stops in the middle of a word reads as a
 * broken build rather than as a deliberate limit. Always keeps at least one
 * block, and hard-cuts a single oversized block on a line boundary, so there is
 * no input for which this returns nothing.
 */
export function fitToLimit(body, maxChars, version) {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return body;
  if (body.length <= maxChars) return body;

  const notice =
    "\n\n---\n\n**These notes are cut short here.** They ran past the 125,000 " +
    "characters a GitHub release body holds. The rest of this release's entries " +
    `are in [CHANGELOG.md](https://github.com/neostryder/neo-angband/blob/v${version}/CHANGELOG.md).\n`;

  const room = maxChars - notice.length;
  if (room <= 0) return notice.trimStart();

  const blocks = body.split("\n\n");
  let kept = "";
  for (const block of blocks) {
    const next = kept ? `${kept}\n\n${block}` : block;
    if (next.length > room) break;
    kept = next;
  }
  if (!kept) {
    // One block on its own is over budget. Fall back to a line boundary.
    const lines = body.split("\n");
    for (const line of lines) {
      const next = kept ? `${kept}\n${line}` : line;
      if (next.length > room) break;
      kept = next;
    }
  }
  if (!kept) kept = body.slice(0, room);
  return kept + notice;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const version = args.find((a) => !a.startsWith("--"));
  const maxArg = args.find((a) => a.startsWith("--max-chars="));
  if (!version) {
    console.error("usage: node tools/changelog-section.mjs <version> [--max-chars=N]");
    process.exit(2);
  }
  const md = readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
  const body =
    changelogSection(md, version) ??
    changelogSection(md, "Unreleased") ??
    `Release ${version}. See CHANGELOG.md.`;
  const maxChars = maxArg ? Number(maxArg.slice("--max-chars=".length)) : NaN;
  const fitted = fitToLimit(body, maxChars, version);
  if (fitted.length < body.length) {
    console.error(
      `[changelog] section is ${body.length} chars; cut to ${fitted.length} to fit ${maxChars}`,
    );
  }
  process.stdout.write(fitted + "\n");
}
