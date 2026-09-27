import type { ModPrompt, PromptAnswer, PromptDescriptor, PromptReplyResult } from "./prompt-view";

type Draft = PromptDescriptor extends infer D ? D extends PromptDescriptor ? Omit<D, "promptId"> : never : never;
type Wait = { descriptor: PromptDescriptor; accept: (answer: PromptAnswer) => PromptReplyResult };
const waits: Wait[] = [];
let nextPromptId = 1;

/** Reading returns the frozen announcement and never calls a game helper. */
export function currentPrompt(): PromptDescriptor | null {
  return waits.at(-1)?.descriptor ?? null;
}

export function openPrompt(draft: Draft, accept: Wait["accept"]): { promptId: number; update: (draft: Draft) => void; refresh: (draft: Draft) => void; close: () => void } {
  const promptId = nextPromptId++;
  const wait: Wait = { descriptor: freezeDescriptor({ ...draft, promptId } as PromptDescriptor), accept };
  waits.push(wait);
  return {
    promptId,
    update(next) { wait.descriptor = freezeDescriptor({ ...next, promptId } as PromptDescriptor); },
    refresh(next) { wait.descriptor = freezeDescriptor({ ...next, promptId: nextPromptId++ } as PromptDescriptor); },
    close() { const i = waits.indexOf(wait); if (i >= 0) waits.splice(i, 1); },
  };
}

function freezeDescriptor(descriptor: PromptDescriptor): PromptDescriptor {
  if ("choices" in descriptor) descriptor.choices.forEach(Object.freeze);
  if ("choices" in descriptor) Object.freeze(descriptor.choices);
  if (descriptor.kind === "item") Object.freeze(descriptor.tabs);
  if (descriptor.kind === "target") {
    Object.freeze(descriptor.cursor);
    descriptor.candidates.forEach(Object.freeze);
    descriptor.path.forEach(Object.freeze);
    Object.freeze(descriptor.candidates);
    Object.freeze(descriptor.path);
  }
  return Object.freeze(descriptor);
}

export const modPrompt: ModPrompt = Object.freeze({
  reply(promptId: number, answer: PromptAnswer): PromptReplyResult {
    const wait = waits.at(-1);
    if (!wait || wait.descriptor.promptId !== promptId) return { accepted: false, reason: "stale promptId" };
    return wait.accept(answer);
  },
});
