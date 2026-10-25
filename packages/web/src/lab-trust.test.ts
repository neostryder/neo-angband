import { describe, expect, it } from "vitest";
import { labBuild, parseLabTrust } from "./lab-trust";

describe("lab trust", () => {
  it("names the ids a lab launch lists", () => {
    expect([...parseLabTrust("?labtrust=anybandui, squire,,", true)]).toEqual(["anybandui", "squire"]);
  });

  it("ignores the flag in a build that was not compiled for the lab", () => {
    expect(parseLabTrust("?labtrust=anybandui", false).size).toBe(0);
  });

  it("is empty without the flag", () => {
    expect(parseLabTrust("?safe=1", true).size).toBe(0);
  });

  it("is not a lab build here, because tests are compiled without the define", () => {
    expect(labBuild()).toBe(false);
  });
});
