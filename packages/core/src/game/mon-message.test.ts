/**
 * Spell-cast messages (game/mon-message.ts spellMessageText), locking in
 * reference/src/mon-spell.c L47-274: the {name} / {pronoun} / {target} /
 * {type} / {oftype} tag substitution, the seen / blind / miss template
 * selection, per-race ALTMSG overrides (message-vis / -invis / -miss,
 * including the empty-string suppression), and the power-level selection.
 * Also covers the get_subject count/invisible/offscreen grammar via
 * formatMonsterMessage's single-monster path (mon-msg.c L320).
 */

import { describe, expect, it } from "vitest";
import { FlagSet } from "../bitflag.js";
import { MFLAG, MON_MSG, MSG, RF } from "../generated/index.js";
import { loc } from "../loc.js";
import { blankMonster } from "../mon/monster.js";
import type { Monster } from "../mon/monster.js";
import { RF_SIZE } from "../mon/types.js";
import type {
  MonsterAltMsg,
  MonsterRace,
  MonsterSpell,
  MonsterSpellLevel,
} from "../mon/types.js";
import type { GameState } from "./context.js";
import {
  addMonsterMessageShowDamage,
  formatMonsterMessage,
  messagePainShowDamage,
  monMessageSoundType,
  showMonsterMessages,
  spellMessageText,
} from "./mon-message.js";

/**
 * The smallest state the queue reads: the notice mask it raises PN_MON_MESSAGE
 * in, and the sink show_monster_messages emits to. game/mon-msg-queue.test.ts
 * drives the same code through the real harness state.
 */
function sink(): { state: GameState; lines: string[] } {
  const lines: string[] = [];
  const state = {
    actor: { player: { upkeep: { notice: 0 } } },
    msg: (text: string): void => void lines.push(text),
  } as unknown as GameState;
  return { state, lines };
}

function level(overrides: Partial<MonsterSpellLevel>): MonsterSpellLevel {
  return {
    power: 0,
    loreDesc: "",
    loreColorBase: "White",
    loreColorResist: "",
    loreColorImmune: "",
    message: "",
    blindMessage: "",
    missMessage: "",
    saveMessage: "",
    ...overrides,
  };
}

function spell(levels: MonsterSpellLevel[], index = 1): MonsterSpell {
  return { index, name: "TEST", msgt: "MSG_GENERIC", hit: 100, effects: [], levels };
}

/** The seven graded pain lines a monster_base carries (pain.txt). */
const PAIN_MESSAGES = [
  "ignore[s] the attack.",
  "grunt[s] with pain.",
  "cr[ies|y] out in pain.",
  "scream[s] in pain.",
  "scream[s] in agony.",
  "writhe[s] in agony.",
  "cr[ies|y] out feebly.",
];

function race(
  name: string,
  opts: {
    flags?: number[];
    spellPower?: number;
    spellMsgs?: MonsterAltMsg[];
    plural?: string | null;
    /** monster_base name, for get_message_type's Morgoth check. */
    base?: string;
  } = {},
): MonsterRace {
  const flags = new FlagSet(RF_SIZE);
  for (const f of opts.flags ?? []) flags.on(f);
  return {
    name,
    plural: opts.plural ?? null,
    flags,
    spellPower: opts.spellPower ?? 0,
    spellMsgs: opts.spellMsgs ?? [],
    blows: [],
    base: {
      name: opts.base ?? "person",
      pain: { index: 0, messages: PAIN_MESSAGES },
    },
  } as unknown as MonsterRace;
}

function mon(r: MonsterRace, visible = true): Monster {
  const m = blankMonster(r);
  m.grid = loc(5, 5);
  if (visible) m.mflag.on(MFLAG.VISIBLE);
  return m;
}

