#!/usr/bin/env node
/**
 * Post a Discord forum announcement for a shipped version.
 *
 * Reused byte-for-byte across the game and each first-party mod repository -
 * REPO_CONFIG below is the only thing that varies per repository. Posts as a
 * new thread in the announcements forum via an incoming webhook (no bot
 * account, no user token - a webhook cannot act as a real Discord user, so it
 * is styled with the maintainer's display name and avatar instead).
 *
 * Env vars:
 *   REPO                 "owner/name", e.g. "neostryder/neo-angband"
 *   TAG                  the tag being announced, e.g. "v0.27.2"
 *   DISCORD_WEBHOOK_URL  the announcements forum's webhook URL
 *   MODE                 "release" (default) or "init" - init skips the
 *                         minor-or-higher check and posts unconditionally,
 *                         with "currently on" phrasing instead of "just
 *                         shipped" - for a one-time status post, not tied to
 *                         a fresh release event.
 *
 * Exits 0 without posting when MODE=release and the bump since the previous
 * real version is patch-only - by design, only minor and major versions get
 * announced.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPO_CONFIG = {
  "neo-angband": {
    title: "Neo Angband",
    emoji: "\u{1F5E1}\u{FE0F}", // dagger
    color: 0x8b1a1a,
    kind: "game",
  },
  "neo-angband-mod-borg": {
    title: "Borg",
    emoji: "\u{1F916}", // robot
    color: 0x1f8ecd,
    kind: "mod",
  },
  "neo-angband-mod-bug-fixes": {
    title: "Bug Fixes",
    emoji: "\u{1FA79}", // adhesive bandage
    color: 0xe07b00,
    kind: "mod",
  },
  "neo-angband-mod-feature-restoration": {
    title: "Feature Restoration",
    emoji: "\u{1F55B}", // clock face twelve
    color: 0x8e44ad,
    kind: "mod",
  },
  "neo-angband-mod-linoleum": {
    title: "Linoleum",
    emoji: "\u{1F3A8}", // artist palette
    color: 0x27ae60,
    kind: "mod",
  },
  "neo-angband-mod-builder": {
    title: "Mod Builder",
    emoji: "\u{1F9F0}", // toolbox
    color: 0x607d8b,
    kind: "mod",
  },
  "neo-angband-mod-qol": {
    title: "Quality of Life",
    emoji: "\u{1F6E0}\u{FE0F}", // hammer and wrench
    color: 0x2f80c4,
    kind: "mod",
  },
};

const RELEASE_TAG_ID = "1540858028381962240"; // "Release" tag in #neo-angband-announcements

const EMBED_DESCRIPTION_LIMIT = 4096;

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

/** The lines under `## [<version>]` or `## <version>`, up to the next `## `. */
function changelogSection(markdown, version) {
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

function fitToLimit(body, maxChars, fullChangelogUrl) {
  if (body.length <= maxChars) return body;
  const notice = `\n\n*(cut short - [full changelog](${fullChangelogUrl}))*`;
  const budget = maxChars - notice.length;
  const blocks = body.split(/\n\n/u);
  let out = "";
  for (const block of blocks) {
    const next = out ? `${out}\n\n${block}` : block;
    if (next.length > budget) break;
    out = next;
  }
  if (!out) out = body.slice(0, Math.max(0, budget));
  return out + notice;
}

/** Real semver tags only - excludes upstream/edge/prerelease noise. */
function realVersionTags() {
  const raw = sh("git", ["tag", "--list", "v[0-9]*.[0-9]*.[0-9]*"]);
  return raw
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => /^v\d+\.\d+\.\d+$/u.test(t))
    .sort((a, b) => {
      const pa = a.slice(1).split(".").map(Number);
      const pb = b.slice(1).split(".").map(Number);
      for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
      return 0;
    });
}

function bumpIsMinorOrHigher(current, previous) {
  if (!previous) return true;
  const c = current.slice(1).split(".").map(Number);
  const p = previous.slice(1).split(".").map(Number);
  return c[0] !== p[0] || c[1] !== p[1];
}

async function main() {
  const repoFull = process.env.REPO;
  const tag = process.env.TAG;
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const mode = process.env.MODE || "release";

  if (!repoFull || !tag || !webhookUrl) {
    console.error("::error::REPO, TAG, and DISCORD_WEBHOOK_URL are all required");
    process.exit(1);
  }

  const repoName = repoFull.split("/").pop();
  const config = REPO_CONFIG[repoName];
  if (!config) {
    console.error(`::error::no REPO_CONFIG entry for "${repoName}"`);
    process.exit(1);
  }

  if (mode === "release") {
    const tags = realVersionTags();
    const idx = tags.indexOf(tag);
    const previous = idx > 0 ? tags[idx - 1] : null;
    if (!bumpIsMinorOrHigher(tag, previous)) {
      console.log(`${tag} is a patch-only bump over ${previous}; skipping the announcement`);
      return;
    }
  }

  const version = tag.replace(/^v/u, "");
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const releaseUrl = `https://github.com/${repoFull}/releases/tag/${tag}`;
  let section = changelogSection(changelog, version);
  if (!section) {
    console.log(`::warning::no CHANGELOG.md section found for ${version}; posting without one`);
    section = `See the [release page](${releaseUrl}) for details.`;
  }
  section = fitToLimit(section, EMBED_DESCRIPTION_LIMIT, releaseUrl);

  const headline =
    mode === "init"
      ? `${config.emoji} **${config.title}** is currently on **v${version}**`
      : `${config.emoji} **${config.title} v${version}** has shipped!`;

  const threadName =
    mode === "init" ? `${config.emoji} ${config.title} - currently v${version}` : `${config.emoji} ${config.title} v${version}`;

  const payload = {
    username: "Aragorn",
    avatar_url: "https://cdn.discordapp.com/avatars/373993501559619596/09bcc0d0aa00500da04e119d2473c6da.png?size=256",
    thread_name: threadName,
    applied_tags: [RELEASE_TAG_ID],
    content: headline,
    embeds: [
      {
        title: `v${version}`,
        url: releaseUrl,
        description: section,
        color: config.color,
        footer: { text: config.kind === "game" ? "Neo Angband" : `Neo Angband mod - ${config.title}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const res = await fetch(`${webhookUrl}?wait=true`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error(`::error::Discord webhook returned ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  console.log(`Posted ${config.title} ${tag} to the announcements forum.`);
}

main().catch((err) => {
  console.error(`::error::${err.stack || err}`);
  process.exit(1);
});
