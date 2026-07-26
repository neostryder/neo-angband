/**
 * Upstream unit tests from reference/src/tests/message/message.c
 * (suite message/message).
 *
 * Mapping:
 * - messages_init / messages_free → new MessageLog() (instantiable, no global)
 * - message_add / messages_num / message_str / message_count / message_type /
 *   message_color / message_color_define / message_type_color → MessageLog methods
 * - msg / msgt / sound / bell → Messages facade + GameEvents
 * - message_lookup_by_name → messageLookupByName (sound/engine.ts); C also
 *   accepts decimal numerals via strtoul — port name path only for names
 * - format (test_msg): C printf formatting is intentionally not ported;
 *   callers use template strings. This suite feeds the already-formatted
 *   expected strings into msg() so log/event behaviour still matches.
 * - sound_lookup (message_sound_name / message_lookup_by_sound_name) ->
 *   messageSoundName / messageLookupBySoundName (sound/engine.ts). Both were
 *   MISSING when this file was first written and the case was recorded BLOCKED;
 *   they were added 2026-07-26 (UT-zlib2) and the case is asserted below.
 *
 * Two upstream assertions initially failed against the port and were pinned
 * with it.fails() — UT-001 (the numeric lookup path) and UT-002 (the NULL bell
 * payload). Both are now FIXED in the port and asserted as plain it(); see
 * parity/phase3-2026-07-25/findings/W3-UNIT-TESTS-zlib-msg.md. A third,
 * UT-006, was found in the same pass: the name lookup compared with === where
 * the C uses my_stricmp, and is covered here too.
 */

import { describe, expect, it } from "vitest";
import {
  COLOUR_GREEN,
  COLOUR_L_BLUE,
  COLOUR_RED,
  COLOUR_VIOLET,
  COLOUR_WHITE,
} from "./color";
import { GameEvents } from "./events";
import { MSG } from "./generated/message";
import { MessageLog, Messages, MSG_GENERIC } from "./msg";
import {
  messageLookupByName,
  messageLookupBySoundName,
  messageSoundName,
} from "./sound/engine";

interface EventState {
  lastmsg: string | null;
  lastbell: string | null;
  lastmsgType: number;
  lastsoundType: number;
  nMsg: number;
  nSound: number;
  nBell: number;
  nOther: number;
  hadInvalidBell: boolean;
}

function freshState(): EventState {
  return {
    lastmsg: null,
    lastbell: null,
    lastmsgType: -1,
    lastsoundType: -1,
    nMsg: 0,
    nSound: 0,
    nBell: 0,
    nOther: 0,
    hadInvalidBell: false,
  };
}

function wireHandlers(events: GameEvents, st: EventState): void {
  events.on("message", (_t, data) => {
    st.nMsg++;
    st.lastmsg = data.msg;
    st.lastmsgType = data.type;
  });
  events.on("bell", (_t, data) => {
    st.nBell++;
    /*
     * C: lastbell = data->message.msg ? string_make(...) : NULL.
     * Port emits msg: "" for bell; empty string is truthy for length-0
     * content but C used a NULL pointer. Record null only for
     * null/undefined; keep "" so the upstream lastbell==NULL check fails
     * when the port sends an empty string.
     */
    st.lastbell =
      data.msg === null || data.msg === undefined ? null : data.msg;
    if (data.type !== MSG.BELL) st.hadInvalidBell = true;
  });
  events.on("sound", (_t, data) => {
    st.nSound++;
    st.lastsoundType = data.type;
  });
}

