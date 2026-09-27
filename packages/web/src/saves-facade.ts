/** The mod saves door delegates each operation to the host's roster paths. */

import { acceptedCharacterName } from "./charsheet";
import type { CharMeta } from "./roster";
import type { ModSaves, SaveEntry, SaveListResult, SaveResult } from "./mod-plugin";

export interface SavesDoorDeps {
  onChange?: (listener: Parameters<NonNullable<ModSaves["onChange"]>>[0]) => () => void;
  listRoster(): CharMeta[];
  load(id: string): Promise<SaveResult>;
  rename(id: string, name: string): SaveResult;
  /** Rename a character that is not in play by rewriting its stored save. */
  renameStored?(id: string, name: string): SaveResult;
  confirmDelete(meta: CharMeta): Promise<boolean>;
  deleteSlot(id: string): void;
  activeSlot(): string | null;
  namePinned(): boolean;
}

const refused = (reason: string): SaveResult => ({ ok: false, reason });
const listRefused = (reason: string): SaveListResult => ({ ok: false, reason });

export function createModSaves(deps: SavesDoorDeps): ModSaves {
  const find = (id: string): CharMeta | undefined => deps.listRoster().find((meta) => meta.id === id);
  return Object.freeze({
    ...(deps.onChange ? { onChange: (listener: Parameters<NonNullable<ModSaves["onChange"]>>[0]) => deps.onChange!(listener) } : {}),
    async list() {
      try {
        const entries: SaveEntry[] = deps.listRoster().map((meta) => Object.freeze({
          id: meta.id,
          name: meta.name,
          race: meta.race,
          cls: meta.cls,
          level: meta.level,
          depth: meta.depth,
          dead: !meta.alive,
          lastPlayed: meta.updatedAt,
        }));
        return { ok: true as const, entries: Object.freeze(entries) };
      } catch {
        return listRefused("The character roster could not be read.");
      }
    },
    async load(id: string) {
      try {
        const meta = find(id);
        if (!meta) return refused("Character not found.");
        if (!meta.alive) return refused("This character has died.");
        return await deps.load(id);
      } catch {
        return refused("The character could not be loaded.");
      }
    },
    async rename(id: string, entered: string) {
      try {
        const meta = find(id);
        if (!meta) return refused("Character not found.");
        if (deps.namePinned()) return refused("You are not allowed to change your name!");
        const name = acceptedCharacterName(entered);
        if (name === null) return refused("Enter a name of 1 to 15 characters.");
        /* The character in play renames live and saves; any other one is renamed
         * inside its stored save, so the next load and the roster agree. */
        if (deps.activeSlot() === id) return deps.rename(id, name);
        if (!deps.renameStored) return refused("Load this character to rename it.");
        return deps.renameStored(id, name);
      } catch {
        return refused("The character could not be renamed.");
      }
    },
    async delete(id: string) {
      try {
        const meta = find(id);
        if (!meta) return refused("Character not found.");
        if (deps.activeSlot() === id) return refused("The active character cannot be deleted.");
        if (!(await deps.confirmDelete(meta))) return refused("Deletion cancelled.");
        if (deps.activeSlot() === id) return refused("The active character cannot be deleted.");
        if (!find(id)) return refused("Character not found.");
        deps.deleteSlot(id);
        return { ok: true as const };
      } catch {
        return refused("The character could not be deleted.");
      }
    },
  });
}
