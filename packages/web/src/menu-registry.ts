/**
 * The single transformation door for every declarative menu.
 *
 * A transformer belongs to one stable menu id. Later mods replace that slot;
 * they can call handlerFor() before registering to wrap the earlier handler.
 * Failure is deliberately local to the transform: a broken menu is a player
 * trap, so a bad mod loses its rewrite and the original screen still opens.
 */

import type { MenuRegistryTarget, MenuTransformRow, MenuTransformer } from "@rpgm-tools/neo-angband-core";

interface InstalledTransformer {
  readonly owner: string | null;
  readonly transformer: MenuTransformer;
}

export type MenuTransformProblem = (owner: string | null, message: string) => void;

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

  constructor(private readonly report: MenuTransformProblem) {}

  register(id: string, transformer: MenuTransformer, owner?: string): void {
    if (id.length === 0) throw new Error("menu registry: id must not be empty");
    if (typeof transformer !== "function") throw new Error("menu registry: transformer must be a function");
    this.#handlers.set(id, { transformer, owner: owner ?? null });
  }

  handlerFor(id: string): MenuTransformer | null {
    return this.#handlers.get(id)?.transformer ?? null;
  }

  /** Bind registration attribution to one mod while preserving handler lookup. */
  forOwner(owner: string): MenuRegistryTarget {
    return {
      register: (id, transformer): void => this.register(id, transformer, owner),
      handlerFor: (id): MenuTransformer | null => this.handlerFor(id),
    };
  }

  /** Test/session teardown: no installed mod means no transform survives. */
  clear(): void {
    this.#handlers.clear();
  }

  transform(id: string, rows: readonly MenuTransformRow[]): readonly MenuTransformRow[] {
    const installed = this.#handlers.get(id);
    if (!installed) return rows;
    const original = frozenRows(rows);
    let transformed: readonly MenuTransformRow[];
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
    return transformed;
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
