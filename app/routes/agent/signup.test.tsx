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
import { render } from "@testing-library/react";
import { createRoutesStub } from "react-router";

const agentSignupPost = vi.fn();

vi.mock("~/lib/api-client.server", () => ({
  createApi: vi.fn(() => ({
    agentSignup: {
      index: { $post: agentSignupPost },
    },
  })),
}));

import { loader, action } from "~/routes/agent/signup";
import AgentSignupPage from "~/routes/agent/signup";

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

/* ------------------------------------------------------------------ */
/*  Rendering — the blocked state, and the copy that describes it      */
/* ------------------------------------------------------------------ */

/**
 * F71 / F72 / F73, audited 2026-09-10 against a deployment that had never
 * published agent terms.
 *
 * F72: the page said "an account cannot be created" and left all three inputs
 * and a full-strength `Create account` button enabled, with the explanation
 * wedged BETWEEN the password field and the button — so a reader filling the
 * form top-to-bottom chose a password first, read the blocker second, and
 * pressed a button that could not succeed third.
 *
 * F71: that explanation was also wrong in the two ways that mattered. It called
 * a DEPLOYMENT-level fact a workspace one, and sent the agent to the inspecting
 * company's administrator — who cannot publish agent terms however they
 * configure their company, because `deployment_legal_versions` is not
 * per-tenant and `scripts/publish-agent-terms.mjs` is its only writer. A real
 * session went round that loop: signup refused → ask the company → the company's
 * admin finds no such setting → back to the start.
 */
const TERMS = { version: "2026-09-01", contentHash: "a".repeat(64), body: "Agent terms text." };

function renderSignup(terms: typeof TERMS | null) {
  const Stub = createRoutesStub([
    {
      path: "/agent-signup",
      Component: AgentSignupPage,
      loader: () => ({ email: "", returnTo: "", terms }),
      action: async () => ({}),
    },
  ]);
  return render(<Stub initialEntries={["/agent-signup"]} />);
}

describe("agent signup page — when signup cannot succeed", () => {
  it("disables every input and the submit button", async () => {
    const { findByLabelText, getByLabelText, getByText } = renderSignup(null);
    expect((await findByLabelText("Full name") as HTMLInputElement).disabled).toBe(true);
    expect((getByLabelText("Work email") as HTMLInputElement).disabled).toBe(true);
    expect((getByLabelText("Password") as HTMLInputElement).disabled).toBe(true);
    expect((getByText("Create account") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says WHY, above the form rather than inside it", async () => {
    const { findByText, container } = renderSignup(null);
    await findByText(/Agent sign-up is not available yet/);
    // Reading order, which is the half of F72 a disabled-attribute assertion
    // cannot see: the blocker used to sit between the password field and the
    // button, so it was read third. (Position is compared through rendered text
    // rather than compareDocumentPosition, which happy-dom answers 0 to.)
    const text = container.textContent ?? "";
    const notice = text.indexOf("Agent sign-up is not available yet");
    const password = text.indexOf("Password");
    expect(notice).toBeGreaterThan(-1);
    expect(password).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(password);
  });

  it("points the disabled button at that explanation", async () => {
    const { findByText } = renderSignup(null);
    const button = await findByText("Create account");
    expect(button.getAttribute("aria-describedby")).toBe("agent-signup-closed");
    expect(document.getElementById("agent-signup-closed")).toBeTruthy();
  });

  it("describes a deployment, not a workspace, and names nobody who cannot fix it", async () => {
    const { findByText, container } = renderSignup(null);
    await findByText(/Agent sign-up is not available yet/);
    const text = container.textContent ?? "";
    expect(text).toMatch(/This deployment has not published its agent terms/);
    // The two errors, each asserted as an absence — with the presence assertion
    // above as the control, so a page that rendered nothing cannot pass.
    expect(text).not.toMatch(/This workspace has not published/);
    expect(text).not.toMatch(/contact their administrator/);
  });

  it("offers no tick against an absent document", async () => {
    const { findByText, container } = renderSignup(null);
    await findByText(/Agent sign-up is not available yet/);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });
});

describe("agent signup page — when signup CAN succeed (the control)", () => {
  it("leaves the form usable and shows the terms with their tick", async () => {
    const { findByLabelText, getByLabelText, getByText, container } = renderSignup(TERMS);
    expect((await findByLabelText("Full name") as HTMLInputElement).disabled).toBe(false);
    expect((getByLabelText("Work email") as HTMLInputElement).disabled).toBe(false);
    expect((getByLabelText("Password") as HTMLInputElement).disabled).toBe(false);
    expect((getByText("Create account") as HTMLButtonElement).disabled).toBe(false);
    expect(container.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect(getByText(TERMS.body)).toBeTruthy();
  });

  it("does not show the blocked notice", async () => {
    const { findByText, queryByText } = renderSignup(TERMS);
    await findByText("Create account");
    expect(queryByText(/Agent sign-up is not available yet/)).toBeNull();
  });
});

describe("agent signup page — copy aimed at an external agent (F73)", () => {
  it("uses a dash and the product's own container word", async () => {
    const { findByText, container } = renderSignup(TERMS);
    await findByText("Create account");
    const text = container.textContent ?? "";
    expect(text).toMatch(/it pre-fills the right company/);
    // `tenant` is the internal word (CLAUDE.md terminology: Company), and it was
    // on the first screen an external real-estate agent ever sees.
    expect(text).not.toMatch(/the right tenant/);
    // Rendered as two hyphens, not an em dash — the only place on the page that
    // punctuation appeared.
    expect(text).not.toMatch(/instead --/);
  });
});
