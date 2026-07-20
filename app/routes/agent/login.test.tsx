/**
 * Spec 3 Task 5 — core `/agent-login` dual-mode front door page.
 *
 * Pattern: action is exercised directly against a mocked BFF (mirrors
 * app/routes/agent/signup.test.tsx); the rendered page is exercised via
 * createRoutesStub + @testing-library/react (mirrors
 * app/routes/agent/settings-profile.test.tsx) so a real button click submits
 * the intent-tagged form through the route's own action.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

const agentLoginPost = vi.fn();
const agentLoginLinkPost = vi.fn();
const { createSessionWithTokenMock } = vi.hoisted(() => ({
  createSessionWithTokenMock: vi.fn(async (_ctx: unknown, _jwt: string, to: string) => ({ redirectTo: to })),
}));

vi.mock("~/lib/api-client.server", () => ({
  createApi: vi.fn(() => ({
    agentLogin: {
      login: { $post: agentLoginPost },
      "login-link": { $post: agentLoginLinkPost },
    },
  })),
}));

vi.mock("~/lib/session.server", () => ({
  createSessionWithToken: createSessionWithTokenMock,
}));

import { action } from "~/routes/agent/login";
import AgentLoginPage from "~/routes/agent/login";

type ActionArgs = Parameters<typeof action>[0];

function jsonRes(body: unknown, ok = true, headers: Record<string, string> = {}) {
  return {
    ok,
    json: async () => body,
    headers: new Headers(headers),
  } as unknown as Response;
}

function actionArgs(form: Record<string, string>): ActionArgs {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.set(k, v);
  return {
    request: new Request("http://app.example.com/agent-login", {
      method: "POST",
      body: fd,
    }),
    context: {} as never,
    params: {},
  } as unknown as ActionArgs;
}

beforeEach(() => {
  agentLoginPost.mockReset();
  agentLoginLinkPost.mockReset().mockResolvedValue(jsonRes({ data: { sent: true } }));
  createSessionWithTokenMock.mockClear();
});

describe("agent login action — password intent", () => {
  it("posts email + password to POST /api/agent/login and redirects to /agent-dashboard on success", async () => {
    agentLoginPost.mockResolvedValue(
      jsonRes(
        { data: { ok: true } },
        true,
        { "set-cookie": "__Host-inspector_token=fake.jwt.token; Path=/; Secure; HttpOnly" },
      ),
    );

    const res = await action(
      actionArgs({ intent: "password", email: "agent@example.com", password: "hunter2hunter2" }),
    );

    expect(agentLoginPost).toHaveBeenCalledWith({
      json: { email: "agent@example.com", password: "hunter2hunter2" },
    });
    expect(createSessionWithTokenMock).toHaveBeenCalledWith(
      expect.anything(),
      "fake.jwt.token",
      "/agent-dashboard",
    );
    expect(res).toMatchObject({ redirectTo: "/agent-dashboard" });
  });

  it("surfaces a generic invalid-credentials error on a 401, without redirecting", async () => {
    agentLoginPost.mockResolvedValue(jsonRes({ error: { message: "nope" } }, false));

    const res = await action(
      actionArgs({ intent: "password", email: "agent@example.com", password: "wrong-password" }),
    );

    expect(createSessionWithTokenMock).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).toContain("Invalid email or password");
  });
});

describe("agent login action — link intent", () => {
  it("posts email to POST /api/agent/login-link and always shows the confirmation", async () => {
    const res = await action(
      actionArgs({ intent: "link", email: "agent@example.com" }),
    );

    expect(agentLoginLinkPost).toHaveBeenCalledWith({ json: { email: "agent@example.com" } });
    expect(res).toMatchObject({ sent: true });
  });

  it("shows the same confirmation even when the BFF call throws (anti-enumeration)", async () => {
    agentLoginLinkPost.mockRejectedValue(new Error("network down"));

    const res = await action(
      actionArgs({ intent: "link", email: "agent@example.com" }),
    );

    expect(res).toMatchObject({ sent: true });
  });
});

/**
 * Rendering — real Form submits via createRoutesStub so a click actually
 * posts through the route's own action (mirrors
 * settings-profile.test.tsx's AgentSettingsProfilePage rendering suite).
 */
describe("AgentLoginPage rendering", () => {
  function renderPage(actionImpl: (args: { request: Request }) => unknown) {
    const Stub = createRoutesStub([
      {
        path: "/agent-login",
        Component: AgentLoginPage,
        action: actionImpl,
      },
    ]);
    return render(<Stub initialEntries={["/agent-login"]} />);
  }

  it("renders email + password fields and the magic-link fallback CTA", () => {
    const { getAllByLabelText, getByLabelText, getByText } = renderPage(async () => ({}));
    // Two email inputs exist (primary password form + secondary link form) —
    // both share the "Email address" label, so there are two matches.
    expect(getAllByLabelText("Email address")).toHaveLength(2);
    expect(getByLabelText("Password")).toBeTruthy();
    expect(getByText("Email me a sign-in link instead")).toBeTruthy();
  });

  it("clicking Log In submits the password intent with the typed credentials", async () => {
    const submitted: Record<string, FormDataEntryValue | null>[] = [];
    const { getAllByLabelText, getByLabelText, getByText } = renderPage(async ({ request }) => {
      const fd = await request.formData();
      submitted.push({
        intent: fd.get("intent"),
        email: fd.get("email"),
        password: fd.get("password"),
      });
      return {};
    });

    // First email input belongs to the primary password form.
    fireEvent.change(getAllByLabelText("Email address")[0], { target: { value: "agent@example.com" } });
    fireEvent.change(getByLabelText("Password"), { target: { value: "hunter2hunter2" } });
    fireEvent.click(getByText("Log In"));

    await waitFor(() => expect(submitted.length).toBeGreaterThan(0));
    expect(submitted[0]).toEqual({
      intent: "password",
      email: "agent@example.com",
      password: "hunter2hunter2",
    });
  });

  it("clicking the magic-link CTA submits the link intent and shows the confirmation", async () => {
    const { getAllByLabelText, getByText, findByText } = renderPage(async ({ request }) => {
      const fd = await request.formData();
      expect(fd.get("intent")).toBe("link");
      return { sent: true };
    });

    // Second "Email address" input belongs to the secondary link form.
    fireEvent.change(getAllByLabelText("Email address")[1], { target: { value: "agent@example.com" } });
    fireEvent.click(getByText("Email me a sign-in link instead"));

    await findByText("Check your inbox");
  });
});
