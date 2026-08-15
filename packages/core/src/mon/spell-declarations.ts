/**
 * A pack's own MONSTER SPELLS, declared as DATA so they exist before the binder
 * that needs them - the ordering half of gap row 22 (#281).
 *
 * THE SAME SHAPE AS `declareModMessageTypes` (#266 / row 20). A mod's
 * `monster_spell` record reaches `bindSpells` through composition today, and
 * `bindSpells` resolves the name through the generated `RSF` object - which
 * throws `mon: invalid spell name` on anything not compiled in, taking
 * `startGame` down with it. A declaration that runs AFTER the bind is not late;
 * it is fatal. So the names must land in `monSpells` as DATA, before
 * `bindMonsters`, exactly as a message type lands before the same call.
 *
 * NOTHING HERE THROWS. A refusal loses one declaration and reports it;
 * `MonSpellRegistry.add` never throws (see mon/spell-registry.ts), and a
 * function called from inside `bindCore` that threw would be the same crash one
 * layer up.
 */

import { monSpells } from "./spell-registry.js";

/** One record of a pack's monster-spell declaration list. */
export interface MonsterSpellDeclarationJson {
  /** The RSF_ name a `spells:` line spells, bare and without the RSF_ prefix. */
  name: string;
  /**
   * The `list-mon-spells.h` type expression ("RST_BREATH | RST_INNATE").
   * Optional; "" joins none of the create_mon_spell_mask masks.
   */
  type?: string;
}

/** What one `declareModMonsterSpells` pass did. */
export interface MonsterSpellDeclarationResult {
  /** Names that took an index this pass. */
  readonly declared: readonly string[];
  /** Full refusal sentences from `MonSpellRegistry.add`, one per dropped name. */
  readonly refused: readonly string[];
}

const EMPTY: MonsterSpellDeclarationResult = { declared: [], refused: [] };

/**
 * Append a pack's declared monster spells, before anything binds a record that
 * names one.
 *
 * NEVER THROWS: a refusal is collected and the pass continues, matching
 * `declareModMessageTypes`. The optional `owner` is stamped on every successful
 * registration so a conflict report can name the pack.
 */
export function declareModMonsterSpells(
  records: readonly unknown[] | undefined | null,
  owner: string | null = null,
): MonsterSpellDeclarationResult {
  if (records === undefined || records === null) return EMPTY;
  const declared: string[] = [];
  const refused: string[] = [];
  if (!Array.isArray(records)) {
    refused.push("monster spell declaration: the file's records must be an array");
    return { declared, refused };
  }
  for (const raw of records) {
    if (typeof raw !== "object" || raw === null) {
      refused.push("monster spell declaration: each record must be an object");
      continue;
    }
    const rec = raw as MonsterSpellDeclarationJson;
    if (typeof rec.name !== "string" || rec.name.length === 0) {
      refused.push("monster spell declaration: name must be a non-empty string");
      continue;
    }
    const type = typeof rec.type === "string" ? rec.type : "";
    const result = monSpells.add(rec.name, type, owner);
    if (result.refused !== null) {
      refused.push(result.refused);
      continue;
    }
    declared.push(rec.name);
  }
  return { declared, refused };
}
