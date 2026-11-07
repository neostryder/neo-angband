// The probe mod's Worker entry: an API 2 definition, as an in-process mod
// exports. Its one dependency is staged beside it, so the probe also proves a
// multi-module graph links inside the sandbox.
import { runChecks } from "./lib/checks.js";

export default {
  api: ">=2.0.0 <3.0.0",
  async start(api) {
    const own = await api.content.own();
    api.meta.log(JSON.stringify(await runChecks(own.value.probe.origin)));
    api.meta.log(`world:${JSON.stringify(await api.view.world())}`);
    api.meta.log(`granted:${JSON.stringify({ any: api.meta.granted("*"), panel: api.meta.granted("ui:panel.mount") })}`);
  },
};
