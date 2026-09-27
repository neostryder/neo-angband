/**
 * Rename a character inside its stored save, for a character that is not in
 * play. The name lives in the save as `player.fullName`; the caller writes the
 * roster row beside the returned bytes.
 */

import { decodeSavedGame, encodeSavedGame } from "@rpgm-tools/neo-angband-core";
import { SAVE_CODEC, SAVE_CODECS } from "./save-codec";

export type StoredRename = { ok: true; bytes: Uint8Array } | { ok: false; reason: string };

/**
 * A save from a newer build, or one whose integrity check failed, is refused:
 * re-encoding it would drop what this build cannot read, or restamp a save
 * whose failed check the player should still be warned about.
 */
export function renameStoredSave(bytes: Uint8Array, name: string): StoredRename {
  let decoded: ReturnType<typeof decodeSavedGame>;
  try {
    decoded = decodeSavedGame(bytes, undefined, SAVE_CODECS);
  } catch {
    return { ok: false, reason: "This character's save could not be read." };
  }
  if (decoded.unknownCodec || decoded.futureSchema) {
    return { ok: false, reason: "This character's save is from a newer Neo Angband." };
  }
  if (!decoded.save) return { ok: false, reason: "This character's save could not be read." };
  if (!decoded.verified) return { ok: false, reason: "This character's save failed its integrity check." };
  (decoded.save.player as { fullName?: string }).fullName = name;
  return { ok: true, bytes: encodeSavedGame(decoded.save, undefined, SAVE_CODEC) };
}
