/**
 * The bug and idea buttons in the corner of the dungeon view (#326).
 *
 * Two small buttons sit at the bottom right of the dungeon view, faint until the
 * pointer is over them. Each opens a popup that takes a one-line summary and a
 * few lines of detail, then sends them to a GitHub issue form or a Discord forum
 * post. A bug report can also carry the system details, once the player ticks
 * the box that shows exactly what they are; can copy a screenshot or the
 * character dump; and can look for similar reports first. The close control on
 * the buttons hides them, and Subwindow setup turns them back on.
 *
 * Nothing is sent from here. GitHub gets a filled-in form the player still has
 * to submit, and Discord gets text on the clipboard. The one request this makes
 * on its own is the similar-reports search, and only when the player asks for it.
 */

import { t } from "@rpgm-tools/neo-angband-core";
import type { ChromeNotice } from "./chrome-notice";
import { addControlDomOwner } from "./input-door";
import {
  DETAILS_MAX, DISCORD_FORUMS, DISCORD_INVITE, SUMMARY_MAX, detailRows, discordPostText,
  githubIssueUrl, issueSearchApi, issueSearchPage, issueTitle, parseIssueSearch,
  type FoundIssue, type ReportDraft, type ReportKind, type SystemDetails,
} from "./report-links";
import type { WatchEntry } from "./report-watch";

export const REPORT_BUTTONS_STORAGE_KEY = "neo-angband:report-buttons";

type ButtonStorage = Pick<Storage, "getItem" | "setItem">;

export function readReportButtonsEnabled(storage: ButtonStorage): boolean {
  try {
    const raw = storage.getItem(REPORT_BUTTONS_STORAGE_KEY);
    if (raw === null) return true;
    const data = JSON.parse(raw) as Record<string, unknown>;
    return !(data !== null && typeof data === "object" && data["v"] === 1 && data["enabled"] === false);
  } catch {
    return true;
  }
}

export function writeReportButtonsEnabled(storage: ButtonStorage, enabled: boolean): boolean {
  try {
    storage.setItem(REPORT_BUTTONS_STORAGE_KEY, JSON.stringify({ v: 1, enabled }));
    return true;
  } catch {
    return false;
  }
}

export interface ReportButtonsHost {
  /** The element the buttons sit in (the dungeon view). */
  readonly host: HTMLElement;
  readonly notice: ChromeNotice;
  readonly storage: ButtonStorage;
  readonly system: () => SystemDetails;
  /** The character dump, or null with no character in play. */
  readonly characterDump: () => string | null;
  /** The game's screen as a PNG. */
  readonly screenshot: () => Promise<Blob>;
  readonly open: (url: string) => boolean;
  readonly fetchJson: (url: string) => Promise<unknown>;
  /** Remember an issue for the fixed notice. */
  readonly watch: (entry: WatchEntry) => void;
  readonly now?: () => number;
}

