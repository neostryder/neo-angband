import { classicCatalog, classicManager } from "./classic-service";
import { type GridSurface, type GridPointerInput } from "../term";
import { type ModManagerDeps } from "./classic-types";
import { type CatalogMod, type AutoplayerSpeed } from "../mod-store";
import { t } from "@rpgm-tools/neo-angband-core";
import { selectFromMenu, showTextScreen, type MenuItem, type ScreenLine } from "../overlay";
import { C_DISABLED, C_DIM, C_ENABLED, C_FG, C_TITLE } from "./classic-colors";
import { resolveSectionState, type PackManifest, type PackSetting, resolveSettingValue } from "@rpgm-tools/neo-angband-mod-sdk";
import { type ModRuleDecl } from "../pack";
import { wrapped } from "./classic-mod-views";

/**
 * One settings screen for one mod or for every enabled mod.
 *
 * Rules and sections remain different kinds of control: rules alter behaviour,
 * while sections can add records and have their own load order. They deliberately
 * share this screen because a player looking for a mod's settings should not need
 * to remember which implementation detail put a control behind which old menu.
 * Prefixing every row with Fix or Part keeps that distinction visible, and the
 * all-mods view also prefixes the owning mod so its flat list remains legible.
 *
 * Returns true for section changes and rules whose manifest says registration
 * must be rebuilt on reload. Hooks-side rules are applied live and do not make
 * the manager dirty.
 */
