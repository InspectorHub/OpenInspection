import { describe, it, expect } from "vitest";
import { isCrossSitePost } from "./same-origin-post.server";

const post = (headers: Record<string, string>) => new Request("https://app.example.com/portal/acme/auth?link=x", { method: "POST", headers });

describe("isCrossSitePost", () => {
  it("refuses what the browser marks cross-site, a foreign or null Origin, and same-site without our Origin", () => {
    expect(isCrossSitePost(post({ "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(isCrossSitePost(post({ "sec-fetch-site": "cross-site", origin: "https://app.example.com" }))).toBe(true);
    expect(isCrossSitePost(post({ origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSitePost(post({ origin: "null" }))).toBe(true);
    expect(isCrossSitePost(post({ origin: "https://app.example.com.evil.example" }))).toBe(true);
    expect(isCrossSitePost(post({ "sec-fetch-site": "same-site" }))).toBe(true);
    expect(isCrossSitePost(post({ "sec-fetch-site": "same-site", origin: "https://other.example.com" }))).toBe(true);
  });

  it("allows same-origin, typed-in or bookmarked, our own Origin, and a client that sends neither header", () => {
    expect(isCrossSitePost(post({ "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(isCrossSitePost(post({ "sec-fetch-site": "none" }))).toBe(false);
    expect(isCrossSitePost(post({ origin: "https://app.example.com" }))).toBe(false);
    expect(isCrossSitePost(post({ "sec-fetch-site": "same-site", origin: "https://app.example.com" }))).toBe(false);
    expect(isCrossSitePost(post({}))).toBe(false);
  });
});
