/**
 * The single transformation door for every declarative menu.
 *
 * A transformer belongs to one stable menu id. Later mods replace that slot;
 * they can call handlerFor() before registering to wrap the earlier handler.
 * Failure is deliberately local to the transform: a broken menu is a player
 * trap, so a bad mod loses its rewrite and the original screen still opens.
 */

import type {
  MenuActionHandler,
  MenuRegistryTarget,
  MenuTransformRow,
  MenuTransformer,
} from "@rpgm-tools/neo-angband-core";

interface InstalledTransformer {
  readonly owner: string | null;
  readonly transformer: MenuTransformer;
}

interface InstalledAction {
  readonly owner: string | null;
  readonly action: string;
  readonly label: string;
  readonly handler: MenuActionHandler;
  readonly rowId: string;
}

export type MenuTransformProblem = (owner: string | null, message: string) => void;

/** The live host binds an owner, so its action door is always available. */
export interface OwnedMenuRegistryTarget extends MenuRegistryTarget {
  addAction(id: string, action: string, label: string, handler: MenuActionHandler): void;
}

function isRow(value: unknown): value is MenuTransformRow {
  if (value === null || typeof value !== "object") return false;
  const row = value as Partial<MenuTransformRow>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.label === "string" &&
    row.semantic !== null &&
    typeof row.semantic === "object" &&
    typeof row.semantic.kind === "string" &&
    row.semantic.kind.length > 0
  );
}

function frozenRows(rows: readonly MenuTransformRow[]): readonly MenuTransformRow[] {
  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        ...row,
        semantic: Object.freeze({
          ...row.semantic,
          ...(row.semantic.data ? { data: Object.freeze({ ...row.semantic.data }) } : {}),
        }),
      }),
    ),
  );
}

export class MenuRegistry implements MenuRegistryTarget {
  readonly #handlers = new Map<string, InstalledTransformer>();
  readonly #actions = new Map<string, Map<string, InstalledAction>>();

  constructor(private readonly report: MenuTransformProblem) {}

  register(id: string, transformer: MenuTransformer, owner?: string): void {
    if (id.length === 0) throw new Error("menu registry: id must not be empty");
    if (typeof transformer !== "function") throw new Error("menu registry: transformer must be a function");
    this.#handlers.set(id, { transformer, owner: owner ?? null });
  }

  handlerFor(id: string): MenuTransformer | null {
    return this.#handlers.get(id)?.transformer ?? null;
  }

  addAction(id: string, action: string, label: string, handler: MenuActionHandler, owner?: string): void {
    if (id !== "core:game-menu") {
      throw new Error(`menu registry: actions are not supported in menu "${id}"`);
    }
    if (action.length === 0) throw new Error("menu registry: action must not be empty");
    if (label.length === 0) throw new Error("menu registry: action label must not be empty");
    if (typeof handler !== "function") throw new Error("menu registry: action handler must be a function");
    const actionOwner = owner ?? "core";
    const key = `${actionOwner}:${action}`;
    const rowId = `mod-action:${key}`;
    let actions = this.#actions.get(id);
    if (!actions) {
      actions = new Map();
      this.#actions.set(id, actions);
    }
    actions.set(key, { owner: owner ?? null, action: key, label, handler, rowId });
  }

  /** Bind registration attribution to one mod while preserving handler lookup. */
  forOwner(owner: string): OwnedMenuRegistryTarget {
    return {
      register: (id, transformer): void => this.register(id, transformer, owner),
      handlerFor: (id): MenuTransformer | null => this.handlerFor(id),
      addAction: (id, action, label, handler): void => this.addAction(id, action, label, handler, owner),
    };
  }

  /** Test/session teardown: no installed mod means no transform survives. */
  clear(): void {
    this.#handlers.clear();
    this.#actions.clear();
  }

  transform(id: string, rows: readonly MenuTransformRow[]): readonly MenuTransformRow[] {
    const installed = this.#handlers.get(id);
    let transformed: readonly MenuTransformRow[] = rows;
    if (installed) {
      const original = frozenRows(rows);
      try {
        transformed = installed.transformer(id, original);
      } catch (err) {
        this.report(installed.owner, `menu "${id}" transformer threw: ${message(err)}`);
        return rows;
      }
      if (!Array.isArray(transformed) || !transformed.every(isRow)) {
        this.report(installed.owner, `menu "${id}" transformer returned rows that are not menu rows`);
        return rows;
      }
    }
    const actions = this.#actions.get(id);
    if (!actions) return transformed;
    return [
      ...transformed,
      ...[...actions.values()].map((action) => ({
        id: action.rowId,
        label: action.label,
        semantic: { kind: "mod-action", ref: action.action },
      })),
    ];
  }

  /** Run only a row this registry itself installed; forged semantic tags are inert. */
  async runAction(id: string, rowId: string): Promise<boolean> {
    const action = [...(this.#actions.get(id)?.values() ?? [])].find((candidate) => candidate.rowId === rowId);
    if (!action) return false;
    try {
      await action.handler();
    } catch (err) {
      this.report(action.owner, `menu action "${action.action}" failed: ${message(err)}`);
    }
    return true;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The live menu door. main.ts supplies the player-visible reporter at boot. */
let reportProblem: MenuTransformProblem = () => undefined;
export const menuRegistry = new MenuRegistry((owner, problem) => reportProblem(owner, problem));

export function setMenuTransformProblemReporter(reporter: MenuTransformProblem): void {
  reportProblem = reporter;
}
