import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityError, CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import { modPluginContext } from "./mod-context";
import {
  resetSharedValues,
  retireSharedValues,
  setSharedValueFaultReporter,
  SHARED_VALUE_MAX_BYTES,
} from "./mod-shared-values";
import { resetModTeardown, teardownModPlugins } from "./mod-teardown";

function ctx(id: string, caps: string[]) {
  return modPluginContext(id, {}, undefined, {}, {
    capabilities: CapabilitySet.fromManifest({ id, name: id, version: "1.0.0", shape: "plugin", capabilities: caps } as never),
  });
}

const publisher = () => ctx("squire", ["shared:publish"]).shared!;
const reader = () => ctx("anybandui", ["shared:read"]).shared!;

beforeEach(() => resetSharedValues());
afterEach(() => {
  resetSharedValues();
  setSharedValueFaultReporter(undefined);
});

describe("ctx.shared across two mods", () => {
  it("hands a reader what the publisher published, under the publisher's id", () => {
    publisher().publish("run-summary", 2, { cause: "Grip, Farmer Maggot's Dog", depth: 1 });
    expect(reader().read("squire", "run-summary")).toEqual({
      mod: "squire",
      name: "run-summary",
      version: 2,
      value: { cause: "Grip, Farmer Maggot's Dog", depth: 1 },
    });
  });

  it("does not depend on which mod loaded first", () => {
    const early = reader();
    publisher().publish("run-summary", 1, "late");
    expect(early.read("squire", "run-summary")?.value).toBe("late");
  });

  it("replaces the value on a later publish and removes it on withdraw", () => {
    const pub = publisher();
    pub.publish("run-summary", 1, { a: 1 });
    pub.publish("run-summary", 2, { b: 2 });
    expect(reader().read("squire", "run-summary")).toMatchObject({ version: 2, value: { b: 2 } });
    pub.withdraw("run-summary");
    expect(reader().read("squire", "run-summary")).toBeNull();
    expect(() => pub.withdraw("never-published")).not.toThrow();
  });

  it("returns null for a publisher that is not installed or a name it never published", () => {
    publisher().publish("run-summary", 1, 1);
    expect(reader().read("not-installed", "run-summary")).toBeNull();
    expect(reader().read("squire", "other-name")).toBeNull();
  });

  it("drops a disabled or torn-down publisher's values, tells listeners null, and ignores later publishes", () => {
    const pub = publisher();
    pub.publish("run-summary", 1, { kills: 3 });
    const heard: unknown[] = [];
    reader().onChange("squire", "run-summary", (value) => heard.push(value));
    retireSharedValues("squire");
    expect(reader().read("squire", "run-summary")).toBeNull();
    expect(heard).toEqual([null]);
    pub.publish("run-summary", 2, { kills: 4 });
    expect(reader().read("squire", "run-summary")).toBeNull();
  });
});

describe("ctx.shared keeps readers and publishers apart", () => {
  it("gives a reader a frozen copy it cannot change, and ignores the publisher's later edits to its own object", () => {
    const original = { items: [{ name: "Dagger" }], depth: 5 };
    publisher().publish("run-summary", 1, original);
    original.depth = 99;
    original.items[0]!.name = "Changed";
    const first = reader().read("squire", "run-summary")!;
    expect(first.value).toEqual({ items: [{ name: "Dagger" }], depth: 5 });
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first.value as { depth: number }).depth = 1;
    }).toThrow(TypeError);
    expect(() => {
      (first.value as { items: { name: string }[] }).items[0]!.name = "x";
    }).toThrow(TypeError);
    expect(reader().read("squire", "run-summary")!.value).toEqual({ items: [{ name: "Dagger" }], depth: 5 });
  });

  it("keeps a key named __proto__ as a key", () => {
    publisher().publish("odd", 1, JSON.parse('{"__proto__": {"x": 1}}'));
    const value = reader().read("squire", "odd")!.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.keys(value)).toEqual(["__proto__"]);
  });
});

