// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { isNetworkFailure } from "~/lib/network-error";

afterEach(() => vi.restoreAllMocks());

describe("isNetworkFailure", () => {
  it("recognises the failed-fetch TypeError of each browser", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new TypeError("Load failed"))).toBe(true);
    expect(isNetworkFailure(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true);
  });

  it("does not call a bug a network failure", () => {
    expect(isNetworkFailure(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isNetworkFailure(new Error("boom"))).toBe(false);
  });

  it("never treats a server answer as a network failure, even when the browser says offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(isNetworkFailure(new Response("nope", { status: 500 }))).toBe(false);
    expect(isNetworkFailure({ status: 404, statusText: "Not Found", data: "" })).toBe(false);
  });

  it("treats any other thrown error as a network failure while the browser reports it is offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(isNetworkFailure(new Error("boom"))).toBe(true);
  });
});
