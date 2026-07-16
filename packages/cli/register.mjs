/**
 * Registers loader.mjs as a resolve hook, then yields to the entry module.
 * Used via `node --import ./register.mjs dist/<entry>.js` (see package.json
 * scripts). Kept separate from loader.mjs because a hook module must not also
 * be the thing that registers itself.
 */
import { register } from "node:module";

register("./loader.mjs", import.meta.url);
