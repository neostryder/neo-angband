import { describe, expect, it } from "vitest";
import {
  BORG_CONFIRM,
  BORG_CONFIRM_MSG_1,
  BORG_CONFIRM_MSG_2,
  NOSCORE_BORG,
  borgActivate,
} from "./activate";
import type { BorgActivateHost } from "./activate";

/** A host that records what it was told and answers the prompt as directed. */
function host(
  answer: boolean,
  noscore = 0,
): BorgActivateHost & {
  msgs: string[];
  prompts: string[];
  marked: boolean;
  flushed: number;
} {
  const rec = {
    noscore,
    msgs: [] as string[],
    prompts: [] as string[],
    marked: false,
    flushed: 0,
    msg(text: string): void {
      rec.msgs.push(text);
    },
    confirm(prompt: string): boolean {
      rec.prompts.push(prompt);
      return answer;
    },
    flush(): void {
      rec.flushed += 1;
    },
    setNoscoreBorg(): void {
      rec.marked = true;
      rec.noscore |= NOSCORE_BORG;
    },
  };
  return rec;
}

describe("do_cmd_try_borg (cmd-misc.c:118-145)", () => {
  it("warns, confirms, and marks the savefile on acceptance", async () => {
    const h = host(true);
    expect(await borgActivate(h)).toBe(true);
    expect(h.msgs).toEqual([BORG_CONFIRM_MSG_1, BORG_CONFIRM_MSG_2]);
    expect(h.prompts).toEqual([BORG_CONFIRM]);
    /* The flag is what makes the character unscoreable - this is the whole
     * reason the gate matters, not just the wording. */
    expect(h.marked).toBe(true);
    expect(h.noscore & NOSCORE_BORG).toBe(NOSCORE_BORG);
  });

  it("flushes the warnings before the prompt blocks on them (:133)", async () => {
    const h = host(true);
    await borgActivate(h);
    expect(h.flushed).toBe(1);
  });

  it("refuses and leaves noscore alone when the player declines", async () => {
    const h = host(false);
    expect(await borgActivate(h)).toBe(false);
    expect(h.marked).toBe(false);
    expect(h.noscore).toBe(0);
  });

  it("asks again after a decline (the flag was not set)", async () => {
    const h = host(false);
    await borgActivate(h);
    await borgActivate(h);
    expect(h.prompts).toHaveLength(2);
  });

  it("asks only ONCE per character - a marked savefile passes silently", async () => {
    const h = host(true, NOSCORE_BORG);
    expect(await borgActivate(h)).toBe(true);
    expect(h.msgs).toEqual([]);
    expect(h.prompts).toEqual([]);
  });

  it("accepts an async confirm (the web shell's get_check is a promise)", async () => {
    const h = host(true);
    const asyncHost: BorgActivateHost = {
      ...h,
      confirm: (prompt: string) => Promise.resolve(h.confirm(prompt)),
    };
    expect(await borgActivate(asyncHost)).toBe(true);
  });
});
