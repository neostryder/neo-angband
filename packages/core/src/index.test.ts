import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, PARITY_BASELINE } from "./index.js";

describe("core scaffold", () => {
	it("declares the 4.2.6 parity baseline", () => {
		expect(PARITY_BASELINE).toBe("4.2.6");
	});

	it("exports an engine version", () => {
		expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
	});
});
