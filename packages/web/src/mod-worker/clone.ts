import type { WorkerJson } from "./protocol";

/** Refuse lookalike records and non-clone data before it crosses the boundary. */
export function cloneWorkerJson(value: unknown, depth: number = 0): WorkerJson {
  if (depth > 32) throw new Error("payload nesting exceeds 32 levels");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("payload numbers must be finite");
    return value;
  }
  if (Array.isArray(value)) {
    const out: WorkerJson[] = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) throw new Error("payload arrays cannot contain empty slots");
      out.push(cloneWorkerJson(value[index], depth + 1));
    }
    return out;
  }
  if (typeof value !== "object") throw new Error("payload must contain only JSON values");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error("payload records must have Object.prototype or null prototype");
  }
  const out: { [key: string]: WorkerJson } = {};
  for (const [key, item] of Object.entries(value)) {
    /* Published JSON keys must stay data even when they name a prototype setter. */
    Object.defineProperty(out, key, { value: cloneWorkerJson(item, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/** The byte budget bounds traversal before a message can allocate a copy. */
export function boundedPayloadBytes(value: unknown, limit: number): number {
  let bytes = 0;
  const charge = (size: number): void => {
    bytes += size;
    if (bytes > limit) throw new Error(`payload larger than ${limit} bytes`);
  };
  const stringBytes = (text: string): void => {
    if (text.length > limit - bytes - 2) charge(limit + 1);
    charge(2);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) charge(2);
      else if (code < 32) charge(6);
      else if (code < 128) charge(1);
      else if (code < 2048) charge(2);
      else if (code >= 0xd800 && code <= 0xdfff) {
        const next = text.charCodeAt(i + 1);
        if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) { charge(4); i++; }
        else charge(6);
      } else charge(3);
    }
  };
  const visit = (item: unknown, depth: number): void => {
    if (depth > 32) throw new Error("payload nesting exceeds 32 levels");
    if (typeof item === "string") { stringBytes(item); return; }
    if (item === null || typeof item === "boolean") { charge(item === false ? 5 : 4); return; }
    if (typeof item === "number" && Number.isFinite(item)) { charge(String(item).length); return; }
    if (item === null || typeof item !== "object") throw new Error("payload must contain only JSON values");
    charge(2);
    if (Array.isArray(item)) {
      if (item.length > 0 && item.length * 2 - 1 > limit - bytes) charge(limit + 1);
      for (let i = 0; i < item.length; i++) {
        if (i > 0) charge(1);
        const descriptor = Object.getOwnPropertyDescriptor(item, i);
        if (!descriptor || !("value" in descriptor)) throw new Error("payload arrays must contain data without empty slots");
        visit(descriptor.value, depth + 1);
      }
      return;
    }
    const proto = Object.getPrototypeOf(item);
    if (proto !== Object.prototype && proto !== null) throw new Error("payload records must have Object.prototype or null prototype");
    let first = true;
    for (const key in item) {
      if (!Object.hasOwn(item, key)) continue;
      if (!first) charge(1);
      first = false;
      stringBytes(key);
      charge(1);
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!("value" in descriptor)) throw new Error("payload records must contain data properties");
      visit(descriptor.value, depth + 1);
    }
  };
  visit(value, 0);
  return bytes;
}

export function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * A host value as Worker JSON, with JSON's own leniency: an undefined record
 * member is left out and an undefined array item becomes null. Used for what
 * the host sends, which is built by the host's own domains; what a Worker
 * sends goes through the strict `cloneWorkerJson`.
 */
export function toWorkerJson(value: unknown, depth: number = 0): WorkerJson {
  if (depth > 64) throw new Error("value nesting exceeds 64 levels");
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => toWorkerJson(item, depth + 1));
  if (value !== null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error("only plain records cross to a Worker");
    const out: { [key: string]: WorkerJson } = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) Object.defineProperty(out, key, { value: toWorkerJson(item, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return cloneWorkerJson(value, depth);
}
