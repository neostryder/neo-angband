import { BRIDGE_LIMITS, BridgeError } from "./types";
import type { BridgeJson } from "./types";

const forbidden = new Set(["__proto__", "constructor", "prototype"]);

/** Descriptors avoid invoking accessors before the transport's data boundary. */
export function copyBridgeJson(input: unknown): BridgeJson {
  const ancestors = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  const charge = (size: number): void => {
    bytes += size;
    if (bytes > BRIDGE_LIMITS.bytes) throw new BridgeError("limit");
  };
  const stringSize = (value: string): number => {
    if (value.length > BRIDGE_LIMITS.bytes) throw new BridgeError("limit");
    return new TextEncoder().encode(JSON.stringify(value)).length;
  };
  const visit = (value: unknown, depth: number): BridgeJson => {
    if (++nodes > BRIDGE_LIMITS.nodes || depth > BRIDGE_LIMITS.depth) throw new BridgeError("limit");
    if (value === null || typeof value === "boolean") {
      charge(value === null || value === true ? 4 : 5);
      return value;
    }
    if (typeof value === "string") {
      charge(stringSize(value));
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      charge(String(value).length);
      return value;
    }
    if (typeof value !== "object" || value === null) throw new BridgeError("invalid-data");
    const array = Array.isArray(value);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) {
      throw new BridgeError("invalid-data");
    }
    if (ancestors.has(value)) throw new BridgeError("invalid-data");
    const keys = Reflect.ownKeys(value);
    if (keys.length > BRIDGE_LIMITS.nodes) throw new BridgeError("limit");
    if (keys.some((key) => typeof key !== "string" || forbidden.has(key))) throw new BridgeError("invalid-data");
    ancestors.add(value);
    charge(2);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value as number;
      if (length > BRIDGE_LIMITS.nodes) throw new BridgeError("limit");
      if (keys.length !== length + 1) throw new BridgeError("invalid-data");
      const result: BridgeJson[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) throw new BridgeError("invalid-data");
        if (index > 0) charge(1);
        result.push(visit(descriptor.value, depth + 1));
      }
      ancestors.delete(value);
      return result;
    }
    const result: { [key: string]: BridgeJson } = {};
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !("value" in descriptor)) throw new BridgeError("invalid-data");
      charge(stringSize(key) + 2);
      result[key] = visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
    return result;
  };
  return visit(input, 0);
}