export async function manageModOptions(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  wanted: readonly CatalogMod[],
  label: string,
): Promise<boolean> {
  const title = t("modsScreen.options.title", "Mod options - {name}", { name: label });
  const candidateIds = new Set(wanted.map((m) => m.id));
  let changed = false;
  let cursor = 0;

  for (;;) {
    const catalog = classicCatalog(deps);
    const selected = catalog.filter((m) => candidateIds.has(m.id) && !m.missing);
    const enabled = selected.filter((m) => m.enabled);
    if (enabled.length === 0) {
      const only = selected[0];
      const rules = only?.manifest.rules?.length ?? 0;
      const sections = only?.manifest.sections?.length ?? 0;
      await selectFromMenu(
        term,
        "core:mod-options-disabled",
        title,
        [
          ...(rules > 0
            ? [
                {
                  label: t("modsScreen.options.fixesDisabled", "Fixes & tweaks ({count} once enabled)", {
                    count: rules,
                  }),
                  color: C_DISABLED,
                  disabled: true,
                },
              ]
            : []),
          ...(sections > 0
            ? [
                {
                  label: t("modsScreen.options.partsDisabled", "Parts of this mod ({count} once enabled)", {
                    count: sections,
                  }),
                  color: C_DISABLED,
                  disabled: true,
                },
              ]
            : []),
          { label: t("modsScreen.common.back", "Back"), color: C_DIM },
        ],
        t("modsScreen.options.disabledFooter", "[ Enable this mod first; ESC to go back ]"),
      );
      return changed;
    }

    const enabledManifests = catalog.filter((m) => m.enabled).map((m) => m.manifest);
    deps.store.migrateSectionChoices(enabledManifests);
    const sectionState = resolveSectionState(
      enabledManifests,
      deps.store.getSectionChoices(),
      new Set(enabledManifests.map((m) => m.id)),
    );
    const forcedOff = new Map<string, string>();
    for (const m of enabled) {
      for (const c of m.manifest.compat ?? []) {
        if (c.claim !== "patches" || enabledManifests.some((other) => other.id === c.with)) continue;
        for (const sectionId of c.scope ?? []) forcedOff.set(`${m.id}:${sectionId}`, c.with);
      }
    }

    /* Space and Enter both resolve through the same selectFromMenu pick() (see
     * overlay.ts), so a row with a checkbox has no way today to tell "toggle"
     * from "open a submenu" apart by KEY - only by what its own `kind` does with
     * the returned index below. That is fine as long as no row is BOTH a
     * checkbox AND a submenu at once (neo-angband#162): "rule"/"section" toggle
     * in place, "speed" opens pickAutoplayerSpeed, and neither kind does both.
     * The day a row needs to, Enter must open the submenu and Space alone must
     * toggle - which needs the picker to say which key resolved it, not just
     * which row. */
    type Option =
      | { readonly kind: "rule"; readonly mod: CatalogMod; readonly decl: ModRuleDecl }
      | {
          readonly kind: "section";
          readonly mod: CatalogMod;
          readonly section: NonNullable<PackManifest["sections"]>[number];
          readonly on: boolean;
          readonly needs: string | null;
        }
      | { readonly kind: "speed"; readonly mod: CatalogMod; readonly autoplayer: NonNullable<ModManagerDeps["autoplayer"]> }
      | { readonly kind: "setting"; readonly mod: CatalogMod; readonly setting: PackSetting; readonly value: number };
    const options: Option[] = [];
    const decls = (deps.ruleDecls ?? ((): ModRuleDecl[] => []))();
    const choicesNow = deps.store.getRuleChoices();
    const storedSettings = deps.store.getSettingValues();
    for (const m of enabled) {
      const own = decls.filter((d) => d.modId === m.id);
      for (const decl of own) {
        options.push({ kind: "rule", mod: m, decl });
      }
      for (const setting of m.manifest.settings ?? []) {
        /* A setting under a rule shows only while that rule is on. */
        const parent = setting.parent === undefined ? undefined : own.find((d) => d.rule.flag === setting.parent);
        if (parent && !(choicesNow[parent.rule.flag] ?? parent.rule.default)) continue;
        options.push({ kind: "setting", mod: m, setting, value: resolveSettingValue(setting, storedSettings[m.id]?.[setting.id]) });
      }
    }
    for (const m of enabled) {
      for (const section of m.manifest.sections ?? []) {
        const needs = forcedOff.get(`${m.id}:${section.id}`) ?? null;
        options.push({
          kind: "section",
          mod: m,
          section,
          on: sectionState.get(m.id)?.get(section.id) ?? true,
          needs,
        });
      }
    }
    const autoplayer = deps.autoplayer;
    if (autoplayer) {
      const active = enabled.find((m) => autoplayer.activeId() === m.id);
      if (active) options.push({ kind: "speed", mod: active, autoplayer });
    }

    if (options.length === 0) {
      await showTextScreen(term, title, [
        {
          text: t("modsScreen.options.none", "These mods are enabled, but have no configurable fixes or parts."),
          color: C_DIM,
        },
      ]);
      return changed;
    }

    const ruleChoices = deps.store.getRuleChoices();
    const many = enabled.length > 1;
    /* No "Fix:"/"Part:"/"Control:" kind label - it named an internal
     * distinction (rule vs. section vs. speed control) that meant nothing to a
     * player reading the row. The detail panel below (modOptionDetail) already
     * explains that distinction in a full sentence when it matters; the row
     * itself only needs to say which mod, and only when more than one is
     * shown at once. */
    const prefix = (m: CatalogMod): string => (many ? `${m.name} - ` : "");
    const items: MenuItem[] = options.map((option) => {
      if (option.kind === "rule") {
        const on = ruleChoices[option.decl.rule.flag] ?? option.decl.rule.default;
        return {
          label: `${prefix(option.mod)}${on ? "[x]" : "[ ]"} ${option.decl.rule.title}`,
          color: on ? C_ENABLED : C_DISABLED,
        };
      }
      if (option.kind === "section") {
        const needs = option.needs === null ? "" : `   (${t("modsScreen.options.needs", "needs {name}", { name: option.needs })})`;
        const birthLock = option.section.lockedAtBirth
          ? t("modsScreen.options.sectionLockedAtBirthLabel", " (new characters only)")
          : "";
        return {
          label: `${prefix(option.mod)}${option.on ? "[x]" : "[ ]"} ${option.section.title}${birthLock}${needs}`,
          color: option.needs === null ? (option.on ? C_ENABLED : C_DISABLED) : C_DISABLED,
          ...(option.needs === null ? {} : { disabled: true }),
        };
      }
      if (option.kind === "setting") {
        return {
          label: `${prefix(option.mod)}    ${option.setting.title}: < ${option.value}${option.setting.unit ?? ""} >`,
          color: C_FG,
        };
      }
      return {
        label: `${prefix(option.mod)}Autoplayer speed: ${autoplayerSpeedLabel(option.autoplayer.getSpeed())}`,
        color: C_FG,
      };
    });
    /* Left and Right step a setting row; any other row keeps the keys inert.
     * Enter, Space and a click step up and wrap, so a mouse alone can reach
     * every value. */
    let settingStep = 0;
    const hasSetting = options.some((option) => option.kind === "setting");
    const stepKey = (dir: number) => (cur: number): number | null => {
      if (options[cur]?.kind !== "setting") return null;
      settingStep = dir;
      return cur;
    };

    const pick = await selectFromMenu(
      term,
      "core:mod-options",
      title,
      items,
      hasSetting
        ? t("modsScreen.options.footerNumbers", "[ Space or Enter changes a setting; Left and Right adjust a number; ESC to go back ]")
        : t("modsScreen.options.footer", "[ Space or Enter changes a setting; ESC to go back ]"),
      {
        initialCursor: cursor,
        onHighlight: (i) => {
          cursor = i;
        },
        commands: {
          " ": (cur) => (options[cur]?.kind === "section" && options[cur]?.needs !== null ? null : cur),
          ...(hasSetting ? { ArrowLeft: stepKey(-1), ArrowRight: stepKey(1) } : {}),
        },
        detail: (i) => modOptionDetail(options[i], ruleChoices, term.size().cols),
        detailToggleKey: "?",
        detailInitiallyShown: true,
      },
    );
    if (pick === null) return changed;
    const option = options[pick];
    if (!option) continue;
    if (option.kind === "rule") {
      const on = ruleChoices[option.decl.rule.flag] ?? option.decl.rule.default;
      classicManager(deps).core.setRuleChoice(option.decl.rule.flag, !on);
      if (option.decl.rule.requiresReload) changed = true;
      else deps.applyRuleLive?.(option.decl.rule.flag, !on);
    } else if (option.kind === "setting") {
      const { setting } = option;
      const dir = settingStep;
      settingStep = 0;
      const next = dir === 0
        ? (option.value >= setting.max ? setting.min : resolveSettingValue(setting, option.value + setting.step))
        : resolveSettingValue(setting, option.value + dir * setting.step);
      if (next === option.value) continue;
      classicManager(deps).core.setSettingValue(option.mod.id, setting.id, next);
      if (setting.requiresReload) changed = true;
      else deps.applySettingLive?.(option.mod.id, setting.id);
    } else if (option.kind === "section") {
      if (option.needs !== null) continue;
      classicManager(deps).core.setSectionChoice(option.mod.id, option.section.id, !option.on);
      changed = true;
    } else {
      await pickAutoplayerSpeed(term, option.autoplayer, option.mod);
    }
  }
}

