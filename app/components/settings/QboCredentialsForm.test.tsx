// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { QboCredentialsForm, qboReadyToConnect } from "./QboCredentialsForm";
import { buildRegistration } from "~/lib/qbo-settings-loader";
import type { QBOCredentialSource } from "../../../server/services/qbo/api-base";

afterEach(cleanup);

const NO_SECRETS = { QBO_CLIENT_ID: "", QBO_CLIENT_SECRET: "", QBO_WEBHOOK_SECRET: "" };
const ALL_ENV: QBOCredentialSource = { clientId: "env", clientSecret: "env", webhookToken: "env", environment: "env" };
const NONE: QBOCredentialSource = { clientId: "missing", clientSecret: "missing", webhookToken: "missing", environment: "missing" };

function view(over: Partial<React.ComponentProps<typeof QboCredentialsForm>> = {}) {
  const props: React.ComponentProps<typeof QboCredentialsForm> = {
    secrets: NO_SECRETS,
    credentialSource: ALL_ENV,
    environment: "sandbox",
    registration: buildRegistration("https://dev.example.com"),
    saving: false,
    ...over,
  };
  const Stub = createRoutesStub([{ path: "/", Component: () => <QboCredentialsForm {...props} /> }]);
  return render(<Stub initialEntries={["/"]} />);
}

const toggle = () => screen.getByRole("button", { name: /show details|hide details/i });

describe("QboCredentialsForm - collapsed by default when everything is in place", () => {
  it("is one summary row, with no inputs, when the environment supplies everything", async () => {
    view();
    expect(await screen.findByRole("heading", { name: "Your Intuit app" })).toBeInTheDocument();
    expect(screen.getByText(/Environment: Sandbox/)).toBeInTheDocument();
    expect(screen.getByText(/Client ID, client secret and webhook token are built in/)).toBeInTheDocument();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens on its own when something needed to connect is missing (control)", async () => {
    view({ credentialSource: NONE, environment: null });
    expect(await screen.findByLabelText(/client id/i)).toBeInTheDocument();
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Missing: Client ID, Client secret, Webhook verifier token/)).toBeInTheDocument();
    expect(screen.getByText("Environment: not set")).toBeInTheDocument();
  });

  it("says Production in the summary for a production app", async () => {
    view({ environment: "production" });
    expect(await screen.findByText(/Environment: Production/)).toBeInTheDocument();
  });
});

describe("QboCredentialsForm - what is editable", () => {
  it("shows an input only for the settings the environment does not supply", async () => {
    // A missing webhook token opens the section by itself.
    view({ credentialSource: { ...ALL_ENV, webhookToken: "missing" } });

    expect(await screen.findByLabelText(/webhook/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/client id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/client secret/i)).not.toBeInTheDocument();
    // The built-in ones are named, not hidden.
    expect(screen.getAllByText("Built in").length).toBeGreaterThanOrEqual(2);
  });

  it("still lets a built-in setting be overridden, behind an explicit Override", async () => {
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Show details" }));
    expect(screen.queryByLabelText(/client id/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Override" })[0]);

    const field = await screen.findByLabelText(/client id/i);
    expect(field).toHaveAttribute("placeholder", "Built in. Type to override");
    // The other two are still collapsed behind their own Override.
    expect(screen.queryByLabelText(/client secret/i)).not.toBeInTheDocument();
  });

  it("shows a stored value masked, as the loader sends it", async () => {
    view({
      credentialSource: { ...NONE, clientId: "tenant" },
      secrets: { ...NO_SECRETS, QBO_CLIENT_ID: "AB7B••••••••xyz1" },
    });
    expect(await screen.findByLabelText(/client id/i)).toHaveValue("AB7B••••••••xyz1");
  });

  it("masks a stored value, clears it on focus, restores it on a bare blur, and submits only what was typed", async () => {
    const { container } = view({
      credentialSource: { ...NONE, clientId: "tenant" },
      secrets: { ...NO_SECRETS, QBO_CLIENT_ID: "AB7B••••••••xyz1" },
    });
    const field = await screen.findByLabelText(/client id/i);
    const submitted = () => container.querySelector<HTMLInputElement>('input[type="hidden"][name="QBO_CLIENT_ID"]')?.value;

    expect(field).toHaveValue("AB7B••••••••xyz1");
    expect(screen.getByText("Set")).toBeInTheDocument();
    expect(submitted()).toBe(""); // untouched: "no change"

    fireEvent.focus(field);
    expect(field).toHaveValue("");
    fireEvent.blur(field);
    expect(field).toHaveValue("AB7B••••••••xyz1");

    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "brand-new-id" } });
    expect(submitted()).toBe("brand-new-id");
  });

  it("links to developer.intuit.com in a new tab, without leaking the opener", async () => {
    view({ credentialSource: NONE, environment: null });
    const link = await screen.findByRole("link", { name: "developer.intuit.com" });
    expect(link).toHaveAttribute("href", "https://developer.intuit.com/app/developer/appdetail");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("registers the three addresses and copies each", async () => {
    view({ credentialSource: NONE, environment: null });
    expect(await screen.findByText("https://dev.example.com/api/integrations/qbo/callback")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Copy/ })).toHaveLength(3);
  });
});

