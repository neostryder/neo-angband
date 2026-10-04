// The probe mod's Worker entry. Its one dependency is staged beside it, so the
// probe also proves a multi-module graph links inside the sandbox.
import { runChecks } from "./lib/checks.js";

export default async (api) => {
  api.log("info", JSON.stringify(await runChecks(api.init.data.origin)));
};
