/**
 * The screens and menus Core always draws itself.
 *
 * A mod that holds `ui:menu.replace` or `ui:screen.replace` presents the game's
 * menus and screens, and `registry:menu` and `screenText` let a mod change
 * their rows and wording. None of that reaches the questions that decide what a
 * mod may do: the permissions a mod is asking for, the separate question for a
 * permission that can install or turn on other code, the notice shown before an
 * unreviewed mod is first turned on, and the answers to all of them. If a mod could
 * draw those, it could answer them for the player.
 *
 * So a menu with one of these ids is asked on the game's own terminal with its
 * rows as Core built them, a screen with one is shown there unrestated, and mod
 * panels are hidden while one is open (overlay.ts).
 */

/** Every Core-drawn id. */
export const CORE_DRAWN_IDS: ReadonlySet<string> = new Set([
  "core:look-choice",
  "core:restore-save-mods",
  "core:mod-set-overwrite",
  "core:mod-capabilities",
  "core:mod-capability-consent",
  "core:mod-capability-regrant",
  "core:mod-capability-regrant-declined",
  "core:mod-manage-confirm",
  "core:mod-permission-choice",
  "core:mod-unreviewed",
  "core:mod-unreviewed-confirm",
  "core:mod-session-load",
  "core:mod-session-consent",
  "core:mods-third-party-consent",
  "core:mods-third-party-disable",
  "core:mod-browse-actions",
  "core:mod-preinstall-actions",
  "core:mod-preinstall-summary",
  "core:mod-community-update",
  "core:mod-update",
  "core:recommended-mod-actions",
  "core:mod-import",
  "core:mod-enable-anyway",
  "core:load-delve-preview",
]);

/** Whether a menu or screen id is one only Core may draw. */
export function isCoreDrawn(id: string): boolean {
  return CORE_DRAWN_IDS.has(id);
}
