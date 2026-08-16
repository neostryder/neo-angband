/* Declares a front end and asks for the override WILDCARD, but never for
 * display:replace. It is LAST in load order, so it would own the map under the
 * last-wins rule alone - the capability gate is the only thing stopping it, and
 * a throw here is how the test would notice if it ran anyway. */
export default {
  api: 1,
  frontend() {
    throw new Error("ungated-view must never be constructed");
  },
};
