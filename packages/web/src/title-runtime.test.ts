import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import { modPluginContext, setModTitleControl } from "./mod-context";
import { resetModTeardown, teardownModPlugins } from "./mod-teardown";
import { titleKeyChoice, titleRows } from "./news";
import { TitleRuntime } from "./title-runtime";

const options = { canLoad: true, canOpen: true, canQuit: false, canInstall: false, canUpdate: false, updateReady: false };

describe("mod title rows", () => {
  it("keeps registration order after the core rows and protects core keys", async () => {
    const choose = vi.fn(async () => 0);
    const runtime = new TitleRuntime(choose);
    const first = vi.fn();
    runtime.forMod("one").registerRow({ label: "New test character", key: "N", run: first });
    runtime.forMod("two").registerRow({ label: "Other character", key: "T", run: () => undefined });
    const rows = titleRows({ ...options, modRows: runtime.list() });
    expect(rows.slice(0, -2)).toEqual(titleRows(options));
    expect(rows.slice(-2).map((r) => r.label)).toEqual(["New test character", "(T) Other character"]);
    expect(titleKeyChoice("n", rows, false)).toBe("new");
    expect(titleKeyChoice("t", rows, false)).toBe(runtime.list()[1]?.choice);
    await runtime.run(runtime.list()[0]!.choice);
    expect(first).toHaveBeenCalledOnce();
    expect(await runtime.forMod("one").choose("Where?", ["Separate", "Here"])).toBe(0);
    expect(choose).toHaveBeenCalledWith("Where?", ["Separate", "Here"]);
  });

  it("removes individual rows and every row owned by an uninstalled mod", () => {
    const runtime = new TitleRuntime(async () => null);
    const one = runtime.forMod("one");
    const remove = one.registerRow({ label: "First", run: () => undefined });
    remove();
    remove();
    one.registerRow({ label: "Second", run: () => undefined });
    runtime.forMod("two").registerRow({ label: "Other", run: () => undefined });
    resetModTeardown();
    teardownModPlugins({
      plugins: [{ id: "one", plugin: { uninstall: () => { one.registerRow({ label: "Last", run: () => undefined }); } } }],
      controller: null,
      removeTitleRows: (id) => runtime.removeMod(id),
    });
    expect(runtime.list().map((r) => r.owner)).toEqual(["two"]);
    resetModTeardown();
  });

  it("withholds the title door without its own capability", () => {
    const runtime = new TitleRuntime(async () => null);
    setModTitleControl((id) => runtime.forMod(id));
    try {
      expect(modPluginContext("one", {}).title).toBeUndefined();
      const capabilities = CapabilitySet.fromManifest({ id: "one", name: "One", version: "1.0.0", shape: "plugin", modApi: 1, capabilities: ["ui:title"] });
      expect(modPluginContext("one", {}, undefined, {}, { capabilities }).title).toBeDefined();
    } finally {
      setModTitleControl(undefined);
    }
  });

  it("wires registered rows into the title and its action handler", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
    expect(source).toContain("modRows: modTitle.list()");
    expect(source).toContain("await modTitle.run(choice)");
    expect(source).toContain("removeTitleRows: (id) => modTitle.removeMod(id)");
  });
});