export function modOptionDetail(
  option:
    | {
        readonly kind: "rule";
        readonly mod: CatalogMod;
        readonly decl: ModRuleDecl;
      }
    | {
        readonly kind: "section";
        readonly mod: CatalogMod;
        readonly section: NonNullable<PackManifest["sections"]>[number];
        readonly on: boolean;
        readonly needs: string | null;
      }
    | {
        readonly kind: "speed";
        readonly mod: CatalogMod;
        readonly autoplayer: NonNullable<ModManagerDeps["autoplayer"]>;
      }
    | { readonly kind: "setting"; readonly mod: CatalogMod; readonly setting: PackSetting; readonly value: number }
    | undefined,
  ruleChoices: Readonly<Record<string, boolean>>,
  cols: number,
): readonly ScreenLine[] {
  if (!option) return [];
  if (option.kind === "rule") {
    const on = ruleChoices[option.decl.rule.flag] ?? option.decl.rule.default;
    return [
      { text: option.decl.rule.title, color: C_TITLE },
      { text: `${on ? t("modsScreen.common.on", "ON") : t("modsScreen.common.off", "OFF")}  -  ${option.mod.name}`, color: on ? C_ENABLED : C_DIM },
      { text: "", color: C_FG },
      ...wrapped(option.decl.rule.description, cols - 1),
      { text: "", color: C_FG },
      ...wrapped(
        t(
          option.decl.rule.requiresReload
            ? "modsScreen.options.ruleReloadNote"
            : "modsScreen.options.ruleNote",
          option.decl.rule.requiresReload
            ? "This is a behavioural fix or tweak. Changing it takes effect after a reload."
            : "This is a behavioural fix or tweak. It takes effect at once while this mod is enabled.",
        ),
        cols - 1,
        C_DIM,
      ),
    ];
  }
  if (option.kind === "setting") {
    const { setting } = option;
    const unit = setting.unit ?? "";
    return [
      { text: setting.title, color: C_TITLE },
      { text: `${option.value}${unit}  -  ${option.mod.name}`, color: C_FG },
      { text: "", color: C_FG },
      ...wrapped(setting.description, cols - 1),
      { text: "", color: C_FG },
      ...wrapped(
        t("modsScreen.options.settingNote", "Left and Right change it by {step}{unit}, from {min}{unit} to {max}{unit}. Enter or a click raises it one step, and after {max}{unit} it goes back to {min}{unit}.", {
          step: String(setting.step), unit, min: String(setting.min), max: String(setting.max),
        }),
        cols - 1,
        C_DIM,
      ),
      ...wrapped(
        setting.requiresReload
          ? t("modsScreen.options.settingReloadNote", "A change takes effect after a reload.")
          : t("modsScreen.options.settingLiveNote", "A change takes effect at once."),
        cols - 1,
        C_DIM,
      ),
    ];
  }
  if (option.kind === "section") {
    const lines: ScreenLine[] = [
      { text: option.section.title, color: C_TITLE },
      { text: `${option.on ? t("modsScreen.common.on", "ON") : t("modsScreen.common.off", "OFF")}  -  ${option.mod.name}`, color: option.on ? C_ENABLED : C_DIM },
      { text: "", color: C_FG },
      ...wrapped(option.section.description ?? "", cols - 1),
      { text: "", color: C_FG },
      ...wrapped(
        t(
          option.section.lockedAtBirth
            ? "modsScreen.options.sectionLockedAtBirthNote"
            : "modsScreen.options.sectionNote",
          option.section.lockedAtBirth
            ? "Each character keeps the choice it was created with. Changing it takes effect after a reload, for new characters."
            : "This is a structural part of the mod. Changing it takes effect after a reload.",
        ),
        cols - 1,
        C_DIM,
      ),
    ];
    if (option.needs !== null) {
      lines.push(
        { text: "", color: C_FG },
        ...wrapped(
          t("modsScreen.options.sectionNeeds", "It is a compatibility patch for {name}, which is not enabled.", {
            name: option.needs,
          }),
          cols - 1,
          C_DIM,
        ),
      );
    }
    return lines;
  }
  return [
    { text: t("modsScreen.patches.autoplayerHeading", "Autoplayer speed"), color: C_TITLE },
    {
      text: t(
        "modsScreen.patches.autoplayerDetail",
        "{speed} - how often {name} takes a turn while it holds the keyboard",
        { speed: autoplayerSpeedLabel(option.autoplayer.getSpeed()), name: option.mod.name },
      ),
      color: C_DIM,
    },
  ];
}

