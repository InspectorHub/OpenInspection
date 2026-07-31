import { describe, expect, it } from "vitest";
import { getBaseUrlFromRequest, rebaseHostedLegalUrl } from "./legal-base-url";

describe("rebaseHostedLegalUrl", () => {
  it("rewrites hosted /legal paths onto the browser origin", () => {
    expect(
      rebaseHostedLegalUrl(
        "http://localhost/legal/acme/privacy",
        "http://127.0.0.1:8787",
      ),
    ).toBe("http://127.0.0.1:8787/legal/acme/privacy");
  });

  it("leaves custom website URLs unchanged", () => {
    expect(
      rebaseHostedLegalUrl("https://example.com/privacy", "http://127.0.0.1:8787"),
    ).toBe("https://example.com/privacy");
  });

  it("accepts relative hosted paths", () => {
    expect(rebaseHostedLegalUrl("/legal/acme/terms", "https://app.example")).toBe(
      "https://app.example/legal/acme/terms",
    );
  });
});

describe("getBaseUrlFromRequest", () => {
  it("uses protocol + host from the request URL", () => {
    const req = new Request("http://127.0.0.1:8787/settings/compliance");
    expect(getBaseUrlFromRequest(req)).toBe("http://127.0.0.1:8787");
  });
});
