import { describe, expect, it } from "vitest";
import { parseDocument, serializeDocument } from "./index.js";
import { subwindowLayoutFormat } from "./subwindow-layout.js";

const main = { kind: "leaf", id: "main" } as const;
const messages = { kind: "leaf", id: "messages" } as const;
const dock = { kind: "split", axis: "v", ratio: 0.7, first: main, second: messages } as const;
const rect = { id: "messages" as const, x: 0.2, y: 0.3, width: 0.4, height: 0.5 };
const base = { enabled: {}, tree: main, mapTileMode: 0 };

describe("floating subwindow documents", () => {
  it("round trips floats and remembered places and reads older documents", () => {
    const data = { ...base, floats: [rect], places: { messages: {
      dock, float: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, last: "float" as const,
    } } };
    const parsed = parseDocument(serializeDocument(subwindowLayoutFormat, data), subwindowLayoutFormat);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data).toEqual(data);
    expect(parseDocument(serializeDocument(subwindowLayoutFormat, base), subwindowLayoutFormat).ok).toBe(true);
  });

  it.each([
    [{ ...rect, id: "main" }, main],
    [rect, dock],
    [{ ...rect, x: -0.1 }, main],
    [{ ...rect, width: 1.1 }, main],
  ])("rejects malformed or docked floats", (floating, tree) => {
    expect(parseDocument({ format: subwindowLayoutFormat.format, schemaVersion: 1,
      data: { ...base, tree, floats: [floating] } }, subwindowLayoutFormat).ok).toBe(false);
  });

  it("rejects duplicate float ids", () => {
    expect(parseDocument({ format: subwindowLayoutFormat.format, schemaVersion: 1,
      data: { ...base, floats: [rect, { ...rect, x: 0.5 }] } }, subwindowLayoutFormat).ok).toBe(false);
  });
});
