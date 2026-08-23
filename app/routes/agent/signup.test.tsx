// @vitest-environment happy-dom
/**
 * Task 4 (report-link conversion) — /agent-signup query-param prefill + guarded returnTo redirect.
 *
 * Pattern: exercise loader/action directly with a mocked BFF (no client fetch,
 * no rendering needed — same approach as connected-apps.test.ts).
 *
 * Asserts:
 *   - Loader reads ?email= and prefills it; reads ?returnTo= and sanitizes it
 *     to a same-origin relative path.
 *   - Open-redirect guard: absolute (https://evil.com) and protocol-relative
 *     (//evil.com) returnTo values are rejected at both the loader and the
 *     action (defense in depth — the hidden field is never trusted blindly).
 *   - On successful signup, the action's redirect target honors a sanitized
 *     returnTo, falls back to /agent-dashboard when absent, and still lets an
 *     explicit API-provided redirect win over returnTo.
 *   - Task 4c: a report-path returnTo (`/portal/:tenant/i/:inspectionId`)
 *     redirects to `/agent-dashboard?welcome=<inspectionId>` instead of back
 *     to the tokenized report, since that inspection is already auto-linked
 *     into the agent's referrals.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const agentSignupPost = vi.fn();

vi.mock("~/lib/api-client.server", () => ({
  createApi: vi.fn(() => ({
    agentSignup: {
      index: { $post: agentSignupPost },
    },
  })),
}));

import { loader, action } from "~/routes/agent/signup";

type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];

function loaderArgs(url: string): LoaderArgs {
  return {
    request: new Request(url),
    context: {} as never,
    params: {},
  } as unknown as LoaderArgs;
}

function actionArgs(form: Record<string, string>): ActionArgs {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.set(k, v);
  return {
    request: new Request("http://app.example.com/agent-signup", {
      method: "POST",
      body: fd,
    }),
    context: {} as never,
    params: {},
  } as unknown as ActionArgs;
}

function jsonRes(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response;
}

const VALID_SIGNUP = {
  name: "Alice Agent",
  email: "a@x.com",
  password: "SuperSecret123!",
  // An agent is a third party and the tick is required — an account is not
  // created without it. A fixture that omitted it would
  // make every returnTo case below fail on the acceptance instead, which is what
  // happened when the field landed.
  agentTerms: "on",
};

beforeEach(() => {
  agentSignupPost.mockReset().mockResolvedValue(jsonRes({ success: true, data: {} }));
});

describe("agent signup loader", () => {
  it("prefills email and carries a sanitized same-origin returnTo", async () => {
    const data = await loader(
      loaderArgs(
        "http://app.example.com/agent-signup?email=a%40x.com&returnTo=%2Fportal%2Facme%2Fi%2Fi1%3Ftoken%3Dt",
      ),
    );
    expect(data.email).toBe("a@x.com");
    expect(data.returnTo).toBe("/portal/acme/i/i1?token=t");
  });

  it("defaults email to empty string and returnTo to empty when absent", async () => {
    const data = await loader(loaderArgs("http://app.example.com/agent-signup"));
    expect(data.email).toBe("");
    expect(data.returnTo).toBe("");
  });

  it("rejects an absolute-URL returnTo (open-redirect guard)", async () => {
    const data = await loader(
      loaderArgs("http://app.example.com/agent-signup?returnTo=https%3A%2F%2Fevil.com"),
    );
    expect(data.returnTo).toBe("");
  });

  it("rejects a protocol-relative returnTo (open-redirect guard)", async () => {
    const data = await loader(
      loaderArgs("http://app.example.com/agent-signup?returnTo=%2F%2Fevil.com"),
    );
    expect(data.returnTo).toBe("");
  });
});

describe("agent signup action redirect target", () => {
  it("honors a sanitized returnTo carried by the hidden field on success", async () => {
    const res = await action(
      actionArgs({ ...VALID_SIGNUP, returnTo: "/agent-dashboard/foo" }),
    );
    expect(res).toMatchObject({ redirect: "/agent-dashboard/foo" });
  });

  it("redirects a report-path returnTo to the dashboard welcome highlight instead of back to the report", async () => {
    const res = await action(
      actionArgs({ ...VALID_SIGNUP, returnTo: "/portal/acme/i/i1?token=t" }),
    );
    expect(res).toMatchObject({ redirect: "/agent-dashboard?welcome=i1" });
  });

  it("falls back to /agent-dashboard when returnTo is absent", async () => {
    const res = await action(actionArgs({ ...VALID_SIGNUP }));
    expect(res).toMatchObject({ redirect: "/agent-dashboard" });
  });

  it("rejects an absolute-URL returnTo hidden field, falling back to /agent-dashboard", async () => {
    const res = await action(
      actionArgs({ ...VALID_SIGNUP, returnTo: "https://evil.com" }),
    );
    expect(res).toMatchObject({ redirect: "/agent-dashboard" });
  });

  it("rejects a protocol-relative returnTo hidden field, falling back to /agent-dashboard", async () => {
    const res = await action(
      actionArgs({ ...VALID_SIGNUP, returnTo: "//evil.com" }),
    );
    expect(res).toMatchObject({ redirect: "/agent-dashboard" });
  });

  it("lets an explicit API-provided redirect win over returnTo", async () => {
    agentSignupPost.mockResolvedValue(
      jsonRes({ success: true, data: { redirect: "/agent-dashboard?welcome=insp1" } }),
    );
    const res = await action(
      actionArgs({ ...VALID_SIGNUP, returnTo: "/somewhere-else" }),
    );
    expect(res).toMatchObject({ redirect: "/agent-dashboard?welcome=insp1" });
  });
});

describe("the agent terms tick is required", () => {
  it("refuses a submission with the box unchecked, and calls no API", async () => {
    // An unchecked checkbox submits NOTHING, so this is the shape a real
    // browser produces — the field is absent, not "off".
    const withoutTick = { ...VALID_SIGNUP };
    delete (withoutTick as Partial<typeof VALID_SIGNUP>).agentTerms;
    const res = await action(actionArgs(withoutTick as Record<string, string>));
    expect(agentSignupPost).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).toMatch(/Agent Terms/i);
  });

  it("refuses a value that is not the tick", async () => {
    const res = await action(actionArgs({ ...VALID_SIGNUP, agentTerms: "off" }));
    expect(agentSignupPost).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).toMatch(/Agent Terms/i);
  });

  it("sends only the tick — never a client-asserted version or hash", async () => {
    // The version and content hash are resolved server-side from the document in
    // force. A client-supplied pair would be the client asserting what it read,
    // which is exactly the evidence this record replaces.
    await action(actionArgs(VALID_SIGNUP));
    expect(agentSignupPost).toHaveBeenCalledTimes(1);
    const body = agentSignupPost.mock.calls[0]![0]!.json as Record<string, unknown>;
    expect(body.termsAccepted).toBe(true);
    expect(Object.keys(body)).not.toContain("version");
    expect(Object.keys(body)).not.toContain("contentHash");
  });
});
