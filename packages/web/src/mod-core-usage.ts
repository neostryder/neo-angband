/**
 * Which names each mod actually reads from `ctx.core`.
 *
 * `ctx.core` hands a mod the whole core namespace, about 2,000 exports,
 * so a mod's manifest says nothing about which of them it leans on. Retiring
 * `ctx.core` means moving every name a mod uses into a stable domain, and that
 * work list has to come from measurement: a count read off the source misses a
 * name reached through a destructure, a helper or a string key, and counts
 * names that are imported and never called.
 *
 * So the namespace is wrapped in a proxy that writes down each property a mod
 * reads, per mod. A read is recorded when it happens, which includes the moment
 * a mod destructures `ctx.core` into locals, so a name pulled out once and
 * called a thousand times shows up once.
 *
 * Off by default. The dev build turns it on at boot and the mod canary turns it
 * on for its run. A player's build hands over the bare namespace and never
 * creates the proxy.
 */

let recording = false;
const used = new Map<string, Set<string>>();

/** Start or stop recording. Mods given `ctx.core` while it is off get the bare namespace. */
export function setCoreUsageRecording(on: boolean): void {
  recording = on;
}

/** True while new mod contexts get a recording `ctx.core`. */
export function coreUsageRecording(): boolean {
  return recording;
}

/**
 * The `ctx.core` a mod gets: the namespace itself, or, while recording, a proxy
 * that notes each name the mod reads under its id.
 *
 * Records reads (`get`) and presence checks (`in`): a mod that tests for a
 * name before calling it depends on that name. Values pass straight through,
 * so `core.loc` through the proxy is the very function `neoCore.loc` is, and
 * comparing functions across mods still works. Asking for a name core does not
 * export is recorded as well; that is exactly the mod this list is meant to
 * catch. Symbol keys like `Symbol.toStringTag` are skipped, since the runtime
 * asks for those, not the mod.
 */
export function coreFor<T extends object>(modId: string, core: T): T {
  if (!recording) return core;
  const note = (key: string | symbol): void => {
    if (typeof key !== "string") return;
    let names = used.get(modId);
    if (!names) {
      names = new Set();
      used.set(modId, names);
    }
    names.add(key);
  };
  return new Proxy(core, {
    get(target, key, receiver) {
      note(key);
      return Reflect.get(target, key, receiver) as unknown;
    },
    has(target, key) {
      note(key);
      return Reflect.has(target, key);
    },
  });
}

/** Every mod's recorded names, ids and names sorted, so two runs diff cleanly. */
export function coreUsage(): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, readonly string[]> = {};
  for (const id of [...used.keys()].sort()) {
    out[id] = Object.freeze([...(used.get(id) ?? [])].sort());
  }
  return Object.freeze(out);
}

/** Forget what was recorded and stop recording, for tests. */
export function resetCoreUsage(): void {
  used.clear();
  recording = false;
}
