// @vitest-environment node
/**
 * The loader guards for pages the API serves only to some viewers.
 *
 * Both fail CLOSED: a session that cannot be read is treated as not allowed, so a
 * page never renders an empty list where the real answer is "not yours to see".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getContext = vi.fn();

vi.mock("~/lib/session.server", () => ({
  requireToken: vi.fn(async () => "tok-123"),
}));

vi.mock("~/lib/api-client.server", () => ({
  createApi: vi.fn(() => ({ sessionContext: { context: { $get: getContext } } })),
}));

import { requireCapabilityLoader, requireNotStaffLoader } from "~/lib/access.server";

const ctx = {} as never;
const req = new Request("http://app.example.com/invoices");

function session(user: unknown, ok = true) {
  getContext.mockResolvedValue({ ok, json: async () => ({ data: { user } }) });
}

beforeEach(() => { getContext.mockReset(); });

describe("requireCapabilityLoader", () => {
  it("lets a viewer holding the capability through", async () => {
    session({ role: "owner", capabilities: { companyFinance: true } });
    expect(await requireCapabilityLoader(ctx, req, "companyFinance")).toEqual({ forbidden: false, token: "tok-123" });
  });

  it("forbids staff, whose companyFinance is off", async () => {
    session({ role: "staff", capabilities: { companyFinance: false } });
    expect((await requireCapabilityLoader(ctx, req, "companyFinance")).forbidden).toBe(true);
  });

  it("forbids when the capability is absent from the session", async () => {
    session({ role: "owner" });
    expect((await requireCapabilityLoader(ctx, req, "companyFinance")).forbidden).toBe(true);
  });

  it("fails closed when the session cannot be read", async () => {
    session(undefined, false);
    expect((await requireCapabilityLoader(ctx, req, "companyFinance")).forbidden).toBe(true);
    getContext.mockImplementation(() => { throw new Error("down"); });
    expect((await requireCapabilityLoader(ctx, req, "companyFinance")).forbidden).toBe(true);
  });
});

describe("requireNotStaffLoader", () => {
  it("forbids staff", async () => {
    session({ role: "staff" });
    expect((await requireNotStaffLoader(ctx, req)).forbidden).toBe(true);
  });

  it("POSITIVE CONTROL - lets owner, manager and inspector through", async () => {
    for (const role of ["owner", "manager", "inspector"]) {
      session({ role });
      expect((await requireNotStaffLoader(ctx, req)).forbidden).toBe(false);
    }
  });

  it("fails closed when the role cannot be resolved", async () => {
    session(undefined, false);
    expect((await requireNotStaffLoader(ctx, req)).forbidden).toBe(true);
  });
});
