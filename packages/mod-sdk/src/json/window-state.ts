import { defineFormat, json } from "./index.js";

const position = json.object({ x: json.integer, y: json.integer });
const validator = json.object({
  fullscreen: json.boolean,
  maximized: json.boolean,
  width: json.integer,
  height: json.integer,
  position: json.nullable(position),
});

const windowValidator: typeof validator = {
  validate(value, path = "$") {
    const result = validator.validate(value, path);
    if (!result.ok) return result;
    const issues = [];
    if (result.value.width < 640 || result.value.width > 32767) {
      issues.push({ path: `${path}["width"]`, message: "width must be from 640 to 32767" });
    }
    if (result.value.height < 480 || result.value.height > 32767) {
      issues.push({ path: `${path}["height"]`, message: "height must be from 480 to 32767" });
    }
    if (result.value.fullscreen && result.value.maximized) {
      issues.push({ path: `${path}["maximized"]`, message: "fullscreen and maximized cannot both be true" });
    }
    return issues.length ? { ok: false, issues } : result;
  },
};

export const windowStateFormat = defineFormat({
  format: "neo-angband/desktop/window-state",
  schemaVersion: 1,
  validator: windowValidator,
  sample: {
    fullscreen: false,
    maximized: false,
    width: 1200,
    height: 800,
    position: null,
  },
});
