import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeSavedGame, encodeSavedGame, saveGame, startGame } from "@rpgm-tools/neo-angband-core";
import type { GamePack } from "@rpgm-tools/neo-angband-core";
import { SAVE_CODEC, SAVE_CODECS } from "./save-codec";
import { renameStoredSave } from "./stored-rename";

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8")) as T;
}
const records = <T>(name: string): T[] => loadJson<{ records: T[] }>(name).records;

const pack = {
  constants: loadJson("constants"),
  terrain: records("terrain"),
  roomTemplates: records("room_template"),
  vaults: records("vault"),
  dungeonProfiles: records("dungeon_profile"),
  obj: {
    objectBase: loadJson("object_base"), object: loadJson("object"), egoItem: loadJson("ego_item"),
    artifact: loadJson("artifact"), curse: loadJson("curse"), brand: loadJson("brand"), slay: loadJson("slay"),
    activation: loadJson("activation"), objectProperty: loadJson("object_property"), flavor: loadJson("flavor"),
  },
  mon: {
    pain: records("pain"), blowMethods: records("blow_methods"), blowEffects: records("blow_effects"),
    monsterSpells: records("monster_spell"), monsterBases: records("monster_base"), monsters: records("monster"),
    summons: records("summon"), pits: records("pit"),
  },
  player: {
    races: records("p_race"), classes: records("class"), properties: records("player_property"),
    timed: records("player_timed"), shapes: records("shape"), bodies: records("body"),
    history: records("history"), realms: records("realm"),
  },
} as unknown as GamePack;

function storedSave(name: string): Uint8Array {
  const game = startGame(pack, { seed: 77, depth: 1 });
  game.state.actor.player.fullName = name;
  return encodeSavedGame(saveGame(game), undefined, SAVE_CODEC);
}

describe("renameStoredSave", () => {
  it("rewrites only the character's name inside the stored save", () => {
    const before = decodeSavedGame(storedSave("Old"), undefined, SAVE_CODECS).save!;
    const renamed = renameStoredSave(storedSave("Old"), "Newname");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    const after = decodeSavedGame(renamed.bytes, undefined, SAVE_CODECS);
    expect(after.verified).toBe(true);
    expect((after.save!.player as { fullName?: string }).fullName).toBe("Newname");
    const strip = (save: unknown) => JSON.stringify({ ...(save as Record<string, unknown>), player: { ...((save as { player: object }).player), fullName: "" } });
    expect(strip(after.save)).toBe(strip(before));
  });

  it("refuses a save that fails its integrity check or cannot be read", () => {
    const bytes = storedSave("Old");
    const tampered = bytes.slice();
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! + 1) % 256;
    expect(renameStoredSave(tampered, "X")).toMatchObject({ ok: false });
    expect(renameStoredSave(new Uint8Array([1, 2, 3]), "X")).toMatchObject({ ok: false });
  });
});
