/* Deliberately wrong: a VALUE import of the engine. The builder must refuse this. */
import { TMD } from "@rpgm-tools/neo-angband-core";

export default {
  api: 1,
  hooks(): Record<string, unknown> {
    return { blind: TMD.BLIND };
  },
};
