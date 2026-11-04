/** Keep original-seed provenance beside the birth UI's advanced RNG state. */
import { Rng, type RngState } from "@rpgm-tools/neo-angband-core";

export interface BirthContinuation {
  readonly rngState: RngState;
  readonly seed?: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rngState(value: unknown): value is RngState {
  if (!record(value) || typeof value["quick"] !== "boolean" || typeof value["fixed"] !== "boolean"
    || !Array.isArray(value["state"]) || !value["state"].every((word) => typeof word === "number" && Number.isInteger(word))
    || !["value", "stateI", "fixval"].every((field) => typeof value[field] === "number" && Number.isInteger(value[field]))) return false;
  try {
    // Validate the same shape the game restores, without changing the stored
    // snapshot or advancing the live stream. Core validates its table length.
    new Rng(1).setState(value as unknown as RngState);
    return true;
  } catch {
    return false;
  }
}

export function encodeBirthContinuation(seed: number, state: RngState): string {
  return JSON.stringify({ seed: seed >>> 0, rngState: state });
}

export function decodeBirthContinuation(raw: string): BirthContinuation | null {
  try {
    const value: unknown = JSON.parse(raw);
    const wrapped = record(value) && "rngState" in value;
    const state = wrapped ? value["rngState"] : value;
    if (!rngState(state)) return null;
    const seed = wrapped ? value["seed"] : undefined;
    return {
      rngState: state,
      ...(typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff ? { seed } : {}),
    };
  } catch {
    return null;
  }
}

export function birthStartOptions(pageSeed: number, continuation: BirthContinuation | null | undefined): { seed?: number; rngState?: RngState } {
  if (!continuation) return { seed: pageSeed };
  // Old bare snapshots still resume their exact stream. Their original seed
  // is unknown; do not relabel it with this new page's unrelated random draw.
  return { rngState: continuation.rngState, ...(continuation.seed === undefined ? {} : { seed: continuation.seed }) };
}
