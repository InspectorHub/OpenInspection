// @vitest-environment happy-dom
/**
 * Spec 3 Task 4b — agent profile round-trip (GET /api/agent/profile wiring +
 * slug/notification save on /agent-settings/profile).
 *
 * Pattern: loader/action are exercised directly against a mocked BFF (mirrors
 * app/lib/connected-apps.test.ts / app/routes/agent/signup.test.tsx). The
 * rendered page is exercised via createRoutesStub + @testing-library/react
 * (mirrors app/components/inspection-edit/compliance-panel.test.tsx) so real
 * hooks (useFetcher) fire on click, including the 409 slug-conflict path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, configure } from "@testing-library/react";
import { createRoutesStub } from "react-router";

/**
 * The rendering suite below is the slowest in `app/routes`, and it races a
 * deadline nobody in this repo chose: testing-library's DEFAULT
 * `asyncUtilTimeout` of 1000 ms.
 *
 * `createRoutesStub` starts in a loading state, so `render()` returns before the
 * page exists — the whole first paint is billed against the following
 * `findBy*`/`waitFor`, not against vitest's 5000 ms `testTimeout`. That paint is
 * genuinely expensive here: the timezone card is a `<Select>` over
 * `Intl.supportedValuesOf('timeZone')`, so happy-dom builds ~418 `<option>`
 * nodes on each of this file's renders.
 *
 * Measured (whole-suite `app/routes` run, idle machine): these tests take
 * 430-690 ms, the five slowest in the suite. Against 1000 ms that is under a 2x
 * margin, and a loaded machine closes it — under a deliberate CPU load the same
 * waits reach 1000-2000 ms and fail as "Unable to find an element with the
 * display value: jane".
 *
 * So this is a deadline that is too tight for the work, NOT a condition that is
 * never satisfied: the elapsed time tracks CPU contention, and every assertion
 * here passes on an idle machine. Raising the budget is the fix; it hides
 * nothing, because a genuinely unsatisfiable condition still fails — just 4 s
 * later. The vitest backstop is raised alongside it only so it cannot fire
 * FIRST: testing-library's error names the element and dumps the DOM, vitest's
 * says only that 5000 ms elapsed.
 */
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

const profileGet = vi.fn();
const profilePost = vi.fn();
const prefsGet = vi.fn();
const prefsPut = vi.fn();

vi.mock("~/lib/session.server", () => ({
  requireToken: vi.fn(async () => "tok-test"),
}));

vi.mock("~/lib/api-client.server", () => ({
  createApi: vi.fn(() => ({
    agent: {
      profile: { $get: profileGet, $post: profilePost },
    },
    // Its own per-module client: the preferences router mounts at /api/agent,
    // a prefix `agent` already owns, so it cannot share that client.
    agentNotificationPrefs: {
      "notification-preferences": { $get: prefsGet, $put: prefsPut },
    },
  })),
}));

import { loader, action } from "~/routes/agent/settings-profile";
import AgentSettingsProfilePage from "~/routes/agent/settings-profile";

type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];

function jsonRes(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response;
}

function loaderArgs(search = ""): LoaderArgs {
  return {
    request: new Request(`http://app.example.com/agent-settings/profile${search}`),
    context: {} as never,
    params: {},
  } as unknown as LoaderArgs;
}

function actionArgs(form: Record<string, string>): ActionArgs {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.set(k, v);
  return {
    request: new Request("http://app.example.com/agent-settings/profile", {
      method: "POST",
      body: fd,
    }),
    context: {} as never,
    params: {},
  } as unknown as ActionArgs;
}

const SAMPLE_AGENT = {
  name: "Jane",
  email: "jane@x.com",
  slug: "jane",
  timezone: "America/New_York",
};

/**
 * Two companies, because one is the case that hides the bug: with a single
 * company the selector, the "apply to all" checkbox and the per-company write
 * all look the same as a global setting.
 */
const SAMPLE_SCREEN = {
  companies: [
    { id: "t-acme", name: "Acme Inspections" },
    { id: "t-bolt", name: "Bolt Home Services" },
  ],
  selected: "t-acme",
  alwaysSent: [{ id: "agent-login-link", label: "Sign-in link", channels: ["email"] }],
  youChoose: [
    {
      id: "agent-new-referral",
      label: "A new referral is booked",
      channels: { email: "on", sms: "on", in_app: "on" },
    },
    {
      id: "agent-report-ready",
      label: "A report is ready to read",
      channels: { email: "off", sms: "on", in_app: "on" },
    },
  ],
};