describe("ctx.shared refuses what is not plain JSON", () => {
  const cases: [string, unknown, RegExp][] = [
    ["a function", { fn: () => 1 }, /\.fn is a function/],
    ["undefined", { gone: undefined }, /\.gone is undefined/],
    ["NaN", [1, Number.NaN], /\[1\] is NaN/],
    ["a bigint", { n: 1n }, /is a bigint/],
    ["a Date", { when: new Date(0) }, /is a Date, not a plain object/],
    ["a Map", new Map(), /is a Map/],
    ["an empty array slot", [1, , 3], /empty array slot/], // eslint-disable-line no-sparse-arrays
  ];
  for (const [label, value, message] of cases) {
    it(`throws a TypeError for ${label}`, () => {
      expect(() => publisher().publish("bad", 1, value)).toThrow(TypeError);
      expect(() => publisher().publish("bad", 1, value)).toThrow(message);
      expect(reader().read("squire", "bad")).toBeNull();
    });
  }

  it("throws for a value that contains itself", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => publisher().publish("bad", 1, loop)).toThrow(/contains itself/);
  });

  it("accepts the same object twice when it is not a cycle", () => {
    const shared = { x: 1 };
    publisher().publish("twice", 1, { a: shared, b: shared });
    expect(reader().read("squire", "twice")!.value).toEqual({ a: { x: 1 }, b: { x: 1 } });
  });

  it("throws a RangeError over the size limit and keeps the old value", () => {
    publisher().publish("big", 1, "small");
    const big = "x".repeat(SHARED_VALUE_MAX_BYTES);
    expect(() => publisher().publish("big", 2, big)).toThrow(RangeError);
    expect(reader().read("squire", "big")?.value).toBe("small");
    const fits = "x".repeat(SHARED_VALUE_MAX_BYTES - 2); // two bytes of quotes
    publisher().publish("big", 3, fits);
    expect(reader().read("squire", "big")?.version).toBe(3);
  });

  it("counts UTF-8 bytes, not characters", () => {
    const wide = "é".repeat(SHARED_VALUE_MAX_BYTES / 2);
    expect(() => publisher().publish("wide", 1, wide)).toThrow(RangeError);
  });

  it("checks the name and the version", () => {
    expect(() => publisher().publish("Bad Name", 1, 1)).toThrow(TypeError);
    expect(() => publisher().publish("", 1, 1)).toThrow(TypeError);
    expect(() => publisher().publish("ok", -1, 1)).toThrow(/version/);
    expect(() => publisher().publish("ok", 1.5, 1)).toThrow(/version/);
  });
});

describe("ctx.shared capabilities", () => {
  it("is absent without either capability", () => {
    expect(ctx("m", []).shared).toBeUndefined();
    expect(ctx("m", ["state:*.read", "mod:read"]).shared).toBeUndefined();
  });

  it("refuses a read without shared:read and a publish without shared:publish", () => {
    expect(() => publisher().read("anybandui", "x")).toThrow(CapabilityError);
    expect(() => publisher().onChange("anybandui", "x", () => {})).toThrow(CapabilityError);
    expect(() => reader().publish("x", 1, 1)).toThrow(CapabilityError);
    expect(() => reader().withdraw("x")).toThrow(CapabilityError);
  });

  it("lets one mod both read and publish when it declares both", () => {
    const both = ctx("both", ["shared:read", "shared:publish"]).shared!;
    both.publish("x", 1, true);
    expect(both.read("both", "x")?.value).toBe(true);
  });
});

describe("ctx.shared.onChange", () => {
  it("hears publishes and withdrawals of one name until it stops", () => {
    const heard: unknown[] = [];
    const stop = reader().onChange("squire", "run-summary", (value) => heard.push(value?.value ?? null));
    publisher().publish("other", 1, "ignored");
    publisher().publish("run-summary", 1, "first");
    publisher().withdraw("run-summary");
    stop();
    publisher().publish("run-summary", 2, "after");
    expect(heard).toEqual(["first", null]);
  });

  it("reports a throwing listener against the listening mod and still tells the others", () => {
    const fault = vi.fn();
    setSharedValueFaultReporter(fault);
    const heard: unknown[] = [];
    reader().onChange("squire", "run-summary", () => {
      throw new Error("boom");
    });
    ctx("other-reader", ["shared:read"]).shared!.onChange("squire", "run-summary", (value) => heard.push(value?.version));
    publisher().publish("run-summary", 1, 1);
    expect(heard).toEqual([1]);
    expect(fault).toHaveBeenCalledWith("anybandui", expect.stringContaining("run-summary"), expect.any(Error));
  });

  it("drops a retired reader's listeners", () => {
    const heard: unknown[] = [];
    reader().onChange("squire", "run-summary", (value) => heard.push(value));
    retireSharedValues("anybandui");
    publisher().publish("run-summary", 1, 1);
    expect(heard).toEqual([]);
  });
});

describe("teardown withdraws shared values", () => {
  beforeEach(() => resetModTeardown());
  afterEach(() => resetModTeardown());

  it("after every uninstall has run, so an uninstall can still read another mod's value", () => {
    publisher().publish("run-summary", 1, "kept");
    const seen: unknown[] = [];
    const reading = reader();
    teardownModPlugins({
      plugins: [
        { id: "squire", plugin: {} },
        { id: "anybandui", plugin: { uninstall: () => { seen.push(reading.read("squire", "run-summary")?.value ?? null); } } },
      ],
      controller: null,
      retireSharedValues,
    });
    expect(seen).toEqual(["kept"]);
    expect(reading.read("squire", "run-summary")).toBeNull();
  });
});

describe("main.ts wires the shared values (drift guard)", () => {
  const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/[^\n]*/gu, "");

  it("retires a mod whose register() failed", () => {
    const failed = MAIN.indexOf("register() failed, so its effects");
    expect(failed).toBeGreaterThan(-1);
    expect(MAIN.slice(failed, failed + 400)).toMatch(/retireSharedValues\(loaded\.id\)/u);
  });

  it("hands teardown the withdrawal and the fault channel to the store", () => {
    expect(MAIN).toMatch(/teardownModPlugins\(\{[\s\S]*?retireSharedValues,[\s\S]*?\}\);/u);
    expect(MAIN).toMatch(/setSharedValueFaultReporter\(reportDisplayFault\)/u);
  });
});
