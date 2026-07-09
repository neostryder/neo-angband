import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TMD } from "../generated";
import { bindPlayer } from "./bind";
import type { PlayerPackRecords } from "./bind";
import { TMD_MAX } from "./types";
import type { TimedEffect } from "./types";
import type { PlayerTimedTarget, PlayerTimedHooks } from "./timed";
import {
  playerClearTimed,
  playerDecTimed,
  playerIncCheck,
  playerIncTimed,
  playerSetTimed,
  playerTimedGrade,
  playerTimedGradeEq,
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

const reg = bindPlayer({
  races: packJson("p_race"),
  classes: packJson("class"),
  properties: packJson("player_property"),
  timed: packJson("player_timed"),
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

/** A recorder for the message + notify hooks. */
function recorder(): PlayerTimedHooks & {
  messages: string[];
  notified: number;
  transitions: Array<{ idx: number; begin: boolean }>;
} {
  const messages: string[] = [];
  const transitions: Array<{ idx: number; begin: boolean }> = [];
  return {
    messages,
    transitions,
    notified: 0,
    onMessage(text) {
      messages.push(text);
    },
    onNotify() {
      (this as { notified: number }).notified++;
    },
    onTransition(idx, begin) {
      transitions.push({ idx, begin });
    },
  };
}

describe("binding new timed fields", () => {
  it("captures NONSTACKING, on-increase/decrease, and grades", () => {
    expect(effect("PARALYZED").nonStacking).toBe(true);
    expect(effect("CONFUSED").nonStacking).toBe(false);
    expect(effect("CONFUSED").onIncrease).toBe("You are more confused!");
    expect(effect("CONFUSED").onDecrease).toBe("You feel a little less confused.");
    /* STUN: 3 pack grades + the implicit off grade. */
    expect(effect("STUN").grades).toHaveLength(4);
  });
});

describe("playerTimedGrade", () => {
  it("walks the graded severity of STUN", () => {
    const stun = effect("STUN");
    expect(playerTimedGrade(stun, 0).grade).toBe(0);
    expect(playerTimedGrade(stun, 30).name).toBe("Stun");
    expect(playerTimedGrade(stun, 100).name).toBe("Heavy Stun");
    expect(playerTimedGrade(stun, 500).name).toBe("Knocked Out");
  });
});

describe("playerSetTimed", () => {
  it("sets a duration, messages on entering the grade, and notifies", () => {
    const p = player();
    const rec = recorder();
    const notified = playerSetTimed(p, effect("CONFUSED"), 10, false, true, rec);
    expect(notified).toBe(true);
    expect(p.timed[TMD.CONFUSED]).toBe(10);
    expect(rec.messages).toContain("You are confused!");
    expect(rec.notified).toBe(1);
    expect(rec.transitions).toEqual([{ idx: TMD.CONFUSED, begin: true }]);
  });

  it("returns false and does nothing when the value is unchanged", () => {
    const p = player();
    p.timed[TMD.CONFUSED] = 10;
    const rec = recorder();
    expect(playerSetTimed(p, effect("CONFUSED"), 10, true, true, rec)).toBe(
      false,
    );
    expect(rec.messages).toHaveLength(0);
  });

  it("emits the on-end message and an end transition when finishing", () => {
    const p = player();
    p.timed[TMD.CONFUSED] = 10;
    const rec = recorder();
    playerSetTimed(p, effect("CONFUSED"), 0, true, true, rec);
    expect(p.timed[TMD.CONFUSED]).toBe(0);
    expect(rec.messages).toContain("You are no longer confused.");
    expect(rec.transitions).toEqual([{ idx: TMD.CONFUSED, begin: false }]);
  });

  it("messages when moving up a STUN grade", () => {
    const p = player();
    p.timed[TMD.STUN] = 30; /* Stun */
    const rec = recorder();
    playerSetTimed(p, effect("STUN"), 100, false, true, rec); /* Heavy Stun */
    expect(rec.messages).toContain("You have been heavily stunned.");
  });

  it("clamps to the top grade's maximum", () => {
    const p = player();
    playerSetTimed(p, effect("STUN"), 999999, true, true);
    expect(p.timed[TMD.STUN]).toBe(10000); /* Knocked Out max */
  });
});

describe("playerIncTimed / DecTimed / ClearTimed", () => {
  it("increments and stacks a normal effect", () => {
    const p = player();
    p.timed[TMD.CONFUSED] = 10;
    playerIncTimed(p, effect("CONFUSED"), 5, true, true, false);
    expect(p.timed[TMD.CONFUSED]).toBe(15);
  });

  it("blocks a NONSTACKING effect that is already active", () => {
    const p = player();
    p.timed[TMD.PARALYZED] = 4;
    const applied = playerIncTimed(p, effect("PARALYZED"), 4, true, true, false);
    expect(applied).toBe(false);
    expect(p.timed[TMD.PARALYZED]).toBe(4);
  });

  it("honours incCheck when check is true, ignores it when false", () => {
    const p = player();
    const blocked = playerIncTimed(p, effect("CONFUSED"), 10, true, true, true, {
      incCheck: () => false,
    });
    expect(blocked).toBe(false);
    expect(p.timed[TMD.CONFUSED]).toBe(0);

    playerIncTimed(p, effect("CONFUSED"), 10, true, true, false, {
      incCheck: () => false,
    });
    expect(p.timed[TMD.CONFUSED]).toBe(10);
  });

  it("decrements, and always notifies when the effect finishes", () => {
    const p = player();
    p.timed[TMD.CONFUSED] = 10;
    const rec = recorder();
    playerDecTimed(p, effect("CONFUSED"), 4, false, true, rec);
    expect(p.timed[TMD.CONFUSED]).toBe(6);

    const rec2 = recorder();
    const notified = playerDecTimed(p, effect("CONFUSED"), 100, false, true, rec2);
    expect(p.timed[TMD.CONFUSED]).toBe(0);
    expect(notified).toBe(true); /* finishing forces notify */
    expect(rec2.messages).toContain("You are no longer confused.");
  });

  it("clears a timed effect", () => {
    const p = player();
    p.timed[TMD.CONFUSED] = 10;
    expect(playerClearTimed(p, effect("CONFUSED"), true, true)).toBe(true);
    expect(p.timed[TMD.CONFUSED]).toBe(0);
  });
});

describe("playerIncCheck", () => {
  it("PARALYZED is blocked by FREE_ACT (object flag)", () => {
    const q = {
      objectFlag: (n: string) => n === "FREE_ACT",
      resistLevel: () => 0,
      playerFlag: () => false,
      timedActive: () => false,
    };
    expect(playerIncCheck(effect("PARALYZED"), q)).toBe(false);
  });

  it("CONFUSED is blocked by PROT_CONF but otherwise allowed", () => {
    const allow = {
      objectFlag: () => false,
      resistLevel: () => 0,
      playerFlag: () => false,
      timedActive: () => false,
    };
    expect(playerIncCheck(effect("CONFUSED"), allow)).toBe(true);
    expect(
      playerIncCheck(effect("CONFUSED"), {
        ...allow,
        objectFlag: (n: string) => n === "PROT_CONF",
      }),
    ).toBe(false);
  });
});

describe("playerTimedGradeEq", () => {
  it("matches the active grade name", () => {
    const p = player();
    p.timed[TMD.STUN] = 100;
    expect(playerTimedGradeEq(p, effect("STUN"), "Heavy Stun")).toBe(true);
    expect(playerTimedGradeEq(p, effect("STUN"), "Stun")).toBe(false);
    p.timed[TMD.STUN] = 0;
    expect(playerTimedGradeEq(p, effect("STUN"), "Stun")).toBe(false);
  });
});
