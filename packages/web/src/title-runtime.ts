import type { ModTitle, ModTitleRow } from "./mod-plugin";

export interface RegisteredTitleRow extends ModTitleRow {
  readonly choice: `mod:${number}`;
  readonly owner: string;
}

export class TitleRuntime {
  private nextId = 0;
  private readonly rows = new Map<string, RegisteredTitleRow>();

  constructor(private readonly choose: ModTitle["choose"]) {}

  forMod(owner: string): ModTitle {
    return Object.freeze({
      registerRow: (row: ModTitleRow) => {
        if (!row.label.trim() || /[\r\n]/u.test(row.label)) throw new Error("A title row needs a single-line label.");
        if (row.key !== undefined && !/^[a-z0-9]$/iu.test(row.key)) throw new Error("A title row key must be one letter or digit.");
        if (typeof row.run !== "function") throw new Error("A title row needs a handler.");
        const choice = `mod:${this.nextId++}` as const;
        this.rows.set(choice, Object.freeze({ ...row, ...(row.key === undefined ? {} : { key: row.key.toLowerCase() }), choice, owner }));
        return () => { this.rows.delete(choice); };
      },
      choose: (title: string, choices: readonly string[]) => this.choose(title, choices),
    });
  }

  list(): readonly RegisteredTitleRow[] {
    return [...this.rows.values()];
  }

  removeMod(owner: string): void {
    for (const [choice, row] of this.rows) if (row.owner === owner) this.rows.delete(choice);
  }

  async run(choice: string): Promise<void> {
    await this.rows.get(choice)?.run();
  }
}
