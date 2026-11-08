import { MessageChannel } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { BlowEffectRegistry, DungeonProfiles, EffectRegistry, GlyphRegistry, RandartRegistry, RoomRegistry,
  type DunProfile, type RegistryTargets } from "@rpgm-tools/neo-angband-core";
import { MenuRegistry } from "../menu-registry";
import { WorkerRegistryDeclarations } from "./registry-declarations";
import { WorkerGameplay } from "./gameplay";

function fixture() {
  const effects = new EffectRegistry();
  const rooms = new RoomRegistry({ templates: [], vaults: [] });
  const room = vi.fn(() => true);
  rooms.register("simple", room);
  rooms.register("circular", () => false);
  const profiles = new DungeonProfiles();
  profiles.addProfile({ name: "classic", builder: "classic", minLevel: 0, alloc: 1, roomProfiles: [],
    blockSize: 11, dunRooms: 30, dunUnusual: 0, maxRarity: 0, tun: { rnd: 0, chg: 0, con: 0, pen: 0, jct: 0 },
    str: { den: 0, rng: 0, mag: 0, mc: 0, qua: 0, qc: 0 } } satisfies DunProfile);
  const glyphs = new GlyphRegistry();
  const terrain = vi.fn(() => false);
  glyphs.set("template", "%", { terrain });
  const randart = new RandartRegistry();
  const menus = new MenuRegistry(() => {});
  const blows = new BlowEffectRegistry();
  const targets = { effects, rooms, profiles, glyphs, randart, menus, blows } satisfies RegistryTargets;
  let live = true;
  const declarations = new WorkerRegistryDeclarations("owner", targets);
  const compile = (domain: string, input: unknown) => declarations.compile(domain, input, () => live);
  return { ...targets, targets, declarations, room, terrain, compile, revoke: () => { live = false; } };
}

const cases: Record<string, object> = {
  effect: { code: "owner:heal", program: [{ op: "heal", amount: 7 }, { op: "damage", amount: 3 }, { op: "message", text: "Hello" }] },
  room: { name: "owner:room", primitive: "simple" },
  profile: { name: "owner:profile", base: "classic", minLevel: 5, alloc: 100 },
  blow: { name: "owner:blow", damage: 12, obvious: true },
  glyph: { kind: "template", glyph: "~", source: "%" },
  randart: { table: "abilities", key: 999, toH: 3, toD: 4, toA: 5 },
  vocab: { kind: "stat", term: "owner:luck", label: "Luck" },
  menu: { id: "core:pickup", rows: [{ id: "one", label: "New label", hidden: false }, { id: "two", label: "Hidden", hidden: true }] },
};

