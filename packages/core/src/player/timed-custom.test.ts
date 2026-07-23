/**
 * Locks gaps 2.8 and 2.9, ported from reference/src/player-timed.c and
 * obj-util.c (Angband 4.2.6):
 * - 2.9: print_custom_message tag substitution (obj-util.c:1118-1185,
 *   msg_tag_lookup obj-util.c:1090-1113) applied to every status line emitted
 *   by player_set_timed (player-timed.c:842-865), and the temp_resist /
 *   oflag_syn "already matches known state" notify suppression
 *   (player-timed.c:828-843).
 * - 2.8: player_inc_check's non-lore side effects (player-timed.c:936-990):
 *   equip_learn_flag / equip_learn_element on every OBJECT / RESIST / VULN
 *   fail check, update_smart_learn for a monster source, and the "You resist
 *   the effect!" message when a monster's effect is inhibited.
 * - player_has_temporary_brand/slay (obj-slays.c:287-317) resolved from the
 *   player_timed brand:/slay: data (player-timed.c:361-405).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TMD } from "../generated";
import { bindPlayer } from "./bind";
import type { PlayerPackRecords } from "./bind";
import { TMD_MAX } from "./types";
import type { TimedEffect } from "./types";
import type {
  PlayerIncCheckHooks,
  PlayerIncCheckQueries,
  PlayerTimedTarget,
} from "./timed";
import {
  buildTempBrandSlay,
  playerIncCheck,
  playerSetTimed,
  substituteTimedMessage,
} from "./timed";

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as { records: T[] };
  return parsed.records;
}

const timedRecords = packJson<{ name: string; brand?: string[]; slay?: string[] }>(
  "player_timed",
);
const reg = bindPlayer({
  races: packJson("p_race"),
  classes: packJson("class"),
  properties: packJson("player_property"),
  timed: timedRecords,
  shapes: packJson("shape"),
  bodies: packJson("body"),
  history: packJson("history"),
  realms: packJson("realm"),
} as PlayerPackRecords);

const effect = (name: keyof typeof TMD): TimedEffect => {
  const e = reg.timed.find((t) => t.name === name);
  if (!e) throw new Error(`no timed effect ${name}`);
  return e;
};

function player(): PlayerTimedTarget {
  return { timed: new Int16Array(TMD_MAX) };
}

describe("print_custom_message substitution (obj-util.c:1118-1185)", () => {
  const sword = { name: "a Long Sword", kind: "long sword", number: 1 };
  const swords = { name: "2 Long Swords", kind: "long sword", number: 2 };

  it("substitutes {name} and {kind}; hands with no weapon", () => {
    expect(substituteTimedMessage("Your {kind} glows!", sword)).toBe(
      "Your long sword glows!",
    );
    expect(substituteTimedMessage("{name} glows!", sword)).toBe(
      "a Long Sword glows!",
    );
    expect(substituteTimedMessage("Your {kind} glows!")).toBe(
      "Your hands glows!",
    );
  });

  it("{s} pluralizes for a single object only; {is} follows the count", () => {
    /* ATT_ACID's real up message (player_timed.txt). */
    const msg = "Your {kind} start{s} to drip with acid!";
    expect(substituteTimedMessage(msg, sword)).toBe(
      "Your long sword starts to drip with acid!",
    );
    expect(substituteTimedMessage(msg, swords)).toBe(
      "Your long sword start to drip with acid!",
    );
    const isMsg = "Your {kind} {is} covered in frost!";
    expect(substituteTimedMessage(isMsg, sword)).toBe(
      "Your long sword is covered in frost!",
    );
    expect(substituteTimedMessage(isMsg, swords)).toBe(
      "Your long sword are covered in frost!",
    );
    /* No weapon: no "s", "are". */
    expect(substituteTimedMessage(msg)).toBe(
      "Your hands start to drip with acid!",
    );
    expect(substituteTimedMessage(isMsg)).toBe(
      "Your hands are covered in frost!",
    );
  });

  it("leaves tagless text intact and drops the stray brace of an invalid tag", () => {
    expect(substituteTimedMessage("You feel safe.", sword)).toBe("You feel safe.");
    /* obj-util.c:1176-1178: an invalid tag sets string = next + 1, dropping the
       '{' and re-reading the rest as plain text ("a {b7} c" -> "a b7} c"). */
    expect(substituteTimedMessage("a {b7} c", sword)).toBe("a b7} c");
  });

  it("player_set_timed routes messages through the substitution", () => {
    const p = player();
    const msgs: string[] = [];
    /* ATT_ACID: grade-up message carries {kind}/{s} tags. */
    playerSetTimed(p, effect("ATT_ACID"), 10, false, false, {
      onMessage: (t) => msgs.push(t),
      weapon: sword,
    });
    expect(msgs).toEqual(["Your long sword starts to drip with acid!"]);
  });
});

