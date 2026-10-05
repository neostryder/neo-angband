/* Spends 80 ms of every level arrival in a busy loop, over the 50 ms default budget. */
export default {
  api: 1,
  register(_host, ctx) {
    ctx.events.on("dungeonlevel", () => {
      const until = performance.now() + 80;
      while (performance.now() < until) {
        /* busy */
      }
    });
  },
};
