import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/session.server", () => ({ getToken: vi.fn() }));
vi.mock("~/lib/api-client.server", () => ({ createApi: vi.fn() }));

import { loader } from "./places";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

const mockGetToken = vi.mocked(getToken);
const mockCreateApi = vi.mocked(createApi);

type Args = Parameters<typeof loader>[0];
const ctx = {} as Args["context"];

function call(url: string): Promise<{ suggestions: unknown[]; address: unknown }> {
  return loader({ request: new Request(url), context: ctx, params: {} } as Args) as Promise<{
    suggestions: unknown[];
    address: unknown;
  }>;
}

function apiWith(autocomplete: unknown, details: unknown) {
  return {
    places: {
      autocomplete: { $get: vi.fn().mockResolvedValue(autocomplete) },
      details: { $get: vi.fn().mockResolvedValue(details) },
    },
  } as unknown as ReturnType<typeof createApi>;
}

describe("resources.places loader", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty when unauthenticated", async () => {
    mockGetToken.mockResolvedValue(null);
    const out = await call("http://x/resources/places?q=123&session=12345678");
    expect(out.suggestions).toEqual([]);
    expect(out.address).toBeNull();
    expect(mockCreateApi).not.toHaveBeenCalled();
  });

  it("returns suggestions for ?q=", async () => {
    mockGetToken.mockResolvedValue("tok");
    mockCreateApi.mockReturnValue(
      apiWith(
        {
          ok: true,
          json: async () => ({
            data: [
              { placeId: "p1", description: "123 Main St, Austin", mainText: "123 Main St", secondaryText: "Austin, TX" },
              { placeId: "p2", description: "123 Main Ave", mainText: "123 Main Ave", secondaryText: "Dallas, TX" },
            ],
          }),
        },
        null,
      ),
    );
    const out = await call("http://x/resources/places?q=123%20Main&session=12345678");
    expect(out.suggestions).toHaveLength(2);
    expect(out.address).toBeNull();
  });

  it("returns a structured address for ?placeId=", async () => {
    mockGetToken.mockResolvedValue("tok");
    mockCreateApi.mockReturnValue(
      apiWith(null, {
        ok: true,
        json: async () => ({
          data: { placeId: "p1", formatted: "123 Main St", street: "123 Main St", city: "Austin", state: "TX", zip: "78701", county: "Travis", lat: 30.26, lng: -97.74 },
        }),
      }),
    );
    const out = await call("http://x/resources/places?placeId=p1&session=12345678");
    expect((out.address as { placeId: string }).placeId).toBe("p1");
    expect((out.address as { lat: number }).lat).toBeCloseTo(30.26);
  });

  it("degrades to empty when the upstream call is not ok (e.g. no API key -> 400)", async () => {
    mockGetToken.mockResolvedValue("tok");
    mockCreateApi.mockReturnValue(apiWith({ ok: false }, null));
    const out = await call("http://x/resources/places?q=123&session=12345678");
    expect(out.suggestions).toEqual([]);
  });

  it("rejects a too-short session token without hitting the API", async () => {
    mockGetToken.mockResolvedValue("tok");
    const api = apiWith({ ok: true, json: async () => ({ data: [] }) }, null);
    mockCreateApi.mockReturnValue(api);
    const out = await call("http://x/resources/places?q=123&session=short");
    expect(out.suggestions).toEqual([]);
  });
});
