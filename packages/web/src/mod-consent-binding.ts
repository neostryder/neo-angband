let bindings: ReadonlyMap<string, string | null> = new Map();
const listeners = new Set<(id: string) => void>();

export function consentBinding(id: string): string | null | undefined {
  return bindings.get(id);
}

export function consentMatches(id: string, recorded: string | undefined): boolean {
  const current = bindings.get(id);
  return current === undefined || (current !== null && current === recorded);
}

export function invalidateModConsent(id: string): void {
  for (const listener of listeners) {
    try { listener(id); } catch { /* Other grants must still be revoked. */ }
  }
}

export function setConsentBindings(next: ReadonlyMap<string, string | null>): void {
  const before = bindings;
  bindings = new Map(next);
  for (const [id, binding] of before) {
    if (next.get(id) !== binding) invalidateModConsent(id);
  }
}

export function onModConsentChange(listener: (id: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
