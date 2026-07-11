/**
 * Character birth (player-birth.c / ui-birth.c): choose race, class, sex, and
 * name for a new character. A faithful-but-compact flow over the overlay menus;
 * the classic stat roller runs inside the engine's generatePlayer (startGame),
 * so this collects the identity choices and the engine does the rest. Point-buy
 * stat allocation is a later refinement (the primitives exist in player/birth).
 *
 * Returns the choice, or null if the player backed all the way out (in which
 * case the caller keeps the default Human Warrior).
 */

import { selectFromMenu, promptText } from "./overlay";
import type { GlyphTerm } from "./term";

export interface BirthChoice {
  raceName: string;
  className: string;
  name: string;
  sex: string;
}

interface Named {
  name: string;
}

export async function runBirth(
  term: GlyphTerm,
  races: readonly Named[],
  classes: readonly Named[],
): Promise<BirthChoice | null> {
  const r = await selectFromMenu(
    term,
    "Create a character  -  choose a race",
    races.map((x) => ({ label: x.name })),
    "[ a-z to choose a race, ESC to keep the default ]",
  );
  if (r === null) return null;
  const raceName = races[r]?.name ?? "Human";

  const c = await selectFromMenu(
    term,
    `Race: ${raceName}  -  choose a class`,
    classes.map((x) => ({ label: x.name })),
    "[ a-z to choose a class, ESC to cancel ]",
  );
  if (c === null) return null;
  const className = classes[c]?.name ?? "Warrior";

  const s = await selectFromMenu(
    term,
    `${raceName} ${className}  -  choose a sex`,
    [{ label: "Female" }, { label: "Male" }],
    "[ choose a sex, ESC to cancel ]",
  );
  if (s === null) return null;

  const entered = await promptText(term, "Enter your character's name", "");
  if (entered === null) return null;

  return {
    raceName,
    className,
    name: entered.trim() || "Adventurer",
    sex: s === 0 ? "Female" : "Male",
  };
}
