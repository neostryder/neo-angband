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
  | { action: "new" }
  /* Write this character to a file the player can carry to another copy of the
   * game, and read one back. Here rather than on the title screen because this is
   * where characters ARE - and a file is the only way one crosses, because the
   * desktop build keeps its roster in its own storage exactly as a browser tab
   * does (save-transfer.ts says why, with the measurement). */
  | { action: "export"; id: string }
  | { action: "import" }
  /* "Where your characters live" (storage-page.ts). Reachable from here because
   * this is the screen that lists the things at risk, and the notice below is
   * where a player is told the key. */
  | { action: "storage" }
  | { action: "back" };

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
 * since a dead character cannot be played.
 *
 * ESC goes BACK to the title screen. It used to resume the most-recent living
 * character, which made cancelling out of the picker indistinguishable from
 * choosing its top row - and left no way back to the title at all. This screen
 * is the port's stand-in for IDM_FILE_OPEN's file dialog (main-win.c:3518), and
 * cancelling a file dialog returns you to the splash, it does not open a file.
 */
export async function runCharacterSelect(
  term: GlyphTerm,
  roster: CharMeta[],
  /**
   * A standing warning about the storage these characters live in, when there is
   * one (storage-persist.durabilityNotice). Shown here because this screen is the
   * only place the player sees their characters as things that can be lost; a
   * warning on the title screen would be about nothing in particular.
   */
  notice?: string | null,
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
    /* Export and import ride the same deferred-command hook for the same reason:
     * both open something - a download, a file dialog - that must not run while
     * this menu's capturing keydown listener is still attached. */
    let exportRow = -1;
    const requestExport = (cursor: number): number | null => {
      const c = roster[cursor];
      if (!c?.alive) return null; // a tombstone's bytes are gone; nothing to carry
      exportRow = cursor;
      return cursor;
    };
    let importRequested = false;
    const requestImport = (cursor: number): number | null => {
      importRequested = true;
      /* Close on whatever row the cursor is on; the handler below ignores which,
       * and an empty roster has the "New character" row to close on. */
      return Math.max(0, Math.min(cursor, roster.length));
    };
    let storageRequested = false;
    const requestStorage = (cursor: number): number | null => {
      storageRequested = true;
      return Math.max(0, Math.min(cursor, roster.length));
    };
    const pick = await selectFromMenu(
      term,
      "Select a character",
      [...items, newRow],
      "[ a-z choose, Del delete, Shift-X export, Shift-M import, ESC title ]",
      {
        subtitle: notice
          ? notice
          : "Living characters resume; tombstones are memorials.",
        /* CAPITALS for the port's own keys. The command layer is checked BEFORE
         * positional letters, so registering lower-case "x", "m" and "w" would
         * steal the selection tags of the 24th, 13th and 23rd rows from anyone
         * with a long roster. Tags are lower case and case-sensitive, so shifted
         * letters cannot collide with them.
         *
         * Shift-W is not in the footer legend, deliberately: that line is already
         * 69 columns of 79 and adding to it would push the ESC hint off the end
         * of the row. It is named in the subtitle instead - which is the line
         * that gives a player a reason to press it. */
        commands: {
          Delete: requestDelete,
          Backspace: requestDelete,
          X: requestExport,
          M: requestImport,
          W: requestStorage,
        },
      },
    );

    if (pick === null) return { action: "back" };
    /* Both are checked before the row meanings below, because both closed the
     * menu ON a row that the player did not choose. */
    if (importRequested) return { action: "import" };
    if (storageRequested) return { action: "storage" };
    if (pick === exportRow) {
      const c = roster[pick];
      if (c) return { action: "export", id: c.id };
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
