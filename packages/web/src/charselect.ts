/**
 * The character-select screen: pick which saved character to play, or start a
 * new one. Shown at boot when there is no live character to auto-resume, and
 * on demand from the in-game menu ("Switch character"). Living characters are
 * resumable; tombstones (dead characters) are listed dimmed for the memorial
 * but cannot be played - faithful terminal death ([[neo-angband-save-scum-policy]]).
 *
 * It resolves with the chosen action; main.ts performs the reload (set the
 * active slot and refresh, or run birth for a new character), reusing the same
 * reload flow the birth screen already uses.
 */

import type { CharMeta } from "./roster";
import type { GlyphTerm } from "./term";
import { selectFromMenu } from "./overlay";
import type { MenuItem } from "./overlay";

const DIM = "#8a8a94";
const FG = "#c8c8d4";

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
 * Run the picker until the player chooses. Living characters resume; a dead
 * character offers to clear its tombstone; the last row starts a new
 * character. ESC resumes the most-recent living character, or starts a new one
 * if there are none (there is always a way forward).
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
    const pick = await selectFromMenu(
      term,
      "Select a character",
      [...items, newRow],
      "[ a-z to choose, tap a row, ESC for the most recent ]",
      { subtitle: "Living characters resume; tombstones are memorials." },
    );

    if (pick === null) {
      const living = roster.find((c) => c.alive);
      return living ? { action: "resume", id: living.id } : { action: "new" };
    }
    if (pick === roster.length) return { action: "new" };

    const chosen = roster[pick];
    if (!chosen) continue;
    if (chosen.alive) return { action: "resume", id: chosen.id };

    // A tombstone: offer to clear it (it cannot be played).
    const what = await selectFromMenu(
      term,
      `${chosen.name || "(unnamed)"} has died.`,
      [{ label: "Leave the tombstone" }, { label: "Delete this record" }],
      "[ ESC to go back ]",
    );
    if (what === 1) return { action: "delete", id: chosen.id };
    // otherwise loop back to the list
  }
}