describe("spellMessageText (mon-spell.c spell_message)", () => {
  it("substitutes a leading {name} capitalised", () => {
    const s = spell([level({ message: "{name} breathes fire." })]);
    const out = spellMessageText(mon(race("kobold")), s, true, true);
    expect(out?.text).toBe("The kobold breathes fire.");
    expect(out?.msgt).toBe("MSG_GENERIC");
  });

  it("a mid-sentence {name} stays lowercase", () => {
    const s = spell([level({ message: "Fire wreathes {name}." })]);
    const out = spellMessageText(mon(race("kobold")), s, true, true);
    expect(out?.text).toBe("Fire wreathes the kobold.");
  });

  it("a hidden caster uses the blind message", () => {
    const s = spell([
      level({ message: "{name} casts.", blindMessage: "Something mumbles." }),
    ]);
    const out = spellMessageText(mon(race("kobold"), false), s, false, true);
    expect(out?.text).toBe("Something mumbles.");
  });

  it("an unseen cast at a monster target is silent", () => {
    const s = spell([level({ message: "x", blindMessage: "y" })]);
    const caster = mon(race("kobold"), false);
    const target = mon(race("orc"));
    caster.target.midx = 2;
    expect(
      spellMessageText(caster, s, false, true, { targetMon: target }),
    ).toBeNull();
  });

  it("a miss uses the miss message", () => {
    const s = spell([
      level({ message: "{name} hits.", missMessage: "{name} misses wildly." }),
    ]);
    const out = spellMessageText(mon(race("kobold")), s, true, false);
    expect(out?.text).toBe("The kobold misses wildly.");
  });

  it("per-race ALTMSG_SEEN overrides the level message", () => {
    const alt: MonsterAltMsg = { index: 1, msgType: "seen", message: "{name} does a thing." };
    const s = spell([level({ message: "{name} casts." })]);
    const out = spellMessageText(mon(race("kobold", { spellMsgs: [alt] })), s, true, true);
    expect(out?.text).toBe("The kobold does a thing.");
  });

  it("an empty-string ALTMSG suppresses the message entirely", () => {
    const alt: MonsterAltMsg = { index: 1, msgType: "miss", message: "" };
    const s = spell([
      level({ message: "{name} hits.", missMessage: "{name} misses." }),
    ]);
    expect(
      spellMessageText(mon(race("kobold", { spellMsgs: [alt] })), s, true, false),
    ).toBeNull();
  });

  it("{target} names the target monster or falls back to 'you'", () => {
    const s = spell([level({ message: "{name} points at {target}." })]);
    const caster = mon(race("kobold"));
    const out1 = spellMessageText(caster, s, true, true);
    expect(out1?.text).toBe("The kobold points at you.");

    const target = mon(race("orc"));
    caster.target.midx = 2;
    const out2 = spellMessageText(caster, s, true, true, { targetMon: target });
    expect(out2?.text).toBe("The kobold points at the orc.");
  });

  it("{pronoun} is the visible possessive pronoun", () => {
    const s = spell([level({ message: "{name} shakes {pronoun} fist." })]);
    const out = spellMessageText(mon(race("apprentice", { flags: [RF.MALE] })), s, true, true);
    expect(out?.text).toBe("The apprentice shakes his fist.");
    const out2 = spellMessageText(mon(race("kobold")), s, true, true);
    expect(out2?.text).toBe("The kobold shakes its fist.");
  });

  it("a NAME_COMMA race gets a comma unless punctuation follows the tag", () => {
    const worm = race("Wormtongue, Agent of Saruman", {
      flags: [RF.UNIQUE, RF.NAME_COMMA],
    });
    const s1 = spell([level({ message: "{name} shouts." })]);
    expect(spellMessageText(mon(worm), s1, true, true)?.text).toBe(
      "Wormtongue, Agent of Saruman, shouts.",
    );
    const s2 = spell([level({ message: "Behold {name}!" })]);
    expect(spellMessageText(mon(worm), s2, true, true)?.text).toBe(
      "Behold Wormtongue, Agent of Saruman!",
    );
  });

  it("selects the highest level whose power the caster meets", () => {
    const s = spell([
      level({ message: "{name} whispers." }),
      level({ power: 10, message: "{name} bellows." }),
    ]);
    expect(spellMessageText(mon(race("kobold")), s, true, true)?.text).toBe(
      "The kobold whispers.",
    );
    expect(
      spellMessageText(mon(race("giant", { spellPower: 15 })), s, true, true)?.text,
    ).toBe("The giant bellows.");
  });

  it("a missing template returns null instead of a bug message", () => {
    const s = spell([level({ message: "{name} casts." })]);
    /* No miss message anywhere: upstream logs a report-this-bug msg. */
    expect(spellMessageText(mon(race("kobold")), s, true, false)).toBeNull();
  });
});

