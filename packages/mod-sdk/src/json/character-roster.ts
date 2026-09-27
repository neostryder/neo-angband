import { defineFormat, json } from "./index.js";
import { characterFromLegacy, characterRecord, type CharacterRecord } from "./character-record.js";

/** Browser-storage key for the roster document. */
export const ROSTER_STORAGE_KEY = "neo-angband-character-roster";
/** Previous key: a bare JSON array of character rows. */
export const LEGACY_ROSTER_STORAGE_KEY = "neo-angband-roster";

export interface CharacterRoster {
  characters: CharacterRecord[];
}

export const rosterFormat = defineFormat({
  format: "neo-angband/web/character-roster",
  schemaVersion: 1,
  validator: json.object({ characters: json.array(characterRecord) }),
  sample: {
    characters: [
      {
        id: "c1",
        name: "Test",
        race: "Human",
        cls: "Warrior",
        sex: "Female",
        level: 1,
        depth: 0,
        maxDepth: 0,
        turn: 1,
        alive: true,
        updatedAt: "2026-01-02T03:04:05.000Z",
        lineage: "c1",
      },
    ],
  },
});

/** A bare roster array, or null when the text is not one. */
export function rosterFromLegacy(raw: string): CharacterRoster | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const characters: CharacterRecord[] = [];
  for (const item of value) {
    const row = characterFromLegacy(item);
    if (!row) return null;
    characters.push(row);
  }
  return { characters };
}
