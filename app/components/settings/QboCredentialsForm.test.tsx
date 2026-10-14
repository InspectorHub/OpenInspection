// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, act, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { QboCredentialsForm, qboReadyToConnect } from "./QboCredentialsForm";
import { buildRegistration } from "~/lib/qbo-settings-loader";
import type { QboCheckOutcome } from "~/lib/qbo-credential-check";
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

describe("QboCredentialsForm - checking while edits are unsaved", () => {
  const checkButton = () => screen.getByRole("button", { name: /check credentials/i });

  it("is available when nothing has been typed (control for the cases below)", async () => {
    view();
    expect(await screen.findByRole("button", { name: /check credentials/i })).not.toBeDisabled();
    expect(screen.queryByText(/Save your changes first/)).not.toBeInTheDocument();
  });

  it("is disabled, and says to save first, once a field has text that is not saved", async () => {
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Show details" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Override" })[0]);
    fireEvent.change(await screen.findByLabelText(/client id/i), { target: { value: "typed-but-not-saved" } });

    expect(checkButton()).toBeDisabled();
    expect(screen.getByText("Save your changes first, then check.")).toBeInTheDocument();
  });

  it("is available again when the typed text is cleared", async () => {
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Show details" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Override" })[0]);
    const field = await screen.findByLabelText(/client id/i);
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "abc" } });
    fireEvent.change(field, { target: { value: "" } });

    expect(checkButton()).not.toBeDisabled();
  });

  it("is disabled after choosing an environment that has not been saved", async () => {
    // Everything else is in place, so only the unsaved choice can be what disables it.
    view({ credentialSource: { ...NONE, clientId: "tenant", clientSecret: "tenant" }, environment: null });
    await screen.findByRole("radiogroup", { name: /intuit environment/i });
    expect(screen.getByRole("button", { name: /check credentials/i })).not.toBeDisabled();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: /intuit environment/i })).getByRole("radio", { name: /production/i }));

    expect(screen.getByRole("button", { name: /check credentials/i })).toBeDisabled();
  });

  it("is available again after folding the section on text that was never saved", async () => {
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Show details" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Override" })[0]);
    fireEvent.change(await screen.findByLabelText(/client id/i), { target: { value: "typed-then-folded" } });
    expect(checkButton()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));

    // The input is gone and its text with it, so nothing is pending any more.
    expect(checkButton()).not.toBeDisabled();
    expect(screen.queryByText(/Save your changes first/)).not.toBeInTheDocument();
  });

  it("does not count pressing the environment already in force as an edit", async () => {
    view({ credentialSource: { ...NONE, clientId: "tenant", clientSecret: "tenant" }, environment: "sandbox" });
    const group = await screen.findByRole("radiogroup", { name: /intuit environment/i });

    fireEvent.click(within(group).getByRole("radio", { name: /sandbox/i }));
    expect(screen.getByRole("button", { name: /check credentials/i })).not.toBeDisabled();

    // Control: a different environment still is one.
    fireEvent.click(within(group).getByRole("radio", { name: /production/i }));
    expect(screen.getByRole("button", { name: /check credentials/i })).toBeDisabled();
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

describe("QboCredentialsForm - Check credentials", () => {
  const CHECKED_AT = 1760400000; // 2025-10-14, epoch seconds
  const OVERPROMISE = /\bvalid\b|production[- ]ready|ready to connect/i;
  // Opens the section on its own (the webhook token is missing) so the footer button shows.
  const OPEN: QBOCredentialSource = { ...ALL_ENV, webhookToken: "missing" };
  const check = () => screen.getByRole("button", { name: /^(Check credentials|Checking…)$/ });
  const panelOf = (text: string | RegExp) => screen.getByText(text).closest("[role]") as HTMLElement;
  const PAIRED: QboCheckOutcome = { kind: "paired", checkedAt: CHECKED_AT };

  function viewCheck(
    outcome: QboCheckOutcome,
    over: Partial<React.ComponentProps<typeof QboCredentialsForm>> = {},
  ) {
    const posted: FormData[] = [];
    const props: React.ComponentProps<typeof QboCredentialsForm> = {
      secrets: NO_SECRETS,
      credentialSource: ALL_ENV,
      environment: "sandbox",
      registration: buildRegistration("https://dev.example.com"),
      saving: false,
      ...over,
    };
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => <QboCredentialsForm {...props} />,
        action: async ({ request }) => {
          posted.push(await request.formData());
          return { success: true, intent: "qbo-check-credentials", error: null, check: outcome };
        },
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    return posted;
  }

  it("paired: says Intuit accepted them, in the success style, with BOTH limits and no over-promise", async () => {
    const posted = viewCheck(PAIRED);
    fireEvent.click(check());
    await screen.findByText("Intuit accepted this Client ID and secret.");
    const banner = panelOf("Intuit accepted this Client ID and secret.");
    expect(banner.className).toContain("bg-ih-ok-bg");
    expect(banner).toHaveTextContent("This does not show whether they are Development or Production keys. Sandbox companies need Development keys.");
    expect(banner).toHaveTextContent("It does not check that the Redirect URI is registered in your Intuit app.");
    expect(banner).toHaveTextContent(/Checked at .*2025/);
    expect(banner.textContent).not.toMatch(OVERPROMISE);
    // The request names the intent plus the guard's idempotency key, and no credential.
    expect([...posted[0].keys()].sort()).toEqual(["idempotencyKey", "intent"]);
    expect(posted[0].get("intent")).toBe("qbo-check-credentials");
  });

  it("rejected: danger style, the copy-again advice, and no over-promise either (control for paired)", async () => {
    viewCheck({ kind: "rejected", checkedAt: CHECKED_AT });
    fireEvent.click(check());
    const text = "Intuit rejected this Client ID and secret. Copy them again from your app's Keys & credentials page.";
    await screen.findByText(text);
    const banner = panelOf(text);
    expect(banner.className).toContain("bg-ih-bad-bg");
    expect(banner.textContent).not.toMatch(OVERPROMISE);
    expect(banner).not.toHaveTextContent("accepted");
    expect(banner).not.toHaveTextContent("does not check that the Redirect URI");
  });

  it("unreachable: warning style, and never suggests the credentials are wrong", async () => {
    viewCheck({ kind: "unreachable", checkedAt: CHECKED_AT });
    fireEvent.click(check());
    await screen.findByText("Could not reach Intuit. Try again in a minute.");
    const banner = panelOf("Could not reach Intuit. Try again in a minute.");
    expect(banner.className).toContain("bg-ih-watch-bg");
    expect(banner.textContent).not.toMatch(/reject|wrong|incorrect|invalid|copy them|mismatch/i);
    expect(banner.textContent).not.toMatch(OVERPROMISE);
  });

  it("says what the server declined for: rate limit, missing settings by name, no public address", async () => {
    viewCheck({ kind: "rate_limited" });
    fireEvent.click(check());
    expect(await screen.findByText("Too many checks. Wait a minute and try again.")).toBeInTheDocument();
    cleanup();

    viewCheck({ kind: "credentials_missing", missing: ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET"] });
    fireEvent.click(check());
    expect(await screen.findByText("These settings are not set yet: Client ID, Client secret.")).toBeInTheDocument();
    cleanup();

    viewCheck({ kind: "app_base_url_missing" });
    fireEvent.click(check());
    expect(await screen.findByText(/Set APP_BASE_URL and try again/)).toBeInTheDocument();
    cleanup();

    viewCheck({ kind: "failed" });
    fireEvent.click(check());
    const failed = await screen.findByText("The check could not run. Try again in a minute.");
    expect(failed.textContent).not.toMatch(/reject|wrong|invalid/i);
  });

  it("is disabled, naming what is missing, while the Client ID, secret or public address is not set", async () => {
    viewCheck(PAIRED, { credentialSource: { ...ALL_ENV, clientId: "missing" } });
    expect(check()).toBeDisabled();
    expect(screen.getByText("To check, first set: Client ID.")).toBeInTheDocument();
    cleanup();

    viewCheck(PAIRED, { credentialSource: NONE, registration: null, environment: null });
    expect(check()).toBeDisabled();
    expect(screen.getByText("To check, first set: Client ID, Client secret, Public address (APP_BASE_URL).")).toBeInTheDocument();
  });

  it("is enabled, with no missing-settings note, when everything is in place (control)", async () => {
    viewCheck(PAIRED);
    expect(check()).toBeEnabled();
    expect(screen.queryByText(/To check, first set/)).not.toBeInTheDocument();
  });

  it("shows one button on the summary row when folded, and one beside Save credentials when open", async () => {
    viewCheck(PAIRED);
    expect(screen.getAllByRole("button", { name: "Check credentials" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Save credentials" })).not.toBeInTheDocument();
    cleanup();

    viewCheck(PAIRED, { credentialSource: OPEN });
    expect(screen.getAllByRole("button", { name: "Check credentials" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Save credentials" })).toBeInTheDocument();
    // Secondary, so it does not compete with Save.
    expect(check().className).not.toContain("bg-ih-primary ");
  });

  it("sends one request for two clicks in one frame", async () => {
    const posted = viewCheck(PAIRED);
    const button = check();
    act(() => {
      button.click();
      button.click();
    });
    expect(await screen.findByText("Intuit accepted this Client ID and secret.")).toBeInTheDocument();
    expect(posted).toHaveLength(1);
    // A later, separate press still goes through.
    fireEvent.click(check());
    await waitFor(() => expect(posted).toHaveLength(2));
  });

  it("reads Checking… and is inert while a check runs", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <QboCredentialsForm
            secrets={NO_SECRETS} credentialSource={ALL_ENV} environment="sandbox"
            registration={buildRegistration("https://dev.example.com")} saving={false}
          />
        ),
        action: async () => {
          await gate;
          return { success: true, intent: "qbo-check-credentials", error: null, check: PAIRED };
        },
      },
    ]);
    render(<Stub initialEntries={["/"]} />);
    fireEvent.click(check());
    const busy = await screen.findByRole("button", { name: "Checking…" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    release();
    expect(await screen.findByRole("button", { name: "Check credentials" })).not.toHaveAttribute("aria-disabled");
  });

  it("drops the result as soon as a credential field is edited (and keeps it before that)", async () => {
    viewCheck(PAIRED, {
      credentialSource: { ...OPEN, clientId: "tenant" },
      secrets: { ...NO_SECRETS, QBO_CLIENT_ID: "AB7B••••••••xyz1" },
    });
    fireEvent.click(check());
    await screen.findByText("Intuit accepted this Client ID and secret.");

    const field = screen.getByLabelText(/client id/i);
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "brand-new-id" } });
    expect(screen.queryByText("Intuit accepted this Client ID and secret.")).not.toBeInTheDocument();

    // The check reads what is saved, so it is not offered while there is text that is not.
    expect(check()).toBeDisabled();
    // With the text gone again, a fresh check shows a fresh answer.
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(check());
    expect(await screen.findByText("Intuit accepted this Client ID and secret.")).toBeInTheDocument();
  });

  it("drops the result when the environment is chosen", async () => {
    viewCheck(PAIRED, { credentialSource: { ...NONE, clientId: "tenant", clientSecret: "tenant" }, environment: null });
    fireEvent.click(check());
    await screen.findByText("Intuit accepted this Client ID and secret.");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: /intuit environment/i })).getByRole("radio", { name: "Production" }));
    expect(screen.queryByText("Intuit accepted this Client ID and secret.")).not.toBeInTheDocument();
  });

  it("never prints a credential value in the result", async () => {
    viewCheck(PAIRED, {
      credentialSource: { ...OPEN, clientId: "tenant" },
      secrets: { ...NO_SECRETS, QBO_CLIENT_ID: "AB7B••••••••xyz1" },
    });
    // Control: the stored value, masked, is on the page in its field.
    expect(document.body.innerHTML).toContain("AB7B");
    fireEvent.click(check());
    await screen.findByText("Intuit accepted this Client ID and secret.");
    const banner = panelOf("Intuit accepted this Client ID and secret.");
    expect(banner.textContent).not.toContain("AB7B");
    expect(banner.textContent).not.toContain("xyz1");
  });
});
