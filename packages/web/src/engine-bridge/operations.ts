import { BRIDGE_LIMITS, BridgeError } from "./types";
import type { ActorSnapshot, BridgeJson, BridgeOperation, BridgeRequest, EngineSnapshot } from "./types";
import { copyBridgeJson } from "./values";

function record(value: BridgeJson): { [key: string]: BridgeJson } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new BridgeError("invalid-operation");
  return value;
}

function exact(value: { [key: string]: BridgeJson }, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new BridgeError("invalid-operation");
  }
}

function integer(value: BridgeJson | undefined, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function name(value: BridgeJson | undefined): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 80 &&
    Array.from(value).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);
}

export function parseRequest(input: unknown): BridgeRequest {
  const value = record(copyBridgeJson(input));
  exact(value, ["version", "epoch", "revision", "operations"]);
  if (value.version !== 1 || !integer(value.epoch) || !integer(value.revision)) throw new BridgeError("invalid-operation");
  if (!Array.isArray(value.operations) || value.operations.length === 0) throw new BridgeError("invalid-operation");
  if (value.operations.length > BRIDGE_LIMITS.steps) throw new BridgeError("limit");
  const operations = value.operations.map((raw): BridgeOperation => {
    const op = record(raw);
    if (typeof op.handle !== "string" || !/^\d{1,16}:[a-f0-9]{64}$/u.test(op.handle)) throw new BridgeError("invalid-handle");
    switch (op.op) {
      case "actor.read":
        exact(op, ["op", "handle", "field"]);
        if (op.field !== "name" && op.field !== "health" && op.field !== "maxHealth") throw new BridgeError("invalid-operation");
        return { op: op.op, handle: op.handle, field: op.field };
      case "actor.setHealth":
        exact(op, ["op", "handle", "health"]);
        if (!integer(op.health, 1_000_000)) throw new BridgeError("invalid-operation");
        return { op: op.op, handle: op.handle, health: op.health };
      case "actor.rename":
        exact(op, ["op", "handle", "name"]);
        if (!name(op.name)) throw new BridgeError("invalid-operation");
        return { op: op.op, handle: op.handle, name: op.name };
      default:
        throw new BridgeError("invalid-operation");
    }
  });
  return { version: 1, epoch: value.epoch, revision: value.revision, operations };
}

export function parseSnapshot(input: unknown): EngineSnapshot {
  const value = record(copyBridgeJson(input));
  exact(value, ["revision", "actors"]);
  if (!integer(value.revision) || !Array.isArray(value.actors) || value.actors.length > BRIDGE_LIMITS.actors) {
    throw new BridgeError("invalid-state");
  }
  const ids = new Set<string>();
  const actors = value.actors.map((raw): ActorSnapshot => {
    const actor = record(raw);
    exact(actor, ["id", "name", "health", "maxHealth"]);
    if (typeof actor.id !== "string" || !/^[a-z0-9:-]{1,128}$/u.test(actor.id) || ids.has(actor.id) || !name(actor.name) ||
      !integer(actor.health, 1_000_000) || !integer(actor.maxHealth, 1_000_000) || actor.maxHealth === 0 || actor.health > actor.maxHealth) {
      throw new BridgeError("invalid-state");
    }
    ids.add(actor.id);
    return { id: actor.id, name: actor.name, health: actor.health, maxHealth: actor.maxHealth };
  });
  return { revision: value.revision, actors };
}
