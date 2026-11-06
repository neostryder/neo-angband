import { describe, expect, it } from "vitest";
import { assertNewerThanInstalled } from "./update-guard.js";

describe("assertNewerThanInstalled", () => {
  it("accepts a newer release, with or without the leading v", () => {
    expect(() => assertNewerThanInstalled("v1.24.0", "1.23.0")).not.toThrow();
    expect(() => assertNewerThanInstalled("1.23.0", "1.23.0-beta.3")).not.toThrow();
    expect(() => assertNewerThanInstalled("v1.23.1-edge.4", "1.23.0")).not.toThrow();
  });

  it("refuses an older release, the same release, and a tag that is not a version", () => {
    expect(() => assertNewerThanInstalled("v1.22.0", "1.23.0")).toThrow(/not newer/u);
    expect(() => assertNewerThanInstalled("v1.23.0", "1.23.0")).toThrow(/not newer/u);
    expect(() => assertNewerThanInstalled("v1.23.0-beta.2", "1.23.0-beta.3")).toThrow(/not newer/u);
    expect(() => assertNewerThanInstalled("latest", "1.23.0")).toThrow(/not newer/u);
  });
});
