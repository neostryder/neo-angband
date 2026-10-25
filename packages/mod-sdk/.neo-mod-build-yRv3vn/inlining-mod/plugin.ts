import { REGISTRY } from "pretend-engine";
export default { api: 1, hooks: () => ({ n: REGISTRY.entries.length }) };
