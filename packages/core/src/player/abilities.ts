/**
 * The race/class abilities browser's data model, ported from
 * reference/src/player-properties.c (class_has_ability, race_has_ability,
 * view_abilities).
 *
 * Upstream keeps one flat player_ability list (player_abilities), each row
 * typed "player" (a PF_* player flag), "object" (an OF_* object flag) or
 * "element" (a resistance/immunity/vulnerability level on a specific
 * element). do_cmd_abilities scans that list twice - once testing
 * class_has_ability against player->class, once testing race_has_ability
 * against player->race - and shows the two runs back to back (class first,
 * then race).
 *
 * The port's bound player_property records (players.properties,
 * PlayerPropertyRecordJson via bind.ts) are a direct, UNEXPANDED parse of
 * player_property.txt: the three "element" template rows (Resistance /
 * Immunity / Vulnerability) still read as single records, whereas upstream's
 * finish_parse_player_prop (init.c L1362) expands each of them into one row
 * per element (new->index = element index, name = "<Elem> <Template>", desc
 * = "<template desc> <elem>.") before the game ever runs. This module
 * performs that same expansion at read time instead of at load time - same
 * result, since playerAbilities is the only reader of the element rows.
 *
 * PlayerProperty carries no numeric index (the bound record keeps only the
 * PF_/OF_ *name*, in `code`); resolveIndex maps it through the generated PF /
 * OF tables, mirroring the game's numeric player_ability->index. An
 * unresolvable code is skipped rather than throwing, so a future data/flag
 * drift degrades gracefully instead of crashing the browser.
 */

import type { GameState } from "../game/context";
import type { PlayerClass, PlayerProperty, PlayerRace } from "./types";
import { OF } from "../generated/object-flags";
import { PF } from "../generated/player-flags";

/** One row of the abilities browser: an ability's display name/desc/group. */
export interface AbilityRow {
  name: string;
  desc: string;
  group: "class" | "race" | "special";
}

/** Deps playerAbilities needs beyond GameState (registry data, not core state). */
export interface PlayerAbilitiesDeps {
  /** players.properties: the raw (unexpanded) player_property records. */
  properties: readonly PlayerProperty[];
  /**
   * projections[i].name for element index i (element-type projections are
   * bound first, in list-elements.h order - see obj/object-info.ts's
   * raceOrigin/projections use for the same convention). Only entries up to
   * the number of elements on PlayerRace.elInfo are consulted.
   */
  elementNames: readonly string[];
}

/** PF_/OF_ name -> numeric index, or null when the code is absent/unmapped. */
function resolveIndex(prop: PlayerProperty): number | null {
  if (prop.code === null) return null;
  if (prop.type === "player") return (PF as Record<string, number>)[prop.code] ?? null;
  if (prop.type === "object") return (OF as Record<string, number>)[prop.code] ?? null;
  return null;
}

/** class_has_ability (player-properties.c L28). */
function classHasAbility(cls: PlayerClass, prop: PlayerProperty): boolean {
  const idx = resolveIndex(prop);
  if (idx === null) return false;
  if (prop.type === "player") return cls.pflags.has(idx);
  if (prop.type === "object") return cls.flags.has(idx);
  return false;
}

/** race_has_ability (player-properties.c L41), excluding the element branch
 * (handled separately by expandElementRows since it fans one record out
 * into one row per matching element). */
function raceHasAbility(race: PlayerRace, prop: PlayerProperty): boolean {
  const idx = resolveIndex(prop);
  if (idx === null) return false;
  if (prop.type === "player") return race.pflags.has(idx);
  if (prop.type === "object") return race.flags.has(idx);
  return false;
}

/** ODESC_CAPITAL-style single-word/phrase capitalisation (my_strcap on the element name). */
function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Expand one "element" template property into its per-element ability rows
 * (finish_parse_player_prop, init.c L1362-1387): one row for every element
 * whose el_info[i].resLevel matches the template's value (1 = resist, 3 =
 * immune, -1 = vulnerable).
 */
function expandElementRows(
  prop: PlayerProperty,
  race: PlayerRace,
  elementNames: readonly string[],
): AbilityRow[] {
  const rows: AbilityRow[] = [];
  const n = Math.min(elementNames.length, race.elInfo.length);
  for (let i = 0; i < n; i++) {
    if ((race.elInfo[i]?.resLevel ?? 0) !== prop.value) continue;
    const elemName = elementNames[i] ?? "";
    rows.push({
      name: `${capitalize(elemName)} ${prop.name}`,
      desc: `${prop.desc} ${elemName}.`,
      group: "race",
    });
  }
  return rows;
}

/**
 * view_abilities (player-properties.c L62): the ability_list the abilities
 * browser shows - every class ability the player has, then every racial one
 * (including the per-element resist/immune/vulnerable rows), in
 * player_property.txt declaration order within each pass.
 */
export function playerAbilities(state: GameState, deps: PlayerAbilitiesDeps): AbilityRow[] {
  const player = state.actor.player;
  const rows: AbilityRow[] = [];

  for (const prop of deps.properties) {
    if (prop.type === "element") continue; // no class-side element abilities
    if (classHasAbility(player.cls, prop)) {
      rows.push({ name: prop.name, desc: prop.desc, group: "class" });
    }
  }

  for (const prop of deps.properties) {
    if (prop.type === "element") {
      rows.push(...expandElementRows(prop, player.race, deps.elementNames));
      continue;
    }
    if (raceHasAbility(player.race, prop)) {
      rows.push({ name: prop.name, desc: prop.desc, group: "race" });
    }
  }

  return rows;
}
