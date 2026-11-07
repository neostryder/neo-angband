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
