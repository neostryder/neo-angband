/**
 * The in-app mod manager (W2.4): the discoverable screen behind the Escape
 * menu's "Mods" row. It lets a player list installed mods, enable/disable them,
 * reorder load order, consent to plugin capabilities, view content conflicts,
 * and manage named profiles - all on the canvas glyph terminal, through the
 * overlay.ts helpers, launched via openModal (main.ts) so it owns input while up.
 *
 * It is deliberately decoupled from discovery and reload: main.ts injects a
 * ModManagerDeps (a live catalog builder, a conflict-line provider, and a
 * reload trigger), so this module is pure UI over the W2.4a store/catalog and
 * the P7.4/P7.6 mod-sdk machinery. Enable/disable/reorder mutate the persisted
 * store; the change takes effect on reload (content is composed at load time and
 * plugins are installed at boot), which the manager makes explicit.
 *
 * Install-from-URL is surfaced honestly: the static web build inlines every mod
 * at build time and has no runtime code loader, so this build cannot fetch a mod
 * from a URL. The row explains that filesystem/URL install is a desktop
 * (Electron) capability rather than pretending to work - documenting the
 * surface difference instead of leaving a dead button.
 */

import {
  menuLetter,
  selectFromMenu,
  showTextScreen,
  promptText,
  type MenuItem,
  type ScreenLine,
} from "./overlay";
import type { GlyphTerm } from "./term";
import type { CatalogMod, ModStore } from "./mod-store";
import { describeCapabilities, hasElevatedCapability } from "./capability-describe";

const C_ENABLED = "#7fd07f";
const C_DISABLED = "#8a8a94";
const C_WARN = "#e0c060";
const C_DANGER = "#e08a8a";
const C_FG = "#c8c8d4";
const C_DIM = "#8a8a94";
const C_TITLE = "#e8e8f0";

/** What the manager needs from the host (discovery + reload are browser-only). */
export interface ModManagerDeps {
  /** The persisted enable/consent/profile store. */
  store: ModStore;
  /** Build the current catalog fresh (re-reads discovery + store each call). */
  listCatalog: () => CatalogMod[];
  /** Human-readable conflict lines for the enabled content set (P7.6 humanLines). */
  conflictLines: () => string[];
  /** Apply pending changes by reloading (recompose content + reinstall plugins). */
  requestReload: () => void;
}

/** The one-line badge for a catalog row: enabled state + any warning. */
function rowLabel(m: CatalogMod): MenuItem {
  const box = m.enabled ? "[x]" : "[ ]";
  const needsConsent = m.enabled && !m.consented;
  const flags: string[] = [];
  if (m.nondeterministic) flags.push("non-deterministic");
  if (needsConsent) flags.push("NEEDS CONSENT");
  const suffix = flags.length ? `  ! ${flags.join(", ")}` : "";
  const label = `${box} ${m.name}  v${m.version}  (${m.kind})${suffix}`;
  const color = needsConsent
    ? C_WARN
    : m.enabled
      ? C_ENABLED
      : C_DISABLED;
  const capNote =
    m.capabilities.length > 0
      ? `Requests ${m.capabilities.length} capability(ies).`
      : "No special capabilities.";
  return {
    label,
    color,
    hint: `${m.shape} mod - ${capNote} Enter to manage.`,
  };
}

/** The detail pane for a catalog row: version, deps, capabilities, consent. */
function rowDetail(m: CatalogMod): ScreenLine[] {
  const lines: ScreenLine[] = [];
  lines.push({ text: `${m.name}  (id: ${m.id})`, color: C_TITLE });
  lines.push({ text: `version ${m.version}  -  ${m.shape} / ${m.kind}`, color: C_FG });
  const deps = m.manifest.dependencies
    ? Object.entries(m.manifest.dependencies).map(([d, v]) => `${d} ${v}`)
    : [];
  if (deps.length) lines.push({ text: `Depends on: ${deps.join(", ")}`, color: C_FG });
  if (m.nondeterministic) {
    lines.push({
      text: "Non-deterministic: enabling this permanently marks the save non-reproducible.",
      color: C_WARN,
    });
  }
  if (m.capabilities.length === 0) {
    lines.push({ text: "Capabilities: none (content only).", color: C_DIM });
  } else {
    lines.push({ text: "Capabilities requested:", color: C_FG });
    for (const d of describeCapabilities(m.capabilities)) {
      lines.push({
        text: `  - ${d.text}${d.elevated ? "  [elevated]" : ""}`,
        color: d.elevated ? C_WARN : C_FG,
      });
    }
    lines.push({
      text: m.consented ? "Consent: granted." : "Consent: NOT granted (enable to review).",
      color: m.consented ? C_ENABLED : C_WARN,
    });
  }
  return lines;
}

