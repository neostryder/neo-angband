/**
 * THE RATCHET on highscore_write (score.c L98-198).
 *
 * Census block E, host-io. The store used to be `try { setItem } catch {}` with
 * the comment "scores are a nicety, never fatal", which meant upstream's eight
 * write-failure messages had nothing to fire from and a quota-exceeded write
 * silently threw away a dead character's only record. Aaron, 2026-07-27, on the
 * host-io block: "Must not deviate from upstream - port the equivalents, do not
 * excuse."
 *
 * Every message below is driven by making the corresponding storage operation
 * fail, which is the only way to prove the branch is reachable rather than
 * merely present (see the memory note on strings that hide behaviour).
 */

import { describe, expect, it } from "vitest";
import { createLocalStorageScoreStore } from "./score";
import type { ScoreStorage } from "./score";
import type { HighScore } from "@neo-angband/core";

const KEY = "t-scores";
const CUR = KEY;
const NEW = `${KEY}.new`;
const OLD = `${KEY}.old`;
const LOK = `${KEY}.lok`;

/** A record just complete enough to survive highscore_regularize. */
function score(pts: number, who = "Tester"): HighScore {
  return {
    what: "4.2.6",
    pts,
    gold: 100,
    turns: 500,
    day: "@20260728",
    who,
    uid: 0,
    pRace: 0,
    pClass: 0,
    curLev: 5,
    curDun: 3,
    maxLev: 5,
    maxDun: 3,
    how: "a white jelly",
  };
}

interface Fake extends ScoreStorage {
  data: Map<string, string>;
  /** Keys whose setItem throws (quota). */
  failWrite: Set<string>;
  /** Keys whose removeItem is a silent no-op (file_delete returning false). */
  failDelete: Set<string>;
  /** Keys whose stored value comes back different (a truncated flush). */
  truncate: Set<string>;
}

