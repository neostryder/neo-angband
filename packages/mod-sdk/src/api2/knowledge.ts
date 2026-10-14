import type { ScreenView } from "../screen.js";

export type KnowledgeCategoryId = "objects" | "runes" | "artifacts" | "egos" | "monsters" | "features" | "traps" | "shapes";

export interface KnowledgeCategoryView {
  readonly id: KnowledgeCategoryId;
  readonly title: string;
  readonly count: number;
}

export interface KnowledgeEntryView {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly known: boolean;
  readonly cells?: readonly { readonly text: string; readonly color: string }[];
}

export interface KnowledgeGroupView {
  readonly name: string;
  readonly entries: readonly KnowledgeEntryView[];
}

export interface KnowledgeListView {
  readonly title: string;
  readonly groups: readonly KnowledgeGroupView[];
}

export interface Api2Knowledge {
  readonly categories: readonly KnowledgeCategoryView[];
  readonly lists: Readonly<Partial<Record<KnowledgeCategoryId, KnowledgeListView>>>;
  readonly recall: ScreenView | null;
}
