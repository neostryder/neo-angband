export type HistoryKind = "birth" | "level" | "unique" | "artifact" | "artifact-unknown" | "note" | "import" | "other";

export type RunOutcome = "death" | "winner" | "retired";

export interface Api2Character {
  readonly key: string | null;
  readonly sheet: CharacterSheetData | null;
  readonly history: readonly CharacterHistoryEntry[];
  readonly report: RunReport | null;
}

export interface Api2RunEndEvent {
  readonly key: string | null;
  readonly report: RunReport | null;
}

export interface SheetColor {
  readonly color: number;
  readonly css: string;
}

export interface CharacterSheetData {
  readonly name: string;
  
  readonly panels: readonly {
    readonly key: string;
    readonly lines: readonly ({
      readonly label: string;
      readonly value: string;
    } & SheetColor)[];
  }[];
  
  readonly stats: readonly {
    readonly key: string;
    readonly label: string;
    readonly natural: string;
    readonly raceBonus: string;
    readonly classBonus: string;
    readonly equipBonus: string;
    readonly best: string;
    readonly reduced: string | null;
    readonly naturalMax: boolean;
    readonly drained: boolean;
  }[];
  
  readonly history: string;
  
  readonly grids: readonly {
    readonly key: string;
    readonly rows: readonly {
      readonly name: string;
      readonly label: string;
      readonly labelColor: SheetColor;
      readonly cells: readonly ({
        readonly symbol: string;
      } & SheetColor)[];
    }[];
  }[] | null;
}

export interface CharacterHistoryEntry {
  readonly kind: HistoryKind;
  
  readonly text: string;
  readonly turn: number;
  
  readonly depth: number;
  
  readonly level: number;
  
  readonly lost: boolean;
}

export interface RunBelonging {
  readonly name: string;
  readonly color: string;
  readonly location: "equipment" | "pack" | "quiver" | "home";
  readonly quantity: number;
  
  readonly recall: {
    readonly title: string;
    readonly text: string;
  } | null;
}

export interface RunReport {
  readonly outcome: RunOutcome;
  
  readonly cause: string;
  
  readonly key: string | null;
  readonly name: string;
  readonly race: string;
  readonly cls: string;
  readonly level: number;
  readonly maxLevel: number;
  
  readonly maxDepth: number;
  
  readonly depth: number;
  readonly gold: number;
  
  readonly turn: number;
  
  readonly score: number;
  
  readonly scored: boolean;
  
  readonly endedAt: number;
  readonly history: readonly CharacterHistoryEntry[];
  
  readonly messages: readonly {
    readonly text: string;
    readonly count: number;
    readonly color?: string;
  }[];
  readonly belongings: readonly RunBelonging[];
  readonly sheet: CharacterSheetData | null;
  
  readonly birth: {
    readonly race: string;
    readonly cls: string;
    readonly name: string;
    readonly stats: readonly number[];
  };
}
