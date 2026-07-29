/**
 * The in-app mod manager (W2.4): the discoverable screen behind the Escape
 * menu's "Mods" row. It lets a player list installed mods, read what each one
 * does, enable/disable them, nudge load order, switch an individual patch of a
 * mod off, consent to plugin capabilities, view content conflicts, and manage
 * named profiles - all on the canvas glyph terminal, through the overlay.ts
 * helpers, launched via openModal (main.ts) so it owns input while up.
 *
 * The shape is deliberately MOD-CENTRIC: the top list highlights one mod at a
 * time and shows its full description, and everything about that mod - including
 * its fixes/tweaks - hangs off the mod's own screen. There is no pooled
 * cross-mod patch list, because a patch is part of a mod: it arrives when the mod
 * is enabled and does not exist while the mod is off.
 *
 * It is also deliberately RUDIMENTARY (MOD_LIFECYCLE.md decision 9, 2026-07-27):
 * enable/disable, per-patch opt-out, a one-step order nudge, conflicts, profiles.
 * Real load-order sorting and bulk management belong to an external mod manager
 * (Vortex/MO2) over the shared on-disk pack format, not to this screen.
 *
 * It is deliberately decoupled from discovery and reload: main.ts injects a
 * ModManagerDeps (a live catalog builder, a conflict-line provider, and a
 * reload trigger), so this module is pure UI over the W2.4a store/catalog and
 * the P7.4/P7.6 mod-sdk machinery. Enable/disable/reorder mutate the persisted
 * store; the change takes effect on reload (content is composed at load time and
 * plugins are installed at boot), which the manager makes explicit.
 *
 * Where mods come from is surfaced honestly, and now with a real answer on the
 * desktop build: the "Where mods come from" row names the actual mods folder,
 * how many packs are in it, and anything it could not read. On a browser tab it
 * says there is no folder and why. Neither surface has a runtime CODE loader, so
 * neither can fetch and run a mod from a URL - a folder of records is a different
 * thing, and it composes through the same pipeline as a bundled pack.
 */

import {
  selectFromMenu,
  showTextScreen,
  promptText,
  type MenuItem,
  type ScreenLine,
} from "./overlay";
import type { GlyphTerm } from "./term";
import type { CatalogMod, ModStore } from "./mod-store";
import type { ModRuleDecl } from "./pack";
import { describeCapabilities, hasElevatedCapability } from "./capability-describe";
import { wrapCssRuns } from "./shop";
import { UI_TEXT, UI_DIM, UI_GOLD, UI_GOOD, UI_BAD } from "./ui-colors";

const C_ENABLED = UI_GOOD;
const C_DISABLED = UI_DIM;
const C_WARN = UI_GOLD;
const C_DANGER = UI_BAD;
const C_FG = UI_TEXT;
const C_DIM = UI_DIM;
const C_TITLE = UI_TEXT;
const C_GOLD_TEXT = UI_GOLD;

/** What the manager needs to know about the on-disk mods folder. */
export interface DiskPackStatus {
  available: boolean;
  dir: string | null;
  count: number;
  problems: readonly string[];
  /** "app" = the shell's own folder; "picked" = one the player chose; "none". */
  kind: "none" | "app" | "picked";
}

/**
 * Choosing a mods folder, on a front end that has to be GIVEN one.
 *
 * Absent on the desktop build, which knows where its own folder is, and on an
 * engine that cannot pick a directory at all - in both cases there is nothing here
 * for a player to do, so no row is offered. Every one of these takes effect on
 * reload, because content composes at load time.
 */
export interface ModFolderPicker {
  /** Ask for a folder. Resolves to its name, or null when cancelled. */
  pick(): Promise<string | null>;
  /** Re-grant read permission for the saved folder. */
  reconnect(): Promise<boolean>;
  /** Stop using the saved folder (the bundled mods remain). */
  forget(): Promise<void>;
  /** The saved folder's name, when one is remembered. */
  savedName(): Promise<string | null>;
}

