#!/usr/bin/env node
/**
 * Build docs/MOD_LIST.md, the list of released mods, from each mod's own
 * repository.
 *
 *   node tools/mod-list.mjs            write docs/MOD_LIST.md
 *   node tools/mod-list.mjs --stdout   print the page instead
 *
 * Which repositories appear comes from two files in this repository:
 * mods/registry.json (its "mods" are the first-party mods in the game's
 * Recommended list, its "community" the community mods) and mods/listed.json
 * (first-party mods that are on the page but not in the game's list). Every fact
 * about a mod comes from its repository: the newest published release and its
 * date from the GitHub API, and the name, description, author and engine range
 * from manifest.json at that release's tag. The page makes no claims of its own,
 * so it cannot drift from the mods it describes.
 *
 * A repository with no published release is left off the page and named in a
 * comment at its end, so the offline test (packages/web/src/mod-list-page.test.ts)
 * can still account for every repository in the source lists. Drafts never
 * count. A pre-release counts only when the repository has no full release, and
 * the page says so.
 *
 * Needs the network. Run by hand during a release pass. GITHUB_TOKEN or GH_TOKEN
 * is sent to api.github.com when set, which lifts the unauthenticated limit of
 * sixty requests an hour; the script makes one API request per mod.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PAGE_PATH = "docs/MOD_LIST.md";

/** `owner/repo` from an entry's `repo`, which may also be a GitHub URL. */
export function repoName(raw) {
  const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?(?:\/.*)?$/u.exec(
    String(raw).trim(),
  );
  if (!m) throw new Error(`not a repository: ${String(raw)}`);
  return m[1];
}

function entries(doc, key, file) {
  const list = doc[key];
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error(`${file}: "${key}" is not a list`);
  return list.map((e) => repoName(e.repo));
}

/**
 * The repositories the page lists, in page order, from the two source files.
 * `inGame` is false for a first-party mod that only the page lists.
 */
export function readSources(root = repoRoot) {
  const registryFile = path.join(root, "mods", "registry.json");
  const listedFile = path.join(root, "mods", "listed.json");
  const registry = JSON.parse(readFileSync(registryFile, "utf8"));
  const listed = JSON.parse(readFileSync(listedFile, "utf8"));
  return {
    firstParty: [
      ...entries(registry, "mods", "mods/registry.json").map((repo) => ({ repo, inGame: true })),
      ...entries(listed, "firstParty", "mods/listed.json").map((repo) => ({ repo, inGame: false })),
    ],
    community: entries(registry, "community", "mods/registry.json").map((repo) => ({
      repo,
      inGame: true,
    })),
  };
}

/** The newest full release, else the newest pre-release; never a draft. */
export function pickRelease(releases) {
  const published = releases.filter((r) => !r.draft && r.published_at);
  const newest = (list) =>
    [...list].sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))[0] ??
    null;
  return newest(published.filter((r) => !r.prerelease)) ?? newest(published);
}

/**
 * Everything the page says about one repository, or `{ repo, missing }` when it
 * has nothing to list.
 */
