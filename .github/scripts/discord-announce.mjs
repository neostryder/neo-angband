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
 *   MODE                 "release" (default) or "init" - init uses "currently
 *                         on" phrasing instead of "just shipped", for a
 *                         one-time status post not tied to a fresh release
 *                         event. Every real release is announced regardless
 *                         of version-bump size - patch, minor and major all
 *                         post.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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
  "neo-angband-mod-forge": {
    title: "ModForge",
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
const NEWS_ROLE_ID = "1541208721533968484"; // "Neo Angband News" role, self-assigned via Channels & Roles

const EMBED_DESCRIPTION_LIMIT = 4096;

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

/**
 * Discord renders a literal newline as a hard line break, so a paragraph or
 * list item hand-wrapped in CHANGELOG.md at ~80-90 columns shows up as a
 * ragged column of short lines instead of flowing to the embed's actual
 * width. This rejoins each paragraph/list item's wrapped lines into one
 * line so Discord's own soft-wrap takes over. Blank lines (paragraph
 * breaks), headings, list-item boundaries, and fenced code blocks are left
 * untouched.
 */
function joinWrapped(text, next) {
  return text.endsWith("/") ? text + next : `${text} ${next}`;
}

function reflow(markdown) {
  const lines = markdown.split(/\r?\n/u);
  const out = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      out.push(line);
      i++;
      continue;
    }
    if (inFence || line.trim() === "" || /^#{1,6}\s/u.test(line)) {
      out.push(line);
      i++;
      continue;
    }

    const bulletMatch = line.match(/^(\s*(?:[-*]|\d+[.)])\s+)(.*)$/u);
    if (bulletMatch) {
      const [, marker, firstText] = bulletMatch;
      const indent = " ".repeat(marker.length);
      let text = firstText;
      i++;
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        lines[i].startsWith(indent) &&
        !/^\s*(?:[-*]|\d+[.)])\s+/u.test(lines[i])
      ) {
        text = joinWrapped(text, lines[i].trim());
        i++;
      }
      out.push(marker + text);
      continue;
    }

    let text = line.trim();
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^#{1,6}\s/u.test(lines[i]) &&
      !/^\s*(?:[-*]|\d+[.)])\s+/u.test(lines[i]) &&
      !/^\s*```/u.test(lines[i])
    ) {
      text = joinWrapped(text, lines[i].trim());
      i++;
    }
    out.push(text);
  }
  return out.join("\n");
}

/**
 * Blocks are split on blank lines (`\n\n`), so a paragraph fits or doesn't as a
 * whole. A markdown list has no blank lines between items, though, so an
 * entire bulleted list is one block - if IT alone overflows the budget, the
 * fallback below adds as many of its own lines (list items, or reflow's
 * single-line paragraphs) as fit, rather than dropping the whole list.
 */
export function fitToLimit(body, maxChars, fullChangelogUrl) {
  if (body.length <= maxChars) return body;
  const notice = `\n\n*(cut short - [full changelog](${fullChangelogUrl}))*`;
  const budget = maxChars - notice.length;
  const blocks = body.split(/\n\n/u);
  let out = "";
  for (const block of blocks) {
    const next = out ? `${out}\n\n${block}` : block;
    if (next.length <= budget) {
      out = next;
      continue;
    }

    const prefix = out ? `${out}\n\n` : "";
    const remaining = budget - prefix.length;
    if (remaining > 0) {
      let partial = "";
      for (const line of block.split("\n")) {
        const nextPartial = partial ? `${partial}\n${line}` : line;
        if (nextPartial.length > remaining) break;
        partial = nextPartial;
      }
      if (partial) out = prefix + partial;
    }
    break;
  }
  if (!out) out = body.slice(0, Math.max(0, budget));
  return out + notice;
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

  const version = tag.replace(/^v/u, "");
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const releaseUrl = `https://github.com/${repoFull}/releases/tag/${tag}`;
  let section = changelogSection(changelog, version);
  if (!section) {
    console.log(`::warning::no CHANGELOG.md section found for ${version}; posting without one`);
    section = `See the [release page](${releaseUrl}) for details.`;
  }
  section = reflow(section);
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
    content: `<@&${NEWS_ROLE_ID}> ${headline}`,
    allowed_mentions: { roles: [NEWS_ROLE_ID] },
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

// Guarded so a test file can `import` this module for its exported helpers
// (fitToLimit, reflow) without also triggering a live run against process.env.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`::error::${err.stack || err}`);
    process.exit(1);
  });
}
