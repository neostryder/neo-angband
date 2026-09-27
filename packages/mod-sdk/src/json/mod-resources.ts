import { defineFormat, json } from "./index.js";

const localeValidator = json.object({
  tag: json.string,
  name: json.optional(json.string),
  rtl: json.optional(json.boolean),
  messages: json.optional(json.map(json.string, json.string)),
});

export const modLocaleFormat = defineFormat({
  format: "neo-angband/mod/locale",
  schemaVersion: 1,
  validator: localeValidator,
  sample: { tag: "en", messages: { "demo.greeting": "Hello" } },
});

const fontValidator = json.object({
  w: json.integer,
  h: json.integer,
  glyphs: json.array(json.array(json.integer)),
});

export const modFontFormat = defineFormat({
  format: "neo-angband/mod/font",
  schemaVersion: 1,
  validator: fontValidator,
  sample: { w: 1, h: 1, glyphs: [[0]] },
});
