// @vitest-environment happy-dom
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
  it("reads `linkEmail` and still posts the API's `{ email }` body", async () => {
    // The field is named apart from the password form's because both render on
    // this one page (F70); the API contract is unchanged, so the route maps it.
    const res = await action(
      actionArgs({ intent: "link", linkEmail: "agent@example.com" }),
    );

    expect(agentLoginLinkPost).toHaveBeenCalledWith({ json: { email: "agent@example.com" } });
    expect(res).toMatchObject({ sent: true });
  });

  it("does not accept the password form's `email` field for the link intent", async () => {
    // The control for the rename: if both names were still honored, a form mix-up
    // would go on silently working and the DOM ambiguity would come straight back.
    const res = await action(actionArgs({ intent: "link", email: "agent@example.com" }));
    expect(agentLoginLinkPost).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).toMatch(/email/i);
  });

  it("shows the same confirmation even when the BFF call throws (anti-enumeration)", async () => {
    agentLoginLinkPost.mockRejectedValue(new Error("network down"));

    const res = await action(
      actionArgs({ intent: "link", linkEmail: "agent@example.com" }),
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

  /**
   * F70 — this page carries two email inputs, one per form, and they used to be
   * indistinguishable: both named `email`, both labelled "Email address", stacked
   * with a single `OR` rule between them. Filling one and pressing the other
   * form's button is then the natural mistake, and a password manager sees one
   * page with two identical fields.
   */
  it("gives each of its two email inputs a label of its own", () => {
    const { getAllByLabelText, getByLabelText } = renderPage(async () => ({}));
    // Exactly one input answers to the bare label now — the assertion that would
    // have failed before, since there were two.
    expect(getAllByLabelText("Email address")).toHaveLength(1);
    const password = getByLabelText("Email address") as HTMLInputElement;
    const link = getByLabelText("Email address for your sign-in link") as HTMLInputElement;
    expect(password.name).toBe("email");
    expect(link.name).toBe("linkEmail");
    // Two inputs, two names: nothing on the page answers to the same one twice.
    expect(password.name).not.toBe(link.name);
  });

  /**
   * The other half of F70: there is no agent password-reset route anywhere in
   * this app, so the sign-in link IS the recovery path — and it was labelled
   * "Email me a sign-in link instead", which reads as a login PREFERENCE. A real
   * session stalled here: the user did not remember the password and nothing on
   * the page was addressed to that.
   */
  it("names the situation the magic link is the way out of", () => {
    const { getByText, queryByText } = renderPage(async () => ({}));
    expect(getByText("Forgot your password?")).toBeTruthy();
    expect(getByText("Email me a sign-in link")).toBeTruthy();
    // No reset link is offered, because no agent reset route exists — a link to
    // one would be a promise this deployment cannot keep.
    expect(queryByText(/reset your password/i)).toBeNull();
  });

  it("renders email + password fields and the magic-link fallback CTA", () => {
    const { getByLabelText, getByText } = renderPage(async () => ({}));
    expect(getByLabelText("Email address")).toBeTruthy();
    expect(getByLabelText("Password")).toBeTruthy();
    expect(getByText("Email me a sign-in link")).toBeTruthy();
  });

  it("clicking Log In submits the password intent with the typed credentials", async () => {
    const submitted: Record<string, FormDataEntryValue | null>[] = [];
    const { getByLabelText, getByText } = renderPage(async ({ request }) => {
      const fd = await request.formData();
      submitted.push({
        intent: fd.get("intent"),
        email: fd.get("email"),
        password: fd.get("password"),
      });
      return {};
    });

    fireEvent.change(getByLabelText("Email address"), { target: { value: "agent@example.com" } });
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
    const seen: Record<string, FormDataEntryValue | null>[] = [];
    const { getByLabelText, getByText, findByText } = renderPage(async ({ request }) => {
      const fd = await request.formData();
      seen.push({ intent: fd.get("intent"), linkEmail: fd.get("linkEmail"), email: fd.get("email") });
      return { sent: true };
    });

    fireEvent.change(getByLabelText("Email address for your sign-in link"), {
      target: { value: "agent@example.com" },
    });
    fireEvent.click(getByText("Email me a sign-in link"));

    await findByText("Check your inbox");
    // The link form carries only its OWN field — the password form's `email` is
    // not swept along, which is what makes the two independently fillable.
    expect(seen[0]).toEqual({ intent: "link", linkEmail: "agent@example.com", email: null });
  });
});
