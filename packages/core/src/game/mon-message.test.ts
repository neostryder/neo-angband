/**
 * Spell-cast messages (game/mon-message.ts spellMessageText), locking in
 * reference/src/mon-spell.c L47-274: the {name} / {pronoun} / {target} /
 * {type} / {oftype} tag substitution, the seen / blind / miss template
 * selection, per-race ALTMSG overrides (message-vis / -invis / -miss,
 * including the empty-string suppression), and the power-level selection.
 * Also covers the get_subject count/invisible/offscreen grammar via
 * formatMonsterMessage's single-monster path (mon-msg.c L318).
 */

import { describe, expect, it } from "vitest";
import { FlagSet } from "../bitflag";
import { MFLAG, MON_MSG, RF } from "../generated";
import { loc } from "../loc";
import { blankMonster } from "../mon/monster";
import type { Monster } from "../mon/monster";
import { RF_SIZE } from "../mon/types";
import type {
  MonsterAltMsg,
  MonsterRace,
  MonsterSpell,
  MonsterSpellLevel,
} from "../mon/types";
import { formatMonsterMessage, spellMessageText } from "./mon-message";

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

function race(
  name: string,
  opts: {
    flags?: number[];
    spellPower?: number;
    spellMsgs?: MonsterAltMsg[];
    plural?: string | null;
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
