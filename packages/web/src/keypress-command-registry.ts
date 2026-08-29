/**
 * The declarative door into the table the root keydown handler scans.
 *
 * `registry:menu` already owns row transforms. A keypress command is one more
 * such row: its runnable closure stays shell-private, while its label, command
 * category and bindings travel through the existing declarative protocol. That
 * makes duplicate stable ids useful too: a mod can add an alias for a core
 * command without being handed a live closure or inventing a second registry.
 */

import type { MenuTransformRow } from "@rpgm-tools/neo-angband-core";
import { menuRegistry } from "./menu-registry";

/** Stable `registry:menu` id for the root keypress dispatcher table. */
export const KEYPRESS_COMMANDS_MENU_ID = "core:keypress-commands";

/** The non-runnable shape shared by the dispatcher and command browser. */
export interface KeypressCommandRow {
  desc: string;
  cat: string | null;
  o?: string | null;
  r?: string | null;
  ctrl?: string;
}

type CommandData = NonNullable<MenuTransformRow["semantic"]["data"]>;

/** The ordinal is upstream's `cmds_all` order, not a display string. */
function commandId(index: number): string {
  return `${KEYPRESS_COMMANDS_MENU_ID}:row:${index}`;
}

function sourceRow(row: KeypressCommandRow, index: number): MenuTransformRow {
  const roguelikeKeyMode = row.r === undefined ? "same" : row.r === null ? "none" : "key";
  return {
    id: commandId(index),
    semantic: {
      kind: "keypress-command",
      ref: index,
      data: {
        category: row.cat,
        originalKey: row.o ?? null,
        roguelikeKeyMode,
        roguelikeKey: row.r ?? null,
        ctrlKey: row.ctrl ?? null,
      },
    },
    label: row.desc,
  };
}

function stringOrNull(data: CommandData | undefined, key: string, fallback: string | null): string | null {
  const value = data?.[key];
  return typeof value === "string" || value === null ? value : fallback;
}

function categoryFor(data: CommandData | undefined, fallback: string | null): string | null {
  return stringOrNull(data, "category", fallback);
}

function originalKeyFor(data: CommandData | undefined, fallback: string | null | undefined): string | null | undefined {
  const value = stringOrNull(data, "originalKey", fallback ?? null);
  return value === null && fallback === undefined ? undefined : value;
}

function roguelikeKeyFor(data: CommandData | undefined, fallback: string | null | undefined): string | null | undefined {
  const mode = data?.roguelikeKeyMode;
  if (mode === "same") return undefined;
  if (mode === "none") return null;
  if (mode === "key") return stringOrNull(data, "roguelikeKey", fallback ?? null);
  return fallback;
}

/**
 * Apply the existing menu transformer, then reunite each declarative row with
 * the original action closure by stable id. A row that names no core id has no
 * faithful shell action, exactly like a new row selected through selectFromMenu,
 * so it is not allowed to steal an ordinal's command accidentally.
 */
export function transformKeypressCommandTable<T extends KeypressCommandRow>(rows: readonly T[]): T[] {
  const source = rows.map(sourceRow);
  const actionById = new Map(source.map((row, index) => [row.id, rows[index]!]));
  return menuRegistry.transform(KEYPRESS_COMMANDS_MENU_ID, source).flatMap((transformed) => {
    const original = actionById.get(transformed.id);
    if (!original) return [];
    const data = transformed.semantic.data;
    return [{
      ...original,
      desc: transformed.label,
      cat: categoryFor(data, original.cat),
      o: originalKeyFor(data, original.o),
      r: roguelikeKeyFor(data, original.r),
    } as T];
  });
}
