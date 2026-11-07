export const BRIDGE_LIMITS = Object.freeze({
  bytes: 64 * 1024,
  depth: 12,
  nodes: 4096,
  steps: 32,
  handles: 256,
  actors: 128,
  callsPerSecond: 32,
});

export type BridgeJson = null | boolean | number | string | BridgeJson[] | { [key: string]: BridgeJson };

export type BridgeErrorCode = "invalid-data" | "invalid-operation" | "invalid-handle" |
  "not-authorized" | "limit" | "conflict" | "invalid-state" | "engine-failure";

export class BridgeError extends Error {
  constructor(readonly code: BridgeErrorCode) {
    super(code);
  }
}

export interface BridgeAuthority {
  readonly installation: string;
  readonly epoch: number;
  readonly granted: boolean;
}

export interface ActorTarget {
  readonly id: string;
}

export interface ActorSnapshot {
  id: string;
  name: string;
  health: number;
  maxHealth: number;
}

export interface EngineSnapshot {
  revision: number;
  actors: ActorSnapshot[];
}

export interface BridgeEngine {
  snapshot(): unknown;
  // The adapter must publish state and persistence atomically, or leave both unchanged.
  commit(expectedRevision: number, next: EngineSnapshot): boolean;
}

export type BridgeOperation =
  | { op: "actor.read"; handle: string; field: "name" | "health" | "maxHealth" }
  | { op: "actor.setHealth"; handle: string; health: number }
  | { op: "actor.rename"; handle: string; name: string };

export interface BridgeRequest {
  version: 1;
  epoch: number;
  revision: number;
  operations: BridgeOperation[];
}

export type BridgeResult =
  | { ok: true; revision: number; values: BridgeJson[] }
  | { ok: false; code: BridgeErrorCode };
