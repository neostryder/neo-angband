/** Keep original-seed provenance beside the birth UI's advanced RNG state. */
import { clampRandartSizeMultiplier, Rng, type RandartSetSize, type RngState } from "@rpgm-tools/neo-angband-core";

export interface BirthContinuation {
  readonly rngState: RngState;
  readonly seed?: number;
  readonly randartSetSize?: RandartSetSize & { readonly binding: string };
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

export function encodeBirthContinuation(seed: number, state: RngState, randartSetSize?: BirthContinuation["randartSetSize"]): string {
  return JSON.stringify({ seed: seed >>> 0, rngState: state, ...(randartSetSize ? { randartSetSize } : {}) });
}

export function decodeBirthContinuation(raw: string): BirthContinuation | null {
  try {
    const value: unknown = JSON.parse(raw);
    const wrapped = record(value) && "rngState" in value;
    const state = wrapped ? value["rngState"] : value;
    if (!rngState(state)) return null;
    const seed = wrapped ? value["seed"] : undefined;
    const size = wrapped ? value["randartSetSize"] : undefined;
    const randartSetSize = record(size) && typeof size["modId"] === "string" && size["modId"].length > 0 && size["modId"].length <= 128
      && typeof size["binding"] === "string" && size["binding"].length > 0 && size["binding"].length <= 1024
      && typeof size["multiplier"] === "number" && Number.isFinite(size["multiplier"]) && size["multiplier"] > 0
      ? { modId: size["modId"], binding: size["binding"], multiplier: clampRandartSizeMultiplier(size["multiplier"]) } : undefined;
    return {
      rngState: state,
      ...(randartSetSize ? { randartSetSize } : {}),
      ...(typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff ? { seed } : {}),
    };
  } catch {
    return null;
  }
}

export function birthStartOptions(pageSeed: number, continuation: BirthContinuation | null | undefined, sizeGranted: (id: string, binding: string) => boolean = () => false): { seed?: number; rngState?: RngState; randartSetSize?: RandartSetSize } {
  if (!continuation) return { seed: pageSeed };
  // Old bare snapshots still resume their exact stream. Their original seed
  // is unknown; do not relabel it with this new page's unrelated random draw.
  const size = continuation.randartSetSize;
  return { rngState: continuation.rngState, ...(continuation.seed === undefined ? {} : { seed: continuation.seed }),
    ...(size && sizeGranted(size.modId, size.binding) ? { randartSetSize: { multiplier: size.multiplier, modId: size.modId } } : {}) };
}
