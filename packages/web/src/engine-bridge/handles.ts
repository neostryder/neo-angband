import { BRIDGE_LIMITS, BridgeError } from "./types";
import type { ActorTarget, BridgeAuthority } from "./types";

export class HandleTable {
  readonly #installation: string;
  #epoch: number;
  #stopped = false;
  readonly #entries = new Map<string, ActorTarget>();

  constructor(installation: string, epoch: number) {
    if (!installation || !Number.isSafeInteger(epoch) || epoch < 0) throw new BridgeError("not-authorized");
    this.#installation = installation;
    this.#epoch = epoch;
  }

  get size(): number {
    return this.#entries.size;
  }

  assertAuthority(authority: BridgeAuthority): void {
    if (this.#stopped || authority.granted !== true || authority.installation !== this.#installation || authority.epoch !== this.#epoch) {
      throw new BridgeError("not-authorized");
    }
  }

  issue(authority: BridgeAuthority, target: ActorTarget): string {
    this.assertAuthority(authority);
    if (this.#entries.size >= BRIDGE_LIMITS.handles) throw new BridgeError("limit");
    for (let attempt = 0; attempt < 4; attempt++) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const id = `${this.#epoch}:${random}`;
      if (!this.#entries.has(id)) {
        this.#entries.set(id, target);
        return id;
      }
    }
    throw new BridgeError("limit");
  }

  resolve(authority: BridgeAuthority, id: string): ActorTarget {
    this.assertAuthority(authority);
    const target = this.#entries.get(id);
    if (!target) throw new BridgeError("invalid-handle");
    return target;
  }

  advanceEpoch(epoch: number): void {
    if (this.#stopped || !Number.isSafeInteger(epoch) || epoch <= this.#epoch) throw new BridgeError("not-authorized");
    this.#entries.clear();
    this.#epoch = epoch;
  }

  stop(): void {
    this.#entries.clear();
    this.#stopped = true;
  }
}
