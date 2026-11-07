import type { ActorTarget, BridgeEngine, EngineSnapshot } from "./types";

/** This test adapter deliberately returns live state so the runner must copy it. */
export class FakeEngine implements BridgeEngine {
  state: EngineSnapshot = {
    revision: 0,
    actors: [{ id: "player", name: "Player", health: 10, maxHealth: 20 }],
  };
  saved = structuredClone(this.state);
  commits = 0;
  snapshots = 0;
  failCommit = false;
  beforeSnapshot: (() => void) | undefined;
  beforeCommit: (() => void) | undefined;

  get target(): ActorTarget {
    return this.state.actors[0]!;
  }

  snapshot(): unknown {
    this.snapshots++;
    this.beforeSnapshot?.();
    return this.state;
  }

  commit(expectedRevision: number, next: EngineSnapshot): boolean {
    this.beforeCommit?.();
    if (this.failCommit) throw new Error("The fake persistence write failed.");
    if (this.state.revision !== expectedRevision) return false;
    const state = structuredClone(next);
    const saved = structuredClone(next);
    this.state = state;
    this.saved = saved;
    this.commits++;
    return true;
  }
}