/**
 * The options-menu route into the same per-mod settings screen used by the
 * manager. The first row pools enabled mods only, because an off mod has no live
 * rules or active sections; individual rows stay present so the player can see
 * which mod they need to enable before its settings become available.
 */
export async function runModOptionsBrowser(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
): Promise<void> {
  let needsReload = false;
  let cursor = 0;
  for (;;) {
    const catalog = classicCatalog(deps).filter((m) => !m.missing);
    const enabled = catalog.filter((m) => m.enabled);
    const items: MenuItem[] = [
      {
        label: t("modsScreen.options.allMods", "All mods"),
        color: enabled.length > 0 ? C_ENABLED : C_DISABLED,
        disabled: enabled.length === 0,
        hint:
          enabled.length > 0
            ? t("modsScreen.options.allModsHint", "Every enabled mod's fixes and parts in one flat list.")
            : t("modsScreen.options.allModsDisabledHint", "Enable a mod first to configure its options."),
      },
      ...catalog.map((m) => ({
        label: m.name,
        color: m.enabled ? C_FG : C_DISABLED,
        hint: m.enabled
          ? t("modsScreen.options.modHint", "Open this mod's fixes and parts together.")
          : t("modsScreen.options.modDisabledHint", "Open to see what becomes available when enabled."),
      })),
    ];
    const pick = await selectFromMenu(
      term,
      "core:mod-options-browser",
      t("modsScreen.options.browserTitle", "Mod options"),
      items,
      t("modsScreen.options.browserFooter", "[ Choose a mod, ESC to return ]"),
      {
        initialCursor: cursor,
        onHighlight: (i) => {
          cursor = i;
        },
      },
    );
    if (pick === null) break;
    if (pick === 0) {
      if (await manageModOptions(term, deps, enabled, t("modsScreen.options.allMods", "All mods"))) {
        needsReload = true;
      }
      continue;
    }
    const mod = catalog[pick - 1];
    if (mod && (await manageModOptions(term, deps, [mod], mod.name))) needsReload = true;
  }
  if (!needsReload) return;
  const pick = await selectFromMenu(
    term,
    "core:mod-options-apply",
    t("modsScreen.applyPrompt.title", "Apply mod changes?"),
    [
      { label: t("modsScreen.applyPrompt.reload", "Reload now to apply"), color: C_ENABLED },
      {
        label: t("modsScreen.applyPrompt.later", "Later (changes are saved; apply on next reload)"),
        color: C_FG,
      },
    ],
    t("modsScreen.applyPrompt.footer", "[ a/b or tap ]"),
  );
  if (pick === 0) deps.requestReload();
}

