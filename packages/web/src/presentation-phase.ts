import type { Api2BootPhase } from "@rpgm-tools/neo-angband-mod-sdk";

let phase: Api2BootPhase = "title";
const listeners = new Set<(phase: Api2BootPhase) => void>();

export function bootPhase(): Api2BootPhase {
  return phase;
}

export function setBootPhase(next: Api2BootPhase): void {
  if (next === phase) return;
  phase = next;
  for (const listener of listeners) listener(next);
}

export function onBootPhaseChanged(listener: (phase: Api2BootPhase) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
