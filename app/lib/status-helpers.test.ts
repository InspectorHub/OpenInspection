import { describe, it, expect } from "vitest";
import { humanizeStatus, statusTone, capitalize } from "~/lib/status";

describe("humanizeStatus", () => {
  it("title-cases underscore-separated status", () => {
    expect(humanizeStatus("in_progress")).toBe("In Progress");
  });
  it("handles single word", () => {
    expect(humanizeStatus("scheduled")).toBe("Scheduled");
  });
  it("handles empty string", () => {
    expect(humanizeStatus("")).toBe("");
  });
});

describe("statusTone", () => {
  it("maps known statuses to pill tones", () => {
    expect(statusTone("requested")).toBe("ni");
    expect(statusTone("scheduled")).toBe("info");
    expect(statusTone("completed")).toBe("sat");
    expect(statusTone("cancelled")).toBe("gen");
  });
  it("falls back to neutral for unknown status", () => {
    expect(statusTone("nonsense_value")).toBe("neutral");
  });
});

describe("capitalize", () => {
  it("capitalizes first letter", () => {
    expect(capitalize("client")).toBe("Client");
  });
  it("handles empty string", () => {
    expect(capitalize("")).toBe("");
  });
});