/**
 * Display name for each autoplayer speed tier (mod-store.ts).
 *
 * A FUNCTION, not a constant: see gameMenuFooter's comment in game-menu.ts - a
 * locale can change mid-session, so nothing translatable may be frozen at
 * import time.
 */
export function autoplayerSpeedLabel(speed: AutoplayerSpeed): string {
  switch (speed) {
    case "turbo":
      return t("modsScreen.autoplayer.speed.turbo", "Turbo");
    case "fast":
      return t("modsScreen.autoplayer.speed.fast", "Fast");
    case "normal":
      return t("modsScreen.autoplayer.speed.normal", "Normal");
    case "slow":
      return t("modsScreen.autoplayer.speed.slow", "Slow");
  }
}

/** Pump rate for each autoplayer speed tier (mod-store.ts). Not player-facing text. */
export const AUTOPLAYER_SPEED_MS: Record<AutoplayerSpeed, number> = {
  turbo: 10,
  fast: 40,
  normal: 120,
  slow: 400,
};

/**
 * The autoplayer speed sub-screen: three tiers, current one marked, same shape
 * as every other named-choice picker on this screen. Reached from the row
 * manageModOptions shows beside a mod's own rule that hands back a controller,
 * only while that mod actually holds the one autoplayer slot.
 */
export async function pickAutoplayerSpeed(
  term: GridSurface & GridPointerInput,
  autoplayer: NonNullable<ModManagerDeps["autoplayer"]>,
  m: CatalogMod,
): Promise<void> {
  const tiers: AutoplayerSpeed[] = ["turbo", "fast", "normal", "slow"];
  const current = autoplayer.getSpeed();
  const items: MenuItem[] = tiers.map((tier) => ({
    label: `${tier === current ? "[x]" : "[ ]"} ${autoplayerSpeedLabel(tier)}`,
    color: tier === current ? C_ENABLED : C_FG,
  }));
  const pick = await selectFromMenu(
    term,
    "core:mod-autoplayer-speed",
    t("modsScreen.autoplayer.title", "Autoplayer speed - {name}", { name: m.name }),
    items,
    t("modsScreen.autoplayer.footer", "[ Enter to choose; ESC to leave it as it is ]"),
    {
      initialCursor: tiers.indexOf(current),
      detail: (i) => {
        const tier = tiers[i];
        if (!tier) return [];
        return [
          { text: autoplayerSpeedLabel(tier), color: C_TITLE },
          {
            text: t(
              "modsScreen.autoplayer.turnRate",
              "A turn every {ms}ms while {name} holds the keyboard.",
              { ms: AUTOPLAYER_SPEED_MS[tier], name: m.name },
            ),
            color: C_DIM,
          },
          { text: "", color: C_FG },
          {
            text: t(
              "modsScreen.autoplayer.urlNote",
              "The same three tiers the debug agent seam's ?speed= URL parameter offers - takes effect at once, no reload.",
            ),
            color: C_DIM,
          },
        ];
      },
      detailToggleKey: "?",
      detailInitiallyShown: true,
    },
  );
  if (pick === null) return;
  const chosen = tiers[pick];
  if (chosen) autoplayer.setSpeed(chosen);
}
