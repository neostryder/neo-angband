import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeEngine } from "./fake-engine";
import { HandleTable } from "./handles";
import { TransactionRunner } from "./transaction";
import { BRIDGE_LIMITS } from "./types";
import type { BridgeAuthority } from "./types";

function fixture() {
  const authority: BridgeAuthority = { installation: "installation-a", epoch: 1, granted: true };
  const engine = new FakeEngine();
  const table = new HandleTable(authority.installation, authority.epoch);
  const handle = table.issue(authority, engine.target);
  let current = authority;
  let time = 0;
  const runner = new TransactionRunner(table, engine, () => current, () => time);
  const change = { op: "actor.setHealth", handle, health: 15 };
  const request = (operations: unknown[] = [change], revision = 0, epoch = 1) => ({ version: 1, epoch, revision, operations });
  const reject = (input: unknown, code?: string) => {
    const before = structuredClone(engine.state);
    const saved = structuredClone(engine.saved);
    const commits = engine.commits;
    const result = runner.run(input);
    expect(result.ok).toBe(false);
    if (code) expect(result).toEqual({ ok: false, code });
    expect(engine.state).toEqual(before);
    expect(engine.saved).toEqual(saved);
    expect(engine.commits).toBe(commits);
  };
  return { authority, engine, table, handle, runner, change, request, reject,
    setAuthority: (next: BridgeAuthority) => { current = next; },
    setTime: (next: number) => { time = next; } };
}

afterEach(() => vi.restoreAllMocks());

