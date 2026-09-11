// @vitest-environment happy-dom
/**
 * F69 — the agent portal's admission rule, at the loader every `/agent-*` page
 * runs.
 *
 * Before this, `agent-layout`'s loader called `requireToken` and nothing else:
 * any signed-in session was served the portal. Measured in a browser against a
 * real inspector session — `GET /agent-dashboard` answered 200 and rendered the
 * whole agent shell, while every agent endpoint behind it answered
 * `403 Requires one of [agent]`. Nothing leaked; the wrong audience was still
 * shown somebody else's front door and told the page was broken.
 *
 * Both halves are pinned here. Refusing a non-agent is the fix; ADMITTING a real
 * agent is the control, without which a guard that refused everyone would pass.
 *
 * Pattern: the loader is exercised directly against a mocked BFF, as in
 * app/routes/agent/settings-profile.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const profileGet = vi.fn();
const noticesGet = vi.fn();

vi.mock("~/lib/session.server", () => ({
  requireToken: vi.fn(async () => "tok-test"),
}));

vi.mock("~/lib/api-client.server", () => ({
  createApi: vi.fn(() => ({
    agent: { profile: { $get: profileGet } },
    agentNotices: { notices: { $get: noticesGet } },
  })),
}));

import { loader } from "~/routes/agent-layout";

type LoaderArgs = Parameters<typeof loader>[0];

function loaderArgs(path = "/agent-dashboard"): LoaderArgs {
  return {
    request: new Request(`http://app.example.com${path}`),
    context: {} as never,
    params: {},
  } as unknown as LoaderArgs;
}

/** A typed-client response: status + ok + json, which is all the loader reads. */
function apiRes(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

const AGENT_PROFILE = {
  success: true,
  data: { name: "Jane Agent", email: "jane@realty.test", slug: "jane", timezone: "America/Chicago" },
};

beforeEach(() => {
  profileGet.mockReset();
  noticesGet.mockReset().mockResolvedValue(apiRes(200, { success: true, data: { notices: [], unread: 0 } }));
});

async function thrownBy(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

describe("agent-layout loader — admission", () => {
  it("refuses a signed-in NON-agent, redirecting out of the portal", async () => {
    // Exactly what a real inspector session gets from the agent API.
    profileGet.mockResolvedValue(
      apiRes(403, { error: { message: "Requires one of [agent]", code: "forbidden" } }),
    );

    const thrown = await thrownBy(() => loader(loaderArgs()));
    // Positive control on the assertion: "nothing was thrown" must not pass.
    expect(thrown instanceof Response).toBe(true);
    const res = thrown as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  it("refuses BEFORE the portal does any work of its own", async () => {
    // The bell read sits after the guard, so this pins the ordering rather than
    // just the outcome: a refused session must not cause agent-portal reads.
    profileGet.mockResolvedValue(apiRes(403, { error: { message: "Requires one of [agent]" } }));
    await thrownBy(() => loader(loaderArgs()));
    expect(noticesGet).not.toHaveBeenCalled();
  });

  it("ADMITS a real agent and hands the page their identity (the control)", async () => {
    profileGet.mockResolvedValue(apiRes(200, AGENT_PROFILE));

    const data = await loader(loaderArgs());
    expect(data.account).toEqual({ name: "Jane Agent", email: "jane@realty.test" });
    expect(data.agentTimezone).toBe("America/Chicago");
    expect(noticesGet).toHaveBeenCalledTimes(1);
  });

  it("sends a session the API will not authenticate to the agent door", async () => {
    profileGet.mockResolvedValue(apiRes(401, { error: { message: "Unauthorized" } }));
    const res = (await thrownBy(() => loader(loaderArgs()))) as Response;
    expect(res instanceof Response).toBe(true);
    expect(res.headers.get("location")).toBe("/agent-login");
  });

  it("refuses when the decision cannot be obtained at all", async () => {
    // The previous code caught this and carried on with `profileRes = null`,
    // which admitted everybody precisely when nobody could be identified.
    profileGet.mockRejectedValue(new Error("binding down"));
    const res = (await thrownBy(() => loader(loaderArgs()))) as Response;
    expect(res instanceof Response).toBe(true);
    expect(res.status).toBe(503);
  });

  it("still redirects a gated agent to accept the terms (428 is not an admission failure)", async () => {
    profileGet.mockResolvedValue(
      apiRes(428, {
        error: { code: "AGENT_TERMS_REQUIRED", details: { acceptPath: "/agent-accept-terms" } },
      }),
    );
    const res = (await thrownBy(() => loader(loaderArgs()))) as Response;
    expect(res.headers.get("location")).toBe(
      "/agent-accept-terms?returnTo=" + encodeURIComponent("/agent-dashboard"),
    );
  });

  it("admits an agent whose profile row cannot be read, with no identity to show", async () => {
    // A broken record, not the wrong audience: the menu degrades to the role and
    // the logout, rather than the whole portal becoming unreachable.
    profileGet.mockResolvedValue(apiRes(404, { error: { message: "Agent profile not found" } }));
    const data = await loader(loaderArgs());
    expect(data.account).toBeNull();
  });
});
