export default {
  api: 1,
  frontend(ctx) {
    return {
      present(frame) {
        globalThis.__neoFrontendFrames.push({ owner: ctx.id, frame });
      },
    };
  },
};
