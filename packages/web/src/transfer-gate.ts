/**
 * What an imported character file is allowed to do to this roster.
 *
 * save-transfer.ts is the FORMAT and is deliberately ignorant of the roster it is
 * landing in. This is the policy, and it exists because the honest note in that
 * module - "a file can be exported, played past, and re-imported; that IS a
 * snapshot restore and this module cannot prevent it" - was true of the format but
 * did not have to be true of the game. Decision 16 says the GAME must not offer
 * save-scumming, and an export followed by a death followed by an import was the
 * game offering it in three keypresses on one install.
 *
 * So a character carries a LINEAGE (roster.ts) which survives the trip, and this
 * decides one of three things:
 *
 *   new      - nobody here is that character. A fresh slot, as before.
 *   replace  - that character is already here, and the file is FURTHER ALONG.
 *              The same character coming home from another surface: it takes over
 *              its own slot rather than becoming a second copy of itself.
 *   refused  - that character died here, or the copy already here has played at
 *              least as far. Both are restores wearing a transfer's clothes.
 *
 * WHAT THIS DOES NOT STOP, because a gate that is oversold is worse than one that
 * is understood:
 *
 *   - Two installs. Play on copy A, die, import the file into copy B, which has
 *     never seen that lineage. Nothing local can know, and nothing short of a
 *     server could - upstream Angband has always had the same hole, which is
 *     `cp save/Bilbo /tmp`.
 *   - A hand-edited file. The lineage is a string in a JSON file the player owns.
 *     Changing it makes the character a stranger and the import succeeds.
 *
 * Neither is worth engineering against. The bar is that the game must not make
 * scumming EASY or accidental, and both of those are deliberate work by somebody
 * who has decided to do it - which is their business, in a single-player game.
 */

import type { CharMeta, DeathRecord } from "./roster";
import { lineageOf } from "./roster";
import type { TransferFile } from "./save-transfer";

export type ImportDecision =
  /** Give it a slot of its own. */
  | { readonly kind: "new" }
  /** The same character, further along: take over this slot. */
  | { readonly kind: "replace"; readonly id: string }
  /** Not imported. `why` is screen lines, already written for the player. */
  | { readonly kind: "refused"; readonly why: readonly string[] };

/** A turn count as a player reads it (state.turn, which is what CharMeta holds). */
function atTurn(turn: number): string {
  return `turn ${turn.toLocaleString("en-US")}`;
}

/**
 * Decide, from the file and this roster alone. Pure: no storage, no UI, so the
 * policy can be tested without a browser and cannot quietly depend on anything
 * but its arguments.
 */
export function decideImport(
  file: TransferFile,
  roster: readonly CharMeta[],
  deaths: readonly DeathRecord[],
): ImportDecision {
  const lineage = file.lineage;
  /* Written by every build that has this gate. A file from before it names no
   * lineage, and there is nothing to match it against - so it imports as it
   * always did rather than being refused for being old. */
  if (lineage === undefined || lineage === "") return { kind: "new" };

  const name = file.meta.name || "That character";

  /* Death first, and from the LEDGER rather than the roster: a tombstone can be
   * cleared from the picker, and the death cannot. */
  const death = deaths.find((d) => d.lineage === lineage);
  if (death) {
    return {
      kind: "refused",
      why: [
        `${death.name || name} died in this game, at ${atTurn(death.turn)}.`,
        "",
        "Death is permanent here, as it is in Angband - so a file saved before",
        "it cannot bring them back. This is the one thing importing will not do.",
      ],
    };
  }

  /* The same character, already in this roster. */
  const here = roster.find((c) => lineageOf(c) === lineage);
  if (here && !here.alive) {
    /* A tombstone with no ledger entry: a roster that predates the ledger. Same
     * refusal, reached the other way. */
    return {
      kind: "refused",
      why: [
        `${here.name || name} is dead in this game, at ${atTurn(here.turn)}.`,
        "",
        "A file saved before that cannot bring them back.",
      ],
    };
  }
  if (here) {
    if (file.meta.turn > here.turn) {
      return { kind: "replace", id: here.id };
    }
    return {
      kind: "refused",
      why: [
        `${here.name || name} is already here, at ${atTurn(here.turn)}.`,
        `This file is from ${atTurn(file.meta.turn)} - the same point or earlier.`,
        "",
        "Importing it would be a restore point, which this game does not have.",
        "Play the one you have; a newer file of the same character will import.",
      ],
    };
  }

  return { kind: "new" };
}
