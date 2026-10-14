/// <reference lib="dom" />
import type { ScreenRegions } from "../frontend.js";
import type { HudOwnership } from "../hud.js";
import type { MenuPresenter } from "../menu.js";
import type { ScreenPresenter } from "../screen.js";

export interface Api2DisplayGridRequest {
  readonly cellHeight: number;
  readonly minCols: number;
  readonly minRows: number;
  readonly snapViewportToEven: boolean;
}

export interface Api2MapView {
  readonly origin: {
    readonly x: number;
    readonly y: number;
  };
  readonly size: {
    readonly width: number;
    readonly height: number;
  };
}

export interface Api2DisplaySnapshot {
  readonly surface?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly mode: "play" | "map" | "store" | "modal";
  readonly grid: {
    readonly cols: number;
    readonly rows: number;
    readonly cellWidth: number;
    readonly cellHeight: number;
  };
  readonly viewport: {
    readonly origin: {
      readonly x: number;
      readonly y: number;
    };
    readonly size: {
      readonly width: number;
      readonly height: number;
    };
    readonly screenOrigin: {
      readonly x: number;
      readonly y: number;
    };
  };
  readonly level: {
    readonly width: number;
    readonly height: number;
  };
  readonly layout: "left" | "top" | "none";
  readonly regions: ScreenRegions;
}

export interface Api2Display {
  snapshot(): Api2DisplaySnapshot;
  cellAt?(clientX: number, clientY: number): Api2DisplayHit | null;
  frame?(): ImageData | null;
  onFrame?(listener: () => void): () => void;
  onKey(listener: (event: KeyboardEvent) => void): () => void;
  setGrid(request: Api2DisplayGridRequest | null): void;
  getGrid(): Api2DisplayGridRequest | null;
  setCamera(origin: {
    readonly x: number;
    readonly y: number;
  } | null): void;
  getCamera(): {
    readonly x: number;
    readonly y: number;
  } | null;
  setMapView(view: Api2MapView | null): void;
  getMapView(): Api2MapView | null;
  setSidebarExtent(extent: {
    readonly columns: number;
    readonly topRows: number;
  } | null): void;
  getSidebarExtent(): {
    readonly columns: number;
    readonly topRows: number;
  } | null;
  setMapMargin?(margin: {
    readonly edge: "top" | "right" | "bottom" | "left";
    readonly cells: number;
  } | null): void;
  getMapMargin?(): {
    readonly edge: "top" | "right" | "bottom" | "left";
    readonly cells: number;
  } | null;
  setTileScaling(mode: "auto" | "crisp" | null): void;
  getTileScaling(): "auto" | "crisp";
  setFullMapOverview(enabled: boolean | null): void;
  getFullMapOverview(): boolean;
  setStoreItemNameEllipsis(enabled: boolean): void;
  setStoreSelectionDescription(enabled: boolean): void;
  setQuiverItemization(enabled: boolean): void;
  setMonsterListColorKey(enabled: boolean): void;
  setVisualFilter(filter: string | null, options?: {
    readonly scope?: "canvas" | "game";
  }): void;
  getVisualFilter(): {
    readonly filter: string;
    readonly scope: "canvas" | "game";
  } | null;
  setChromeTheme?(theme: Api2ChromeTheme | null): void;
  getChromeTheme?(): Api2ChromeTheme | null;
  setTerminalGround?(ground: {
    readonly color: string;
    readonly scope?: "subwindows" | "all";
  } | null): void;
  getTerminalGround?(): Api2TerminalGround | null;
  repaint(): void;
}

export interface Api2DisplayHit {
  readonly cell: { readonly col: number; readonly row: number };
  readonly grid: { readonly x: number; readonly y: number } | null;
}

export interface Api2SubwindowInfo {
  readonly id: string;
  readonly label: string;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly focused: boolean;
  readonly grid: {
    readonly cols: number;
    readonly rows: number;
    readonly cellWidth: number;
    readonly cellHeight: number;
  };
}

export interface Api2SubwindowControl {
  readonly glyph: string;
  readonly title?: string;
  onActivate(): void;
}

