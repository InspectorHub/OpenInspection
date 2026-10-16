// @vitest-environment happy-dom
/**
 * Integrations -> Email. The page that owns the email provider choice and keys
 * (they used to sit in Communication).
 *
 * BFF-seam approach for the loader and action: the exported functions run
 * against a mocked api-client. The rendered page is checked for what a person
 * sees in each deployment kind.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";

const getComm = vi.fn();
const getSecrets = vi.fn();
const getTenantConfig = vi.fn();
const getSources = vi.fn();
const putSource = vi.fn();
const patchTenantConfig = vi.fn();
const putSecrets = vi.fn();
const postValidate = vi.fn();
const postEmailStep = vi.fn();
const requireAdminLoader = vi.fn();

vi.mock("~/lib/session.server", () => ({ requireToken: vi.fn(async () => "tok-123") }));
vi.mock("~/lib/access.server", () => ({ requireAdminLoader: (...a: unknown[]) => requireAdminLoader(...a) }));
vi.mock("~/lib/api-client.server", () => ({
  createApi: vi.fn(() => ({
    admin: {
      communication: { $get: getComm },
      "tenant-config": { $get: getTenantConfig, $patch: patchTenantConfig },
      "integration-sources": { $get: getSources, $put: putSource },
    },
    secrets: { secrets: { $get: getSecrets, $put: putSecrets } },
    integrations: {
      email: { validate: { $post: postValidate } },
      "test-results": { $get: () => Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) }) },
    },
    integrationsTestSteps: { email: { $post: postEmailStep } },
  })),
}));

import Page, { loader, action } from "./settings-integrations-email";
import { granted } from "../../tests/helpers/loader-data";

type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];

const jsonRes = (body: unknown, ok = true, status = ok ? 200 : 500) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

const loaderArgs = (): LoaderArgs =>
  ({ request: new Request("http://app.example.com/settings/integrations/email"), context: {} as never, params: {} }) as unknown as LoaderArgs;

function actionArgs(form: Record<string, string>): ActionArgs {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.set(k, v);
  return {
    request: new Request("http://app.example.com/settings/integrations/email", { method: "POST", body: fd }),
    context: {} as never,
    params: {},
  } as unknown as ActionArgs;
}

const HOSTED_ROW = {
  service: "email", choiceShown: true, available: ["provided", "own"], stored: null, current: "provided",
  reason: "profile_default", reasonKey: null, state: "connected", ownReady: false,
};
const SELF_HOSTED_ROW = {
  service: "email", choiceShown: false, available: ["own"], stored: null, current: "own",
  reason: "profile_default", reasonKey: null, state: "connected", ownReady: true,
};
const sourcesBody = (row: object) => ({ success: true, data: [row, { ...row, service: "sms" }] });

beforeEach(() => {
  requireAdminLoader.mockReset().mockResolvedValue({ forbidden: false, token: "tok-123" });
  getComm.mockReset().mockResolvedValue(jsonRes({ data: { emailMode: "own", senderEmail: "me@acme.test", resendConfigured: true } }));
  getSecrets.mockReset().mockResolvedValue(jsonRes({ data: { RESEND_API_KEY: "re_••••1234", TWILIO_AUTH_TOKEN: "tw_••••" } }));
  getTenantConfig.mockReset().mockResolvedValue(jsonRes({ data: { emailByoProvider: "resend" } }));
  getSources.mockReset().mockResolvedValue(jsonRes(sourcesBody(HOSTED_ROW)));
  putSource.mockReset().mockResolvedValue(jsonRes({ success: true, data: { service: "email", source: "own" } }));
  patchTenantConfig.mockReset().mockResolvedValue(jsonRes({ success: true }));
  putSecrets.mockReset().mockResolvedValue(jsonRes({ success: true }));
  postValidate.mockReset().mockResolvedValue(jsonRes({ data: { ok: true } }));
  postEmailStep.mockReset().mockResolvedValue(jsonRes({ data: { status: "pass", detail: null } }));
});
afterEach(cleanup);

describe("email page loader", () => {
  it("returns this service's source row, the sender address, and the saved provider", async () => {
    const data = granted(await loader(loaderArgs()));
    expect(data.source).toMatchObject({ service: "email", choiceShown: true, available: ["provided", "own"] });
    expect(data.senderEmail).toBe("me@acme.test");
    expect(data.emailByoProvider).toBe("resend");
  });

  it.each(["sendgrid", "postmark", "mailgun"] as const)("surfaces the saved provider %s", async (provider) => {
    getTenantConfig.mockResolvedValue(jsonRes({ data: { emailByoProvider: provider } }));
    expect(granted(await loader(loaderArgs())).emailByoProvider).toBe(provider);
  });

  it("defaults the provider to resend when the call fails or the field is absent", async () => {
    getTenantConfig.mockResolvedValue(jsonRes(null, false));
    expect(granted(await loader(loaderArgs())).emailByoProvider).toBe("resend");
    getTenantConfig.mockResolvedValue(jsonRes({ data: {} }));
    expect(granted(await loader(loaderArgs())).emailByoProvider).toBe("resend");
  });

  it("hands the page masked email keys only, never an SMS key", async () => {
    getSecrets.mockResolvedValue(jsonRes({ data: {
      RESEND_API_KEY: "re_••••", SENDGRID_API_KEY: "SG.••••", POSTMARK_SERVER_TOKEN: "pm_••••",
      MAILGUN_API_KEY: "mg_••••", MAILGUN_DOMAIN: "mg.example.com", TWILIO_AUTH_TOKEN: "tw_••••",
    } }));
    const data = granted(await loader(loaderArgs()));
    expect(data.secrets).toMatchObject({ SENDGRID_API_KEY: "SG.••••", POSTMARK_SERVER_TOKEN: "pm_••••", MAILGUN_API_KEY: "mg_••••", MAILGUN_DOMAIN: "mg.example.com" });
    expect(Object.keys(data.secrets).some((k) => k.startsWith("TWILIO") || k.startsWith("TELNYX"))).toBe(false);
  });

  it("reads as own-only and not connected when the source call fails, never as connected", async () => {
    getSources.mockResolvedValue(jsonRes(null, false));
    const data = granted(await loader(loaderArgs()));
    expect(data.source).toMatchObject({ choiceShown: false, available: ["own"], state: "not_connected" });
  });

  it("answers a person below owner or manager with the forbidden branch and reads nothing", async () => {
    requireAdminLoader.mockResolvedValue({ forbidden: true, token: "tok-123" });
    expect(await loader(loaderArgs())).toEqual({ forbidden: true });
    expect(getSecrets).not.toHaveBeenCalled();
    expect(getSources).not.toHaveBeenCalled();
  });
});

describe("email page action: save-email-secrets", () => {
  it.each([
    ["resend", { RESEND_API_KEY: "re_newkey" }],
    ["sendgrid", { SENDGRID_API_KEY: "SG.newkey" }],
    ["postmark", { POSTMARK_SERVER_TOKEN: "pm_token" }],
    ["mailgun", { MAILGUN_API_KEY: "key-abc", MAILGUN_DOMAIN: "mg.example.com" }],
  ] as const)("saves the provider %s and only its keys", async (provider, keys) => {
    const res = await action(actionArgs({ intent: "save-email-secrets", email_byo_provider: provider, ...keys }));
    expect(patchTenantConfig).toHaveBeenCalledWith({ json: { emailByoProvider: provider } });
    expect(putSecrets).toHaveBeenCalledWith({ json: keys });
    expect(res).toMatchObject({ intent: "save-email-secrets", ok: true });
  });

  it("falls back to resend on a garbage provider value", async () => {
    await action(actionArgs({ intent: "save-email-secrets", email_byo_provider: "GARBAGE", RESEND_API_KEY: "re_key" }));
    expect(patchTenantConfig).toHaveBeenCalledWith({ json: { emailByoProvider: "resend" } });
  });

  it("leaves a blank field alone: nothing is sent for it (leave blank to keep)", async () => {
    const res = await action(actionArgs({ intent: "save-email-secrets", email_byo_provider: "sendgrid", SENDGRID_API_KEY: "   " }));
    expect(putSecrets).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true });
  });

  it("stops before the keys when the provider choice cannot be saved", async () => {
    patchTenantConfig.mockResolvedValue(jsonRes(null, false));
    const res = await action(actionArgs({ intent: "save-email-secrets", email_byo_provider: "resend", RESEND_API_KEY: "re_key" }));
    expect(putSecrets).not.toHaveBeenCalled();
    expect(res).toMatchObject({ intent: "save-email-secrets", ok: false, error: "Failed to save provider selection." });
  });
});

describe("email page action: checks", () => {
  it("validates the saved credentials of a known provider", async () => {
    const res = await action(actionArgs({ intent: "validate-email-provider", provider: "postmark" }));
    expect(postValidate).toHaveBeenCalledWith({ json: { provider: "postmark" } });
    expect(res).toMatchObject({ intent: "validate-email-provider", ok: true });
  });

  it("refuses an unknown provider without calling the API", async () => {
    const res = await action(actionArgs({ intent: "validate-email-provider", provider: "nope" }));
    expect(postValidate).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false });
  });

  it("runs one step of the stepwise test", async () => {
    const res = await action(actionArgs({ intent: "test-email-step", step: "key_valid" }));
    expect(postEmailStep).toHaveBeenCalledWith({ json: { step: "key_valid" } });
    expect(res).toMatchObject({ intent: "test-email-step", ok: true });
  });
});

describe("email page action: save-source", () => {
  it("saves only the choice: no key and no provider setting is written", async () => {
    const res = await action(actionArgs({ intent: "save-source", source: "own" }));
    expect(putSource).toHaveBeenCalledWith({ json: { service: "email", source: "own" } });
    expect(putSecrets).not.toHaveBeenCalled();
    expect(patchTenantConfig).not.toHaveBeenCalled();
    expect(res).toMatchObject({ intent: "save-source", ok: true });
  });

  it("switches to Built-in without touching the company's keys", async () => {
    await action(actionArgs({ intent: "save-source", source: "provided" }));
    expect(putSource).toHaveBeenCalledWith({ json: { service: "email", source: "provided" } });
    expect(putSecrets).not.toHaveBeenCalled();
  });

  it("tells the person to finish their own details first when the server refuses Your own", async () => {
    putSource.mockResolvedValue(jsonRes({ success: false, error: { code: "own_credentials_incomplete", message: "x" } }, false, 409));
    const res = await action(actionArgs({ intent: "save-source", source: "own" }));
    expect(res).toMatchObject({ intent: "save-source", ok: false, error: "Add your own account details below first, then choose Your own." });
  });

  it("refuses any other value without calling the API", async () => {
    for (const source of ["platform", "managed_shared", ""]) {
      const res = await action(actionArgs({ intent: "save-source", source }));
      expect(res).toMatchObject({ ok: false });
    }
    expect(putSource).not.toHaveBeenCalled();
  });
});

type PageData = Awaited<ReturnType<typeof loader>>;
const EMPTY_SECRETS = { RESEND_API_KEY: "", SENDGRID_API_KEY: "", POSTMARK_SERVER_TOKEN: "", MAILGUN_API_KEY: "", MAILGUN_DOMAIN: "", RESEND_WEBHOOK_SECRET: "", SENDGRID_WEBHOOK_PUBLIC_KEY: "", POSTMARK_WEBHOOK_TOKEN: "", MAILGUN_SIGNING_KEY: "" };
function renderPage(row: object, over: Record<string, unknown> = {}) {
  const data = {
    source: row, senderEmail: "me@acme.test", emailByoProvider: "resend", testResults: [],
    secrets: EMPTY_SECRETS,
    ...over,
  } as unknown as PageData;
  const Stub = createRoutesStub([{ path: "/settings/integrations/email", Component: Page, loader: () => data }]);
  return render(<Stub initialEntries={["/settings/integrations/email"]} />);
}

describe("email page", () => {
  it("asks which account to use where a built-in one exists", async () => {
    renderPage(HOSTED_ROW);
    expect(await screen.findByRole("radio", { name: /Built-in/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Your own/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save choice" })).toBeTruthy();
  });

  it("does not ask where there is no built-in account, and shows the account details", async () => {
    renderPage(SELF_HOSTED_ROW);
    expect(await screen.findByTestId("delivery-source")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Built-in/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save choice" })).toBeNull();
    expect(screen.getByText("Email API keys")).toBeTruthy();
  });

  it("keeps the account details out of the way while Built-in is selected, and says they are kept", async () => {
    renderPage(HOSTED_ROW);
    await screen.findByRole("radio", { name: /Built-in/ });
    expect(screen.queryByText("Email API keys")).toBeNull();
    expect(screen.getByText(/Your own account details stay saved/)).toBeTruthy();
    await act(async () => { screen.getByRole("radio", { name: /Your own/ }).click(); });
    expect(await screen.findByText("Email API keys")).toBeTruthy();
  });

  it("points at Communication when Your own has no sender address", async () => {
    renderPage({ ...HOSTED_ROW, stored: "own", current: "unavailable", reason: "own_credentials_incomplete", reasonKey: "integrations_source_reason_own_credentials_incomplete", state: "attention" }, {
      senderEmail: null,
      secrets: { ...EMPTY_SECRETS, RESEND_API_KEY: "re_••••1234" },
    });
    expect(await screen.findByText(/needs a sender address/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open Communication" });
    expect(link.getAttribute("href")).toBe("/settings/communication");
  });

  it("never uses the words a company is not meant to read", async () => {
    for (const row of [HOSTED_ROW, SELF_HOSTED_ROW]) {
      const { container, unmount } = renderPage(row);
      await screen.findByTestId("delivery-source");
      expect(container.textContent ?? "").not.toMatch(/workspace|tenant|deployment|platform|managed|BYO|[A-Z_]{6,}_(KEY|SECRET|ID)\b/i);
      unmount();
    }
  });
});
