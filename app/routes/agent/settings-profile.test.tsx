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
import { render, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

const profileGet = vi.fn();
const profilePost = vi.fn();

vi.mock("~/lib/session.server", () => ({
  requireToken: vi.fn(async () => "tok-test"),
}));

vi.mock("~/lib/api-client.server", () => ({
  createApi: vi.fn(() => ({
    agent: {
      profile: { $get: profileGet, $post: profilePost },
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

function loaderArgs(): LoaderArgs {
  return {
    request: new Request("http://app.example.com/agent-settings/profile"),
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
  notifyOnReferral: true,
  notifyOnReport: false,
  notifyOnPaid: true,
  timezone: "America/New_York",
};

beforeEach(() => {
  profileGet.mockReset().mockResolvedValue(jsonRes({ data: SAMPLE_AGENT }));
  profilePost.mockReset().mockResolvedValue(jsonRes({ data: { ok: true } }));
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
    expect(data.agent).toEqual({
      name: null, email: "", slug: null,
      notifyOnReferral: true, notifyOnReport: true, notifyOnPaid: false,
      timezone: null,
    });
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

  it("intent=save-notifications posts all three toggles", async () => {
    const res = await action(actionArgs({
      intent: "save-notifications",
      notifyOnReferral: "false",
      notifyOnReport: "true",
      notifyOnPaid: "true",
    }));
    expect(profilePost).toHaveBeenCalledWith({
      json: { notifyOnReferral: false, notifyOnReport: true, notifyOnPaid: true },
    });
    expect(res).toMatchObject({ ok: true, intent: "save-notifications" });
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
    agent?: typeof SAMPLE_AGENT;
    action?: (args: { request: Request }) => unknown;
  } = {}) {
    const Stub = createRoutesStub([
      {
        path: "/agent-settings/profile",
        Component: AgentSettingsProfilePage,
        loader: () => ({ agent: opts.agent ?? SAMPLE_AGENT }),
        action: opts.action ?? (async () => ({ ok: true, intent: "save-slug", error: undefined })),
      },
    ]);
    return render(<Stub initialEntries={["/agent-settings/profile"]} />);
  }

  it("seeds the slug input and toggle states from loader data", async () => {
    const { findByDisplayValue, getByText } = renderPage();
    await findByDisplayValue("jane");
    // notifyOnReferral: true, notifyOnReport: false, notifyOnPaid: true — just
    // assert the section renders with the loader-seeded titles (state itself
    // is covered by the switch aria-checked assertions below).
    expect(getByText("A new referral is booked")).toBeTruthy();
  });

  it("reflects notifyOnReport=false as an unchecked switch", async () => {
    const { findAllByRole } = renderPage();
    const switches = await findAllByRole("switch");
    // Order: referral, report, paid.
    expect(switches[0].getAttribute("aria-checked")).toBe("true");
    expect(switches[1].getAttribute("aria-checked")).toBe("false");
    expect(switches[2].getAttribute("aria-checked")).toBe("true");
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

  it("clicking a notification toggle submits save-notifications with the flipped value", async () => {
    const submitted: Record<string, FormDataEntryValue | null>[] = [];
    const { findAllByRole } = renderPage({
      action: async ({ request }) => {
        const fd = await request.formData();
        submitted.push({
          intent: fd.get("intent"),
          notifyOnReferral: fd.get("notifyOnReferral"),
          notifyOnReport: fd.get("notifyOnReport"),
          notifyOnPaid: fd.get("notifyOnPaid"),
        });
        return { ok: true, intent: "save-notifications", error: undefined };
      },
    });

    // Order: referral (true), report (false), paid (true). Flip the second
    // switch (notifyOnReport: false -> true); the other two stay unchanged.
    const switches = await findAllByRole("switch");
    fireEvent.click(switches[1]);

    await waitFor(() => expect(submitted.length).toBeGreaterThan(0));
    expect(submitted[0]).toEqual({
      intent: "save-notifications",
      notifyOnReferral: "true",
      notifyOnReport: "true",
      notifyOnPaid: "true",
    });
  });
});