describe("message/message upstream", () => {
  // C: test_empty
  it("empty", () => {
    const log = new MessageLog();

    expect(log.num()).toBe(0);
    expect(log.str(0)).toBe("");
    expect(log.str(1)).toBe("");
    expect(log.count(0)).toBe(0);
    expect(log.count(2)).toBe(0);
    expect(log.type(0)).toBe(0);
    expect(log.type(3)).toBe(0);
    expect(log.color(0)).toBe(COLOUR_WHITE);
    expect(log.color(4)).toBe(COLOUR_WHITE);
  });

  // C: test_add
  it("add", () => {
    const m1 = "msg1";
    const t1 = MSG_GENERIC;
    const m2 = "msg2";
    const t2 = MSG.HIT;
    const log = new MessageLog();

    log.add(m1, t1);
    expect(log.num()).toBe(1);
    expect(log.count(0)).toBe(1);
    expect(log.str(0)).toBe(m1);
    expect(log.type(0)).toBe(t1);
    expect(log.count(1)).toBe(0);

    log.add(m2, t2);
    expect(log.num()).toBe(2);
    expect(log.count(0)).toBe(1);
    expect(log.str(0)).toBe(m2);
    expect(log.type(0)).toBe(t2);
    expect(log.count(1)).toBe(1);
    expect(log.str(1)).toBe(m1);
    expect(log.type(1)).toBe(t1);
    expect(log.count(2)).toBe(0);

    /*
     * Adding a duplicate message should only increase the count of the
     * most recent one and have no other effect.
     */
    log.add(m2, t2);
    expect(log.num()).toBe(2);
    expect(log.count(0)).toBe(2);
    expect(log.str(0)).toBe(m2);
    expect(log.type(0)).toBe(t2);
    expect(log.count(1)).toBe(1);
    expect(log.str(1)).toBe(m1);
    expect(log.type(1)).toBe(t1);
    expect(log.count(2)).toBe(0);

    /*
     * If the string is a duplicate but the type is different, it should
     * not stack.
     */
    log.add(m2, t1);
    expect(log.num()).toBe(3);
    expect(log.count(0)).toBe(1);
    expect(log.str(0)).toBe(m2);
    expect(log.type(0)).toBe(t1);
    expect(log.count(1)).toBe(2);
    expect(log.str(1)).toBe(m2);
    expect(log.type(1)).toBe(t2);
    expect(log.count(2)).toBe(1);
    expect(log.str(2)).toBe(m1);
    expect(log.type(2)).toBe(t1);
    expect(log.count(3)).toBe(0);

    /*
     * If the type is the same but the string is different, it also should
     * not stack.
     */
    log.add(m1, t1);
    expect(log.num()).toBe(4);
    expect(log.count(0)).toBe(1);
    expect(log.str(0)).toBe(m1);
    expect(log.type(0)).toBe(t1);
    expect(log.count(1)).toBe(1);
    expect(log.str(1)).toBe(m2);
    expect(log.type(1)).toBe(t1);
    expect(log.count(2)).toBe(2);
    expect(log.str(2)).toBe(m2);
    expect(log.type(2)).toBe(t2);
    expect(log.count(3)).toBe(1);
    expect(log.str(3)).toBe(m1);
    expect(log.type(3)).toBe(t1);
    expect(log.count(4)).toBe(0);
  });

  // C: test_fill
  it("fill", () => {
    const log = new MessageLog();
    let i = 0;

    /*
     * Keep adding messages till it fills up. Verify that the oldest
     * message is lost.
     */
    while (true) {
      expect(i).toBeLessThan(1 << 16);
      const buf = String(i);
      log.add(buf, MSG_GENERIC);
      i++;
      const n = log.num();
      if (i !== n) {
        expect(i).toBe(n + 1);
        for (let j = 0; j < n; j++) {
          expect(log.count(j)).toBe(1);
          expect(log.str(j)).toBe(String(i - 1 - j));
        }

        /* Test adding one more. */
        log.add("msg", MSG_GENERIC);
        expect(log.num()).toBe(n);
        expect(log.count(0)).toBe(1);
        expect(log.str(0)).toBe("msg");
        expect(log.count(n - 1)).toBe(1);
        expect(log.str(n - 1)).toBe("2");
        break;
      }
    }
  });

  // C: test_many_repeat
  it("many_repeat", () => {
    const log = new MessageLog();
    let i = 0;

    /*
     * Keep repeating the same message until it can't stack them any more.
     */
    while (true) {
      expect(i).toBeLessThan(1 << 16);
      log.add("msg", MSG_GENERIC);
      i++;
      const n = log.num();
      if (n !== 1) {
        expect(n).toBe(2);
        expect(log.count(0)).toBe(1);
        expect(log.str(0)).toBe("msg");
        expect(log.type(0)).toBe(MSG_GENERIC);
        expect(log.count(1)).toBe(i - 1);
        expect(log.str(1)).toBe("msg");
        expect(log.type(1)).toBe(MSG_GENERIC);
        break;
      }
      expect(log.count(0)).toBe(i);
      expect(log.str(0)).toBe("msg");
      expect(log.type(0)).toBe(MSG_GENERIC);
    }
  });

  // C: test_color
  it("color", () => {
    const log = new MessageLog();

    expect(log.typeColor(MSG.HIT)).toBe(COLOUR_WHITE);

    log.colorDefine(MSG.HIT, COLOUR_RED);
    expect(log.typeColor(MSG.HIT)).toBe(COLOUR_RED);

    log.colorDefine(MSG.MISS, COLOUR_GREEN);
    expect(log.typeColor(MSG.MISS)).toBe(COLOUR_GREEN);

    log.add("msg0", MSG.MISS);
    expect(log.color(0)).toBe(COLOUR_GREEN);

    log.add("msg1", MSG.HIT);
    expect(log.color(0)).toBe(COLOUR_RED);
    expect(log.color(1)).toBe(COLOUR_GREEN);

    log.add("msg2", MSG_GENERIC);
    expect(log.color(0)).toBe(COLOUR_WHITE);
    expect(log.color(1)).toBe(COLOUR_RED);
    expect(log.color(2)).toBe(COLOUR_GREEN);

    log.colorDefine(MSG.HIT, COLOUR_L_BLUE);
    expect(log.color(0)).toBe(COLOUR_WHITE);
    expect(log.color(1)).toBe(COLOUR_L_BLUE);
    expect(log.color(2)).toBe(COLOUR_GREEN);

    log.colorDefine(MSG.MISS, COLOUR_VIOLET);
    expect(log.color(0)).toBe(COLOUR_WHITE);
    expect(log.color(1)).toBe(COLOUR_L_BLUE);
    expect(log.color(2)).toBe(COLOUR_VIOLET);
  });

  // C: test_msg (format) — printf path dropped; pre-formatted strings used.
  it("format", () => {
    const expected1 = "%   abcde   1  +2  3 4  ";
    const expected2 = "ab      -7";
    const events = new GameEvents();
    const st = freshState();
    wireHandlers(events, st);
    const log = new MessageLog();
    const m = new Messages(log, events, () => false);

    m.msg(expected1);
    expect(log.num()).toBe(1);
    expect(log.count(0)).toBe(1);
    expect(log.str(0)).toBe(expected1);
    expect(log.type(0)).toBe(MSG_GENERIC);
    expect(st.lastmsg).toBe(expected1);
    expect(st.lastmsgType).toBe(MSG_GENERIC);
    expect(st.nMsg).toBe(1);
    expect(st.nSound).toBe(0);
    expect(st.nBell).toBe(0);
    expect(st.nOther).toBe(0);

    m.msg(expected2);
    expect(log.num()).toBe(2);
    expect(log.count(0)).toBe(1);
    expect(log.str(0)).toBe(expected2);
    expect(log.type(0)).toBe(MSG_GENERIC);
    expect(st.lastmsg).toBe(expected2);
    expect(st.lastmsgType).toBe(MSG_GENERIC);
    expect(st.nMsg).toBe(2);
    expect(st.nSound).toBe(0);
    expect(st.nBell).toBe(0);
    expect(st.nOther).toBe(0);
  });

  // C: test_sound
  it("sound", () => {
    const events = new GameEvents();
    const st = freshState();
    wireHandlers(events, st);
    let soundOn = false;
    const m = new Messages(new MessageLog(), events, () => soundOn);

    soundOn = false;
    m.sound(MSG.HIT);
    expect(st.nMsg).toBe(0);
    expect(st.nSound).toBe(0);
    expect(st.nBell).toBe(0);
    expect(st.nOther).toBe(0);

    soundOn = true;
    m.sound(MSG.MISS);
    expect(st.nMsg).toBe(0);
    expect(st.nSound).toBe(1);
    expect(st.nBell).toBe(0);
    expect(st.nOther).toBe(0);
  });

  // C: test_bell
  it("bell", () => {
    const events = new GameEvents();
    const st = freshState();
    wireHandlers(events, st);
    const log = new MessageLog();
    const m = new Messages(log, events, () => false);

    m.bell();
    expect(log.num()).toBe(0);
    expect(log.count(0)).toBe(0);
    expect(log.str(0)).toBe("");
    expect(st.nMsg).toBe(0);
    expect(st.nSound).toBe(0);
    expect(st.nBell).toBe(1);
    expect(st.nOther).toBe(0);
    expect(st.hadInvalidBell).toBe(false);
    /* The remaining upstream assertion (lastbell == NULL) is UT-002 below. */
  });

  /*
   * UT-002 — FIXED in the port; kept as the guard.
   *
   * reference/src/message.c:381 rings the bell with a NULL message pointer:
   *   event_signal_message(EVENT_BELL, MSG_BELL, NULL);
   * so reference/src/tests/message/message.c:443 requires
   * `st->lastbell == NULL` (the C handler only string_make()s a non-NULL
   * data->message.msg). The port's MessageEventData.msg is a non-nullable
   * string and materialised it as "", so the handler recorded "" and the
   * upstream assertion could not hold.
   *
   * MessageEventData.msg is now `string | null`, and both NULL-carrying signals
   * send null: bell (message.c:381) and sound (:374). "" and NULL are not
   * interchangeable here -- a front end has to be able to tell "no message
   * accompanies this signal" from "an empty message".
   */
  it("bell:  EVENT_BELL carries a NULL message [UT-002]", () => {
    const events = new GameEvents();
    const st = freshState();
    wireHandlers(events, st);
    const log = new MessageLog();
    const m = new Messages(log, events, () => false);

    m.bell();
    expect(st.nBell).toBe(1);
    /* Upstream event_signal_message(..., NULL) → lastbell stays NULL. */
    expect(st.lastbell).toBeNull();
  });

  // C: test_msgt
  it("msgt", () => {
    const expected1 = "msg1";
    const expected2 = "msg2";
    const events = new GameEvents();
    const st = freshState();
    wireHandlers(events, st);
    let soundOn = false;
    const log = new MessageLog();
    const m = new Messages(log, events, () => soundOn);

    soundOn = false;
    m.msgt(MSG.HIT, expected1);
    expect(log.num()).toBe(1);
    expect(log.count(0)).toBe(1);
    expect(log.str(0)).toBe(expected1);
    expect(log.type(0)).toBe(MSG.HIT);
    expect(st.lastmsg).toBe(expected1);
    expect(st.lastmsgType).toBe(MSG.HIT);
    expect(st.nMsg).toBe(1);
    expect(st.nSound).toBe(0);
    expect(st.nBell).toBe(0);
    expect(st.nOther).toBe(0);

    soundOn = true;
    m.msgt(MSG.WALK, expected2);
    expect(log.num()).toBe(2);
    expect(log.count(0)).toBe(1);
    expect(log.str(0)).toBe(expected2);
    expect(log.type(0)).toBe(MSG.WALK);
    expect(st.lastmsg).toBe(expected2);
    expect(st.lastmsgType).toBe(MSG.WALK);
    expect(st.lastsoundType).toBe(MSG.WALK);
    expect(st.nMsg).toBe(2);
    expect(st.nSound).toBe(1);
    expect(st.nBell).toBe(0);
    expect(st.nOther).toBe(0);
  });

  // C: test_lookup
  it("lookup", () => {
    /* Test by name. */
    expect(messageLookupByName("GENERIC")).toBe(MSG.GENERIC);
    expect(messageLookupByName("DEATH")).toBe(MSG.DEATH);
    expect(messageLookupByName("MAX")).toBe(MSG.MAX);

    /* The printed-number block is UT-001 below. */

    /* Test failed lookups. NOTE: the last two currently pass VACUOUSLY —
     * the port rejects every numeral, not just the out-of-range ones. */
    expect(messageLookupByName("")).toBe(-1);
    expect(messageLookupByName("kskl8bktk2b")).toBe(-1);
    expect(messageLookupByName("-3")).toBe(-1);
    expect(messageLookupByName(String(MSG.MAX))).toBe(-1);
    expect(messageLookupByName(String(MSG.MAX + 1))).toBe(-1);
  });

  /*
   * UT-001 — FIXED in the port; kept as the guard.
   *
   * reference/src/message.c:304-309 runs strtoul over the name FIRST:
   *   unsigned long number = strtoul(name, &pe, 10);
   *   if (pe != name) return (contains_only_spaces(pe) && number < MSG_MAX) ?
   *           (int)number : -1;
   * so the decimal form of a MSG_ index resolves to that index, which
   * reference/src/tests/message/message.c:521-526 asserts for every index from
   * MSG_GENERIC to MSG_MAX-1. The port only walked MESSAGE_ENTRIES by name, so
   * every numeral returned -1.
   */
  it("lookup:  by printed number, the C strtoul path [UT-001]", () => {
    /* Test by printed number (C strtoul path). */
    for (let i = MSG.GENERIC; i < MSG.MAX; i++) {
      expect(messageLookupByName(String(i))).toBe(i);
    }
  });

  /*
   * UT-006 — found and FIXED in the same pass, and not covered by any upstream
   * test, which only ever probes canonical spellings.
   *
   * message.c:312 compares with my_stricmp, i.e. case-INSENSITIVELY; the port
   * used ===. The C reaches message_lookup_by_name from every `msgt:` directive
   * in gamedata (init.c, mon-init.c, mon-summon.c, obj-init.c,
   * player-timed.c), where the spelling is whatever a data file happens to use,
   * so the case-folding is load-bearing rather than cosmetic.
   */
  it("lookup:  the name comparison is case-insensitive [UT-006]", () => {
    expect(messageLookupByName("generic")).toBe(MSG.GENERIC);
    expect(messageLookupByName("GeNeRiC")).toBe(MSG.GENERIC);
    expect(messageLookupByName("death")).toBe(MSG.DEATH);
    /* Still no match for a name that does not exist in any case. */
    expect(messageLookupByName("kskl8bktk2b")).toBe(-1);
  });

  /*
   * The numeric path's edge cases, which the fix has to get right for the
   * upstream failure assertions at tests/message/message.c:529-536 to hold:
   * a trailing remainder is allowed only if it is spaces or tabs
   * (contains_only_spaces, z-util.c:801-806), and a negative literal wraps
   * through unsigned long to a value far above MSG_MAX.
   */
  it("lookup:  numeric edge cases (blank tail, sign, overflow)", () => {
    expect(messageLookupByName(" 3 ")).toBe(3);
    expect(messageLookupByName("3\t")).toBe(3);
    expect(messageLookupByName("3x")).toBe(-1);
    expect(messageLookupByName("-3")).toBe(-1);
    expect(messageLookupByName("99999999999999999999")).toBe(-1);
    /* Nothing numeric consumed -> falls through to the name table. */
    expect(messageLookupByName("")).toBe(-1);
  });

  /*
   * C: test_sound_lookup — previously recorded BLOCKED here because the port had
   * no counterpart to message_sound_name / message_lookup_by_sound_name; only
   * the underlying table (MESSAGE_ENTRIES[i].sound) existed. Both are now real
   * functions in sound/engine.ts, so the case ports directly.
   *
   * Upstream has no caller for either function outside its own test, but the
   * table they read is the same one sound.prf is keyed by, and the case pins two
   * warts worth keeping: the relationship is NOT one-to-one (MSG_GENERIC and
   * MSG_BIRTH share the empty sound name, and the lower index wins), and a
   * failed lookup answers MSG_GENERIC rather than -1.
   */
  it("test_sound_lookup", () => {
    for (let i = MSG.GENERIC; i < MSG.MAX; i++) {
      const name = messageSoundName(i);
      expect(name).not.toBeNull();
      const j = messageLookupBySoundName(name as string);
      if (j !== i) {
        /*
         * Not guaranteed to be one-to-one, but the names must still agree.
         */
        expect(messageSoundName(j)).toBe(name);
      }
    }

    /* Check for lookups that should fail. */
    expect(messageLookupBySoundName("ahvkaugowhbnsk")).toBe(MSG.GENERIC);
    expect(messageSoundName(MSG.GENERIC - 1)).toBeNull();
    expect(messageSoundName(MSG.MAX + 1)).toBeNull();
    /* MSG_MAX itself is out of range too (the C tests `>= MSG_MAX`). */
    expect(messageSoundName(MSG.MAX)).toBeNull();
  });

  /*
   * The empty-name collision the loop above only reaches by accident, asserted
   * head-on: MSG_BIRTH's sound name is "" and resolves back to MSG_GENERIC.
   */
  it("sound_lookup:  the empty sound name is shared and resolves to GENERIC", () => {
    expect(messageSoundName(MSG.GENERIC)).toBe("");
    expect(messageSoundName(MSG.BIRTH)).toBe("");
    expect(messageLookupBySoundName("")).toBe(MSG.GENERIC);
    /* And a real name round-trips exactly, case-insensitively. */
    expect(messageSoundName(MSG.HIT)).toBe("hit");
    expect(messageLookupBySoundName("hit")).toBe(MSG.HIT);
    expect(messageLookupBySoundName("HiT")).toBe(MSG.HIT);
  });
});
