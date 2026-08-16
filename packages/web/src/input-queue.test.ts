import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearInputQueue, enqueueKeys } from "./input-queue";
import { clearInputDoor, onKeydown } from "./input-door";

/** One real macrotask (the pump paces one key per setTimeout(0)). */
function macrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("input queue (keymap expansion feed)", () => {
  let got: string[];
  beforeEach(() => {
    clearInputDoor();
    clearInputQueue();
    got = [];
    onKeydown((ev) => got.push(ev.key));
  });
  afterEach(() => {
    clearInputQueue();
    clearInputDoor();
  });

  it("delivers queued keys through the input door in order, none synchronously", async () => {
    enqueueKeys([{ key: "q" }, { key: "c" }]);
    // A modal opened by the first key must get to attach before the next key
    // arrives, so nothing is delivered synchronously.
    expect(got).toEqual([]);
    await macrotask();
    await macrotask();
    await macrotask();
    expect(got).toEqual(["q", "c"]);
  });

  it("clearInputQueue drops keys not yet delivered", async () => {
    enqueueKeys([{ key: "a" }, { key: "b" }, { key: "c" }]);
    await macrotask(); // 'a' delivered
    expect(got).toEqual(["a"]);
    clearInputQueue();
    await macrotask();
    await macrotask();
    await macrotask();
    expect(got).toEqual(["a"]); // b, c were cleared
  });
});
