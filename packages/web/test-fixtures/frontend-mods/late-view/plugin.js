export default {
  api: 1,
  frontend(ctx) {
    return {
      present(frame) {
        const measurement = (name, value) => {
          if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new TypeError(`WorldFrame ${name} must be a finite number`);
          }
          return value;
        };
        const width = measurement("viewport.size.width", frame?.viewport?.size?.width);
        const height = measurement("viewport.size.height", frame?.viewport?.size?.height);
        const cells = measurement("cells.length", frame?.cells?.length);
        const badge = `WorldFrame ${width}x${height} (${cells} cells)`;
        globalThis.__neoFrontendFrames.push({ owner: ctx.id, badge, frame });
      },
    };
  },
};