function fakeStorage(seed: Record<string, string> = {}): Fake {
  const data = new Map(Object.entries(seed));
  const failWrite = new Set<string>();
  const failDelete = new Set<string>();
  const truncate = new Set<string>();
  return {
    data,
    failWrite,
    failDelete,
    truncate,
    getItem(k) {
      const v = data.get(k);
      if (v === undefined) return null;
      return truncate.has(k) ? v.slice(0, Math.max(0, v.length - 1)) : v;
    },
    setItem(k, v) {
      if (failWrite.has(k)) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem(k) {
      if (failDelete.has(k)) return; /* still there afterwards */
      data.delete(k);
    },
  };
}

function make(storage: ScoreStorage): { msgs: string[]; store: ReturnType<typeof createLocalStorageScoreStore> } {
  const msgs: string[] = [];
  const store = createLocalStorageScoreStore(KEY, {
    storage,
    msg: (t) => msgs.push(t),
  });
  return { msgs, store };
}

describe("highscore_write, ported (score.c L98-198)", () => {
  it("writes through scores.new and rotates the old table into place", () => {
    const fs = fakeStorage({ [CUR]: JSON.stringify([score(10)]) });
    const { msgs, store } = make(fs);

    store.write([score(20), score(10)]);

    expect(msgs).toEqual([]);
    /* The live table holds the new list... */
    expect(store.read().map((s) => s.pts)).toEqual([20, 10]);
    /* ...the previous one was rotated to scores.old (L184)... */
    expect(JSON.parse(fs.data.get(OLD) ?? "null")).toEqual([score(10)]);
    /* ...and neither the staged file nor the lock is left behind. */
    expect(fs.data.has(NEW)).toBe(false);
    expect(fs.data.has(LOK)).toBe(false);
  });

  it("refuses to write while another tab holds the lock (L123-128)", () => {
    const fs = fakeStorage({ [LOK]: "neo-angband", [CUR]: JSON.stringify([score(10)]) });
    const { msgs, store } = make(fs);

    store.write([score(99)]);

    expect(msgs).toEqual(["Lock file in place for scorefile; not writing."]);
    /* The other tab's table is untouched, and its lock is NOT stolen. */
    expect(store.read().map((s) => s.pts)).toEqual([10]);
    expect(fs.data.get(LOK)).toBe("neo-angband");
  });

  it("reports a lock it cannot create (L132-135)", () => {
    const fs = fakeStorage();
    fs.failWrite.add(LOK);
    const { msgs, store } = make(fs);

    store.write([score(20)]);

    expect(msgs).toEqual(["Failed to create lock for scorefile; not writing."]);
    expect(fs.data.has(CUR)).toBe(false);
  });

  it("reports a staged file it cannot open, and drops the lock (L146-153)", () => {
    const fs = fakeStorage();
    fs.failWrite.add(NEW);
    const { msgs, store } = make(fs);

    store.write([score(20)]);

    expect(msgs).toEqual(["Failed to open new scorefile for writing."]);
    expect(fs.data.has(LOK)).toBe(false);
  });

  it("reports a truncated flush - the failure the empty catch used to hide (L168-175)", () => {
    /* setItem succeeds and the value comes back short: the read-back is
     * file_close's flush check, and without it this write looks like a win. */
    const fs = fakeStorage({ [CUR]: JSON.stringify([score(10)]) });
    fs.truncate.add(NEW);
    const { msgs, store } = make(fs);

    store.write([score(20), score(10)]);

    expect(msgs).toEqual(["Failed to close new scores."]);
    /* The live table still holds the OLD list - nothing was clobbered. */
    expect(store.read().map((s) => s.pts)).toEqual([10]);
    expect(fs.data.has(NEW)).toBe(false);
    expect(fs.data.has(LOK)).toBe(false);
  });

  it("reports an old scorefile it cannot delete (L181-183)", () => {
    const fs = fakeStorage({
      [CUR]: JSON.stringify([score(10)]),
      [OLD]: JSON.stringify([score(5)]),
    });
    fs.failDelete.add(OLD);
    const { msgs, store } = make(fs);

    store.write([score(20), score(10)]);

    expect(msgs).toEqual(["Couldn't delete old scorefile"]);
    expect(store.read().map((s) => s.pts)).toEqual([10]);
    expect(fs.data.has(NEW)).toBe(false);
    expect(fs.data.has(LOK)).toBe(false);
  });

  it("reports a live table it cannot move aside (L184-186)", () => {
    const fs = fakeStorage({ [CUR]: JSON.stringify([score(10)]) });
    fs.failWrite.add(OLD);
    const { msgs, store } = make(fs);

    store.write([score(20), score(10)]);

    expect(msgs).toEqual(["Couldn't move old scores.raw out of the way"]);
    expect(store.read().map((s) => s.pts)).toEqual([10]);
    expect(fs.data.has(NEW)).toBe(false);
  });

  it("rolls the old table back when the rename fails (L187-190)", () => {
    const fs = fakeStorage({ [CUR]: JSON.stringify([score(10)]) });
    /* CUR moves to OLD, then the rename NEW -> CUR cannot write CUR. */
    const { msgs, store } = make(fs);
    let armed = false;
    let refused = 0;
    const guard: ScoreStorage = {
      getItem: (k) => fs.getItem(k),
      setItem: (k, v) => {
        /* Fail the rename ONCE: the rollback must then be able to put the old
         * table back, which is the branch under test (L189). */
        if (k === CUR && armed && refused++ === 0) {
          throw new Error("QuotaExceededError");
        }
        if (k === OLD) armed = true; /* the rotation just happened */
        fs.setItem(k, v);
      },
      removeItem: (k) => {
        fs.removeItem(k);
      },
    };
    const guarded = createLocalStorageScoreStore(KEY, {
      storage: guard,
      msg: (t) => msgs.push(t),
    });

    guarded.write([score(20), score(10)]);

    expect(msgs).toEqual(["Couldn't rename new scorefile to scores.raw"]);
    /* The rollback (file_move(old_name, cur_name)) restored the old table. */
    expect(store.read().map((s) => s.pts)).toEqual([10]);
    expect(fs.data.has(NEW)).toBe(false);
    expect(fs.data.has(LOK)).toBe(false);
  });

  it("survives storage being unavailable entirely (private mode)", () => {
    const dead: ScoreStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    const { msgs, store } = make(dead);
    expect(store.read()).toEqual([]);
    store.write([score(20)]);
    /* It reports rather than throwing; the death screen still comes up. */
    expect(msgs).toEqual(["Failed to create lock for scorefile; not writing."]);
  });

  it("read() regularizes a corrupt blob instead of throwing (highscore_read L63)", () => {
    for (const raw of ["not json", '{"a":1}', "[null]", ""]) {
      const fs = fakeStorage({ [CUR]: raw });
      const { store } = make(fs);
      expect(store.read()).toEqual([]);
    }
  });
});
