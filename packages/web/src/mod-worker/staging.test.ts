import { describe, expect, it } from "vitest";
import { MAX_STAGED_SOURCE, stageModuleGraph, type StagedModuleGraph } from "./staging";

const ORIGIN = "neo-angband://game";
const BASE = `${ORIGIN}/mods/probe/`;

function reader(files: Record<string, string>): (url: string) => Promise<string | null> {
  return (url) => Promise.resolve(files[url] ?? null);
}

/** Join a staged graph back into text, writing `<n>` where module n is referred to. */
function joined(graph: StagedModuleGraph): string[] {
  return graph.modules.map((module) => module.parts.map((part) => (typeof part === "number" ? `<${String(part)}>` : part)).join(""));
}

describe("staging a Worker mod's module graph", () => {
  it("puts dependencies first, the entry last, and shares a module imported twice", async () => {
    const graph = await stageModuleGraph(`${BASE}worker.js`, {
      origin: ORIGIN,
      read: reader({
        [`${BASE}worker.js`]: `import { a } from "./lib/a.js";\nimport { b } from "./lib/b.js";\nexport default () => a + b;`,
        [`${BASE}lib/a.js`]: `import { c } from "./c.js";\nexport const a = c;`,
        [`${BASE}lib/b.js`]: `import { c } from "../lib/c.js";\nexport const b = c;`,
        [`${BASE}lib/c.js`]: `export const c = 1;`,
      }),
    });
    expect(graph.modules.map((module) => module.label)).toEqual(["lib/c.js", "lib/a.js", "lib/b.js", "worker.js"]);
    expect(joined(graph)).toEqual([
      "export const c = 1;",
      "import { c } from <0>;\nexport const a = c;",
      "import { c } from <0>;\nexport const b = c;",
      "import { a } from <1>;\nimport { b } from <2>;\nexport default () => a + b;",
    ]);
  });

  it("rewrites a literal dynamic import as well as a static one", async () => {
    const graph = await stageModuleGraph(`${BASE}worker.js`, {
      origin: ORIGIN,
      read: reader({ [`${BASE}worker.js`]: `export default async () => import("./late.js");`, [`${BASE}late.js`]: "export const late = true;" }),
    });
    expect(joined(graph)[1]).toBe("export default async () => import(<0>);");
  });

  it("accepts a picked folder's blob: graph from the game's own origin", async () => {
    const origin = "https://game.example";
    const graph = await stageModuleGraph(`blob:${origin}/entry`, {
      origin,
      read: reader({ [`blob:${origin}/entry`]: `import "blob:${origin}/dep";`, [`blob:${origin}/dep`]: "self;" }),
    });
    expect(joined(graph)).toEqual(["self;", "import <0>;"]);
  });

  it.each([
    ["a bare package name", `import x from "lodash";`],
    ["another origin", `import x from "https://cdn.example/x.js";`],
    ["a data: URL", `import x from "data:text/javascript,export default 1";`],
    ["a path out of the mod's folder", `import x from "../other/x.js";`],
    ["the game's own code", `import x from "/assets/index.js";`],
    ["a query string", `import x from "./x.js?v=1";`],
  ])("refuses %s", async (_what, source) => {
    await expect(stageModuleGraph(`${BASE}worker.js`, {
      origin: ORIGIN,
      read: reader({ [`${BASE}worker.js`]: source, [`${BASE}x.js`]: "", [`${ORIGIN}/mods/other/x.js`]: "", [`${ORIGIN}/assets/index.js`]: "" }),
    })).rejects.toThrow(/worker\.js imports .* which is not one of the mod's own files/u);
  });

  it("refuses a blob: graph that reaches for a URL that is not a blob of its own origin", async () => {
    const origin = "https://game.example";
    for (const spec of [`${origin}/mods/x.js`, "blob:https://elsewhere.example/dep", "./x.js"]) {
      await expect(stageModuleGraph(`blob:${origin}/entry`, {
        origin,
        read: reader({ [`blob:${origin}/entry`]: `import ${JSON.stringify(spec)};` }),
      })).rejects.toThrow(/not one of the mod's own files/u);
    }
  });

  it("refuses an entry that is not on the game's origin", async () => {
    await expect(stageModuleGraph("https://elsewhere.example/worker.js", { origin: ORIGIN, read: reader({}) })).rejects.toThrow(/not a file of this game's own origin/u);
  });

  it("names both files of a cycle and the file that cannot be read", async () => {
    await expect(stageModuleGraph(`${BASE}worker.js`, {
      origin: ORIGIN,
      read: reader({ [`${BASE}worker.js`]: `import "./a.js";`, [`${BASE}a.js`]: `import "./worker.js";` }),
    })).rejects.toThrow("a.js and worker.js import each other");
    await expect(stageModuleGraph(`${BASE}worker.js`, {
      origin: ORIGIN,
      read: reader({ [`${BASE}worker.js`]: `import "./gone.js";` }),
    })).rejects.toThrow("gone.js could not be read");
  });

  it("refuses a graph larger than the size limit", async () => {
    await expect(stageModuleGraph(`${BASE}worker.js`, {
      origin: ORIGIN,
      read: reader({ [`${BASE}worker.js`]: "x".repeat(MAX_STAGED_SOURCE + 1) }),
    })).rejects.toThrow(/larger than/u);
  });
});
