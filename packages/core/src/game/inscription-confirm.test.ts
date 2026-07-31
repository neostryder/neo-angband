/**
 * The `!` / `^` inscription safety net (key_confirm_command, ui-input.c:1995;
 * get_item_allow, ui-object.c:634). Neither existed in the port before; the text
 * census saw only "Are you sure? " because get_item_allow's prompt is assembled
 * from fragments below the anchor floor.
 */

import { describe, expect, it } from "vitest";
import {
  ITEM_ALLOW_FALLBACK_VERB,
  KEY_CONFIRM_PROMPT,
  itemAllowPrompt,
  keyConfirmCount,
  unKtrlCap,
} from "./inscription-confirm.js";
import type { GameObject } from "../obj/object.js";
import type { Gear } from "./gear.js";
import type { Player } from "../player/player.js";

/* check_for_inscrip reads only obj.note (game/pickup.ts:104), and neither
 * function under test touches anything else, so a note-only stand-in is the
 * whole object these need. */
function inscribed(note: string): GameObject {
  return { note } as unknown as GameObject;
}

/** A player wearing exactly the given objects, one per body slot. */
function wearing(...worn: (GameObject | null)[]): { player: Player; gear: Gear } {
  const store = new Map<number, GameObject>();
  const equipment: number[] = [];
  worn.forEach((obj, i) => {
    if (!obj) {
      equipment[i] = 0;
      return;
    }
    const handle = i + 1;
    store.set(handle, obj);
    equipment[i] = handle;
  });
  const gear = { store, next: worn.length + 1, pack: [], quiver: [] } as unknown as Gear;
  const player = {
    body: { count: worn.length, slots: worn.map(() => ({ type: "WEAPON", name: "weapon" })) },
    equipment,
  } as unknown as Player;
  return { player, gear };
}

describe("key_confirm_command (ui-input.c:1995-2020)", () => {
  it("asks nothing for uninscribed equipment", () => {
    const { player, gear } = wearing(inscribed(""), null, inscribed("of Doom"));
    expect(keyConfirmCount(player, gear, "T")).toBe(0);
  });

  it("asks once per ^<key> on a worn item", () => {
    const { player, gear } = wearing(inscribed("^T"));
    expect(keyConfirmCount(player, gear, "T")).toBe(1);
    /* A different command key is unaffected - that is the point of ^<key>. */
    expect(keyConfirmCount(player, gear, "w")).toBe(0);
  });

  it("honours the blanket ^* for every key", () => {
    const { player, gear } = wearing(inscribed("^*"));
    for (const key of ["T", "w", "q", "R"]) {
      expect(keyConfirmCount(player, gear, key)).toBe(1);
    }
  });

  it("sums across slots and across repeats, since each occurrence asks again", () => {
    const { player, gear } = wearing(inscribed("^T^T"), inscribed("^*"), null);
    expect(keyConfirmCount(player, gear, "T")).toBe(3);
  });

  it("counts ^* DOUBLE for the key '*', exactly as the C's buffer reuse does", () => {
    /* verify_inscrip is the literal "^*" with only [1] overwritten, so for '*'
     * both terms of upstream's sum count the same inscription. An upstream wart,
     * kept deliberately. */
    const { player, gear } = wearing(inscribed("^*"));
    expect(keyConfirmCount(player, gear, "*")).toBe(2);
  });

  it("does NOT shift a control key to its capital (get_item_allow does; this does not)", () => {
    /* ui-input.c has no UN_KTRL_CAP call, so a Ctrl-chord looks for "^" plus a
     * control byte and finds nothing. Tidying this would make ^D fire on the
     * roguelike Ctrl-D ignore, which upstream avoids in the OTHER function. */
    const { player, gear } = wearing(inscribed("^D"));
    expect(keyConfirmCount(player, gear, "")).toBe(0);
    expect(keyConfirmCount(player, gear, "D")).toBe(1);
  });

  it("keeps the prompt verbatim", () => {
    expect(KEY_CONFIRM_PROMPT).toBe("Are you sure? ");
  });
});

describe("get_item_allow (ui-object.c:634-679)", () => {
  const name = (o: GameObject): string => (o.note ? `a Potion {${o.note}}` : "a Potion");

  it("is null when the object asks for nothing", () => {
    expect(itemAllowPrompt(inscribed("@q1"), "q", "quaff", false, name)).toBeNull();
  });

  it("asks once per !<key>, with the command's verb", () => {
    const got = itemAllowPrompt(inscribed("!q"), "q", "quaff", false, name);
    expect(got).toEqual({ prompt: "Really quaff a Potion {!q}? ", count: 1 });
  });

  it("adds !* only when the command is not harmless", () => {
    const obj = inscribed("!*");
    expect(itemAllowPrompt(obj, "q", "quaff", false, name)?.count).toBe(1);
    /* IS_HARMLESS (inspecting, for instance) ignores a blanket !* ... */
    expect(itemAllowPrompt(obj, "q", "quaff", true, name)).toBeNull();
    /* ... but still honours the command's own !<key>. */
    expect(itemAllowPrompt(inscribed("!q"), "q", "quaff", true, name)?.count).toBe(1);
  });

  it("stacks !<key> and !* on one object", () => {
    const got = itemAllowPrompt(inscribed("!q!*"), "q", "quaff", false, name);
    expect(got?.count).toBe(2);
  });

  it("falls back to 'do that with' when the command has no verb", () => {
    const got = itemAllowPrompt(inscribed("!q"), "q", null, false, name);
    expect(got?.prompt).toBe(`Really ${ITEM_ALLOW_FALLBACK_VERB} a Potion {!q}? `);
  });

  it("shifts a control key to its CAPITAL (UN_KTRL_CAP, not UN_KTRL)", () => {
    /* ui-object.c:642-647's Hack: the roguelike ignore is Ctrl-D, and UN_KTRL
     * would give 'd' - the drop command in both keysets - so !d would fire on an
     * ignore. UN_KTRL_CAP gives 'D' instead. */
    expect(unKtrlCap("")).toBe("D");
    expect(unKtrlCap("d")).toBe("d");
    expect(itemAllowPrompt(inscribed("!D"), "", null, false, name)?.count).toBe(1);
    expect(itemAllowPrompt(inscribed("!d"), "", null, false, name)).toBeNull();
  });
});
