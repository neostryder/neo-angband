/**
 * The character-select screen: pick which saved character to play, or start a
 * new one. Shown at boot when there is no live character to auto-resume, and
 * on demand from the in-game menu ("Switch character"). Living characters are
 * resumable; tombstones (dead characters) are listed dimmed for the memorial
 * but cannot be played - faithful terminal death (decision 16, docs/PORT_PLAN.md).
 *
 * It resolves with the chosen action; main.ts performs the reload (set the
 * active slot and refresh, or run birth for a new character), reusing the same
 * reload flow the birth screen already uses.
 */

import type { CharMeta } from "./roster";
import type { GlyphTerm } from "./term";
import { selectFromMenu } from "./overlay";
import type { MenuItem } from "./overlay";
import { UI_TEXT, UI_DIM } from "./ui-colors";

const DIM = UI_DIM;
const FG = UI_TEXT;

export type SelectResult =
  | { action: "resume"; id: string }
  | { action: "delete"; id: string }
  | { action: "new" };

/** "Town" at the surface, else the classic "<feet>' (L<n>)". */
function depthLabel(depth: number): string {
  return depth <= 0 ? "Town" : `${depth * 50}' (L${depth})`;
}

/** One roster row: "Name the Race Class   Lv N   <depth>" (dead ones tagged). */
function charLabel(c: CharMeta): string {
  const who = `${c.name || "(unnamed)"} the ${c.race} ${c.cls}`.padEnd(34).slice(0, 34);
  const lv = `Lv ${c.level}`.padEnd(6);
  const where = c.alive ? depthLabel(c.depth) : "(deceased)";
  return `${who} ${lv} ${where}`;
}

/** "just now" / "Nm ago" / "Nh ago" / "Nd ago" from an epoch-ms save stamp. */
function lastPlayed(updatedAt: number, now: number): string {
  const mins = Math.floor(Math.max(0, now - updatedAt) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Per-row detail shown while the row is highlighted (MenuItem.hint). */
function charHint(c: CharMeta, now: number): string {
  if (!c.alive) return "(deceased) - memorial only";
  return `Level ${c.level} ${c.cls} - ${depthLabel(c.depth)}, last played ${lastPlayed(c.updatedAt, now)}`;
}

/**
 * Confirm deleting a save, naming what is about to be destroyed. A living
 * character is a real loss, so it asks twice as bluntly as a tombstone does:
 * there is no undo and no other place to delete a save from (the browser owns
 * the storage, so there is no file to remove by hand - the reason this screen
 * has a delete at all when upstream, with a savefile directory, does not).
 */
async function confirmDelete(term: GlyphTerm, c: CharMeta): Promise<boolean> {
  const who = `${c.name || "(unnamed)"} the ${c.race} ${c.cls}, level ${c.level}`;
  const title = c.alive ? `Delete ${who}?` : `${c.name || "(unnamed)"} has died.`;
  const keep = c.alive ? "Keep this character" : "Leave the tombstone";
  const drop = c.alive ? "Delete this save PERMANENTLY" : "Delete this record";
  const pick = await selectFromMenu(term, title, [{ label: keep }, { label: drop }], "[ ESC to go back ]", {
    ...(c.alive ? { subtitle: "The save is erased from this browser. There is no undo." } : {}),
  });
  return pick === 1;
}

/**
 * Run the picker until the player chooses. Living characters resume; the last
 * row starts a new character. Delete (or Backspace) on any row erases that save
 * after a confirmation - a tombstone's own row also offers it on selection,
 * since a dead character cannot be played. ESC resumes the most-recent living
 * character, or starts a new one if there are none (there is always a way
 * forward).
 */
export async function runCharacterSelect(
  term: GlyphTerm,
  roster: CharMeta[],
): Promise<SelectResult> {
  for (;;) {
    const now = Date.now();
    const items: MenuItem[] = roster.map((c) => ({
      label: charLabel(c),
      color: c.alive ? FG : DIM,
      hint: charHint(c, now),
    }));
    const newRow: MenuItem = {
      label: "[ New character ]",
      color: FG,
      hint: "Birth a brand-new character in a fresh save slot.",
    };
    /* The delete request, resolved after the menu closes: opening a confirm
     * while this menu's own capturing keydown listener is still attached would
     * double-capture keys (the same constraint optionsKey documents). */
    let deleteRow = -1;
    const requestDelete = (cursor: number): number | null => {
      if (cursor < 0 || cursor >= roster.length) return null; // not a character row
      deleteRow = cursor;
      return cursor; // close the menu on this row; handled below
    };
    const pick = await selectFromMenu(
      term,
      "Select a character",
      [...items, newRow],
      "[ a-z to choose, tap a row, Del to delete, ESC for the most recent ]",
      {
        subtitle: "Living characters resume; tombstones are memorials.",
        commands: { Delete: requestDelete, Backspace: requestDelete },
      },
    );

    if (pick === null) {
      const living = roster.find((c) => c.alive);
      return living ? { action: "resume", id: living.id } : { action: "new" };
    }
    if (pick === roster.length) return { action: "new" };

    const chosen = roster[pick];
    if (!chosen) continue;

    // Del on a row, or selecting a tombstone (which cannot be played): both
    // land on the same confirmation.
    if (pick === deleteRow || !chosen.alive) {
      if (await confirmDelete(term, chosen)) return { action: "delete", id: chosen.id };
      continue; // back to the list
    }
    return { action: "resume", id: chosen.id };
  }
}
