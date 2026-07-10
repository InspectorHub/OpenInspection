import { expect, test } from "vitest";
import { SEVERITY_LABEL, SEVERITIES, isSeverity } from "./severity";

test("severity vocabulary is the canonical four with friendly labels", () => {
  expect([...SEVERITIES]).toEqual(["good", "marginal", "significant", "minor"]);
  expect(SEVERITY_LABEL.good).toBe("Satisfactory");
  expect(SEVERITY_LABEL.marginal).toBe("Monitor");
  expect(SEVERITY_LABEL.significant).toBe("Defect");
  expect(SEVERITY_LABEL.minor).toBe("N/A");
});

test("isSeverity narrows unknown values to the canonical vocabulary", () => {
  expect(isSeverity("good")).toBe(true);
  expect(isSeverity("significant")).toBe(true);
  expect(isSeverity("satisfactory")).toBe(false);
  expect(isSeverity(null)).toBe(false);
  expect(isSeverity(undefined)).toBe(false);
});