/** What the manager needs from the host (discovery + reload are browser-only). */
export interface ModManagerDeps {
  /** The persisted enable/consent/profile store. */
  store: ModStore;
  /**
   * The mods DIRECTORY's state, when this front end has one (pack.diskPackStatus).
   * Absent means the same as unavailable; the manager says so rather than
   * implying a folder exists.
   */
  diskPackStatus?: () => DiskPackStatus;
  /**
   * Pick / reconnect / forget a mods folder. Present only where the player is the
   * one who has to supply it - a browser tab on an engine that can pick a
   * directory. See ModFolderPicker.
   */
  modFolder?: ModFolderPicker;
  /** Build the current catalog fresh (re-reads discovery + store each call). */
  listCatalog: () => CatalogMod[];
  /** Human-readable conflict lines for the enabled content set (P7.6 humanLines). */
  conflictLines: () => string[];
  /** Apply pending changes by reloading (recompose content + reinstall plugins). */
  requestReload: () => void;
  /**
   * The rule declarations of the currently ENABLED mods (qol / bug-fixes). Each
   * mod's own Fixes & tweaks submenu filters this by `modId`; a disabled mod is
   * absent from it entirely, which is what makes "a patch does not exist while
   * its mod is off" true of the UI and not just of core. Absent / empty when no
   * enabled mod declares rules.
   */
  ruleDecls?: () => ModRuleDecl[];
  /**
   * Apply a rule toggle to the LIVE running game immediately (writes
   * GameState.modRules), so a tweak takes effect without a reload. Absent when
   * no game is running (the choice still persists and applies on next start).
   */
  applyRuleLive?: (flag: string, on: boolean) => void;
  isModNoscore?: () => boolean;
  advanceSaveRatchets?: (mod: CatalogMod) => void;
  /**
   * The `?mods=` URL override, when one is in force, else null. It outranks the
   * store for the RUNNING session (resolveEnabledIds), so the [x] boxes here -
   * which show the persisted set, the thing this screen edits - can disagree
   * with what is actually loaded. The manager says so rather than showing a
   * screenful of empty boxes over a game running three mods.
   */
  urlModsOverride?: () => readonly string[] | null;
}

/**
 * The mods-folder row: label and colour for the three states it can be in.
 *
 * Exported and pure because the states are easy to get wrong in the direction that
 * hides a problem - a remembered folder the browser will not read must look
 * DIFFERENT from one it is reading, or the player sees a folder named on screen,
 * no mods from it, and no explanation.
 */
export function modFolderRow(
  savedName: string | null,
  attached: boolean,
): { label: string; color: string; lapsed: boolean } {
  if (savedName === null) {
    return { label: "Choose a mods folder...", color: C_FG, lapsed: false };
  }
  if (attached) return { label: `Mods folder: ${savedName}`, color: C_FG, lapsed: false };
  return {
    label: `Mods folder: ${savedName} - NEEDS RECONNECTING`,
    color: C_WARN,
    lapsed: true,
  };
}

