import { blowEffect, VocabularyRegistry, type DunProfile, type RegistryTargets } from "@rpgm-tools/neo-angband-core";
import { copyBridgeJson } from "../engine-bridge/values";
import type { BridgeJson } from "../engine-bridge/types";

type RecordValue = { [key: string]: BridgeJson };

function record(value: BridgeJson): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A declaration needs a record.");
  return value;
}

function exact(value: RecordValue, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) throw new Error("Unknown declaration fields.");
}

function text(value: BridgeJson | undefined, max = 80): string {
  if (typeof value !== "string" || !value.length || value.length > max || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) throw new Error("Invalid declaration text.");
  return value;
}

function integer(value: BridgeJson | undefined, max: number, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error("Invalid declaration integer.");
  return value;
}

function target<T>(value: T | null | undefined): T {
  if (!value) throw new Error("This registry is unavailable.");
  return value;
}

/** Compilation validates every field and reference before the caller writes a consequence or installs anything. */
export class WorkerRegistryDeclarations {
  readonly vocab = new VocabularyRegistry();
  #count = 0;
  #bytes = 0;

  constructor(private readonly owner: string, private readonly targets: RegistryTargets) {}

  compile(domain: string, input: unknown, active: () => boolean): () => void {
    const value = record(copyBridgeJson(input));
    const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    let retainedBytes = bytes;
    if (this.#count >= 64 || this.#bytes + bytes > 256 * 1024) throw new Error("The declaration quota is exhausted.");
    const owned = (raw: BridgeJson | undefined): string => {
      const id = text(raw, 128);
      if (!id.startsWith(`${this.owner}:`) || !/^[a-z0-9][a-z0-9:._-]*$/.test(id)) throw new Error("A new identifier must belong to this mod.");
      return id;
    };
    let install: () => void;
    switch (domain) {
      case "effect": {
        exact(value, ["code", "program"]);
        const code = typeof value.code === "number" ? integer(value.code, 10000, 1) : owned(value.code);
        const registry = target(this.targets.effects);
        const previous = registry.handlerFor(code);
        if (typeof code === "number" && !previous) throw new Error("Unknown core effect.");
        if (!Array.isArray(value.program) || value.program.length < 1 || value.program.length > 16) throw new Error("An effect needs 1 to 16 operations.");
        const program = value.program.map((raw): { op: "message"; text: string } | { op: "heal" | "damage"; amount: number } => {
          const step = record(raw);
          if (step.op === "message") {
            exact(step, ["op", "text"]);
            return { op: "message" as const, text: text(step.text, 160) };
          }
          exact(step, ["op", "amount"]);
          if (step.op !== "heal" && step.op !== "damage") throw new Error("Unknown effect primitive.");
          return { op: step.op, amount: integer(step.amount, 10000) };
        });
        install = () => registry.register(code, { handler: (ctx) => {
          if (!active()) return previous?.(ctx) ?? false;
          for (const step of program) {
            if (step.op === "message") ctx.env.messages?.msg(step.text);
            else if (step.op === "damage") ctx.env.player?.takeHit?.(step.amount, this.owner);
            else {
              const hp = ctx.env.player?.hp;
              if (hp) {
                hp.chp = Math.min(hp.mhp, hp.chp + step.amount);
                hp.chpFrac = 0;
              }
            }
          }
          ctx.ident = true;
          return true;
        } });
        break;
      }
      case "room": {
        exact(value, ["name", "primitive"]);
        const name = text(value.name, 128);
        const primitive = text(value.primitive);
        if (!["simple", "circular", "overlap", "crossed", "large"].includes(primitive)) throw new Error("Unknown room primitive.");
        const registry = target(this.targets.rooms);
        if (!registry.has(name)) owned(value.name);
        const previous = registry.has(name) ? registry.get(name) : undefined;
        const builder = registry.get(primitive);
        install = () => registry.register(name, (g, centre, rating) => active() ? builder(g, centre, rating) : previous?.(g, centre, rating) ?? false);
        break;
      }
      case "profile": {
        exact(value, ["name", "base", "minLevel", "alloc"]);
        const name = owned(value.name);
        const registry = target(this.targets.profiles);
        if (registry.find(name)) throw new Error("This profile already exists.");
        const base = registry.find(text(value.base));
        if (!base) throw new Error("Unknown base profile.");
        const copied = copyBridgeJson(base) as unknown as DunProfile;
        const profile = { ...copied, name, minLevel: integer(value.minLevel, 127), alloc: integer(value.alloc, 100) };
        retainedBytes += new TextEncoder().encode(JSON.stringify(profile)).length;
        install = () => registry.addProfile(profile, active);
        break;
      }
      case "blow": {
        exact(value, ["name", "damage", "obvious"]);
        const name = text(value.name, 128);
        const registry = target(this.targets.blows);
        const previous = registry.handlerFor(name);
        if (!previous) owned(value.name);
        const damage = integer(value.damage, 10000);
        if (typeof value.obvious !== "boolean") throw new Error("A blow needs an obvious flag.");
        const handler = blowEffect({ damage: () => damage, obvious: value.obvious });
        const neutral = blowEffect({ damage: () => 0, obvious: false });
        install = () => registry.register(name, {
          record: (ctx) => (active() ? handler : previous ?? neutral).record(ctx),
          live: (ctx, env) => (active() ? handler : previous ?? neutral).live(ctx, env),
        });
        break;
      }
      case "glyph": {
        exact(value, ["kind", "glyph", "source"]);
        if (value.kind !== "template" && value.kind !== "vault") throw new Error("Unknown glyph decoder.");
        const kind = value.kind;
        const glyph = text(value.glyph, 1);
        const source = text(value.source, 1);
        if (glyph === " ") throw new Error("A space cannot carry a glyph handler.");
        const registry = target(this.targets.glyphs);
        const handler = registry.handlerFor(kind, source);
        if (!handler) throw new Error("Unknown source glyph.");
        const previous = registry.handlerFor(kind, glyph);
        install = () => registry.set(kind, glyph, {
          terrain: (ctx) => (active() ? handler : previous)?.terrain?.({ ...ctx, glyph: active() ? source : glyph }),
          populate: (ctx) => (active() ? handler : previous)?.populate?.({ ...ctx, glyph: active() ? source : glyph }),
        });
        break;
      }
      case "randart": {
        exact(value, ["table", "key", "toH", "toD", "toA"]);
        if (value.table !== "abilities" && value.table !== "prep") throw new Error("Only ability and preparation stats are supported.");
        const table = value.table;
        const key = integer(value.key, 4095);
        const stats = { toH: integer(value.toH, 100, -100), toD: integer(value.toD, 100, -100), toA: integer(value.toA, 100, -100) };
        const registry = target(this.targets.randart);
        if (table === "abilities") {
          const previous = registry.abilities.handlerFor(key);
          install = () => registry.abilities.set(key, (ctx) => {
            if (!active()) { previous?.(ctx); return; }
            Object.assign(ctx.art, stats);
          });
        } else {
          const previous = registry.prep.handlerFor(key);
          install = () => registry.prep.set(key, (ctx) => {
            if (!active()) { previous?.(ctx); return; }
            Object.assign(ctx.art, stats);
          });
        }
        break;
      }
      case "vocab": {
        exact(value, ["kind", "term", "label"]);
        const term = { kind: text(value.kind, 64), term: owned(value.term), label: text(value.label) };
        if (this.vocab.has(term.kind, term.term)) throw new Error("This term already exists.");
        install = () => this.vocab.define(term);
        break;
      }
      case "menu": {
        exact(value, ["id", "rows"]);
        const id = text(value.id, 128);
        if (!["core:activate-item", "core:browse-spell", "core:cast-spell", "core:context-grid", "core:context-object", "core:context-player-other",
          "core:context-player", "core:context-use-item", "core:curse-removal", "core:effect-choice", "core:pickup", "core:spell-book",
          "core:study-spell", "core:target-monster", "core:use-item"].includes(id)) throw new Error("This menu is reserved or unsupported.");
        if (!Array.isArray(value.rows) || value.rows.length > 64) throw new Error("A menu accepts at most 64 row rules.");
        const rows = value.rows.map((raw) => {
          const row = record(raw);
          exact(row, ["id", "label", "hidden"]);
          if (typeof row.hidden !== "boolean") throw new Error("A row needs a hidden flag.");
          return { id: text(row.id, 128), label: text(row.label, 160), hidden: row.hidden };
        });
        if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("Duplicate menu row ids.");
        const registry = target(this.targets.menus);
        const previous = registry.handlerFor(id);
        install = () => registry.register(id, (menu, original) => {
          const base = previous?.(menu, original) ?? original;
          if (!active() || base.length > 256) return base;
          return base.flatMap((row) => {
            const rule = rows.find((candidate) => candidate.id === row.id);
            return rule?.hidden ? [] : [{ ...row, ...(rule ? { label: rule.label } : {}) }];
          });
        });
        break;
      }
      default: throw new Error("Unknown registry domain.");
    }
    if (this.#bytes + retainedBytes > 256 * 1024) throw new Error("The declaration quota is exhausted.");
    return () => { install(); this.#count++; this.#bytes += retainedBytes; };
  }
}