export interface Api2Subwindows {
  list(): readonly Api2SubwindowInfo[];
  setGrid(id: string, request: Api2DisplayGridRequest | null): void;
  addControl(id: string, key: string, control: Api2SubwindowControl): () => void;
  registerPrefBlock<T>(name: string, block: {
    serialize(): string | null;
    parse(text: string): T | null;
    apply(value: T): void;
  }): () => void;
  layout(): string;
  setLayout(text: string): boolean;
  onLayoutChange(listener: (layout: string) => void): () => void;
}

export interface Api2Tiles {
  readonly active: boolean;
  hasMonsterTile(ridx: number): boolean;
  drawMonster(ctx: CanvasRenderingContext2D, ridx: number, dx: number, dy: number, dw: number, dh: number): boolean;
}

export interface Api2PanelSpec {
  readonly id: string;
  readonly modal?: boolean;
  readonly label?: string;
}

export interface Api2DomPanel {
  readonly id: string;
  readonly root: ShadowRoot;
  readonly open: boolean;
  readonly closed: Promise<void>;
  close(): void;
}

export interface Api2DomUi {
  openPanel(spec: Api2PanelSpec): Api2DomPanel;
  registerPanelKind(spec: Api2PanelKindSpec): () => void;
  readonly openPanels: readonly string[];
}

export interface Api2PanelKindSpec {
  readonly kind: string;
  readonly label: string;
  readonly tab?: string;
  readonly minSize?: Readonly<{
    width: number;
    height: number;
  }>;
  readonly preferredPlacement?: Readonly<{
    kind: "dock";
    target: string;
    edge: "left" | "right" | "top" | "bottom";
  }> | Readonly<{
    kind: "tab";
    target: string;
  }>;
  readonly fitHeight?: number;
  mount(host: Api2PanelMount): void | (() => void);
}

export interface Api2PanelMount {
  readonly id: string;
  readonly root: ShadowRoot;
  readonly bounds: Readonly<{
    width: number;
    height: number;
  }>;
  readonly active: boolean;
  readonly focused: boolean;
  onStateChange(listener: (state: Api2PanelState) => void): () => void;
  requestFocus(): void;
  requestClose(): void;
  setFitHeight(px: number | null): void;
}

export interface Api2ChromeTheme {
  readonly font?: string;
  readonly fontSize?: number;
  readonly page?: string;
  readonly titleBackground?: string;
  readonly text?: string;
  readonly textStrong?: string;
  readonly muted?: string;
  readonly border?: string;
  readonly divider?: string;
  readonly dividerHover?: string;
  readonly accent?: string;
  readonly floatBorder?: string;
  readonly radius?: number;
  readonly shadow?: boolean;
}

export interface Api2TerminalGround {
  readonly color: string;
  readonly scope: "subwindows" | "all";
}

export type Api2PanelState = Readonly<{
  bounds: Readonly<{
    width: number;
    height: number;
  }>;
  active: boolean;
  focused: boolean;
}>;

export interface Api2Presentation {
  cancelInput(escapeCount?: number): import("./result.js").Api2Call<null>;
  readonly keyRepeat?: () => Api2KeyRepeat | null;
  readonly title?: Api2Title;
  phase(): Api2BootPhase;
  onPhaseChanged(listener: (phase: Api2BootPhase) => void): () => void;
  readonly display?: Api2Display;
  readonly subwindows?: Api2Subwindows;
  readonly tiles?: Api2Tiles;
  readonly panels?: Api2DomUi;
  readonly sidebarHost?: HTMLElement;
}

export interface Api2KeyRepeat {
  readonly isRepeat: boolean;
  readonly reportedRepeat: boolean;
  readonly intervalMs: number | null;
  readonly ageMs: number;
}

export type Api2BootPhase = "title" | "birth" | "play";

export interface Api2Presenters {
  birth?(mod: import("./domains.js").ModApi2): Api2BirthPresenter | undefined;
  menu?(mod: import("./domains.js").ModApi2): MenuPresenter | undefined;
  screen?(mod: import("./domains.js").ModApi2): ScreenPresenter | undefined;
  hud?(mod: import("./domains.js").ModApi2): HudOwnership | undefined;
}

