/**
 * Copy the SDK-facing modding documentation into the published package.
 *
 * `docs/modding` is the source of truth. The output under `docs/` is generated
 * by this script, including its package-safe links, and must not be edited by
 * hand. Run with:
 *
 *   pnpm --dir packages/mod-sdk run sync-docs
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "..", "..");
const sourceDir = resolve(repoRoot, "docs", "modding");
const outputDir = resolve(packageDir, "docs");
const githubDocsUrl = "https://github.com/neostryder/neo-angband/blob/master";

/* These are the reusable SDK and authoring references. First-party mod design
 * records deliberately stay in the repository rather than shipping here. */
const documents = [
  "README.md",
  "AUTHORING.md",
  "MOD_COMPATIBILITY.md",
  "MOD_LIFECYCLE.md",
  "MOD_REACH.md",
  "MOD_SEAMS.md",
  "PLUGINS.md",
  "REGION_INPUT.md",
  "REQUIREMENTS.md",
  "tutorials/01-tweak-a-value.md",
  "tutorials/02-add-an-item.md",
  "tutorials/03-add-a-monster.md",
  "tutorials/04-change-a-spell.md",
  "tutorials/05-hook-behaviour.md",
  "tutorials/06-add-an-option.md",
  "tutorials/07-add-an-artifact.md",
  "tutorials/README.md",
];

const documentSet = new Set(documents);

function toPosix(path) {
  return path.split(sep).join("/");
}

function splitFragment(target) {
  const hash = target.indexOf("#");
  return hash === -1 ? [target, ""] : [target.slice(0, hash), target.slice(hash)];
}

function isExternal(target) {
  return target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(target);
}

function rewriteTarget(target, sourceFile) {
  if (isExternal(target)) return target;

  const [pathPart, fragment] = splitFragment(target);
  if (pathPart === "") return target;

  const targetFile = resolve(dirname(sourceFile), pathPart);
  if (!existsSync(targetFile)) {
    throw new Error(`${relative(repoRoot, sourceFile)} links to missing ${target}`);
  }

  const sourceRelative = toPosix(relative(sourceDir, targetFile));
  if (documentSet.has(sourceRelative)) {
    /* The generated directory mirrors docs/modding, so its internal links keep
     * their source spelling and continue to resolve without a second link map. */
    return target;
  }

  return `${githubDocsUrl}/${toPosix(relative(repoRoot, targetFile))}${fragment}`;
}

function rewriteLinks(text, sourceFile) {
  return text.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/gu, (all, image, label, target) => {
    if (image === "!") return all;
    return `[${label}](${rewriteTarget(target, sourceFile)})`;
  });
}

function localLinks(text) {
  return [...text.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/gu)].map((match) => match[1]);
}

function verifyLinks(outputFile) {
  const text = readFileSync(outputFile, "utf8");
  for (const target of localLinks(text)) {
    if (isExternal(target)) continue;
    const [pathPart] = splitFragment(target);
    if (pathPart !== "" && !existsSync(resolve(dirname(outputFile), pathPart))) {
      throw new Error(`${relative(packageDir, outputFile)} has a broken local link: ${target}`);
    }
  }
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

for (const sourceRelative of documents) {
  const sourceFile = resolve(sourceDir, sourceRelative);
  const outputFile = resolve(outputDir, sourceRelative);
  if (!existsSync(sourceFile)) throw new Error(`missing source document: ${sourceRelative}`);
  mkdirSync(dirname(outputFile), { recursive: true });
  const text = rewriteLinks(readFileSync(sourceFile, "utf8"), sourceFile).replace(/\n{2,}$/u, "\n");
  writeFileSync(outputFile, text, "utf8");
}

for (const sourceRelative of documents) verifyLinks(resolve(outputDir, sourceRelative));

/* stderr, not stdout: this runs as `prepack`, and `npm pack --json` (the check
 * this repository's own tooling and CI run) expects clean JSON on stdout - a
 * lifecycle script's own stdout output lands in the same stream and breaks
 * that parse. */
console.error(`synced ${String(documents.length)} SDK authoring documents to docs/`);