beforeEach(() => {
  profileGet.mockReset().mockResolvedValue(jsonRes({ data: SAMPLE_AGENT }));
  profilePost.mockReset().mockResolvedValue(jsonRes({ data: { ok: true } }));
  prefsGet.mockReset().mockResolvedValue(jsonRes({ data: SAMPLE_SCREEN }));
  prefsPut.mockReset().mockResolvedValue(jsonRes({ success: true, applied: 1 }));
});

describe("agent settings-profile loader", () => {
  it("loads the real agent profile via GET /api/agent/profile", async () => {
    const data = await loader(loaderArgs());
    expect(profileGet).toHaveBeenCalled();
    expect(data.agent).toEqual(SAMPLE_AGENT);
  });

  it("degrades to safe defaults when the GET fails", async () => {
    profileGet.mockResolvedValue(jsonRes(null, false));
    const data = await loader(loaderArgs());
    expect(data.agent).toEqual({ name: null, email: "", slug: null, timezone: null });
  });

  it("reads the notification screen for the company named in the URL", async () => {
    await loader(loaderArgs("?company=t-bolt"));
    expect(prefsGet).toHaveBeenCalledWith({ query: { companyId: "t-bolt" } });
  });

  it("lets the server pick the company when the URL names none", async () => {
    await loader(loaderArgs());
    expect(prefsGet).toHaveBeenCalledWith({ query: {} });
  });

  it("degrades to an empty screen rather than failing the page", async () => {
    // A notification read that 500s must not take the slug and timezone cards
    // down with it — they are a different subject entirely.
    prefsGet.mockResolvedValue(jsonRes(null, false));
    const data = await loader(loaderArgs());
    expect(data.notifications.companies).toEqual([]);
    expect(data.agent.slug).toBe("jane");
  });
});

describe("agent settings-profile action", () => {
  it("intent=save-slug posts the typed slug", async () => {
    const res = await action(actionArgs({ intent: "save-slug", slug: "newslug" }));
    expect(profilePost).toHaveBeenCalledWith({ json: { slug: "newslug" } });
    expect(res).toMatchObject({ ok: true, intent: "save-slug" });
  });

  it("intent=save-slug surfaces a 409 slug-conflict as an inline error", async () => {
    profilePost.mockResolvedValue(
      jsonRes({ success: false, error: { message: "Slug already taken", code: "conflict" } }, false),
    );
    const res = await action(actionArgs({ intent: "save-slug", slug: "taken" }));
    expect(res).toMatchObject({ ok: false, intent: "save-slug", error: "Slug already taken" });
  });

  it("intent=save-notifications names the class, the channel and the company", async () => {
    const res = await action(actionArgs({
      intent: "save-notifications",
      classId: "agent-new-referral",
      channel: "email",
      enabled: "false",
      scope: "company",
      companyId: "t-acme",
    }));
    expect(prefsPut).toHaveBeenCalledWith({
      json: {
        classId: "agent-new-referral", channel: "email", enabled: false,
        scope: "company", companyId: "t-acme",
      },
    });
    expect(res).toMatchObject({ ok: true, intent: "save-notifications" });
  });

  it("intent=save-notifications with scope=all sends no company at all", async () => {
    // Sending a companyId alongside scope=all would be two answers to one
    // question, and the server would have to decide which one meant it.
    await action(actionArgs({
      intent: "save-notifications",
      classId: "agent-new-referral", channel: "email", enabled: "false",
      scope: "all", companyId: "t-acme",
    }));
    expect(prefsPut).toHaveBeenCalledWith({
      json: {
        classId: "agent-new-referral", channel: "email", enabled: false, scope: "all",
      },
    });
  });

  it("intent=save-timezone posts the chosen IANA zone", async () => {
    const res = await action(actionArgs({ intent: "save-timezone", timezone: "America/Chicago" }));
    expect(profilePost).toHaveBeenCalledWith({ json: { timezone: "America/Chicago" } });
    expect(res).toMatchObject({ ok: true, intent: "save-timezone" });
  });

  it("intent=save-timezone posts an empty string to clear the override", async () => {
    const res = await action(actionArgs({ intent: "save-timezone", timezone: "" }));
    expect(profilePost).toHaveBeenCalledWith({ json: { timezone: "" } });
    expect(res).toMatchObject({ ok: true, intent: "save-timezone" });
  });
});

/**
 * Rendering — real useFetcher via createRoutesStub so a click actually
 * submits a POST through the route's own action, mirroring
 * compliance-panel.test.tsx's reliance-editing suite.
 */