export async function modFacts(repo, { fetch: get = fetch, token } = {}) {
  const headers = { accept: "application/vnd.github+json", "user-agent": "neo-angband-mod-list" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await get(`https://api.github.com/repos/${repo}/releases?per_page=50`, { headers });
  if (res.status === 404) return { repo, missing: "repository not found" };
  if (!res.ok) throw new Error(`${repo}: releases request failed (HTTP ${String(res.status)})`);
  const release = pickRelease(await res.json());
  if (!release) return { repo, missing: "no published release" };

  const tag = release.tag_name;
  const raw = (file) =>
    `https://raw.githubusercontent.com/${repo}/refs/tags/${encodeURIComponent(tag)}/${file}`;
  const manifestRes = await get(raw("manifest.json"));
  if (!manifestRes.ok) throw new Error(`${repo}: no manifest.json at ${tag}`);
  const manifest = JSON.parse(await manifestRes.text());

  let docs = null;
  for (const file of ["docs/README.md", "README.md"]) {
    const r = await get(raw(file), { method: "HEAD" });
    if (r.ok) {
      docs = `https://github.com/${repo}/blob/${encodeURIComponent(tag)}/${file}`;
      break;
    }
  }

  return {
    repo,
    id: typeof manifest.id === "string" ? manifest.id : null,
    name: typeof manifest.name === "string" && manifest.name !== "" ? manifest.name : repo,
    description: typeof manifest.description === "string" ? manifest.description : "",
    author: typeof manifest.author === "string" ? manifest.author : null,
    engine: typeof manifest.engine === "string" ? manifest.engine : null,
    tag,
    prerelease: release.prerelease === true,
    date: String(release.published_at).slice(0, 10),
    releaseUrl: release.html_url,
    docs,
  };
}

/** Text from a manifest, made safe to put in Markdown as plain text. */
export function escapeMarkdown(text) {
  return String(text).replace(/[\\`*_[\]<>|#]/gu, (c) => `\\${c}`);
}

const INTRO =
  "Every mod on this page has a published release on GitHub. A script builds the page from each mod's repository, so the name, description and supported game builds are the ones in the manifest at that release. To install a mod, open **Mods** in the game and choose **Recommended mods...**. A mod that is not on that screen installs by its repository address, from **Get a mod another way...**.";
const FIRST_PARTY =
  "Mods by the maintainer of Neo Angband. Report a bug in what a mod does in that mod's own repository.";
const COMMUNITY =
  "Mods by other authors, listed once their release passed the listing checks. A listing is not an endorsement, a code review or a security audit.";
const COMMUNITY_EMPTY =
  "No community mods are listed yet. See [Getting a community mod listed](MODS.md#getting-a-community-mod-listed) in the mod system guide to add one.";

function renderMod(mod, where) {
  const lines = [`### ${escapeMarkdown(mod.name)}`, ""];
  for (const para of mod.description.split(/\n\s*\n/u)) {
    const text = para.replace(/\s*\n\s*/gu, " ").trim();
    if (text !== "") lines.push(escapeMarkdown(text), "");
  }
  const who = mod.author ? `, by ${escapeMarkdown(mod.author)}` : "";
  if (mod.id) lines.push(`- Mod id: \`${mod.id.replace(/`/gu, "")}\`${who}`);
  const pre = mod.prerelease ? " (marked as a pre-release)" : "";
  lines.push(`- Newest release: [${escapeMarkdown(mod.tag)}](${mod.releaseUrl})${pre}, published ${mod.date}`);
  lines.push(
    `- Game builds: ${mod.engine ? `\`${mod.engine.replace(/`/gu, "")}\`` : "any (the manifest declares no range)"}`,
  );
  lines.push(`- In the game: ${where}`);
  const links = [`[repository](https://github.com/${mod.repo})`];
  if (mod.docs) links.push(`[docs](${mod.docs})`);
  lines.push(`- Links: ${links.join(", ")}`, "");
  return lines;
}

/** The whole page, from the facts `modFacts` returned for each group. */
export function renderPage({ firstParty, community, unreleased }) {
  const out = [
    "<!-- Generated by tools/mod-list.mjs from mods/registry.json and mods/listed.json. Run node tools/mod-list.mjs to rebuild it; edits made by hand are lost on the next run. -->",
    "",
    "# Mod list",
    "",
    INTRO,
    "",
    "## First-party mods",
    "",
    FIRST_PARTY,
    "",
  ];
  for (const mod of firstParty) {
    out.push(
      ...renderMod(mod, mod.inGame ? "**Recommended mods...**" : "install it by repository address"),
    );
  }
  out.push("## Community mods", "", COMMUNITY, "");
  if (community.length === 0) out.push(COMMUNITY_EMPTY, "");
  for (const mod of community) {
    out.push(...renderMod(mod, "**Recommended mods...**, under **Community mods**"));
  }
  if (unreleased.length > 0) {
    out.push(`<!-- Not listed, no published release: ${unreleased.join(", ")} -->`, "");
  }
  return `${out.join("\n").replace(/\n+$/u, "")}\n`;
}

/**
 * The repositories a rendered page names, by section, plus the ones its closing
 * comment says were left off. What the offline test compares with the sources.
 */
export function pageRepos(markdown) {
  const found = { firstParty: [], community: [], unreleased: [] };
  let section = null;
  for (const line of markdown.split(/\r?\n/u)) {
    if (line === "## First-party mods") section = "firstParty";
    else if (line === "## Community mods") section = "community";
    const link = /^- Links: \[repository\]\(https:\/\/github\.com\/([^)]+)\)/u.exec(line);
    if (link && section) found[section].push(link[1]);
    const off = /^<!-- Not listed, no published release: (.*) -->$/u.exec(line);
    if (off) found.unreleased.push(...off[1].split(", "));
  }
  return found;
}

async function main(argv) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
  const sources = readSources();
  const groups = { firstParty: [], community: [] };
  const unreleased = [];
  for (const key of ["firstParty", "community"]) {
    for (const { repo, inGame } of sources[key]) {
      const facts = await modFacts(repo, { token });
      if (facts.missing) {
        process.stderr.write(`left off: ${repo} (${facts.missing})\n`);
        unreleased.push(repo);
        continue;
      }
      groups[key].push({ ...facts, inGame });
    }
  }
  const page = renderPage({ ...groups, unreleased });
  if (argv.includes("--stdout")) {
    process.stdout.write(page);
    return;
  }
  writeFileSync(path.join(repoRoot, PAGE_PATH), page);
  process.stdout.write(
    `wrote ${PAGE_PATH}: ${String(groups.firstParty.length)} first-party, ${String(groups.community.length)} community, ${String(unreleased.length)} left off\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
