import { vi, beforeEach } from "vitest";
import { loader } from "./cost-export";
import { getToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

vi.mock("~/lib/session.server", () => ({ getToken: vi.fn() }));
vi.mock("~/lib/api-client.server", () => ({ createApi: vi.fn() }));

const getTokenMock = vi.mocked(getToken);
const createApiMock = vi.mocked(createApi);

/** Minimal AppLoadContext stub — the loader only forwards it to createApi. */
const CONTEXT = {} as Parameters<typeof loader>[0]["context"];

function req(query: string): Request {
  return new Request(`https://app.example/resources/cost-export${query}`);
}

/** Build a createApi() stub whose cost-export.$get returns `upstream`. */
function stubApi(upstream: Response, format: "csv" | "xlsx") {
  const csvGet = vi.fn();
  const xlsxGet = vi.fn();
  (format === "xlsx" ? xlsxGet : csvGet).mockResolvedValue(upstream);
  createApiMock.mockReturnValue({
    inspections: {
      ":id": {
        "cost-export.csv": { $get: csvGet },
        "cost-export.xlsx": { $get: xlsxGet },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return { csvGet, xlsxGet };
}

describe("cost-export relay loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without ever calling the API when there is no session token", async () => {
    getTokenMock.mockResolvedValue(null);
    const res = await loader({ request: req("?inspectionId=i1&format=csv"), context: CONTEXT, params: {} });
    expect(res.status).toBe(401);
    expect(createApiMock).not.toHaveBeenCalled();
  });

  it("returns 400 when inspectionId is missing", async () => {
    getTokenMock.mockResolvedValue("jwt");
    const res = await loader({ request: req("?format=csv"), context: CONTEXT, params: {} });
    expect(res.status).toBe(400);
    expect(createApiMock).not.toHaveBeenCalled();
  });

  it("relays the CSV upstream body + status + content headers untouched", async () => {
    getTokenMock.mockResolvedValue("jwt");
    const upstream = new Response("system,total_cents\nroof,500000\n", {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="cost-items-i1.csv"',
      },
    });
    const { csvGet, xlsxGet } = stubApi(upstream, "csv");

    const res = await loader({ request: req("?inspectionId=i1&format=csv"), context: CONTEXT, params: {} });

    expect(csvGet).toHaveBeenCalledWith({ param: { id: "i1" } }, { headers: { "x-token-relay": "1" } });
    expect(xlsxGet).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="cost-items-i1.csv"');
    expect(await res.text()).toBe("system,total_cents\nroof,500000\n");
  });

  it("routes format=xlsx to the xlsx endpoint and preserves the binary Content-Type", async () => {
    getTokenMock.mockResolvedValue("jwt");
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04" zip magic
    const upstream = new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="cost-items-i1.xlsx"',
      },
    });
    const { csvGet, xlsxGet } = stubApi(upstream, "xlsx");

    const res = await loader({ request: req("?inspectionId=i1&format=xlsx"), context: CONTEXT, params: {} });

    expect(xlsxGet).toHaveBeenCalledWith({ param: { id: "i1" } }, { headers: { "x-token-relay": "1" } });
    expect(csvGet).not.toHaveBeenCalled();
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("relays an upstream auth failure (403) verbatim instead of masking it", async () => {
    getTokenMock.mockResolvedValue("jwt");
    const upstream = new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
    stubApi(upstream, "csv");

    const res = await loader({ request: req("?inspectionId=i1"), context: CONTEXT, params: {} });
    expect(res.status).toBe(403);
  });

  it("defaults an unknown format to csv (never silently 500s on a bad param)", async () => {
    getTokenMock.mockResolvedValue("jwt");
    const upstream = new Response("h\n", { status: 200, headers: { "Content-Type": "text/csv" } });
    const { csvGet, xlsxGet } = stubApi(upstream, "csv");

    await loader({ request: req("?inspectionId=i1&format=pdf"), context: CONTEXT, params: {} });
    expect(csvGet).toHaveBeenCalledTimes(1);
    expect(xlsxGet).not.toHaveBeenCalled();
  });
});