describe("notify suppression (player-timed.c:828-843)", () => {
  /* OPP_ACID has temp_resist = ELEM_ACID; a same-grade change with known
   * immunity is not notified (the message only duplicates known state). */
  it("suppresses a non-grade notify when the resist duplicates known immunity", () => {
    const p = player();
    const opp = effect("OPP_ACID");
    p.timed[opp.index] = 10;
    const msgs: string[] = [];
    let notified = 0;
    const suppress = {
      knownResist: () => true,
      isImmune: () => true,
      knownFlag: () => false,
      hasFlagNotTimed: () => false,
    };
    /* Same grade, notify requested: upstream prints on_increase unless
     * suppressed. */
    const r = playerSetTimed(p, opp, 20, true, false, {
      onMessage: (t) => msgs.push(t),
      onNotify: () => notified++,
      notifyQueries: suppress,
    });
    expect(r).toBe(false);
    expect(msgs).toEqual([]);
    expect(notified).toBe(0);
    expect(p.timed[opp.index]).toBe(20);
  });

  it("does not suppress without the knowledge queries", () => {
    const p = player();
    const opp = effect("OPP_ACID");
    p.timed[opp.index] = 10;
    const msgs: string[] = [];
    playerSetTimed(p, opp, 20, true, false, { onMessage: (t) => msgs.push(t) });
    expect(msgs.length).toBeGreaterThan(0);
  });
});

describe("player_inc_check side effects (player-timed.c:936-990, gap 2.8)", () => {
  const queries = (
    over: Partial<PlayerIncCheckQueries> = {},
  ): PlayerIncCheckQueries => ({
    objectFlag: () => false,
    resistLevel: () => 0,
    playerFlag: () => false,
    timedActive: () => false,
    ...over,
  });

  it("OBJECT fail: learns the flag, teaches a monster source, and messages on resist", () => {
    /* TMD_AFRAID has fail:1:PROT_FEAR (an object-flag fail). */
    const afraid = effect("AFRAID");
    const learned: string[] = [];
    const smart: string[] = [];
    let resisted = 0;
    const hooks: PlayerIncCheckHooks = {
      monsterSource: true,
      equipLearnFlag: (n) => learned.push(n),
      updateSmartLearn: (n) => smart.push(n),
      resistMessage: () => resisted++,
    };
    const ok = playerIncCheck(
      afraid,
      queries({ objectFlag: (n) => n === "PROT_FEAR" }),
      hooks,
    );
    expect(ok).toBe(false);
    expect(learned).toContain("PROT_FEAR");
    expect(smart).toContain("PROT_FEAR");
    expect(resisted).toBe(1);
  });

  it("OBJECT fail without a monster source: no smart-learn, no message", () => {
    const afraid = effect("AFRAID");
    const smart: string[] = [];
    let resisted = 0;
    const ok = playerIncCheck(
      afraid,
      queries({ objectFlag: () => true }),
      {
        monsterSource: false,
        updateSmartLearn: (n) => smart.push(n),
        resistMessage: () => resisted++,
      },
    );
    expect(ok).toBe(false);
    expect(smart).toEqual([]);
    expect(resisted).toBe(0);
  });

  it("RESIST fail: learns the element from worn gear even when it passes", () => {
    /* TMD_POISONED has fail:2:POIS (an element-resist fail). */
    const poisoned = effect("POISONED");
    const elems: string[] = [];
    const ok = playerIncCheck(poisoned, queries(), {
      equipLearnElement: (n) => elems.push(n),
    });
    expect(ok).toBe(true);
    expect(elems).toContain("POIS");
  });

  it("stays a pure predicate with no hooks", () => {
    const afraid = effect("AFRAID");
    expect(playerIncCheck(afraid, queries({ objectFlag: () => true }))).toBe(false);
    expect(playerIncCheck(afraid, queries())).toBe(true);
  });
});

describe("player_has_temporary_brand/slay (obj-slays.c:287-317)", () => {
  /* Minimal brand/slay tables: index 3 = ACID_3, index 2 = EVIL_2. */
  const brands = [null, null, null, { code: "ACID_3" }];
  const slays = [null, null, { code: "EVIL_2" }];

  it("an active ATT_ACID grants the ACID_3 brand; inactive does not", () => {
    const p = player();
    const t = buildTempBrandSlay(p, timedRecords, brands, slays);
    expect(t.hasBrand(3)).toBe(false);
    p.timed[TMD.ATT_ACID] = 10;
    expect(t.hasBrand(3)).toBe(true);
    expect(t.hasSlay(2)).toBe(false);
  });

  it("an active ATT_EVIL grants the EVIL_2 slay", () => {
    const p = player();
    p.timed[TMD.ATT_EVIL] = 5;
    const t = buildTempBrandSlay(p, timedRecords, brands, slays);
    expect(t.hasSlay(2)).toBe(true);
    expect(t.hasBrand(3)).toBe(false);
  });
});