export interface ReportButtons {
  enabled(): boolean;
  setEnabled(enabled: boolean): void;
  openPopup(kind: ReportKind): void;
  closePopup(): void;
  isOpen(): boolean;
  destroy(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/* Line icons drawn in the button's text colour, on a 16-unit grid. */
const ICONS: Readonly<Record<ReportKind, string>> = {
  bug: "M5.5 3.5l1.5 1.5M10.5 3.5L9 5M8 5c2 0 3 1.5 3 3.5V11c0 1.7-1.3 3-3 3s-3-1.3-3-3V8.5C5 6.5 6 5 8 5zM5 8H2.5M11 8h2.5M5 11.5H3M11 11.5h2M8 7.5V14",
  idea: "M8 2a4 4 0 0 0-2.4 7.2c.5.4.9 1 .9 1.6V12h3v-1.2c0-.6.4-1.2.9-1.6A4 4 0 0 0 8 2zM6.5 14h3",
};

function icon(kind: ReportKind): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICONS[kind]);
  svg.appendChild(path);
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(cls: string, label: string, title?: string): HTMLButtonElement {
  const b = el("button", cls, label);
  b.type = "button";
  if (title) b.title = title;
  return b;
}

/** Copy text, falling back to a selected text area where the async API is refused. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = el("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const BUG_TOOLTIP = t("reportButtons.bugTooltip", "Report a bug");
export const IDEA_TOOLTIP = t("reportButtons.ideaTooltip", "Share an idea. Bring your ideas to a Neo Angband mod!");

export function mountReportButtons(opts: ReportButtonsHost): ReportButtons {
  const now = opts.now ?? Date.now;
  let enabled = readReportButtonsEnabled(opts.storage);
  let kind: ReportKind = "bug";
  let destroyed = false;

  const root = el("div", "report-root");
  const dock = el("div", "report-dock");
  dock.setAttribute("role", "toolbar");
  dock.setAttribute("aria-label", t("reportButtons.dockLabel", "Report a bug or share an idea"));
  const bugButton = button("report-dock-button", "", BUG_TOOLTIP);
  bugButton.setAttribute("aria-label", BUG_TOOLTIP);
  bugButton.dataset.kind = "bug";
  bugButton.appendChild(icon("bug"));
  const ideaButton = button("report-dock-button", "", IDEA_TOOLTIP);
  ideaButton.setAttribute("aria-label", IDEA_TOOLTIP);
  ideaButton.dataset.kind = "idea";
  ideaButton.appendChild(icon("idea"));
  const hideLabel = t("reportButtons.hide", "Hide these buttons (Subwindow setup brings them back)");
  const hideButton = button("report-dock-hide", "x", hideLabel);
  hideButton.setAttribute("aria-label", hideLabel);
  dock.append(bugButton, ideaButton, hideButton);

  const popup = el("div", "report-popup");
  popup.setAttribute("role", "dialog");
  popup.hidden = true;
  const head = el("div", "report-popup-head");
  const title = el("span", "report-popup-title");
  title.id = "report-popup-title";
  popup.setAttribute("aria-labelledby", title.id);
  const close = button("report-popup-close", "x", t("reportButtons.close", "Close (Esc)"));
  close.setAttribute("aria-label", t("reportButtons.close", "Close (Esc)"));
  head.append(title, close);
  const intro = el("p", "report-popup-intro");

  const summaryLabel = el("label", "report-field");
  const summaryText = el("span");
  const summary = el("input");
  summary.type = "text";
  summary.maxLength = SUMMARY_MAX;
  summaryLabel.append(summaryText, summary);
  const detailsLabel = el("label", "report-field");
  const detailsText = el("span");
  const details = el("textarea");
  details.rows = 4;
  details.maxLength = DETAILS_MAX;
  detailsLabel.append(detailsText, details);

  const consentRow = el("label", "report-consent");
  const consent = el("input");
  consent.type = "checkbox";
  consentRow.append(consent, el("span", undefined, t("reportButtons.consent", "Include these system details")));
  const detailList = el("dl", "report-details");

  const extras = el("div", "report-actions");
  const shotButton = button("report-action", t("reportButtons.screenshot", "Copy screenshot"),
    t("reportButtons.screenshotTip", "Copy the game's screen, to paste into the report"));
  const dumpButton = button("report-action", t("reportButtons.dump", "Copy character dump"),
    t("reportButtons.dumpTip", "Copy the character sheet as text, to paste into the report"));
  extras.append(shotButton, dumpButton);

  const similar = el("div", "report-similar");
  const similarButton = button("report-action", t("reportButtons.similar", "Look for similar reports"),
    t("reportButtons.similarTip", "Search the issue tracker for the words in your summary"));
  const similarList = el("ul", "report-similar-list");
  similar.append(similarButton, similarList);

  const send = el("div", "report-send");
  const githubButton = button("report-send-button", t("reportButtons.github", "Open a GitHub issue"),
    t("reportButtons.githubTip", "Opens the issue form in your browser, filled in from here. You submit it there."));
  const discordButton = button("report-send-button", t("reportButtons.discord", "Post on Discord"),
    t("reportButtons.discordTip", "Copies the post and opens the forum. No GitHub account needed."));
  send.append(githubButton, discordButton);
  const discordSteps = el("div", "report-discord-steps");
  discordSteps.hidden = true;
  const status = el("p", "report-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  popup.append(head, intro, summaryLabel, detailsLabel, consentRow, detailList, extras, similar, send, discordSteps, status);
  root.append(dock, popup);
  opts.host.appendChild(root);

  function say(text: string): void {
    status.textContent = text;
  }

  function draft(): ReportDraft {
    return {
      kind,
      summary: summary.value,
      details: details.value,
      ...(kind === "bug" && consent.checked ? { system: opts.system() } : {}),
    };
  }

  function renderDetails(): void {
    detailList.replaceChildren();
    for (const [label, value] of detailRows(opts.system())) {
      detailList.append(el("dt", undefined, label), el("dd", undefined, value));
    }
  }

  function refresh(): void {
    root.hidden = !enabled && popup.hidden;
    dock.hidden = !enabled;
  }

  function openPopup(next: ReportKind): void {
    /* A draft belongs to one kind: a bug's summary is not an idea's. */
    if (next !== kind) {
      summary.value = "";
      details.value = "";
      consent.checked = false;
    }
    kind = next;
    const bug = kind === "bug";
    popup.dataset.kind = kind;
    title.textContent = bug ? t("reportButtons.bugTitle", "Report a bug") : t("reportButtons.ideaTitle", "Share an idea");
    intro.textContent = bug
      ? t("reportButtons.bugIntro", "Say what went wrong and how you got there. For a crash or a save that will not load, Report a problem in the Escape menu also writes a file with the recent log to attach.")
      : t("reportButtons.ideaIntro", "Bring your ideas to a Neo Angband mod! The core game stays faithful to Angband, so most ideas become mods, and the people who make them read these.");
    summaryText.textContent = t("reportButtons.summary", "Summary");
    summary.placeholder = bug
      ? t("reportButtons.bugSummaryHint", "The screen went black on the stairs")
      : t("reportButtons.ideaSummaryHint", "Show the light radius on the map");
    detailsText.textContent = bug ? t("reportButtons.bugDetails", "What happened") : t("reportButtons.ideaDetails", "The idea");
    for (const node of [consentRow, detailList, extras]) node.hidden = !bug;
    if (bug) renderDetails();
    detailList.classList.toggle("report-details-off", !consent.checked);
    dumpButton.disabled = opts.characterDump() === null;
    dumpButton.title = dumpButton.disabled
      ? t("reportButtons.dumpNone", "No character is in play")
      : t("reportButtons.dumpTip", "Copy the character sheet as text, to paste into the report");
    similarList.replaceChildren();
    discordSteps.hidden = true;
    say("");
    popup.hidden = false;
    refresh();
    summary.focus();
  }

  function closePopup(): void {
    if (popup.hidden) return;
    popup.hidden = true;
    if (popup.contains(document.activeElement) && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    refresh();
  }

  function setEnabled(next: boolean): void {
    enabled = next;
    writeReportButtonsEnabled(opts.storage, next);
    if (!next) closePopup();
    refresh();
  }

  async function copyScreenshot(): Promise<void> {
    const shot = opts.screenshot();
    try {
      /* The blob is handed over as a promise so the write starts inside the click,
       * which Safari requires. */
      await navigator.clipboard.write([new ClipboardItem({ "image/png": shot })]);
      say(t("reportButtons.screenshotCopied", "Screenshot copied. Paste it into the report with Ctrl+V."));
    } catch {
      try {
        saveFile(await shot, "neo-angband-screenshot.png");
        say(t("reportButtons.screenshotSaved", "This browser would not copy the image, so it was saved as a file to attach instead."));
      } catch {
        say(t("reportButtons.screenshotFailed", "The screenshot could not be taken."));
      }
    }
  }

  async function copyDump(): Promise<void> {
    const dump = opts.characterDump();
    if (dump === null) return;
    say(await copyText(dump)
      ? t("reportButtons.dumpCopied", "Character dump copied. Paste it into the report.")
      : t("reportButtons.copyFailed", "The clipboard refused the copy."));
  }

  function showFound(found: readonly FoundIssue[]): void {
    similarList.replaceChildren();
    for (const issue of found) {
      const item = el("li");
      const link = button("report-similar-link", `#${String(issue.number)} ${issue.title}`,
        t("reportButtons.openIssue", "Open this issue in your browser"));
      link.addEventListener("click", () => { opts.open(issue.url); });
      const state = el("span", "report-similar-state", issue.open ? t("reportButtons.open", "open") : t("reportButtons.closed", "closed"));
      const mine = button("report-similar-mine", t("reportButtons.mine", "Same here"),
        t("reportButtons.mineTip", "Opens the issue so you can add to it, and shows a notice once it is marked fixed"));
      mine.addEventListener("click", () => {
        opts.watch({ number: issue.number, at: now() });
        opts.open(issue.url);
        say(t("reportButtons.watching", "You will get a notice after an update once #{n} is marked fixed.", { n: String(issue.number) }));
      });
      item.append(link, state, mine);
      similarList.append(item);
    }
  }

  async function findSimilar(): Promise<void> {
    const api = issueSearchApi(summary.value);
    if (api === null) {
      say(t("reportButtons.similarEmpty", "Write a summary first, and the search uses its words."));
      summary.focus();
      return;
    }
    say(t("reportButtons.searching", "Searching..."));
    try {
      const found = parseIssueSearch(await opts.fetchJson(api));
      showFound(found);
      say(found.length === 0
        ? t("reportButtons.noneFound", "No similar reports found.")
        : t("reportButtons.found", "If one of these is yours, Same here keeps you posted instead of opening a new one."));
    } catch {
      similarList.replaceChildren();
      const fallback = button("report-similar-link", t("reportButtons.searchPage", "Search on GitHub instead"));
      fallback.addEventListener("click", () => { opts.open(issueSearchPage(summary.value)); });
      const item = el("li");
      item.append(fallback);
      similarList.append(item);
      say(t("reportButtons.searchFailed", "GitHub could not be reached."));
    }
  }

  function openGithub(): void {
    const current = draft();
    if (!opts.open(githubIssueUrl(current))) {
      say(t("reportButtons.notOpened", "The browser did not open the page. Allow pop-ups for the game and try again."));
      return;
    }
    if (current.summary.trim() !== "") opts.watch({ title: issueTitle(current), at: now() });
    say(t("reportButtons.githubOpened", "The form opened in your browser. Check it over and submit it there."));
  }

  async function openDiscord(): Promise<void> {
    const copied = await copyText(discordPostText(draft()));
    discordSteps.replaceChildren();
    const join = button("report-action", t("reportButtons.join", "1. Join the Discord"),
      t("reportButtons.joinTip", "Skip this if you are already a member"));
    join.addEventListener("click", () => { opts.open(DISCORD_INVITE); });
    const forum = button("report-action", kind === "bug"
      ? t("reportButtons.bugForum", "2. Open the bug reports forum")
      : t("reportButtons.ideaForum", "2. Open the ideas forum"),
    t("reportButtons.forumTip", "Start a new post there and paste"));
    forum.addEventListener("click", () => { opts.open(DISCORD_FORUMS[kind]); });
    discordSteps.append(join, forum);
    discordSteps.hidden = false;
    say(copied
      ? t("reportButtons.discordCopied", "The post is copied. Start a new post in the forum and paste it; its first line makes a good title.")
      : t("reportButtons.copyFailed", "The clipboard refused the copy."));
  }

  bugButton.addEventListener("click", () => { openPopup("bug"); });
  ideaButton.addEventListener("click", () => { openPopup("idea"); });
  hideButton.addEventListener("click", () => {
    setEnabled(false);
    opts.notice.show(t("reportButtons.hidden", "The bug and idea buttons are hidden. Options (=), Subwindow setup (w) brings them back."));
  });
  close.addEventListener("click", closePopup);
  consent.addEventListener("change", () => { detailList.classList.toggle("report-details-off", !consent.checked); });
  shotButton.addEventListener("click", () => { void copyScreenshot(); });
  dumpButton.addEventListener("click", () => { void copyDump(); });
  similarButton.addEventListener("click", () => { void findSimilar(); });
  githubButton.addEventListener("click", openGithub);
  discordButton.addEventListener("click", () => { void openDiscord(); });

  /* The dock's buttons must not take focus from the game. */
  for (const b of [bugButton, ideaButton, hideButton]) b.addEventListener("pointerdown", (event) => { event.preventDefault(); });
  /* Pointer work inside the root belongs to it, not to the map underneath. */
  for (const type of ["pointerdown", "mousedown", "click", "contextmenu", "wheel"]) {
    root.addEventListener(type, (event) => { event.stopPropagation(); });
  }

  const onWindowPointerDown = (event: PointerEvent): void => {
    if (!popup.hidden && event.target instanceof Node && !root.contains(event.target)) closePopup();
  };
  window.addEventListener("pointerdown", onWindowPointerDown, true);

  const removeOwner = addControlDomOwner({
    owns: (event) => event.target instanceof Node && popup.contains(event.target),
    escape: () => {
      if (popup.hidden) return false;
      closePopup();
      return true;
    },
  });

  refresh();

  return {
    enabled: () => enabled,
    setEnabled,
    openPopup,
    closePopup,
    isOpen: () => !popup.hidden,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      removeOwner();
      window.removeEventListener("pointerdown", onWindowPointerDown, true);
      root.remove();
    },
  };
}

/**
 * One PNG of every visible canvas under `root`, placed where each one sits on
 * screen, so a screenshot shows the panels as well as the map. A panel a mod
 * draws as plain page content is left out.
 */
export function captureCanvases(root: HTMLElement, dpr = window.devicePixelRatio || 1): Promise<Blob> {
  const base = root.getBoundingClientRect();
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(base.width * dpr));
  out.height = Math.max(1, Math.round(base.height * dpr));
  const g = out.getContext("2d");
  if (!g) return Promise.reject(new Error("no 2d context"));
  g.fillStyle = "#000";
  g.fillRect(0, 0, out.width, out.height);
  for (const canvas of root.querySelectorAll("canvas")) {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || canvas.width === 0 || canvas.height === 0) continue;
    if (canvas.closest("[hidden]") !== null) continue;
    g.drawImage(canvas, (r.left - base.left) * dpr, (r.top - base.top) * dpr, r.width * dpr, r.height * dpr);
  }
  return new Promise<Blob>((resolve, reject) => {
    out.toBlob((blob) => { if (blob) resolve(blob); else reject(new Error("no image")); }, "image/png");
  });
}