export interface Api2BirthAbilityView {
  readonly name: string;
  readonly description: string;
}

export interface Api2BirthRaceView {
  readonly name: string;
  
  readonly statAdj: readonly number[];
  readonly hitDie: number;
  
  readonly expFactor: number;
  readonly infravisionFeet: number;
  
  readonly skills: Readonly<Record<string, number>>;
  readonly abilities: readonly Api2BirthAbilityView[];
}

export interface Api2BirthClassView {
  readonly name: string;
  readonly statAdj: readonly number[];
  readonly hitDie: number;
  readonly expFactor: number;
  readonly skills: Readonly<Record<string, number>>;
  
  readonly magic: readonly string[];
  readonly abilities: readonly Api2BirthAbilityView[];
}

export interface Api2BirthOptionView {
  readonly name: string;
  readonly description: string;
  readonly value: boolean;
}

export interface Api2BirthCatalogue {
  readonly races: readonly Api2BirthRaceView[];
  readonly classes: readonly Api2BirthClassView[];
  readonly stats: readonly string[];
  readonly pointBudget: number;
  readonly nameMax: number;
  
  readonly previous: {
    readonly race: string;
    readonly cls: string;
    readonly name: string;
  } | null;
  
  readonly namePinned: boolean;
}

export interface Api2BirthPreview {
  
  readonly stats: readonly {
    readonly key: string;
    readonly label: string;
    readonly natural: string;
    readonly raceBonus: string;
    readonly classBonus: string;
    readonly best: string;
  }[];
  
  readonly panels: readonly {
    readonly key: string;
    readonly lines: readonly {
      readonly label: string;
      readonly value: string;
      readonly color: number;
    }[];
  }[];
  
  readonly gold: number;
}

export interface Api2BirthDraftView {
  readonly race: string | null;
  readonly cls: string | null;
  
  readonly method: "point" | "roller";
  
  readonly stats: readonly number[];
  readonly pointsLeft: number;
  readonly pointsSpent: readonly number[];
  
  readonly statCosts: readonly {
    readonly buyCost: number | null;
    readonly sellRefund: number | null;
    readonly canBuy: boolean;
    readonly canSell: boolean;
  }[];
  readonly canPreviousRoll: boolean;
  readonly name: string;
  readonly history: string;
  readonly historyEdited: boolean;
  readonly options: readonly Api2BirthOptionView[];
  readonly preview: Api2BirthPreview | null;
  
  readonly ready: boolean;
}

export type Api2BirthResult = {
  readonly ok: true;
} | {
  readonly ok: false;
  readonly reason: string;
};

export interface Api2BirthSession {
  catalogue(): Api2BirthCatalogue;
  draft(): Api2BirthDraftView;
  chooseRace(name: string): Api2BirthResult;
  chooseClass(name: string): Api2BirthResult;
  
  usePointBuy(): Api2BirthResult;
  buy(stat: number): Api2BirthResult;
  sell(stat: number): Api2BirthResult;
  
  suggest(): Api2BirthResult;
  
  reset(): Api2BirthResult;
  
  roll(): Api2BirthResult;
  
  previousRoll(): Api2BirthResult;
  setName(name: string): Api2BirthResult;
  randomName(): Api2BirthResult;
  setHistory(text: string): Api2BirthResult;
  
  restoreHistory(): Api2BirthResult;
  
  regenerateHistory(): Api2BirthResult;
  setOption(name: string, value: boolean): Api2BirthResult;
  
  usePrevious(): Api2BirthResult;
  
  accept(): Api2BirthResult;
  
  cancel(): void;
}

export interface Api2BirthPresenter {
  show(session: Api2BirthSession): boolean | undefined;
}

export interface Api2TitleAction {
  readonly id: string;
  readonly label: string;
  readonly key?: string;
  run(): void | Promise<void>;
}

export interface Api2Title {
  registerRow(row: Api2TitleAction): import("./result.js").Api2Call<import("./domains.js").Api2Subscription>;
  removeRow(subscription: import("./domains.js").Api2Subscription): import("./result.js").Api2Call<null>;
  choose(label: string, choices: readonly string[]): import("./result.js").Api2Call<number | null>;
}