/** The one-line badge for a catalog row: enabled state + any warning. */
function rowLabel(m: CatalogMod): MenuItem {
  const box = m.enabled ? "[x]" : "[ ]";
  const needsConsent = m.enabled && !m.consented;
  const flags: string[] = [];
  if (m.nondeterministic) flags.push("non-deterministic");
  if (m.affectsGameplay) flags.push("noscore");
  if (needsConsent) flags.push("NEEDS CONSENT");
  const suffix = flags.length ? `  ! ${flags.join(", ")}` : "";
  // Kind distinguishes the two PLUGIN load paths (sandbox vs trusted); for a
  // non-plugin it is just "content", which mislabels a tiles pack - so show the
  // shape there instead ("tiles" for a tile pack, not "content").
  const kindTag = m.kind === "content" ? m.shape : m.kind;
  const label = `${box} ${m.name}  v${m.version}  (${kindTag})${suffix}`;
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

/**
 * Word-wrap plain text to `width` columns as ScreenLines. The menu's detail pane
 * hard-slices at the terminal edge, so anything long enough to be worth reading -
 * a mod's own description, a patch's - has to be wrapped before it gets there.
 */
function wrapped(text: string, width: number, color = C_FG): ScreenLine[] {
  return wrapCssRuns([{ text, color }], Math.max(20, width)).map((runs) => ({
    text: runs.map((r) => r.text).join(""),
    color,
  }));
}

/**
 * The detail pane for a catalog row: the mod's own description (the thing a
 * player actually needs in order to decide, wrapped to fill the pane), then what
 * it is, what it depends on, what its patches do collectively, and the trust /
 * consent facts. `width` is the terminal's column count.
 *
 * `maxLines` is the pane's budget. selectFromMenu gives the detail pane whatever
 * it asks for and shrinks the LIST to fit, so an unbounded description on the
 * top-level Mods list would push the action rows off screen. Only the
 * description flexes: the identity and trust lines are never dropped, and the
 * mod's own screen (few rows, a big budget) shows the description in full.
 */
function rowDetail(m: CatalogMod, width = 80, maxLines = 99): ScreenLine[] {
  const lines: ScreenLine[] = [];
  lines.push({ text: `${m.name}  (id: ${m.id})`, color: C_TITLE });
  lines.push({
    text:
      m.kind === "content"
        ? `version ${m.version}  -  ${m.shape} pack`
        : `version ${m.version}  -  ${m.shape} pack, ${m.kind} plugin`,
    color: C_FG,
  });
  const by = [m.manifest.author, m.manifest.license].filter(Boolean).join("  -  ");
  if (by) lines.push({ text: by, color: C_DIM });
  if (m.manifest.description) {
    // Reserve room for everything below (patches / deps / warnings / consent),
    // then give the description the rest.
    const belowCount =
      (m.manifest.rules?.length ? 3 : 0) +
      (m.manifest.dependencies ? 1 : 0) +
      (m.nondeterministic ? 1 : 0) +
      (m.affectsGameplay ? 1 : 0) +
      (m.capabilities.length === 0 ? 1 : m.capabilities.length + 2);
    const room = Math.max(1, maxLines - lines.length - belowCount - 1);
    const desc = wrapped(m.manifest.description, width - 1);
    lines.push({ text: "", color: C_FG });
    if (desc.length <= room) {
      lines.push(...desc);
    } else {
      lines.push(...desc.slice(0, Math.max(1, room - 1)));
      lines.push({ text: "...  (open the mod to read the rest)", color: C_DIM });
    }
  }
  const ruleCount = m.manifest.rules?.length ?? 0;
  if (ruleCount > 0) {
    lines.push({ text: "", color: C_FG });
    lines.push(
      ...wrapped(
        m.enabled
          ? `Patches: ${ruleCount}, all on. Open this mod to switch any of them off individually.`
          : `Patches: ${ruleCount}. None of them exist while this mod is disabled; enabling it turns them all on at once.`,
        width - 1,
        m.enabled ? C_ENABLED : C_DIM,
      ),
    );
  }
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
  if (m.affectsGameplay) {
    lines.push({
      text: "Gameplay-changing: enabling this permanently marks this save non-scoring.",
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

/** True exactly while enabling `m` needs the one-time score warning. */
export function needsGameplayNoscoreWarning(m: CatalogMod, modNoscore: boolean): boolean {
  return m.affectsGameplay && !modNoscore;
}

/** Run the one-time warning only for the transition that trips the ratchet. */
export async function confirmGameplayNoscore(
  m: CatalogMod,
  modNoscore: boolean,
  confirm: () => Promise<boolean>,
): Promise<boolean> {
  return needsGameplayNoscoreWarning(m, modNoscore) ? confirm() : true;
}

async function gameplayNoscorePrompt(term: GlyphTerm, m: CatalogMod): Promise<boolean> {
  await showTextScreen(term, `Non-scoring save - ${m.name}`, [
    { text: "This mod changes core gameplay behavior.", color: C_WARN },
    { text: "Your save will be permanently marked as non-scoring.", color: C_WARN },
  ], "[ Press ESC to review, then choose ]");
  const pick = await selectFromMenu(
    term,
    `Enable gameplay-changing mod "${m.name}"?`,
    [
      { label: "Yes, enable and mark save non-scoring", color: C_WARN },
      { label: "No, cancel", color: C_FG },
    ],
    "[ a/b or tap; ESC cancels ]",
  );
  return pick === 0;
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
  if (!(await confirmGameplayNoscore(
    m,
    deps.isModNoscore?.() ?? false,
    () => gameplayNoscorePrompt(term, m),
  ))) return false;
  if (m.capabilities.length > 0) {
    const ok = await consentPrompt(term, m);
    if (!ok) return false;
    deps.store.setConsent(m.id, m.capabilities);
  }
  deps.advanceSaveRatchets?.(m);
  deps.store.setModEnabled(m.id, true);
  return true;
}

/**
 * Per-mod action submenu: toggle, reorder, THIS MOD'S patches, details. Returns
 * true if anything changed. The patch list hangs off the mod that provides it
 * rather than a pooled screen, because that is where a patch belongs: it is part
 * of a mod, arrives with it, and cannot exist without it.
 */
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
    const ruleCount = m.manifest.rules?.length ?? 0;
    if (m.enabled) {
      items.push({ label: "Disable", color: C_WARN });
      acts.push("disable");
      if (ruleCount > 0) {
        items.push({
          label: `Fixes & tweaks (${ruleCount})...`,
          color: C_ENABLED,
          hint: `All ${ruleCount} are on; switch any one off here.`,
        });
        acts.push("rules");
      }
      items.push({ label: "Move earlier (loads first)", color: C_FG });
      acts.push("up");
      items.push({ label: "Move later (loads last, wins conflicts)", color: C_FG });
      acts.push("down");
    } else {
      items.push({ label: "Enable", color: C_ENABLED });
      acts.push("enable");
      if (ruleCount > 0) {
        // Deliberately present and deliberately dead: it is the clearest way to
        // show that this mod HAS patches and that they do not exist yet.
        items.push({
          label: `Fixes & tweaks (${ruleCount} once enabled)`,
          color: C_DISABLED,
          disabled: true,
          hint: "Enable this mod first - its patches do not exist until then.",
        });
        acts.push("rules");
      }
    }
    items.push({ label: "Back", color: C_DIM });
    acts.push("back");

    const pick = await selectFromMenu(
      term,
      `${m.name}  v${m.version}`,
      items,
      "[ choose an action; ESC to go back ]",
      {
        detail: () => rowDetail(m, term.size().cols),
        detailToggleKey: "?",
        detailInitiallyShown: true,
      },
    );
    const act = pick === null ? "back" : acts[pick];
    if (act === "back") return changed;
    if (act === "enable") {
      if (await enableMod(term, deps, m)) changed = true;
    } else if (act === "disable") {
      deps.store.setModEnabled(m.id, false);
      changed = true;
    } else if (act === "rules") {
      await managePatches(term, deps, m);
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

/**
 * ONE MOD's Fixes & tweaks: the toggleable rules that mod declares, each with an
 * on/off box and its full description. Reached from the mod itself (manageMod),
 * not from a pooled screen - a patch belongs to its mod, so it is managed where
 * the mod is.
 *
 * Toggling writes the player's choice to the store and, when a game is running,
 * applies it live (deps.applyRuleLive) so it takes effect immediately; otherwise
 * it applies on the next character.
 *
 * Reachable only while the mod is ENABLED, because a patch does not exist while
 * its mod is off - no flag is present and core runs faithful 4.2.6. Enabling the
 * mod brings its whole patch set on with it (every bundled patch declares
 * `default: true`, i.e. "on once its mod is on"); these rows exist so a player
 * can then opt out of individual patches and take the set minus one.
 */
async function managePatches(
  term: GlyphTerm,
  deps: ModManagerDeps,
  m: CatalogMod,
): Promise<void> {
  const getDecls = deps.ruleDecls ?? ((): ModRuleDecl[] => []);
  const title = `Fixes & tweaks - ${m.name}`;
  for (;;) {
    const decls = getDecls().filter((d) => d.modId === m.id);
    if (decls.length === 0) {
      // Only reachable if discovery and the catalog disagree (the mod declares
      // rules but the host does not surface them) - say so plainly.
      await showTextScreen(term, title, [
        { text: `${m.name} is not contributing any toggleable patch right now.`, color: C_DIM },
        { text: "", color: C_FG },
        { text: "A patch exists only while the mod providing it is enabled.", color: C_FG },
      ]);
      return;
    }
    const choices = deps.store.getRuleChoices();
    // No per-row hint: the detail pane below already carries the full wrapped
    // description, and a truncated copy of it on the bottom line only costs a row.
    const items: MenuItem[] = decls.map(({ rule }) => {
      const on = choices[rule.flag] ?? rule.default;
      return {
        label: `${on ? "[x]" : "[ ]"} ${rule.title}`,
        color: on ? C_ENABLED : C_DISABLED,
      };
    });
    const pick = await selectFromMenu(
      term,
      title,
      items,
      "[ On with the mod; Enter opts one out; ESC to go back ]",
      {
        detail: (i) => {
          const d = decls[i];
          if (!d) return [];
          const cols = term.size().cols;
          const on = choices[d.rule.flag] ?? d.rule.default;
          return [
            { text: d.rule.title, color: C_TITLE },
            { text: `${on ? "ON" : "OFF"}  -  flag ${d.rule.flag}`, color: on ? C_ENABLED : C_DIM },
            { text: "", color: C_FG },
            ...wrapped(d.rule.description, cols - 1),
            { text: "", color: C_FG },
            ...wrapped(
              d.rule.default
                ? `Comes on with ${m.name}; turn it off here to take the rest of the set without it. It does not exist at all while ${m.name} is disabled.`
                : `Off until you turn it on here. It does not exist at all while ${m.name} is disabled.`,
              cols - 1,
              C_DIM,
            ),
          ];
        },
        detailToggleKey: "?",
        detailInitiallyShown: true,
      },
    );
    if (pick === null) return;
    const d = decls[pick];
    if (!d) continue;
    const now = choices[d.rule.flag] ?? d.rule.default;
    deps.store.setRuleChoice(d.rule.flag, !now);
    deps.applyRuleLive?.(d.rule.flag, !now);
  }
}

/**
 * Where mods come from, and how to add one.
 *
 * On a front end WITH a mods directory this is the real answer: the path, what
 * is in it, and what could not be read. On one without, it says so - which is
 * the same honesty the old "Install from URL" row had, arrived at from the other
 * side now that the directory actually works.
 *
 * Neither surface has a runtime code loader, so neither can fetch and RUN a mod
 * from a URL. A folder you copied in is a different thing: its records are data,
 * composed at load time by the same pipeline the bundled mods use.
 */
async function showModSources(
  term: GlyphTerm,
  status: DiskPackStatus | undefined,
  canPick: boolean,
): Promise<void> {
  const lines: ScreenLine[] = [];
  if (!status || !status.available) {
    if (canPick) {
      /* An engine that CAN be given a folder has not been given one yet. Saying
       * "this build has no mods folder" here would be a false statement about the
       * program, which is the exact failure mode PLATFORM.md was written about. */
      lines.push(
        { text: "No mods folder chosen yet.", color: C_FG },
        { text: "", color: C_FG },
        { text: "This build can read one: choose a folder on your computer and it", color: C_FG },
        { text: "is remembered for every later visit. The mods in it are read the", color: C_FG },
        { text: "same way the desktop build reads its own folder, by the same", color: C_FG },
        { text: "validator, so a mod behaves identically on both.", color: C_FG },
        { text: "", color: C_FG },
        { text: "Pick either a folder of mods, or a single mod's folder.", color: C_GOLD_TEXT },
      );
    } else {
      lines.push(
        { text: "This browser has no mods folder.", color: C_FG },
        { text: "", color: C_FG },
        { text: "It cannot ask you for a directory to read, so every mod here is", color: C_FG },
        { text: "one bundled into the app - fully manageable, but a fixed set.", color: C_FG },
        { text: "", color: C_FG },
        { text: "Chrome and Edge can be given a folder; the desktop build keeps", color: C_WARN },
        { text: "its own, which an external mod manager can deploy into.", color: C_WARN },
      );
    }
  } else {
    lines.push(
      {
        text: status.kind === "picked" ? "Mods folder you chose:" : "Mods folder:",
        color: C_FG,
      },
      { text: `  ${status.dir ?? "(unknown)"}`, color: C_GOLD_TEXT },
      { text: "", color: C_FG },
      {
        text:
          status.count === 1
            ? "1 mod found in it."
            : `${status.count} mods found in it.`,
        color: C_FG,
      },
      { text: "", color: C_FG },
      { text: "To add one, copy its folder in and restart. A mod folder holds", color: C_FG },
      { text: "manifest.json plus one .json per kind of record it changes -", color: C_FG },
      { text: "exactly the layout a bundled mod has.", color: C_FG },
      { text: "", color: C_FG },
      { text: "load-order.json in that folder is owned by an external mod", color: C_FG },
      { text: "manager: the ids it lists are loaded, in that order. Turning a", color: C_FG },
      { text: "mod on or off here overrides it for that mod.", color: C_FG },
    );
    if (status.kind === "picked") {
      lines.push(
        { text: "", color: C_FG },
        { text: "Your browser is not told where that folder is on disk, only its", color: C_DIM },
        { text: "name, so only the name can be shown here.", color: C_DIM },
      );
    }
    if (status.problems.length > 0) {
      lines.push({ text: "", color: C_FG }, { text: "Could not be used:", color: C_DANGER });
      for (const p of status.problems.slice(0, 8)) {
        lines.push({ text: `  ${p}`, color: C_DANGER });
      }
    }
  }
  await showTextScreen(term, "Where mods come from", lines);
}

/**
 * Choose, reconnect, or forget the mods folder.
 *
 * Returns whether anything changed, so the caller can offer the reload that makes
 * it take effect. Every branch is reported: a cancelled picker and a refused
 * permission look identical from here otherwise, and silence after a folder failed
 * to attach is how a player concludes the feature is broken.
 */
async function manageModFolder(
  term: GlyphTerm,
  picker: ModFolderPicker,
  status: DiskPackStatus | undefined,
  savedName: string | null,
): Promise<boolean> {
  /* A saved folder that produced no readable directory is the lapsed-permission
   * case: the handle is still remembered, the browser just will not read it until
   * the player says so from a keypress. */
  const lapsed = savedName !== null && status?.available !== true;

  type Row = "pick" | "reconnect" | "forget" | "about";
  const items: MenuItem[] = [];
  const rows: Row[] = [];
  const add = (label: string, row: Row, color: string, hint: string): void => {
    items.push({ label, color, hint });
    rows.push(row);
  };

  if (lapsed) {
    add(
      `Reconnect "${savedName}"`,
      "reconnect",
      C_WARN,
      "Your browser needs permission again before it will read that folder.",
    );
  }
  add(
    savedName === null ? "Choose a mods folder..." : "Choose a different folder...",
    "pick",
    C_FG,
    "A folder of mods, or one mod's own folder.",
  );
  if (savedName !== null) {
    add(
      `Stop using "${savedName}"`,
      "forget",
      C_DIM,
      "The bundled mods stay; nothing on your disk is touched.",
    );
  }
  add("What is this?", "about", C_DIM, "Where mods come from, and the folder layout.");

  for (;;) {
    const pick = await selectFromMenu(term, "Mods folder", items, "[ ESC to go back ]");
    if (pick === null) return false;
    const row = rows[pick];
    if (row === "about") {
      await showModSources(term, status, true);
      continue;
    }
    if (row === "pick") {
      const name = await picker.pick();
      if (name === null) return false; /* cancelled: not a failure, no message */
      await showTextScreen(term, "Mods folder", [
        { text: `Using "${name}".`, color: C_ENABLED },
        { text: "", color: C_FG },
        { text: "Reload to read it. Any mod in it appears in this list, off until", color: C_FG },
        { text: "you turn it on - the same as a bundled one.", color: C_FG },
      ]);
      return true;
    }
    if (row === "reconnect") {
      const ok = await picker.reconnect();
      await showTextScreen(term, "Mods folder", [
        ok
          ? { text: `Reconnected to "${savedName}".`, color: C_ENABLED }
          : { text: "Permission was not granted, so that folder stays unread.", color: C_DANGER },
        { text: "", color: C_FG },
        ok
          ? { text: "Reload to read it.", color: C_FG }
          : { text: "You can try again, or choose a different folder.", color: C_FG },
      ]);
      if (ok) return true;
      continue;
    }
    /* forget */
    await picker.forget();
    await showTextScreen(term, "Mods folder", [
      { text: `No longer using "${savedName}".`, color: C_FG },
      { text: "", color: C_FG },
      { text: "Nothing on your disk was changed. Reload to drop its mods.", color: C_FG },
    ]);
    return true;
  }
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
    type ActionKind =
      | "conflicts"
      | "profiles"
      | "install"
      | "folder"
      | "reload"
      | "done";
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
    // No pooled "Fixes & tweaks" row: a mod's patches live under that mod
    // (manageMod -> managePatches), because they arrive with it and cannot exist
    // without it.
    addAction("View conflicts", "conflicts", C_FG, "Which enabled content mods contest the same records.");
    addAction("Profiles...", "profiles", C_FG, "Save / apply / delete named mod setups.");
    const diskStatus = deps.diskPackStatus?.();
    /* The saved folder's name is read fresh each pass, because picking or
     * forgetting one changes it and the row has to follow. */
    const savedFolder = deps.modFolder ? await deps.modFolder.savedName() : null;
    if (deps.modFolder) {
      const row = modFolderRow(savedFolder, diskStatus?.available === true);
      addAction(
        row.label,
        "folder",
        row.color,
        savedFolder === null
          ? "Read mods from a folder on your computer."
          : row.lapsed
            ? "Your browser needs permission again before it will read it."
            : "Choose another, reconnect, or stop using it.",
      );
    }
    addAction(
      "Where mods come from...",
      "install",
      C_DIM,
      diskStatus?.available === true
        ? "Your mods folder: path, contents, and anything unreadable."
        : deps.modFolder
          ? "The folder layout, and how one is read."
          : "Why this build has no mods folder.",
    );
    if (dirty) {
      addAction("Apply changes and reload", "reload", C_WARN, "Reload so enable/disable/order take effect.");
    }
    addAction("Done", "done", C_DIM, "Close the mod manager.");

    // A live ?mods= override outranks the store for this session, so the boxes
    // below describe what is SAVED, not what is loaded. Say so; the row list is
    // too narrow to spell out both sets.
    const override = deps.urlModsOverride?.() ?? null;
    const footer = override
      ? dirty
        ? "[ ?mods= live; changes pending - Apply to reload; ESC ]"
        : "[ ?mods= override is live; boxes show the SAVED set; ESC ]"
      : dirty
        ? "[ changes pending - Apply to reload; ESC = Done ]"
        : "[ Enter a mod to manage it; ESC to close ]";
    const pick = await selectFromMenu(term, "Mods", items, footer, {
      // Shown by default (not behind the '?' toggle): what a mod IS is the thing
      // a player needs in order to decide whether to turn it on.
      detail: (i) => {
        const rk = rowKinds[i];
        if (!rk || !("id" in rk)) return [];
        const m = catalog.find((x) => x.id === rk.id);
        if (!m) return [];
        // Budget: keep at least MIN_LIST_ROWS rows of the list on screen (it
        // scrolls to the cursor, and ESC always closes) and hand the rest to the
        // description. The cap only bites on a mod whose blurb is longer than the
        // pane; the bundled ones fit, and opening the mod shows the full text.
        const MIN_LIST_ROWS = 5;
        const { cols, rows } = term.size();
        const budget = Math.max(8, rows - 4 - Math.min(items.length, MIN_LIST_ROWS));
        return rowDetail(m, cols, budget);
      },
      detailToggleKey: "?",
      detailInitiallyShown: true,
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
      await showModSources(term, deps.diskPackStatus?.(), deps.modFolder !== undefined);
    } else if (rk.kind === "folder") {
      if (
        deps.modFolder &&
        (await manageModFolder(term, deps.modFolder, diskStatus, savedFolder))
      ) {
        dirty = true;
      }
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
