import { describe, expect, it } from "vitest";
import { m } from "../../i18n";

// The publish dialog is shown on the web and in the native app; its delivery sentence names no page that only one has.
describe("publish dialog delivery sentence", () => {
  it("does not point at a 'Send report' button on an inspection page", () => {
    const text = m.report_publish_body_delivery();
    expect(text).not.toMatch(/Send report/i);
    expect(text).not.toMatch(/inspection page/i);
    expect(text).toMatch(/send it from the inspection\.$/);
  });
});