describe("formatMonsterMessage subject grammar (mon-msg.c get_subject)", () => {
  it("uses 'The <race>' for a single visible monster", () => {
    const m = mon(race("kobold"));
    expect(formatMonsterMessage(m, MON_MSG.DIE)).toMatch(/^The kobold /);
  });

  it("uses the bare name for uniques", () => {
    const m = mon(race("Gollum", { flags: [RF.UNIQUE] }));
    expect(formatMonsterMessage(m, MON_MSG.DIE)).toMatch(/^Gollum /);
  });
});

/*
 * add_monster_message_show_damage / message_pain_show_damage (mon-msg.c L288 /
 * L132) and show_message's MON_MSG_FLAG_DAMAGE branch (L494): with
 * OPT(player, show_damage) on, a monster message from the player's own damage
 * carries the numeric amount.
 */
describe("show_damage monster messages (mon-msg.c L132/L288/L494)", () => {
  it("appends ' (N)' to a coded message (count == 1 form)", () => {
    const { state, lines } = sink();
    addMonsterMessageShowDamage(state, mon(race("kobold")), MON_MSG.DIE, false, 17);
    showMonsterMessages(state);
    expect(lines).toEqual(["The kobold dies. (17)"]);
  });

  it("appends ' (N)' to the graded pain message", () => {
    const { state, lines } = sink();
    const m = mon(race("kobold"));
    m.maxhp = 100;
    m.hp = 40; /* 40/47 == 85% -> MON_MSG_75 */
    messagePainShowDamage(state, m, 7);
    showMonsterMessages(state);
    expect(lines).toEqual(["The kobold grunts with pain. (7)"]);
  });

  it("a zero-damage hit takes the plain branch, with no ' (0)'", () => {
    /* message_pain_show_damage only calls the show-damage variant when dam > 0
     * (mon-msg.c L136-140), so MON_MSG_UNHARMED never carries a suffix. */
    const { state, lines } = sink();
    const m = mon(race("kobold"));
    m.maxhp = 100;
    m.hp = 100;
    messagePainShowDamage(state, m, 0);
    showMonsterMessages(state);
    expect(lines).toEqual([formatMonsterMessage(m, MON_MSG.UNHARMED)]);
    expect(lines[0]).not.toMatch(/\(0\)/);
  });
});

/*
 * get_message_type (mon-msg.c L450): MSG_KILL is refined to MSG_KILL_UNIQUE for
 * a unique, and MSG_KILL_KING when the unique's base is Morgoth's.
 */
describe("get_message_type unique refinement (mon-msg.c L450)", () => {
  it("a normal monster's death plays MSG_KILL", () => {
    expect(monMessageSoundType(MON_MSG.DIE, race("kobold"))).toBe(MSG.KILL);
  });

  it("a unique's death plays MSG_KILL_UNIQUE", () => {
    const r = race("Gollum", { flags: [RF.UNIQUE], base: "person" });
    expect(monMessageSoundType(MON_MSG.DIE, r)).toBe(MSG.KILL_UNIQUE);
  });

  it("a Morgoth-base unique's death plays MSG_KILL_KING", () => {
    const r = race("Morgoth, Lord of Darkness", {
      flags: [RF.UNIQUE],
      base: "Morgoth",
    });
    expect(monMessageSoundType(MON_MSG.DIE, r)).toBe(MSG.KILL_KING);
  });

  it("a non-KILL message is never refined, even for a unique", () => {
    const r = race("Gollum", { flags: [RF.UNIQUE], base: "person" });
    expect(monMessageSoundType(MON_MSG.WAKES_UP, r)).toBe(MSG.GENERIC);
  });

  it("the Morgoth base only matters for uniques", () => {
    /* rf_has(race->flags, RF_UNIQUE) gates the whole refinement. */
    const r = race("lesser morgoth-thing", { base: "Morgoth" });
    expect(monMessageSoundType(MON_MSG.DIE, r)).toBe(MSG.KILL);
  });
});
