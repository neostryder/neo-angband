import type { WorkerJson } from "./protocol";

/** Refuse lookalike records and non-clone data before it crosses the boundary. */
export function cloneWorkerJson(value: unknown, depth: number = 0): WorkerJson {
  if (depth > 32) throw new Error("payload nesting exceeds 32 levels");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("payload numbers must be finite");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => cloneWorkerJson(item, depth + 1));
  if (typeof value !== "object") throw new Error("payload must contain only JSON values");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error("payload records must have Object.prototype or null prototype");
  }
  const out: { [key: string]: WorkerJson } = {};
  for (const [key, item] of Object.entries(value)) out[key] = cloneWorkerJson(item, depth + 1);
  return out;
}

export function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
