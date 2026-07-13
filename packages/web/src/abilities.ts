/**
 * The race/class abilities browser (ui-player-properties.c
 * textui_view_ability_menu / view_ability_display / view_ability_menu_browser).
 *
 * The core hands over the ordered ability rows (player/abilities.ts
 * playerAbilities: class abilities first, then racial, including the
 * per-element resist/immune/vulnerable expansion); this paints them with the
 * faithful per-group colours and a per-cursor description pane, reusing
 * selectFromMenu's browse-hook + "browseOnly" (MN_DBL_TAP, read-only: only
 * ESC exits) rather than a bespoke widget.
 */

import {
  COLOUR_GREEN,
  COLOUR_L_BLUE,
  COLOUR_ORANGE,
  COLOUR_UMBER,
  COLOUR_WHITE,
  colorToCss,
} from "@neo-angband/core";
import type { AbilityRow } from "@neo-angband/core";
import type { GlyphTerm } from "./term";
import { menuLetter, selectFromMenu } from "./overlay";
import type { MenuItem, ScreenLine } from "./overlay";

/** view_ability_display (ui-player-properties.c L39): per-group label + colour. */
function rowLabelAndColor(row: AbilityRow): { label: string; color: string } {
  switch (row.group) {
    case "class":
      return { label: `Class: ${row.name}`, color: colorToCss(COLOUR_UMBER) };
    case "race":
      return { label: `Racial: ${row.name}`, color: colorToCss(COLOUR_ORANGE) };
    case "special":
    default:
      return { label: `Specialty Ability: ${row.name}`, color: colorToCss(COLOUR_GREEN) };
  }
}

/**
 * do_cmd_abilities / view_abilities: browse the character's race and class
 * abilities. Read-only (upstream has no EVT_SELECT action on this menu) -
 * arrows move the cursor and update the description pane; ESC is the only
 * way out.
 */
export function showAbilities(term: GlyphTerm, rows: readonly AbilityRow[]): Promise<void> {
  const items: MenuItem[] = rows.map((r) => {
    const { label, color } = rowLabelAndColor(r);
    return { label, color };
  });
  const lastLetter = rows.length > 0 ? menuLetter(rows.length - 1) : "a";
  const header = `Race and class abilities (a-${lastLetter}, ESC=exit):`;
  const detail = (idx: number): ScreenLine[] => {
    const row = rows[idx];
    if (!row?.desc) return [];
    return [{ text: row.desc, color: colorToCss(COLOUR_L_BLUE) }];
  };
  return selectFromMenu(term, header, items, "[ arrows to browse, ESC to exit ]", {
    detail,
    browseOnly: true,
    cursorColor: colorToCss(COLOUR_WHITE),
  }).then(() => undefined);
}
