/**
 * randart.log as a FILE, not as a set of format strings (PORT_TODO 5.5).
 *
 * The census test next door proves each C log line has a counterpart in the
 * source. That is a statement about text, and text can sit in a function
 * nothing calls. This one installs a host, runs the code, and reads what landed
 * in ANGBAND_DIR_USER - the "supplied is not read" guard a newly-added sink
 * most needs, because a sink with no producer type-checks, never throws, and
 * stays empty forever.
 */
import { describe, expect, it } from "vitest";

import { FileMode, HostDir, NULL_HOST } from "../host/io.js";
import type { HostIo, WriteOutcome } from "../host/io.js";
import { doRandart, RANDART_LOG } from "./randart.js";
import type { ObjRegistry } from "./bind.js";
import type { Constants } from "../constants.js";
import { randartLog, randartLogOpen, setRandartLog } from "./randart-log.js";

/** A HostIo whose USER directory is a Map, with an optional forced failure. */
function memHost(
  files: Map<string, string>,
  fail?: WriteOutcome,
): HostIo & { writes: { name: string; mode: number | undefined; len: number }[] } {
  const writes: { name: string; mode: number | undefined; len: number }[] = [];
  const io = {
    ...NULL_HOST,
    writes,
    displayPath: (dir: HostDir, name: string) => `${dir}/${name}`,
    exists: (dir: HostDir, name: string) => dir === HostDir.USER && files.has(name),
    read: (dir: HostDir, name: string) =>
      dir === HostDir.USER ? (files.get(name) ?? null) : null,
    write: (dir: HostDir, name: string, text: string, mode?: number) => {
      writes.push({ name, mode, len: text.length });
      if (fail) return fail;
      if (dir !== HostDir.USER) return "create-failed" as WriteOutcome;
      files.set(name, text);
      return "ok" as WriteOutcome;
    },
  };
  return io as unknown as HostIo & { writes: typeof writes };
}

/**
 * The smallest registry do_randart will run against: no artifacts, so
 * store_base_power and create_artifact_set both loop zero times. That is enough
 * to exercise the file lifecycle, which is what this file is about - the
 * content of a real run is the census test's and randart.test.ts's business.
 */
/** object_prep's constants; never reached, because the registry has no kinds. */
const NO_CONSTANTS = {} as unknown as Constants;

function emptyRegistry(): ObjRegistry {
  return {
    artifacts: [],
    brands: [],
    slays: [],
    curses: [],
    kinds: [],
    lookupKind: () => null,
  } as unknown as ObjRegistry;
}

describe("the randart log sink (obj-power.c's object_log / obj-randart.c's log_file)", () => {
  it("is closed by default, so pricing an item costs no formatting", () => {
    /* objectPower runs for every item the game values. An open-by-default sink
     * would build a string on every price lookup. */
    expect(randartLogOpen()).toBe(false);
    randartLog("this must go nowhere");
    expect(randartLogOpen()).toBe(false);
  });

  it("opens and closes", () => {
    const out: string[] = [];
    setRandartLog((t) => out.push(t));
    expect(randartLogOpen()).toBe(true);
    randartLog("a");
    randartLog("b");
    setRandartLog(null);
    randartLog("c");
    expect(out.join("")).toBe("ab");
    expect(randartLogOpen()).toBe(false);
  });
});

describe("do_randart's file lifecycle (obj-randart.c L3164-L3193)", () => {
  it("truncates randart.log on open and writes it on close", () => {
    const files = new Map<string, string>([[RANDART_LOG, "stale content"]]);
    const io = memHost(files);
    doRandart(emptyRegistry(), NO_CONSTANTS, 1, false, undefined, undefined, io);

    /* Two writes: file_open(MODE_WRITE) truncating, then the close. */
    expect(io.writes.map((w) => w.name)).toEqual([RANDART_LOG, RANDART_LOG]);
    expect(io.writes[0]!.len).toBe(0);
    expect(io.writes[0]!.mode).toBe(FileMode.WRITE);
    /* The stale content is gone whatever the run produced. */
    expect(files.get(RANDART_LOG)).not.toContain("stale");
  });

  it("leaves the sink CLOSED afterwards, so the next caller starts clean", () => {
    /* log_file is a static upstream. A run that left it installed would
     * narrate the following one into this one's buffer. */
    doRandart(emptyRegistry(), NO_CONSTANTS, 1, false, undefined, undefined, memHost(new Map()));
    expect(randartLogOpen()).toBe(false);
  });

  it("reports a failed open with upstream's message and generates anyway", () => {
    /* obj-randart.c L3167-L3171 exit(1)s here. The port cannot, so the message
     * goes to the caller and generation continues - the one deliberate
     * divergence in this row. */
    const errors: string[] = [];
    const io = memHost(new Map(), "create-failed");
    const arts = doRandart(emptyRegistry(), NO_CONSTANTS, 1, false, undefined, undefined, io, (m) =>
      errors.push(m),
    );
    expect(errors).toEqual(["Error - can't open randart.log for writing."]);
    expect(arts).toEqual([]);
    /* And it did not then try to write the body over a file it could not open. */
    expect(io.writes).toHaveLength(1);
    expect(randartLogOpen()).toBe(false);
  });

  it("reports a failed close separately", () => {
    /* file_close failing is a different message from file_open failing
     * (L3190-L3193), and the port keeps them apart because upstream does. */
    const errors: string[] = [];
    let call = 0;
    const files = new Map<string, string>();
    const base = memHost(files);
    const io: HostIo = {
      ...base,
      write: (dir, name, text, mode, ftype) =>
        ++call === 1 ? base.write(dir, name, text, mode, ftype) : "close-failed",
    };
    doRandart(emptyRegistry(), NO_CONSTANTS, 1, false, undefined, undefined, io, (m) => errors.push(m));
    expect(errors).toEqual(["Error - can't close randart.log file."]);
  });

  it("with no host installed it neither throws nor claims success", () => {
    /* NULL_HOST.write returns "create-failed" by design - a missing host is a
     * reported failure, not a silent one (host/io.ts). */
    const errors: string[] = [];
    doRandart(emptyRegistry(), NO_CONSTANTS, 1, false, undefined, undefined, NULL_HOST, (m) =>
      errors.push(m),
    );
    expect(errors).toEqual(["Error - can't open randart.log for writing."]);
  });
});