describe("serialized engine transactions", () => {
  it("commits a batch once and reads the staged snapshot without returning objects", () => {
    const f = fixture();
    const result = f.runner.run(f.request([
      f.change,
      { op: "actor.rename", handle: f.handle, name: "New name" },
      { op: "actor.read", handle: f.handle, field: "health" },
      { op: "actor.read", handle: f.handle, field: "name" },
      { op: "actor.read", handle: f.handle, field: "maxHealth" },
    ]));
    expect(result).toEqual({ ok: true, revision: 1, values: [null, null, 15, "New name", 20] });
    expect(f.engine.state.actors[0]).toEqual({ id: "player", name: "New name", health: 15, maxHealth: 20 });
    expect(f.engine.saved).toEqual(f.engine.state);
    expect(f.engine.commits).toBe(1);
    expect(f.engine.state.revision).toBe(1);
    if (result.ok) result.values[2] = 999;
    expect(f.engine.state.actors[0]?.health).toBe(15);
  });

  it("does not save a read-only batch", () => {
    const f = fixture();
    expect(f.runner.run(f.request([{ op: "actor.read", handle: f.handle, field: "health" }]))).toEqual({ ok: true, revision: 0, values: [10] });
    expect(f.engine.commits).toBe(0);
  });

  it("rolls back earlier steps when a later step violates engine state", () => {
    const f = fixture();
    f.reject(f.request([f.change, { ...f.change, health: 21 }]), "invalid-state");
    expect(f.engine.snapshots).toBe(1);
  });

  it("validates every schema and handle before reading the engine", () => {
    const f = fixture();
    f.reject(f.request([f.change, { ...f.change, op: "invoke" }]), "invalid-operation");
    f.reject(f.request([f.change, { ...f.change, handle: `1:${"f".repeat(64)}` }]), "invalid-handle");
    expect(f.engine.snapshots).toBe(0);
  });

  it("refuses a failed persistence commit without publishing state", () => {
    const f = fixture();
    f.engine.failCommit = true;
    f.reject(f.request(), "engine-failure");
  });

  it("refuses a stale revision and a replay after a successful commit", () => {
    const f = fixture();
    f.reject(f.request([f.change], 99), "conflict");
    expect(f.runner.run(f.request()).ok).toBe(true);
    f.reject(f.request(), "conflict");
  });

  it("uses compare-and-swap to reject a concurrent engine revision", () => {
    const f = fixture();
    f.engine.beforeCommit = () => { f.engine.state.revision++; };
    expect(f.runner.run(f.request())).toEqual({ ok: false, code: "conflict" });
    expect(f.engine.state.actors[0]?.health).toBe(10);
    expect(f.engine.saved.revision).toBe(0);
    expect(f.engine.commits).toBe(0);
  });

  it.each(["grant", "installation", "epoch", "stop", "advance"])("rechecks %s after the engine snapshot", (mode) => {
    const f = fixture();
    f.engine.beforeSnapshot = () => {
      if (mode === "grant") f.setAuthority({ ...f.authority, granted: false });
      if (mode === "installation") f.setAuthority({ ...f.authority, installation: "installation-b" });
      if (mode === "epoch") f.setAuthority({ ...f.authority, epoch: 2 });
      if (mode === "stop") f.table.stop();
      if (mode === "advance") f.table.advanceEpoch(2);
    };
    f.reject(f.request(), "not-authorized");
  });

  it("refuses callers without authority before reading state", () => {
    const f = fixture();
    f.setAuthority({ ...f.authority, granted: false });
    f.reject(f.request(), "not-authorized");
    expect(f.engine.snapshots).toBe(0);
  });

  it("refuses a foreign installation's handle and caller identity", () => {
    const f = fixture();
    const other = fixture();
    const foreign = new HandleTable("installation-b", 1);
    const handle = foreign.issue({ installation: "installation-b", epoch: 1, granted: true }, other.engine.target);
    f.reject(f.request([{ ...f.change, handle }]), "invalid-handle");
    f.setAuthority({ ...f.authority, installation: "installation-b" });
    f.reject(f.request(), "not-authorized");
  });

  it("refuses old epochs, old handles in a new epoch, and stopped connections", () => {
    const f = fixture();
    f.reject(f.request([f.change], 0, 0), "not-authorized");
    f.table.advanceEpoch(2);
    f.setAuthority({ ...f.authority, epoch: 2 });
    f.reject(f.request(), "not-authorized");
    f.reject(f.request([f.change], 0, 2), "invalid-handle");
    f.table.stop();
    f.reject(f.request([f.change], 0, 2), "not-authorized");
  });

  it.each(["installation", "pluginId", "granted", "grants", "authority", "save", "turn"])("refuses a caller-supplied %s", (field) => {
    const f = fixture();
    f.reject({ ...f.request(), [field]: "self-authorized" }, "invalid-operation");
  });

  it.each(["__proto__", "constructor", "prototype", "health.value", "constructor.constructor", "neoDesktop", "neoHostFs", "state", "consent", "credentials"])("refuses the field %s", (field) => {
    const f = fixture();
    f.reject(f.request([{ op: "actor.read", handle: f.handle, field }]), "invalid-operation");
  });

  it.each(["get", "set", "invoke", "construct", "eval", "import", "Atomics.wait", "actor.unknown", "__proto__", "constructor", "prototype"])("refuses operation %s", (op) => {
    const f = fixture();
    f.reject(f.request([{ ...f.change, op }]), "invalid-operation");
  });

  it.each(["path", "args", "callback", "constructorName", "target"])("refuses generic operation argument %s", (field) => {
    const f = fixture();
    f.reject(f.request([{ ...f.change, [field]: ["health"] }]), "invalid-operation");
  });

  it.each(["__proto__", "constructor", "prototype"])("refuses the own key %s without prototype mutation", (key) => {
    const f = fixture();
    const op = Object.defineProperty({ ...f.change }, key, { value: { polluted: true }, enumerable: true });
    f.reject(f.request([op]), "invalid-data");
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });

  it.each([
    ["function", () => 1],
    ["class", class Hostile {}],
    ["class instance", new (class Hostile {})()],
    ["symbol", Symbol("hostile")],
    ["bigint", 1n],
    ["undefined", undefined],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["SharedArrayBuffer", new SharedArrayBuffer(8)],
    ["Atomics", Atomics],
    ["Atomics.wait", Atomics.wait],
    ["ArrayBuffer", new ArrayBuffer(8)],
    ["Uint8Array", new Uint8Array(8)],
    ["Int32Array", new Int32Array(8)],
    ["DataView", new DataView(new ArrayBuffer(8))],
    ["Blob", new Blob(["hostile"])],
    ["ReadableStream", new ReadableStream()],
    ["WritableStream", new WritableStream()],
    ["TransformStream", new TransformStream()],
    ["Date", new Date(0)],
    ["Map", new Map()],
    ["Set", new Set()],
    ["RegExp", /hostile/u],
  ])("refuses non-JSON value %s", (_name, value) => {
    const f = fixture();
    f.reject(f.request([{ ...f.change, health: value }]), "invalid-data");
  });

  it("refuses MessagePort without retaining or transferring it", () => {
    const f = fixture();
    const channel = new MessageChannel();
    try {
      f.reject(f.request([{ ...f.change, health: channel.port1 }]), "invalid-data");
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });

  it("refuses typed views over shared memory", () => {
    const f = fixture();
    f.reject(f.request([{ ...f.change, health: new Int32Array(new SharedArrayBuffer(8)) }]), "invalid-data");
  });

  it("refuses symbol keys on objects and arrays", () => {
    const f = fixture();
    f.reject(f.request([{ ...f.change, [Symbol("hostile")]: 1 }]), "invalid-data");
    const operations = [f.change];
    Object.defineProperty(operations, Symbol("hostile"), { value: 1 });
    f.reject(f.request(operations), "invalid-data");
  });

  it("refuses cyclic objects and arrays", () => {
    const f = fixture();
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    f.reject({ ...f.request(), cycle }, "invalid-data");
    const operations: unknown[] = [f.change];
    operations.push(operations);
    f.reject(f.request(operations), "invalid-data");
  });

  it("refuses inherited objects, accessors, hidden keys, sparse arrays, and array properties", () => {
    const f = fixture();
    f.reject(f.request([Object.create(f.change)]), "invalid-data");
    const getter = vi.fn(() => 15);
    f.reject(f.request([Object.defineProperty({ ...f.change }, "health", { get: getter })]), "invalid-data");
    expect(getter).not.toHaveBeenCalled();
    f.reject(f.request([Object.defineProperty({ ...f.change }, "hidden", { value: 1 })]), "invalid-data");
    f.reject(f.request(new Array(2)), "invalid-data");
    const operations = Object.assign([f.change], { extra: true });
    f.reject(f.request(operations), "invalid-data");
  });

  it.each([-1, 1.5, 1_000_001, "15", null])("refuses invalid health %s", (health) => {
    const f = fixture();
    f.reject(f.request([{ ...f.change, health }]), "invalid-operation");
  });

  it.each(["", "x".repeat(81), "hidden\nname", "hidden\u007fname", 12])("refuses invalid name %s", (name) => {
    const f = fixture();
    f.reject(f.request([{ op: "actor.rename", handle: f.handle, name }]), "invalid-operation");
  });

  it.each([null, [], {}, { version: 2, epoch: 1, revision: 0, operations: [] }])("refuses invalid envelopes", (input) => {
    const f = fixture();
    f.reject(input, "invalid-operation");
  });

  it("refuses empty batches, malformed steps, array paths, and invalid handles", () => {
    const f = fixture();
    f.reject(f.request([]), "invalid-operation");
    f.reject(f.request([null]), "invalid-operation");
    f.reject(f.request([[]]), "invalid-operation");
    f.reject(f.request([{ op: "actor.read", handle: f.handle, field: ["health"] }]), "invalid-operation");
    for (const handle of [null, 12, "player", "__proto__", "1:short"]) {
      f.reject(f.request([{ ...f.change, handle }]), "invalid-handle");
    }
    expect(f.engine.snapshots).toBe(0);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1", null])("refuses malformed revision and epoch %s", (value) => {
    const f = fixture();
    f.reject({ ...f.request(), revision: value }, "invalid-operation");
    f.reject({ ...f.request(), epoch: value }, "invalid-operation");
  });

  it("keeps the caller's request detached from changes made during snapshot capture", () => {
    const f = fixture();
    const input = f.request();
    f.engine.beforeSnapshot = () => { f.change.health = 19; };
    expect(f.runner.run(input).ok).toBe(true);
    expect(f.engine.state.actors[0]?.health).toBe(15);
  });

  it("bounds bytes, UTF-8 bytes, depth, node count, and steps before engine work", () => {
    const f = fixture();
    f.reject({ ...f.request(), extra: "x".repeat(BRIDGE_LIMITS.bytes) }, "limit");
    f.reject({ ...f.request(), extra: "\u0800".repeat(BRIDGE_LIMITS.bytes / 2) }, "limit");
    let nested: unknown = 0;
    for (let depth = 0; depth <= BRIDGE_LIMITS.depth; depth++) nested = [nested];
    f.reject({ ...f.request(), extra: nested }, "limit");
    f.reject({ ...f.request(), extra: Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 0)) }, "limit");
    f.reject(f.request(Array.from({ length: BRIDGE_LIMITS.steps + 1 }, () => f.change)), "limit");
    expect(f.engine.snapshots).toBe(0);
  });

  it("charges rejected calls against the rate and resumes after the window", () => {
    const f = fixture();
    for (let call = 0; call < BRIDGE_LIMITS.callsPerSecond; call++) f.reject(null, "invalid-operation");
    f.reject(f.request(), "limit");
    expect(f.engine.snapshots).toBe(0);
    f.setTime(1000);
    expect(f.runner.run(f.request()).ok).toBe(true);
    f.setTime(999);
    f.reject(f.request([f.change], 1), "limit");
  });

  it("refuses recursive work while a transaction is active", () => {
    const f = fixture();
    f.engine.beforeSnapshot = () => f.reject(f.request(), "limit");
    expect(f.runner.run(f.request()).ok).toBe(true);
    expect(f.engine.commits).toBe(1);
  });

  it.each([NaN, Infinity, -Infinity])("refuses invalid clock %s", (time) => {
    const f = fixture();
    f.setTime(time);
    f.reject(f.request(), "limit");
    expect(f.engine.snapshots).toBe(0);
  });

  it("refuses a reversed clock within the current rate window", () => {
    const f = fixture();
    f.reject(null, "invalid-operation");
    f.setTime(100);
    f.reject(null, "invalid-operation");
    f.setTime(50);
    f.reject(f.request(), "limit");
    expect(f.engine.snapshots).toBe(0);
  });

  it("keeps its rate counter when the host advances the epoch", () => {
    const f = fixture();
    for (let call = 0; call < BRIDGE_LIMITS.callsPerSecond; call++) f.reject(null);
    f.table.advanceEpoch(2);
    const current = { ...f.authority, epoch: 2 };
    f.setAuthority(current);
    const handle = f.table.issue(current, f.engine.target);
    f.reject(f.request([{ ...f.change, handle }], 0, 2), "limit");
  });

  it("refuses malformed, oversized, and non-JSON engine snapshots without saving", () => {
    const f = fixture();
    vi.spyOn(f.engine, "snapshot").mockReturnValue({ revision: 0, actors: [{ ...f.engine.state.actors[0], health: 21 }] });
    f.reject(f.request(), "invalid-state");
    vi.mocked(f.engine.snapshot).mockReturnValue({ revision: 0, actors: Array.from({ length: BRIDGE_LIMITS.actors + 1 }, () => f.engine.state.actors[0]) });
    f.reject(f.request(), "invalid-state");
    vi.mocked(f.engine.snapshot).mockReturnValue({ revision: 0, actors: [], host: () => undefined });
    f.reject(f.request(), "invalid-data");
  });

  it("refuses duplicate actors, missing targets, and revision overflow without saving", () => {
    const f = fixture();
    const snapshot = vi.spyOn(f.engine, "snapshot");
    snapshot.mockReturnValue({ revision: 0, actors: [f.engine.state.actors[0], f.engine.state.actors[0]] });
    f.reject(f.request(), "invalid-state");
    snapshot.mockReturnValue({ revision: 0, actors: [] });
    f.reject(f.request(), "invalid-handle");
    snapshot.mockReturnValue({ ...f.engine.state, revision: Number.MAX_SAFE_INTEGER });
    f.reject(f.request([f.change], Number.MAX_SAFE_INTEGER), "invalid-state");
  });

  it("drops engine failures and detached read results when authority changes", () => {
    const f = fixture();
    const snapshot = vi.spyOn(f.engine, "snapshot").mockImplementationOnce(() => { throw new Error("private host detail"); });
    f.reject(f.request(), "engine-failure");
    snapshot.mockImplementation(() => {
      f.setAuthority({ ...f.authority, granted: false });
      return f.engine.state;
    });
    f.reject(f.request([{ op: "actor.read", handle: f.handle, field: "health" }]), "not-authorized");
  });

  it("keeps the maximum permitted reply within its byte budget", () => {
    const f = fixture();
    f.engine.state.actors[0]!.name = "\u0800".repeat(80);
    const operations = Array.from({ length: BRIDGE_LIMITS.steps }, () => ({ op: "actor.read", handle: f.handle, field: "name" }));
    expect(f.runner.run(f.request(operations))).toEqual({ ok: true, revision: 0, values: Array.from({ length: BRIDGE_LIMITS.steps }, () => "\u0800".repeat(80)) });
    expect(f.engine.commits).toBe(0);
  });
});