/**
 * The capability consent gate: show every requested capability in plain terms,
 * flag elevated ones, and require an explicit Yes. Returns true if consented.
 */
async function consentPrompt(term: GlyphTerm, m: CatalogMod): Promise<boolean> {
  const lines: ScreenLine[] = [
    { text: `"${m.name}" requests these capabilities:`, color: C_TITLE },
    { text: "", color: C_FG },
  ];
  for (const d of describeCapabilities(m.capabilities)) {
    lines.push({
      text: `  - ${d.text}${d.elevated ? "   [elevated]" : ""}`,
      color: d.elevated ? C_WARN : C_FG,
    });
  }
  lines.push({ text: "", color: C_FG });
  if (hasElevatedCapability(m.capabilities)) {
    lines.push({
      text: "This mod can change core game behavior in-process. Only enable mods you trust.",
      color: C_DANGER,
    });
  }
  if (m.nondeterministic) {
    lines.push({
      text: "It also marks your save permanently non-reproducible.",
      color: C_WARN,
    });
  }
  lines.push({ text: "", color: C_FG });
  // A trailing read of the terms, then a Yes/No pick.
  await showTextScreen(term, `Consent - ${m.name}`, lines, "[ Press ESC to review, then choose ]");
  const pick = await selectFromMenu(
    term,
    `Grant these capabilities to "${m.name}"?`,
    [
      { label: "Yes, enable and grant", color: C_ENABLED },
      { label: "No, cancel", color: C_FG },
    ],
    "[ a/b or tap; ESC cancels ]",
  );
  return pick === 0;
}

/** Enable a mod, gating plugins on capability consent. Returns true if enabled. */
async function enableMod(
  term: GlyphTerm,
  deps: ModManagerDeps,
  m: CatalogMod,
): Promise<boolean> {
  if (m.capabilities.length > 0) {
    const ok = await consentPrompt(term, m);
    if (!ok) return false;
    deps.store.setConsent(m.id, m.capabilities);
  }
  deps.store.setModEnabled(m.id, true);
  return true;
}

/** Per-mod action submenu: toggle, reorder, details. Returns true if changed. */
async function manageMod(
  term: GlyphTerm,
  deps: ModManagerDeps,
  id: string,
): Promise<boolean> {
  let changed = false;
  for (;;) {
    const m = deps.listCatalog().find((x) => x.id === id);
    if (!m) return changed;
    const items: MenuItem[] = [];
    const acts: string[] = [];
    if (m.enabled) {
      items.push({ label: "Disable", color: C_WARN });
      acts.push("disable");
      items.push({ label: "Move earlier (loads first)", color: C_FG });
      acts.push("up");
      items.push({ label: "Move later (loads last, wins conflicts)", color: C_FG });
      acts.push("down");
    } else {
      items.push({ label: "Enable", color: C_ENABLED });
      acts.push("enable");
    }
    items.push({ label: "Back", color: C_DIM });
    acts.push("back");

    const pick = await selectFromMenu(
      term,
      `${m.name}  v${m.version}`,
      items,
      "[ choose an action; ESC to go back ]",
      { detail: () => rowDetail(m), detailToggleKey: "?", detailInitiallyShown: true },
    );
    const act = pick === null ? "back" : acts[pick];
    if (act === "back") return changed;
    if (act === "enable") {
      if (await enableMod(term, deps, m)) changed = true;
    } else if (act === "disable") {
      deps.store.setModEnabled(m.id, false);
      changed = true;
    } else if (act === "up") {
      deps.store.moveEnabled(m.id, -1);
      changed = true;
    } else if (act === "down") {
      deps.store.moveEnabled(m.id, +1);
      changed = true;
    }
  }
}

/** The conflicts viewer (P7.6 human lines over the enabled content set). */
async function viewConflicts(term: GlyphTerm, deps: ModManagerDeps): Promise<void> {
  const lines = deps.conflictLines();
  const body: ScreenLine[] =
    lines.length === 0
      ? [{ text: "No conflicts among the enabled content mods.", color: C_ENABLED }]
      : lines.map((t) => ({ text: t, color: C_FG }));
  await showTextScreen(term, "Mod conflicts", body);
}