describe("qboReadyToConnect", () => {
  it("needs a usable environment value, not only a supplied one", () => {
    expect(qboReadyToConnect(ALL_ENV, "sandbox")).toBe(true);
    // The deployment supplies QBO_ENV, but with a value that is neither sandbox nor
    // production: the callback would refuse it, so the link must not be offered.
    expect(qboReadyToConnect(ALL_ENV, null)).toBe(false);
  });

  it("still needs the client id and the client secret (control)", () => {
    expect(qboReadyToConnect({ ...ALL_ENV, clientId: "missing" }, "sandbox")).toBe(false);
    expect(qboReadyToConnect({ ...ALL_ENV, clientSecret: "missing" }, "production")).toBe(false);
  });
});

describe("QboCredentialsForm - the Intuit environment", () => {
  const env = () => screen.getByRole("radiogroup", { name: /intuit environment/i });
  const hidden = (container: HTMLElement) => container.querySelector<HTMLInputElement>('input[type="hidden"][name="QBO_ENV"]');

  it("selects nothing when the environment is unset, and submits nothing for it", async () => {
    const { container } = view({ credentialSource: NONE, environment: null });
    await screen.findByRole("radiogroup", { name: /intuit environment/i });
    for (const radio of within(env()).getAllByRole("radio")) {
      expect(radio).toHaveAttribute("aria-checked", "false");
    }
    expect(screen.getByText(/Not set yet/)).toBeInTheDocument();
    // Untouched: the form carries no value, so saving credentials cannot write a default.
    expect(hidden(container)?.value).toBe("");
  });

  it("does not present an unusable deployment value as built in", async () => {
    view({ credentialSource: ALL_ENV, environment: null });
    // The control shows, with nothing selected, instead of a "Built in" row that
    // would look like a working setting.
    await screen.findByRole("radiogroup", { name: /intuit environment/i });
    for (const radio of within(env()).getAllByRole("radio")) {
      expect(radio).toHaveAttribute("aria-checked", "false");
    }
  });

  it("does not resubmit a known environment the person never touched", async () => {
    const { container } = view({ credentialSource: { ...NONE, environment: "tenant" }, environment: "sandbox" });
    await screen.findByRole("radiogroup", { name: /intuit environment/i });
    expect(within(env()).getByRole("radio", { name: "Sandbox" })).toHaveAttribute("aria-checked", "true");
    expect(hidden(container)?.value).toBe("");
  });

  it("submits the chosen value once a segment is pressed", async () => {
    const { container } = view({ credentialSource: NONE, environment: null });
    await screen.findByRole("radiogroup", { name: /intuit environment/i });
    fireEvent.click(within(env()).getByRole("radio", { name: "Production" }));
    expect(within(env()).getByRole("radio", { name: "Production" })).toHaveAttribute("aria-checked", "true");
    expect(within(env()).getByRole("radio", { name: "Sandbox" })).toHaveAttribute("aria-checked", "false");
    expect(hidden(container)?.value).toBe("production");
  });

  it("explains that Development keys only reach sandbox companies", async () => {
    view({ credentialSource: NONE, environment: null });
    expect(await screen.findByText(/Development keys only work with sandbox companies/)).toBeInTheDocument();
  });

  it("treats a built-in environment like the other built-in settings", async () => {
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Show details" }));
    expect(screen.queryByRole("radiogroup", { name: /intuit environment/i })).not.toBeInTheDocument();
    const overrides = screen.getAllByRole("button", { name: "Override" });
    expect(overrides).toHaveLength(4);
    fireEvent.click(overrides[3]);
    expect(await screen.findByRole("radiogroup", { name: /intuit environment/i })).toBeInTheDocument();
  });
});

describe("QboCredentialsForm - saving", () => {
  it("posts the save intent and labels the button, then says Saving while it runs", async () => {
    const { container } = view({ credentialSource: NONE, environment: null });
    await screen.findByLabelText(/client id/i);
    expect(container.querySelector('input[name="intent"][value="save-qbo-secrets"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Save credentials" })).toBeInTheDocument();
    cleanup();

    view({ credentialSource: NONE, environment: null, saving: true });
    expect(await screen.findByRole("button", { name: "Saving…" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: "Save credentials" })).not.toBeInTheDocument();
  });

  it("opens on its own when something is missing, and can be folded by hand", async () => {
    view({ credentialSource: NONE, environment: null });
    await screen.findByLabelText(/client id/i);
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });
});