describe("bounded Worker registry declarations", () => {
  it("interprets effect primitives and restores the original handler after revocation", () => {
    const f = fixture();
    const previous = vi.fn(() => false);
    f.effects.register("owner:heal", { handler: previous });
    f.compile("effect", cases.effect)();
    const hp = { chp: 5, mhp: 10, chpFrac: 8 };
    const takeHit = vi.fn();
    const msg = vi.fn();
    const ctx = { env: { player: { hp, takeHit }, messages: { msg } }, ident: false };
    expect(f.effects.handlerFor("owner:heal")!(ctx as never)).toBe(true);
    expect(hp).toEqual({ chp: 10, mhp: 10, chpFrac: 0 });
    expect(takeHit).toHaveBeenCalledWith(3, "owner");
    expect(msg).toHaveBeenCalledWith("Hello");
    f.revoke();
    expect(f.effects.handlerFor("owner:heal")!(ctx as never)).toBe(false);
    expect(previous).toHaveBeenCalledOnce();
    expect(takeHit).toHaveBeenCalledOnce();
  });

  it("selects a room primitive and uses the previous builder after revocation", () => {
    const f = fixture();
    f.compile("room", { name: "circular", primitive: "simple" })();
    expect(f.rooms.get("circular")({} as never, { x: 4, y: 5 }, 0)).toBe(true);
    expect(f.room).toHaveBeenCalledOnce();
    f.revoke();
    expect(f.rooms.get("circular")({} as never, { x: 4, y: 5 }, 0)).toBe(false);
    expect(f.room).toHaveBeenCalledOnce();
  });

  it("copies profiles and excludes them from lookup, listing, and selection after revocation", () => {
    const f = fixture();
    f.compile("profile", cases.profile)();
    expect(f.profiles.find("owner:profile")?.minLevel).toBe(5);
    expect(() => f.compile("profile", cases.profile)).toThrow(/exists/);
    expect(f.profiles.find("classic")?.minLevel).toBe(0);
    f.revoke();
    expect(f.profiles.find("owner:profile")).toBeNull();
    expect(f.profiles.list().map((profile) => profile.name)).toEqual(["classic"]);
    expect(f.profiles.choose({ randint0: () => 0, oneIn: () => false } as never, 5).name).toBe("classic");
  });

  it("uses one blow specification for recorded and live paths and neutralizes a revoked declaration", () => {
    const f = fixture();
    f.compile("blow", cases.blow)();
    const handler = f.blows.handlerFor("owner:blow")!;
    expect(handler.record({} as never)).toEqual({ hpDamage: 12, obvious: true, sideEffects: [] });
    f.revoke();
    expect(handler.record({} as never)).toEqual({ hpDamage: 0, obvious: false, sideEffects: [] });
  });

  it("maps glyphs to host behavior and declines a revoked glyph", () => {
    const f = fixture();
    f.compile("glyph", cases.glyph)();
    expect(f.glyphs.handlerFor("template", "~")!.terrain!({ glyph: "~" } as never)).toBe(false);
    expect(f.terrain).toHaveBeenCalledWith({ glyph: "%" });
    f.revoke();
    expect(f.glyphs.handlerFor("template", "~")!.terrain!({} as never)).toBeUndefined();
    expect(f.terrain).toHaveBeenCalledOnce();
  });

  it.each(["abilities", "prep"] as const)("sets bounded randart %s stats and leaves revoked artifacts unchanged", (table) => {
    const f = fixture();
    f.compile("randart", { ...cases.randart, table })();
    const art = { toH: 0, toD: 0, toA: 0 };
    const handler = f.randart[table].handlerFor(999)!;
    handler({ art } as never);
    expect(art).toEqual({ toH: 3, toD: 4, toA: 5 });
    f.revoke();
    const untouched = { toH: 1, toD: 1, toA: 1 };
    handler({ art: untouched } as never);
    expect(untouched).toEqual({ toH: 1, toD: 1, toA: 1 });
  });

  it("stores only owned vocabulary terms in the connection's registry", () => {
    const f = fixture();
    f.compile("vocab", cases.vocab)();
    expect(f.declarations.vocab.list()).toEqual([cases.vocab]);
    expect(() => f.compile("vocab", cases.vocab)).toThrow(/exists/);
    expect(fixture().declarations.vocab.list()).toEqual([]);
    expect(() => f.compile("vocab", { ...cases.vocab, term: "victim:luck" })).toThrow();
  });

  it("changes only existing row labels and visibility and restores the original menu on revocation", () => {
    const f = fixture();
    f.compile("menu", cases.menu)();
    const rows = [{ id: "one", label: "One", semantic: { kind: "item", ref: 1 } }, { id: "two", label: "Two", semantic: { kind: "item", ref: 2 } }];
    expect(f.menus.transform("core:pickup", rows)).toEqual([{ ...rows[0], label: "New label" }]);
    const large = Array.from({ length: 257 }, (_, id) => ({ id: String(id), label: "Unchanged", semantic: { kind: "item" } }));
    expect(f.menus.transform("core:pickup", large)).toEqual(large);
    f.revoke();
    expect(f.menus.transform("core:pickup", rows)).toEqual(rows);
    for (const id of ["core:mod-permission-choice", "core:mod-capabilities", "core:mod-truth-confirm", "core:game-menu", "core:death-menu"]) {
      expect(() => f.compile("menu", { ...cases.menu, id })).toThrow();
    }
  });

  for (const [domain, declaration] of Object.entries(cases)) {
    it(`${domain} rejects executable, cyclic, transferable, and prototype data before installation`, () => {
      const f = fixture();
      const channel = new MessageChannel();
      const cycle: unknown[] = [];
      cycle.push(cycle);
      const getter = vi.fn(() => 1);
      const accessor = Object.defineProperty({}, "value", { get: getter, enumerable: true });
      const attacks = [() => 1, class Hostile {}, new (class Hostile {})(), cycle, new Uint8Array(4), new ArrayBuffer(4),
        new SharedArrayBuffer(4), Atomics, Atomics.wait, channel.port1, new Blob(["data"]), accessor,
        JSON.parse('{"__proto__":{"polluted":true}}'), { constructor: {} }, { prototype: {} }, Object.create({ inherited: true })];
      try {
        for (const attack of attacks) expect(() => f.compile(domain, { ...declaration, attack })).toThrow();
        expect(getter).not.toHaveBeenCalled();
        expect(() => f.compile(domain, { ...declaration, extra: true })).toThrow();
        expect(() => f.compile(domain, { ...declaration, oversized: "x".repeat(65536) })).toThrow();
        expect(f.declarations.vocab.list()).toEqual([]);
        expect(f.profiles.list()).toHaveLength(1);
      } finally { channel.port1.close(); channel.port2.close(); }
    });
  }

  it("bounds total registrations across domains without resetting after revocation", () => {
    const f = fixture();
    for (let i = 0; i < 64; i++) f.compile("vocab", { kind: "stat", term: `owner:term${i}`, label: "Term" })();
    f.revoke();
    expect(() => f.compile("room", cases.room)).toThrow(/quota/);
    expect(f.rooms.has("owner:room")).toBe(false);
  });

  it("rejects skipped glyphs before installation and bounds retained menu declaration bytes", () => {
    const f = fixture();
    expect(() => f.compile("glyph", { ...cases.glyph, glyph: " " })).toThrow();
    const rows = Array.from({ length: 64 }, (_, index) => ({ id: `row:${index}`, label: "x".repeat(160), hidden: false }));
    const register = vi.spyOn(f.menus, "register");
    let accepted = 0;
    for (; accepted < 64; accepted++) {
      try { f.compile("menu", { id: "core:pickup", rows })(); }
      catch { break; }
    }
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(64);
    expect(register).toHaveBeenCalledTimes(accepted);
    expect(() => f.compile("menu", { id: "core:pickup", rows })).toThrow(/quota/);
  });

  it("rejects oversized base profiles before retaining a copy", () => {
    const f = fixture();
    const base = f.profiles.find("classic")!;
    base.roomProfiles = Array.from({ length: 4097 }, () => ({ name: "room", builder: "simple" })) as DunProfile["roomProfiles"];
    expect(() => f.compile("profile", cases.profile)).toThrow();
    expect(f.profiles.find("owner:profile")).toBeNull();
  });

  it("deactivates installed programs on epoch change and refuses replay or binding loss", async () => {
    const f = fixture();
    let held = true;
    const mark = vi.fn(() => true);
    const gameplay = new WorkerGameplay({ id: "owner", installation: "binding", state: {} as never, held: () => held,
      host: { targets: () => f.targets, mark } });
    expect(await gameplay.call("registry.room.declare", [cases.room], 1, () => true)).toMatchObject({ ok: true });
    expect(f.rooms.get("owner:room")({} as never, { x: 0, y: 0 }, 0)).toBe(true);
    gameplay.advanceEpoch(2);
    expect(f.rooms.get("owner:room")({} as never, { x: 0, y: 0 }, 0)).toBe(false);
    expect(await gameplay.call("registry.room.declare", [cases.room], 1, () => true)).toMatchObject({ ok: false });
    held = false;
    expect(await gameplay.call("registry.room.declare", [cases.room], 2, () => true)).toMatchObject({ ok: false });
    expect(mark).toHaveBeenCalledOnce();
  });

  it("bounds declaration work per second without calling the durable writer", async () => {
    const f = fixture();
    const mark = vi.fn(() => true);
    const gameplay = new WorkerGameplay({ id: "owner", installation: "binding", state: {} as never, held: () => true,
      host: { targets: () => f.targets, mark } });
    for (let i = 0; i < 32; i++) expect(await gameplay.call("registry.room.declare", [], 1, () => true)).toMatchObject({ ok: false });
    expect(await gameplay.call("registry.room.declare", [cases.room], 1, () => true)).toMatchObject({ ok: false, code: "rate" });
    expect(mark).not.toHaveBeenCalled();
  });

  it("bounds pending work and refuses a stopped request before publication", async () => {
    const f = fixture();
    let finish: (value: boolean) => void = () => {};
    const mark = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const gameplay = new WorkerGameplay({ id: "owner", installation: "binding", state: {} as never, held: () => true,
      host: { targets: () => f.targets, mark } });
    const pending = gameplay.call("registry.room.declare", [cases.room], 1, () => true);
    expect(await gameplay.call("registry.room.declare", [cases.room], 1, () => true)).toMatchObject({ ok: false, code: "busy" });
    gameplay.stop();
    finish(true);
    expect(await pending).toMatchObject({ ok: false });
    expect(f.rooms.has("owner:room")).toBe(false);
    expect(mark).toHaveBeenCalledOnce();
  });

  it("limits failed consequence writes to four per second", async () => {
    const f = fixture();
    const mark = vi.fn(() => false);
    const gameplay = new WorkerGameplay({ id: "owner", installation: "binding", state: {} as never, held: () => true,
      host: { targets: () => f.targets, mark } });
    for (let i = 0; i < 5; i++) expect(await gameplay.call("registry.room.declare", [cases.room], 1, () => true)).toMatchObject({ ok: false });
    expect(mark).toHaveBeenCalledTimes(4);
    expect(f.rooms.has("owner:room")).toBe(false);
  });

  const invalid: [string, object][] = [
    ["effect", { code: "owner:heal", program: [] }],
    ["effect", { code: "owner:heal", program: Array.from({ length: 17 }, () => ({ op: "heal", amount: 1 })) }],
    ["effect", { code: "owner:heal", program: [{ op: "invoke", amount: 1 }] }],
    ["effect", { code: "owner:heal", program: [{ op: "heal", amount: 10001 }] }],
    ["effect", { code: "owner:heal", program: [{ op: "message", text: "x".repeat(161) }] }],
    ["effect", { ...cases.effect, code: 0 }],
    ["effect", { ...cases.effect, code: "victim:heal" }],
    ["room", { ...cases.room, primitive: "constructor" }],
    ["room", { ...cases.room, name: "victim:room" }],
    ["profile", { ...cases.profile, base: "missing" }],
    ["profile", { ...cases.profile, minLevel: 128 }],
    ["profile", { ...cases.profile, alloc: 101 }],
    ["blow", { ...cases.blow, damage: -1 }],
    ["blow", { ...cases.blow, damage: 10001 }],
    ["blow", { ...cases.blow, obvious: "true" }],
    ["glyph", { ...cases.glyph, glyph: " " }],
    ["glyph", { ...cases.glyph, glyph: "~~" }],
    ["glyph", { ...cases.glyph, kind: "constructor" }],
    ["glyph", { ...cases.glyph, source: "?" }],
    ["randart", { ...cases.randart, table: "redundancy" }],
    ["randart", { ...cases.randart, key: 4096 }],
    ["randart", { ...cases.randart, toH: 1.5 }],
    ["randart", { ...cases.randart, toD: 101 }],
    ["randart", { ...cases.randart, toA: -101 }],
    ["vocab", { ...cases.vocab, kind: "x".repeat(65) }],
    ["vocab", { ...cases.vocab, label: "x".repeat(81) }],
    ["vocab", { ...cases.vocab, term: "owner:bad\nterm" }],
    ["menu", { ...cases.menu, rows: Array.from({ length: 65 }, (_, id) => ({ id: String(id), label: "Row", hidden: false })) }],
    ["menu", { ...cases.menu, rows: [{ id: "one", label: "One", hidden: false }, { id: "one", label: "Duplicate", hidden: true }] }],
    ["menu", { ...cases.menu, rows: [{ id: "one", label: "Row", hidden: false, semantic: { kind: "install" } }] }],
  ];
  it.each(invalid)("rejects invalid %s fields before saving", async (domain, declaration) => {
    const f = fixture();
    const mark = vi.fn(() => true);
    const gameplay = new WorkerGameplay({ id: "owner", installation: "binding", state: {} as never, held: () => true,
      host: { targets: () => f.targets, mark } });
    expect(await gameplay.call(`registry.${domain}.declare`, [declaration], 1, () => true)).toMatchObject({ ok: false });
    expect(mark).not.toHaveBeenCalled();
    expect(f.profiles.list()).toHaveLength(1);
    expect(f.declarations.vocab.list()).toEqual([]);
  });
});
