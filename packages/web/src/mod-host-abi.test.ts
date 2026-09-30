import { describe, expectTypeOf, it } from "vitest";
import type { ModPluginContext } from "@rpgm-tools/neo-angband-core";
import type { ModPlugin } from "./mod-plugin";
import { modPluginContext } from "./mod-context";

describe("the published host ABI", () => {
  it("types the host context builder and plugin callbacks with Core's context", () => {
    expectTypeOf<ReturnType<typeof modPluginContext>>().toEqualTypeOf<ModPluginContext>();
    expectTypeOf<Parameters<NonNullable<ModPlugin["register"]>>[1]>().toEqualTypeOf<ModPluginContext>();
    expectTypeOf<Parameters<NonNullable<ModPlugin["hooks"]>>[0]>().toEqualTypeOf<ModPluginContext>();
    expectTypeOf<Parameters<NonNullable<ModPlugin["hud"]>>[0]>().toEqualTypeOf<ModPluginContext>();
    expectTypeOf<Parameters<NonNullable<ModPlugin["controller"]>>[0]>().toEqualTypeOf<ModPluginContext>();
  });
});
