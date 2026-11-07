import { HandleTable } from "./handles";
import { parseRequest, parseSnapshot } from "./operations";
import { BRIDGE_LIMITS, BridgeError } from "./types";
import type { BridgeAuthority, BridgeEngine, BridgeJson, BridgeResult } from "./types";
import { copyBridgeJson } from "./values";

/** One runner belongs to one host connection for its entire lifetime. */
export class TransactionRunner {
  #busy = false;
  #windowStart = -Infinity;
  #lastTime = -Infinity;
  #calls = 0;

  constructor(
    private readonly handles: HandleTable,
    private readonly engine: BridgeEngine,
    private readonly authority: () => BridgeAuthority,
    private readonly now: () => number = () => performance.now(),
  ) {}

  run(input: unknown): BridgeResult {
    if (this.#busy) return { ok: false, code: "limit" };
    this.#busy = true;
    try {
      const authority = { ...this.authority() };
      this.handles.assertAuthority(authority);
      const now = this.now();
      if (!Number.isFinite(now) || now < this.#lastTime) throw new BridgeError("limit");
      this.#lastTime = now;
      if (now - this.#windowStart >= 1000) {
        this.#windowStart = now;
        this.#calls = 0;
      }
      if (++this.#calls > BRIDGE_LIMITS.callsPerSecond) throw new BridgeError("limit");
      const request = parseRequest(input);
      if (request.epoch !== authority.epoch) throw new BridgeError("not-authorized");
      const targets = request.operations.map((op) => this.handles.resolve(authority, op.handle).id);
      const state = parseSnapshot(this.engine.snapshot());
      if (state.revision !== request.revision) throw new BridgeError("conflict");
      const actors = new Map(state.actors.map((actor) => [actor.id, actor]));
      const values: BridgeJson[] = [];
      let changed = false;
      for (let index = 0; index < request.operations.length; index++) {
        const op = request.operations[index]!;
        const actor = actors.get(targets[index]!);
        if (!actor) throw new BridgeError("invalid-handle");
        switch (op.op) {
          case "actor.read":
            values.push(actor[op.field]);
            break;
          case "actor.setHealth":
            if (op.health > actor.maxHealth) throw new BridgeError("invalid-state");
            actor.health = op.health;
            values.push(null);
            changed = true;
            break;
          case "actor.rename":
            actor.name = op.name;
            values.push(null);
            changed = true;
            break;
        }
      }
      if (changed) state.revision++;
      const next = parseSnapshot(state);
      const result = { ok: true as const, revision: next.revision, values };
      copyBridgeJson(result);
      const current = this.authority();
      this.handles.assertAuthority(current);
      if (current.installation !== authority.installation || current.epoch !== authority.epoch) throw new BridgeError("not-authorized");
      if (changed && !this.engine.commit(request.revision, next)) throw new BridgeError("conflict");
      return result;
    } catch (error) {
      return { ok: false, code: error instanceof BridgeError ? error.code : "engine-failure" };
    } finally {
      this.#busy = false;
    }
  }
}
