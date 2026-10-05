/* Subscribes to an event its manifest does not grant. */
export default {
  api: 1,
  register(_host, ctx) {
    ctx.events.on("message", () => {});
  },
};
