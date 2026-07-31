/* Compiles, exports no default. The builder must refuse it rather than write a
 * plugin.js the host will reject much later, with much less context. */
export const notThePlugin = { api: 1, hooks: () => null };