describe("AgentSettingsProfilePage rendering", () => {
  function renderPage(opts: {
    notifications?: typeof SAMPLE_SCREEN | { companies: []; selected: null; alwaysSent: []; youChoose: [] };
    action?: (args: { request: Request }) => unknown;
  } = {}) {
    const Stub = createRoutesStub([
      {
        path: "/agent-settings/profile",
        Component: AgentSettingsProfilePage,
        loader: () => ({
          agent: SAMPLE_AGENT,
          notifications: opts.notifications ?? SAMPLE_SCREEN,
        }),
        action: opts.action ?? (async () => ({ ok: true, intent: "save-slug", error: undefined })),
      },
    ]);
    return render(<Stub initialEntries={["/agent-settings/profile"]} />);
  }

  it("seeds the slug input from loader data", async () => {
    const { findByDisplayValue } = renderPage();
    await findByDisplayValue("jane");
  });

  it("names the company whose settings are on screen", async () => {
    // The whole card is one company's answer. A reader who cannot see which
    // company they are editing is one click from silencing the wrong firm.
    // A <select>'s display value is the option TEXT — which is also the only
    // thing the reader can act on.
    const { findByDisplayValue } = renderPage();
    await findByDisplayValue("Acme Inspections");
  });

  it("shows a switched-off notification as unchecked, on the channel it was switched off on", async () => {
    const { findAllByRole, getByText } = renderPage();
    const boxes = await findAllByRole("checkbox") as HTMLInputElement[];
    // Every row offers all three channels now, so each contributes three cells.
    // The fixture has agent-new-referral email = on, agent-report-ready email
    // = off; the rest default to on.
    const email = boxes.filter((b) => (b.getAttribute("aria-label") ?? "").endsWith("Email"));
    expect(email.map((b) => b.checked)).toEqual([true, false]);
    expect(getByText("A new referral is booked")).toBeTruthy();
  });

  it("submits the class, the channel and the flipped value on click", async () => {
    const submitted: Record<string, FormDataEntryValue | null>[] = [];
    const { findAllByRole } = renderPage({
      action: async ({ request }) => {
        const fd = await request.formData();
        submitted.push({
          intent: fd.get("intent"), classId: fd.get("classId"),
          channel: fd.get("channel"), enabled: fd.get("enabled"),
          scope: fd.get("scope"), companyId: fd.get("companyId"),
        });
        return { ok: true, intent: "save-notifications", error: undefined };
      },
    });

    const boxes = await findAllByRole("checkbox") as HTMLInputElement[];
    const referral = boxes.find((b) => (b.getAttribute("aria-label") ?? "").startsWith("A new referral"))!;
    fireEvent.click(referral);

    await waitFor(() => expect(submitted.length).toBeGreaterThan(0));
    expect(submitted[0]).toEqual({
      intent: "save-notifications", classId: "agent-new-referral",
      channel: "email", enabled: "false", scope: "company", companyId: "t-acme",
    });
  });

  it("says something useful when no company has added this agent yet", async () => {
    // An empty screen is an invitation, not a blank card: it says who makes
    // the next move, which is not the agent.
    const { findByText } = renderPage({
      notifications: { companies: [], selected: null, alwaysSent: [], youChoose: [] },
    });
    await findByText(/No companies yet/i);
  });

  it("clicking Save slug submits the fetcher with the typed slug", async () => {
    const submitted: { intent: FormDataEntryValue | null; slug: FormDataEntryValue | null }[] = [];
    const { findByDisplayValue, getByText } = renderPage({
      action: async ({ request }) => {
        const fd = await request.formData();
        submitted.push({ intent: fd.get("intent"), slug: fd.get("slug") });
        return { ok: true, intent: "save-slug", error: undefined };
      },
    });

    const input = await findByDisplayValue("jane") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "newslug" } });
    fireEvent.click(getByText("Save slug"));

    await waitFor(() => expect(submitted.length).toBeGreaterThan(0));
    expect(submitted[0]).toEqual({ intent: "save-slug", slug: "newslug" });
  });

  it("shows 'Slug already taken' inline when the action returns a 409-shaped error", async () => {
    const { findByDisplayValue, getByText, findByText } = renderPage({
      action: async () => ({ ok: false, intent: "save-slug", error: "Slug already taken" }),
    });

    await findByDisplayValue("jane");
    fireEvent.click(getByText("Save slug"));

    await findByText("Slug already taken");
  });
  /**
   * A settings page with no link is the defect this came from: a surface that
   * exists, works, and can only be reached by typing its URL. Asserted on the
   * HREF and not on the words, because the words are translated and the address
   * is the thing that has to be right.
   */
  it("links to the legal page", async () => {
    const { findByRole } = renderPage();
    const link = await findByRole("link", { name: /terms|legal/i });
    expect(link.getAttribute("href")).toBe("/agent-settings/legal");
  });
});
