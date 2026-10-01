/**
 * Where the bug and idea buttons send a player, and what they send (#326).
 *
 * Pure: every value the links need is passed in, so the addresses and the text
 * can be asserted without a page.
 *
 * GitHub's issue forms take their fields from the query string, keyed by each
 * field's `id` in `.github/ISSUE_TEMPLATE`. A dropdown takes the option's exact
 * text, so `surfaceOption` has to stay in step with `2-bug.yml`, and a test reads
 * that file to hold it there.
 *
 * Discord has no link that fills in a forum post, so the Discord route copies
 * the text and opens the forum for the player to paste into.
 */

import type { EnabledMod } from "./mod-summary";
import type { ReportShell } from "./report";

export type ReportKind = "bug" | "idea";

export const NEO_ANGBAND_REPO = "neostryder/neo-angband";
export const DISCORD_INVITE = "https://discord.gg/YegtwbHTBQ";
const DISCORD_GUILD = "1019812414348345375";
/** neo-angband-bug-reports for bugs, neo-angband-forum (Feature Requests tag) for ideas. */
export const DISCORD_FORUMS: Readonly<Record<ReportKind, string>> = {
  bug: `https://discord.com/channels/${DISCORD_GUILD}/1540837430205227142`,
  idea: `https://discord.com/channels/${DISCORD_GUILD}/1540857566140301322`,
};

/** The issue form each kind opens, and the field its details go into. */
const FORMS: Readonly<Record<ReportKind, { template: string; prefix: string; field: string }>> = {
  bug: { template: "2-bug.yml", prefix: "[bug] ", field: "what" },
  idea: { template: "4-idea.yml", prefix: "[idea] ", field: "idea" },
};

/** A summary is cut to fit an issue title, and the details to keep the form's link a workable length. */
export const SUMMARY_MAX = 120;
export const DETAILS_MAX = 2000;

/** The system details a bug report carries when the player agrees to share them. */
export interface SystemDetails {
  readonly version: string;
  readonly shell: ReportShell;
  readonly userAgent: string;
  readonly platform: string;
  readonly devServer: boolean;
  readonly mods: readonly EnabledMod[];
}

/** The option of `2-bug.yml`'s "Where you were playing" dropdown that fits. */
export function surfaceOption(d: Pick<SystemDetails, "shell" | "userAgent" | "platform" | "devServer">): string {
  if (d.devServer) return "Built from source (dev server)";
  if (d.shell === "installed") return "Installed as a PWA";
  if (d.shell === "browser") return "Browser";
  const os = `${d.platform} ${d.userAgent}`;
  if (/Mac/i.test(os)) return "Desktop app (macOS)";
  if (/Linux|X11/i.test(os)) return "Desktop app (Linux)";
  return "Desktop app (Windows)";
}

/** "Firefox 148" from a user agent, or "" when it names no browser this knows. */
export function browserName(userAgent: string): string {
  const rules: readonly [RegExp, string][] = [
    [/Firefox\/(\d+)/, "Firefox"],
    [/Edg\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/Chrome\/(\d+)/, "Chrome"],
    [/Version\/(\d+)[.\d]* .*Safari/, "Safari"],
  ];
  for (const [pattern, name] of rules) {
    const m = pattern.exec(userAgent);
    if (m) return `${name} ${m[1] ?? ""}`.trim();
  }
  return "";
}

export function modsLine(mods: readonly EnabledMod[]): string {
  return mods.length === 0 ? "none" : mods.map((m) => `${m.id} ${m.version}`).join(", ");
}

/** Rows for the popup to show before the player agrees to share them. */
export function detailRows(d: SystemDetails): [string, string][] {
  const rows: [string, string][] = [
    ["Version", d.version],
    ["Where", surfaceOption(d)],
  ];
  const browser = d.shell === "desktop" ? "" : browserName(d.userAgent);
  if (browser !== "") rows.push(["Browser", browser]);
  rows.push(["Mods", modsLine(d.mods)]);
  return rows;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 3).trimEnd()}...`;
}

export interface ReportDraft {
  readonly kind: ReportKind;
  readonly summary: string;
  readonly details: string;
  /** Present only when the player agreed to share them; always absent for an idea. */
  readonly system?: SystemDetails;
}

/** The issue's title. The fixed notice searches for this exact text. */
export function issueTitle(draft: Pick<ReportDraft, "kind" | "summary">): string {
  return FORMS[draft.kind].prefix + clip(draft.summary, SUMMARY_MAX);
}

/** The new-issue form for a draft, filled in as far as its fields allow. */
export function githubIssueUrl(draft: ReportDraft): string {
  const form = FORMS[draft.kind];
  const params = new URLSearchParams({ template: form.template });
  params.set("title", issueTitle(draft));
  const details = clip(draft.details, DETAILS_MAX);
  if (details !== "") params.set(form.field, details);
  if (draft.kind === "bug" && draft.system) {
    const s = draft.system;
    params.set("version", s.version);
    params.set("surface", surfaceOption(s));
    const browser = s.shell === "desktop" ? "" : browserName(s.userAgent);
    if (browser !== "") params.set("browser", browser);
    params.set("mods", modsLine(s.mods));
  }
  return `https://github.com/${NEO_ANGBAND_REPO}/issues/new?${params.toString()}`;
}

/** The text copied for a Discord post: the summary as its first line, then the rest. */
export function discordPostText(draft: ReportDraft): string {
  const lines = [clip(draft.summary, SUMMARY_MAX) || (draft.kind === "bug" ? "Bug report" : "Idea")];
  const details = clip(draft.details, DETAILS_MAX);
  if (details !== "") lines.push("", details);
  if (draft.kind === "bug" && draft.system) {
    lines.push("");
    for (const [label, value] of detailRows(draft.system)) lines.push(`${label}: ${value}`);
  }
  return lines.join("\n");
}

/** The words of a summary worth searching on: three letters or more, at most eight. */
export function searchTerms(summary: string): string[] {
  const words = summary.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
  return [...new Set(words.filter((w) => w.length >= 3))].slice(0, 8);
}

/** The tracker's own search page for a summary, for when the API cannot be reached. */
export function issueSearchPage(summary: string): string {
  const q = ["is:issue", ...searchTerms(summary)].join(" ");
  return `https://github.com/${NEO_ANGBAND_REPO}/issues?${new URLSearchParams({ q }).toString()}`;
}

/** The search API request for issues that look like a summary, open or closed. */
export function issueSearchApi(summary: string): string | null {
  const terms = searchTerms(summary);
  if (terms.length === 0) return null;
  const q = [`repo:${NEO_ANGBAND_REPO}`, "is:issue", ...terms].join(" ");
  return `https://api.github.com/search/issues?${new URLSearchParams({ q, per_page: "5" }).toString()}`;
}

export interface FoundIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly open: boolean;
}

/** The issues out of a search API answer, ignoring anything malformed. */
export function parseIssueSearch(body: unknown): FoundIssue[] {
  if (body === null || typeof body !== "object") return [];
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const found: FoundIssue[] = [];
  for (const item of items) {
    if (item === null || typeof item !== "object") continue;
    const { number, title, html_url: url, state, pull_request: pr } = item as Record<string, unknown>;
    if (pr !== undefined) continue;
    if (typeof number !== "number" || typeof title !== "string" || typeof url !== "string") continue;
    found.push({ number, title, url, open: state === "open" });
  }
  return found;
}
