/**
 * Visible agent mode (agent-mode.ts).
 *
 * Verified end to end before this file existed, and the measurement is the
 * reason the tests below are shaped the way they are: the desktop build was
 * launched with `NEO_ANGBAND_AGENT=demo-wanderer` and its DevTools target
 * reported the window had loaded `http://127.0.0.1:45871/?agent=demo-wanderer`.
 * Then the canvas was fingerprinted seven times over eight seconds with NO input
 * dispatched: five distinct screen states. The agent was playing the window.
 *
 * What that run cannot do is fail in CI, so the URL half is pinned here.
 */

import { describe, expect, it } from "vitest";
import { agentQuery } from "./agent-mode";

describe("agentQuery", () => {
  it("is empty when no agent was asked for", () => {
    /* The default path, and the one that must not change: an ordinary launch
     * loads the renderer with no query string at all. */
    expect(agentQuery({})).toBe("");
  });

  it("treats an empty or blank value as no agent", () => {
    /* `NEO_ANGBAND_AGENT=` in a shell profile or a CI env block sets the
     * variable to "". Reading that as "yes, an agent named nothing" would send
     * `?agent=` to the renderer, whose lookup would miss and leave a query
     * string on the URL for no reason. */
    expect(agentQuery({ NEO_ANGBAND_AGENT: "" })).toBe("");
    expect(agentQuery({ NEO_ANGBAND_AGENT: "   " })).toBe("");
  });

  it("passes the id through as a query parameter", () => {
    expect(agentQuery({ NEO_ANGBAND_AGENT: "demo-wanderer" })).toBe("?agent=demo-wanderer");
  });

  it("trims, because a trailing newline is what a shell pipeline leaves", () => {
    expect(agentQuery({ NEO_ANGBAND_AGENT: " demo-wanderer\n" })).toBe("?agent=demo-wanderer");
  });

  it("encodes, so a value from the environment cannot add a second parameter", () => {
    /* The renderer ignores an id it does not know, so a bogus one is inert - but
     * an unencoded `&` would not be an id at all, it would be another parameter,
     * and the renderer reads several. */
    expect(agentQuery({ NEO_ANGBAND_AGENT: "x&graf=6" })).toBe("?agent=x%26graf%3D6");
    expect(agentQuery({ NEO_ANGBAND_AGENT: "a b" })).toBe("?agent=a%20b");
  });
});
