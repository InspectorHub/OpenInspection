// @vitest-environment happy-dom
/**
 * "Check credentials" through the real route: the button posts one
 * `qbo-check-credentials` request to the route action and the result is drawn
 * on the page. The action's own mapping is proven in the behavior test next
 * door; here the action is a stub that answers with the shape it returns.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import Route, { type QboLoaderData } from "./settings-integrations-qbo";
import { buildRegistration } from "~/lib/qbo-settings-loader";
import type { QboCheckOutcome } from "~/lib/qbo-credential-check";

afterEach(cleanup);

const LOADER: QboLoaderData = {
  access: "ok",
  status: null,
  secrets: { QBO_CLIENT_ID: "", QBO_CLIENT_SECRET: "", QBO_WEBHOOK_SECRET: "" },
  selfHosted: true,
  credentialSource: { clientId: "env", clientSecret: "env", webhookToken: "env", environment: "env" },
  environment: "sandbox",
  registration: buildRegistration("https://dev.example.com"),
  oauth: { connected: false, error: null },
};

function renderPage(check: QboCheckOutcome) {
  const intents: string[] = [];
  const Stub = createRoutesStub([
    {
      path: "/settings/integrations/qbo",
      Component: Route,
      loader: () => LOADER,
      action: async ({ request }) => {
        const fd = await request.formData();
        intents.push(String(fd.get("intent")));
        return { success: true, intent: "qbo-check-credentials", error: null, syncEnabled: undefined, check } as never;
      },
    },
  ]);
  render(<Stub initialEntries={["/settings/integrations/qbo"]} />);
  return intents;
}

const checkButton = () => screen.findByRole("button", { name: "Check credentials" });

describe("QuickBooks settings page - Check credentials", () => {
  it("posts one qbo-check-credentials request, even for two clicks in one frame, and shows the answer", async () => {
    const intents = renderPage({ kind: "paired", checkedAt: 1760400000 });
    const button = await checkButton();
    act(() => {
      button.click();
      button.click();
    });
    expect(await screen.findByText("Intuit accepted this Client ID and secret.")).toBeInTheDocument();
    expect(intents).toEqual(["qbo-check-credentials"]);
  });

  it("shows the rejection in words about the credentials, not as a page error", async () => {
    renderPage({ kind: "rejected", checkedAt: 1760400000 });
    fireEvent.click(await checkButton());
    expect(await screen.findByText(/Intuit rejected this Client ID and secret/)).toBeInTheDocument();
    // The page-level error bar belongs to the other actions.
    expect(screen.queryByText("Unknown action")).not.toBeInTheDocument();
  });

  it("shows nothing before the button is pressed (control)", async () => {
    renderPage({ kind: "paired", checkedAt: 1760400000 });
    await checkButton();
    expect(screen.queryByText("Intuit accepted this Client ID and secret.")).not.toBeInTheDocument();
  });
});
