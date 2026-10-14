import { describe, expectTypeOf, it } from "vitest";
import type { ModPluginContext } from "@rpgm-tools/neo-angband-core";
import type { ModPlugin } from "./mod-plugin";
import type { Api2Engine } from "@rpgm-tools/neo-angband-mod-sdk";
import { modPluginContext } from "./mod-context";

describe("the published host ABI", () => {
  it("keeps engine.core and ctx.core on the same exported namespace", () => {
    expectTypeOf<Api2Engine["core"]>().toEqualTypeOf<ModPluginContext["core"]>();
    expectTypeOf<Api2Engine["state"]>().toEqualTypeOf<ModPluginContext["state"]>();
    expectTypeOf<Api2Engine["registries"]>().toEqualTypeOf<ModPluginContext["registries"]>();
  });
  it("types the host context builder and plugin callbacks with Core's context", () => {
    expectTypeOf<ReturnType<typeof modPluginContext>>().toEqualTypeOf<ModPluginContext>();
    expectTypeOf<Parameters<NonNullable<ModPlugin["register"]>>[1]>().toEqualTypeOf<ModPluginContext>();
    expectTypeOf<Parameters<NonNullable<ModPlugin["hooks"]>>[0]>().toEqualTypeOf<ModPluginContext>();
    expectTypeOf<Parameters<NonNullable<ModPlugin["hud"]>>[0]>().toEqualTypeOf<ModPluginContext>();
    expectTypeOf<Parameters<NonNullable<ModPlugin["controller"]>>[0]>().toEqualTypeOf<ModPluginContext>();
  });

  it("publishes an optional reason on controller release", () => {
    expectTypeOf<NonNullable<ModPluginContext["controller"]>["release"]>()
      .toEqualTypeOf<(reason?: string) => void>();
  });
});