/** The profiles submenu: save current, apply, or delete a named config. */
async function manageProfiles(
  term: GlyphTerm,
  deps: ModManagerDeps,
): Promise<boolean> {
  let changed = false;
  for (;;) {
    const profiles = Object.keys(deps.store.getProfiles()).sort();
    const items: MenuItem[] = [
      { label: "Save current setup as a profile...", color: C_FG },
    ];
    const acts: string[] = ["save"];
    for (const name of profiles) {
      items.push({ label: `Apply "${name}"`, color: C_ENABLED });
      acts.push(`apply:${name}`);
      items.push({ label: `Delete "${name}"`, color: C_WARN });
      acts.push(`delete:${name}`);
    }
    items.push({ label: "Back", color: C_DIM });
    acts.push("back");

    const pick = await selectFromMenu(
      term,
      "Mod profiles",
      items,
      "[ save / apply / delete; ESC to go back ]",
    );
    const act = pick === null ? "back" : acts[pick];
    if (act === "back") return changed;
    if (act === "save") {
      const name = await promptText(term, "Profile name", "", 40);
      if (name && name.trim()) deps.store.saveProfile(name.trim());
    } else if (act?.startsWith("apply:")) {
      deps.store.applyProfile(act.slice("apply:".length));
      changed = true;
    } else if (act?.startsWith("delete:")) {
      deps.store.deleteProfile(act.slice("delete:".length));
    }
  }
}

/** The honest install-from-URL surface (no runtime loader in the web build). */
async function installFromUrl(term: GlyphTerm): Promise<void> {
  const url = await promptText(term, "Install mod from URL", "https://", 200);
  if (!url) return;
  await showTextScreen(
    term,
    "Install from URL",
    [
      { text: "This browser build inlines every mod at build time and has no", color: C_FG },
      { text: "runtime code loader, so it cannot fetch and run a mod from a URL.", color: C_FG },
      { text: "", color: C_FG },
      { text: "To install mods from a URL or a folder, use the desktop (Electron)", color: C_WARN },
      { text: "build, which reads mods from a local mods/ directory. See the", color: C_WARN },
      { text: "Electron how-to in the docs. Bundled mods remain manageable here.", color: C_WARN },
      { text: "", color: C_FG },
      { text: `(You entered: ${url.slice(0, 60)})`, color: C_DIM },
    ],
  );
}

/**
 * Run the mod manager. Loops on the top list (mods + actions) until the user
 * leaves; if changes were made it offers to reload so they take effect.
 */
export async function runModManager(
  term: GlyphTerm,
  deps: ModManagerDeps,
): Promise<void> {
  let dirty = false;
  for (;;) {
    const catalog = deps.listCatalog();
    const items: MenuItem[] = catalog.map(rowLabel);
    type ActionKind = "conflicts" | "profiles" | "install" | "reload" | "done";
    type RowKind = { kind: "mod"; id: string } | { kind: ActionKind };
    const rowKinds: RowKind[] = catalog.map((m) => ({
      kind: "mod" as const,
      id: m.id,
    }));

    // Action rows below the list.
    const addAction = (
      label: string,
      kind: ActionKind,
      color = C_FG,
      hint = "",
    ): void => {
      items.push({ label, color, ...(hint ? { hint } : {}) });
      rowKinds.push({ kind });
    };
    addAction("View conflicts", "conflicts", C_FG, "Which enabled content mods contest the same records.");
    addAction("Profiles...", "profiles", C_FG, "Save / apply / delete named mod setups.");
    addAction("Install from URL...", "install", C_DIM, "Desktop-only; explains the web-build limit.");
    if (dirty) {
      addAction("Apply changes and reload", "reload", C_WARN, "Reload so enable/disable/order take effect.");
    }
    addAction("Done", "done", C_DIM, "Close the mod manager.");

    const footer = dirty
      ? "[ changes pending - Apply to reload; ESC = Done ]"
      : "[ Enter a mod to manage it; ESC to close ]";
    const pick = await selectFromMenu(term, "Mods", items, footer, {
      detail: (i) => {
        const rk = rowKinds[i];
        return rk && "id" in rk
          ? rowDetail(catalog.find((m) => m.id === rk.id)!)
          : [];
      },
      detailToggleKey: "?",
    });

    const rk: RowKind | undefined =
      pick === null ? { kind: "done" } : rowKinds[pick];
    if (!rk || rk.kind === "done") break;
    if (rk.kind === "mod" && "id" in rk) {
      if (await manageMod(term, deps, rk.id)) dirty = true;
    } else if (rk.kind === "conflicts") {
      await viewConflicts(term, deps);
    } else if (rk.kind === "profiles") {
      if (await manageProfiles(term, deps)) dirty = true;
    } else if (rk.kind === "install") {
      await installFromUrl(term);
    } else if (rk.kind === "reload") {
      deps.requestReload();
      return; // reload takes over
    }
  }

  if (dirty) {
    const pick = await selectFromMenu(
      term,
      "Apply mod changes?",
      [
        { label: "Reload now to apply", color: C_ENABLED },
        { label: "Later (changes are saved; apply on next reload)", color: C_FG },
      ],
      "[ a/b or tap ]",
    );
    if (pick === 0) deps.requestReload();
  }
}
