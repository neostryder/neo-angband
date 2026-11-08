import type { GameState, RegistryTargets } from "@rpgm-tools/neo-angband-core";
import { api2NotGranted, api2Ok, api2Refused, type Api2Result } from "@rpgm-tools/neo-angband-mod-sdk";
import { copyBridgeJson } from "../engine-bridge/values";
import { GAMEPLAY_WORKER_CALLS, type WorkerJson } from "./protocol";
import { WorkerRegistryDeclarations } from "./registry-declarations";

export interface WorkerGameplayHost {
  targets(id: string): RegistryTargets;
  mark(id: string, capability: string, state: GameState, current: () => boolean): boolean | Promise<boolean>;
}

export interface WorkerGameplayDeps {
  readonly id: string;
  readonly installation: string;
  readonly state: GameState;
  readonly host: WorkerGameplayHost;
  held(capability: string): boolean;
}

/** One connection retains its declaration quotas across authorization epochs. */
export class WorkerGameplay {
  readonly #declarations: WorkerRegistryDeclarations;
  #epoch = -1;
  #stopped = false;
  #busy = false;
  #time = -Infinity;
  #calls = 0;
  #writes: number[] = [];
  #live: () => boolean = () => false;
  #marked = new Set<string>();

  constructor(private readonly deps: WorkerGameplayDeps) {
    this.#declarations = new WorkerRegistryDeclarations(deps.id, deps.host.targets(deps.id));
  }

  private current(capability: string): boolean {
    return !this.#stopped && this.#live() && this.deps.held(capability);
  }

  advanceEpoch(epoch: number): void {
    if (epoch <= this.#epoch) return;
    this.#epoch = epoch;
  }

  stop(): void {
    this.#stopped = true;
  }

  async call(method: string, raw: readonly unknown[], epoch: number, live: () => boolean): Promise<Api2Result<unknown>> {
    const capability = Object.hasOwn(GAMEPLAY_WORKER_CALLS, method) ? GAMEPLAY_WORKER_CALLS[method] : undefined;
    if (!capability || !Number.isSafeInteger(epoch) || epoch < 0 || epoch < this.#epoch || this.#stopped || !live() || !this.deps.held(capability)) return api2NotGranted(capability ?? "engine:access");
    if (this.#busy) return api2Refused("busy", "A gameplay request is already pending.");
    this.advanceEpoch(epoch);
    this.#live = live;
    const time = performance.now();
    if (time - this.#time >= 1000) { this.#time = time; this.#calls = 0; }
    if (++this.#calls > 32) return api2Refused("rate", "Gameplay requests exceed 32 calls per second.");
    this.#busy = true;
    try {
      const args = copyBridgeJson(raw) as WorkerJson[];
      const current = () => epoch === this.#epoch && live() && this.current(capability);
      if (args.length !== 1) return api2Refused("schema", "A registry declaration takes one record.");
      const install = this.#declarations.compile(method.split(".")[1]!, args[0], current);
      if (!await this.mark(capability, current)) return current() ? api2Refused("mark", "The permanent registry consequence could not be saved.") : api2NotGranted(capability);
      if (!current()) return api2NotGranted(capability);
      install();
      return api2Ok(null);
    } catch {
      return api2Refused("gameplay", "The gameplay request failed validation or persistence.");
    } finally { this.#busy = false; }
  }

  private async mark(capability: string, current: () => boolean): Promise<boolean> {
    if (this.#marked.has(capability)) return current();
    if (!this.spendWrite()) return false;
    if (!current() || !await this.deps.host.mark(this.deps.id, capability, this.deps.state, current) || !current()) return false;
    this.#marked.add(capability);
    return true;
  }

  private spendWrite(): boolean {
    const now = performance.now();
    this.#writes = this.#writes.filter((time) => time > now - 1000);
    if (this.#writes.length >= 4) return false;
    this.#writes.push(now);
    return true;
  }
}
