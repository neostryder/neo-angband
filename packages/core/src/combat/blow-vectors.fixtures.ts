/**
 * The monster and player a blow vector is run against, built from the real
 * shipped content pack.
 *
 * SEPARATE FILE, and it reads the disk: this is the only part of the vector
 * machinery that needs node:fs, and keeping it out of `blow-vectors.ts` means
 * that module stays importable from anywhere. Nothing in the game imports
 * either one - they exist for `blow-vectors.test.ts` and for
 * `scripts/gen-blow-vectors.mjs`, which is why there is ONE copy of this rather
 * than one in the test and one in the script.
 *
 * The fixtures are built from `packages/content/pack`, not hand-written,
 * because a hand-written blow method would not carry the real message list and
 * the INSULT `randint0(8)` draw - the exact thing the vectors exist to pin.
 */

import { readFileSync } from "node:fs";
import { FlagSet } from "../bitflag.js";
import { Dice } from "../dice.js";
import { bindMonsters } from "../mon/bind.js";
import type { MonsterPackRecords } from "../mon/bind.js";
import { blankMonster } from "../mon/monster.js";
import type { Monster } from "../mon/monster.js";
import { RF_SIZE } from "../mon/types.js";
import type { MonsterBlow, MonsterRace } from "../mon/types.js";
import { bindPlayer } from "../player/bind.js";
import type { PlayerPackRecords } from "../player/bind.js";
import { blankPlayer } from "../player/player.js";
import type { Player } from "../player/player.js";
import type { BlowVectorFixtures } from "./blow-vectors.js";

function packJson<T>(name: string): T[] {
  const text = readFileSync(
    new URL(`../../../content/pack/${name}.json`, import.meta.url),
    "utf8",
  );
  return (JSON.parse(text) as { records: T[] }).records;
}

/** Bind the pack once; both consumers run the whole grid off this. */
export function blowVectorFixtures(): BlowVectorFixtures {
  const monReg = bindMonsters({
    pain: packJson("pain"),
    blowMethods: packJson("blow_methods"),
    blowEffects: packJson("blow_effects"),
    monsterSpells: packJson("monster_spell"),
    monsterBases: packJson("monster_base"),
    monsters: packJson("monster"),
    summons: packJson("summon"),
    pits: packJson("pit"),
  } as MonsterPackRecords);

  const plReg = bindPlayer({
    races: packJson("p_race"),
    classes: packJson("class"),
    properties: packJson("player_property"),
    timed: packJson("player_timed"),
    shapes: packJson("shape"),
    bodies: packJson("body"),
    history: packJson("history"),
    realms: packJson("realm"),
  } as PlayerPackRecords);

  const realRace = monReg.races.find((r) => r.base) as MonsterRace;

  return {
    makeMonster(effectName, methodName, diceStr, level): Monster {
      const method = monReg.blowMethods.get(methodName);
      const effect = monReg.blowEffects.get(effectName);
      if (!method || !effect) {
        throw new Error(`missing blow ${methodName}/${effectName}`);
      }
      const d = new Dice();
      d.parseString(diceStr);
      const blow: MonsterBlow = { method, effect, dice: d, diceRaw: diceStr };
      const race: MonsterRace = {
        ...realRace,
        level,
        flags: new FlagSet(RF_SIZE),
        blows: [blow],
      };
      const mon = blankMonster(race);
      mon.hp = 100;
      mon.maxhp = 100;
      return mon;
    },
    makePlayer(): Player {
      const p = blankPlayer(
        plReg.races[0] as (typeof plReg.races)[number],
        plReg.classes[0] as (typeof plReg.classes)[number],
        plReg.bodies[0] as (typeof plReg.bodies)[number],
      );
      p.lev = 1;
      p.chp = 100;
      p.mhp = 100;
      return p;
    },
  };
}
