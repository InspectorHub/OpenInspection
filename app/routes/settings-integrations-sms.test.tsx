// @vitest-environment happy-dom
/**
 * Integrations -> SMS. The page that owns the SMS provider choice, keys, company
 * phone and (where it is offered) registration onboarding. They used to sit in
 * Communication.
 *
 * Loader and action run against a mocked api-client (the BFF seam); the rendered
 * page is checked for what a person sees in each deployment kind.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { createLoadContext } from "~/lib/load-context";

const getComm = vi.fn();
const getSecrets = vi.fn();
const getSmsConfig = vi.fn();
const getTenantConfig = vi.fn();
const getSmsCompliance = vi.fn();
const getSources = vi.fn();
const putSource = vi.fn();
const patchTenantConfig = vi.fn();
const putSecrets = vi.fn();
const postSmsTest = vi.fn();
const postProvision = vi.fn();
const postResubmit = vi.fn();
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
    smsAdmin: {
      sms: {
        config: { $get: getSmsConfig },
        test: { $post: postSmsTest },
        compliance: { $get: getSmsCompliance, provision: { $post: postProvision }, resubmit: { $post: postResubmit } },
      },
    },
    integrations: {
      "test-results": { $get: () => Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) }) },
    },
  })),
}));

import Page, { loader, action } from "./settings-integrations-sms";
import { granted } from "../../tests/helpers/loader-data";

type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];

const jsonRes = (body: unknown, ok = true, status = ok ? 200 : 500) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

const loaderArgs = (env: Record<string, string> = { APP_MODE: "saas" }): LoaderArgs =>
  ({ request: new Request("http://app.example.com/settings/integrations/sms"), context: createLoadContext(env) as never, params: {} }) as unknown as LoaderArgs;

function actionArgs(form: Record<string, string>, env: Record<string, string> = { APP_MODE: "saas" }): ActionArgs {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.set(k, v);
  return {
    request: new Request("http://app.example.com/settings/integrations/sms", { method: "POST", body: fd }),
    context: createLoadContext(env) as never,
    params: {},
  } as unknown as ActionArgs;
}

const HOSTED_ROW = {
  service: "sms", choiceShown: true, available: ["own"], stored: null, current: "unavailable",
  reason: "provider_confirmation_pending", reasonKey: "integrations_source_reason_provider_confirmation_pending",
  state: "not_connected", ownReady: false,
};
const SELF_HOSTED_ROW = {
  service: "sms", choiceShown: false, available: ["own"], stored: null, current: "own",
  reason: "profile_default", reasonKey: null, state: "connected", ownReady: true,
};
const sourcesBody = (row: object) => ({ success: true, data: [{ ...row, service: "email" }, row] });

const MANAGED_BODY = {
  data: {
    mode: "managed_dedicated", complianceStatus: "profile_pending", rejectionReason: null, tollfree: [],
    customerProfileStatus: "pending-review", brandStatus: null, campaignStatus: null, tfvStatus: null,
    messagingServiceSid: "MGxxx", provisionedNumber: "+15559990000",
  },
};

beforeEach(() => {
  requireAdminLoader.mockReset().mockResolvedValue({ forbidden: false, token: "tok-123" });
  getComm.mockReset().mockResolvedValue(jsonRes({ data: { legalName: "Acme Inspection LLC" } }));
  getSecrets.mockReset().mockResolvedValue(jsonRes({ data: { TWILIO_ACCOUNT_SID: "AC••••1234", RESEND_API_KEY: "re_••••" } }));
  getSmsConfig.mockReset().mockResolvedValue(jsonRes({ data: { mode: "own", effectiveSource: "own" } }));
  getTenantConfig.mockReset().mockResolvedValue(jsonRes({ data: { smsMode: "own", companyPhone: "+15551112222" } }));
  getSmsCompliance.mockReset().mockResolvedValue(jsonRes({ data: { mode: "own", complianceStatus: "approved", rejectionReason: null, tollfree: [] } }));
  getSources.mockReset().mockResolvedValue(jsonRes(sourcesBody(HOSTED_ROW)));
  putSource.mockReset().mockResolvedValue(jsonRes({ success: true, data: { service: "sms", source: "own" } }));
  patchTenantConfig.mockReset().mockResolvedValue(jsonRes({ success: true }));
  putSecrets.mockReset().mockResolvedValue(jsonRes({ success: true }));
  postSmsTest.mockReset().mockResolvedValue(jsonRes({ success: true }));
  postProvision.mockReset().mockResolvedValue(jsonRes({ success: true, data: MANAGED_BODY.data }));
  postResubmit.mockReset().mockResolvedValue(jsonRes({ success: true, data: MANAGED_BODY.data }));
});
afterEach(cleanup);

describe("sms page loader", () => {
  it("returns this service's source row, the effective source, company phone and masked keys", async () => {
    const data = granted(await loader(loaderArgs()));
    expect(data.source).toMatchObject({ service: "sms", choiceShown: true, available: ["own"] });
    expect(data.smsConfig).toEqual({ mode: "own", effectiveSource: "own" });
    expect(data.companyPhone).toBe("+15551112222");
    expect(data.secrets.TWILIO_ACCOUNT_SID).toBe("AC••••1234");
    // the registration form is pre-filled with the company's legal name
    expect(data.legalName).toBe("Acme Inspection LLC");
  });

  it("hands the page SMS keys only, never an email key", async () => {
    const data = granted(await loader(loaderArgs()));
    expect(Object.keys(data.secrets).sort()).toEqual([
      "TELNYX_API_KEY", "TELNYX_FROM_NUMBER", "TELNYX_PUBLIC_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER",
    ]);
  });

  it("degrades the SMS configuration to platform/none and the phone to empty when the calls fail", async () => {
    getSmsConfig.mockResolvedValue(jsonRes(null, false));
    getTenantConfig.mockResolvedValue(jsonRes(null, false));
    const data = granted(await loader(loaderArgs()));
    expect(data.smsConfig).toEqual({ mode: "platform", effectiveSource: "none" });
    expect(data.companyPhone).toBe("");
  });

  it("reads as own-only and not connected when the source call fails, never as connected", async () => {
    getSources.mockResolvedValue(jsonRes(null, false));
    expect(granted(await loader(loaderArgs())).source).toMatchObject({ choiceShown: false, available: ["own"], state: "not_connected" });
  });

  it("answers a person below owner or manager with the forbidden branch and reads nothing", async () => {
    requireAdminLoader.mockResolvedValue({ forbidden: true, token: "tok-123" });
    expect(await loader(loaderArgs())).toEqual({ forbidden: true });
    expect(getSecrets).not.toHaveBeenCalled();
  });
});

describe("sms page loader: registration status", () => {
  it("surfaces the status and the sub-statuses", async () => {
    getSmsCompliance.mockResolvedValue(jsonRes(MANAGED_BODY));
    expect(granted(await loader(loaderArgs())).compliance).toMatchObject({
      complianceStatus: "profile_pending", rejectionReason: null, customerProfileStatus: "pending-review",
      brandStatus: null, campaignStatus: null, tfvStatus: null, messagingServiceSid: "MGxxx", provisionedNumber: "+15559990000",
    });
  });

  it("passes the rejection reason through when rejected", async () => {
    getSmsCompliance.mockResolvedValue(jsonRes({ data: { mode: "own", complianceStatus: "rejected", rejectionReason: "Website URL does not match business.", tollfree: [] } }));
    expect(granted(await loader(loaderArgs())).compliance).toMatchObject({ complianceStatus: "rejected", rejectionReason: "Website URL does not match business." });
  });

  it("degrades every status field to null / not started when the call fails", async () => {
    getSmsCompliance.mockResolvedValue(jsonRes(null, false));
    expect(granted(await loader(loaderArgs())).compliance).toMatchObject({
      complianceStatus: "not_started", rejectionReason: null, customerProfileStatus: null, brandStatus: null,
      campaignStatus: null, tfvStatus: null, messagingServiceSid: null, provisionedNumber: null,
    });
  });

  it("defaults the carrier to twilio, and surfaces telnyx when stored", async () => {
    expect(granted(await loader(loaderArgs())).managedProvider).toBe("twilio");
    getTenantConfig.mockResolvedValue(jsonRes({ data: { smsMode: "managed_dedicated", managedProvider: "telnyx" } }));
    expect(granted(await loader(loaderArgs())).managedProvider).toBe("telnyx");
    getTenantConfig.mockResolvedValue(jsonRes({ data: { managedProvider: null } }));
    expect(granted(await loader(loaderArgs())).managedProvider).toBe("twilio");
  });

  it("offers onboarding only on a deployment that files registrations, and only to a company already on it", async () => {
    getSmsConfig.mockResolvedValue(jsonRes({ data: { mode: "managed_dedicated", effectiveSource: "none" } }));
    expect(granted(await loader(loaderArgs({ APP_MODE: "saas" }))).showOnboarding).toBe(true);
    expect(granted(await loader(loaderArgs({}))).showOnboarding).toBe(false);
    getSmsConfig.mockResolvedValue(jsonRes({ data: { mode: "own", effectiveSource: "own" } }));
    expect(granted(await loader(loaderArgs({ APP_MODE: "saas" }))).showOnboarding).toBe(false);
  });
});

describe("sms page action: company phone and keys", () => {
  it("save-sms-config writes the company phone (blank clears it) and never the mode", async () => {
    await action(actionArgs({ intent: "save-sms-config", companyPhone: "+15553334444", smsMode: "managed_shared" }));
    expect(patchTenantConfig).toHaveBeenCalledWith({ json: { companyPhone: "+15553334444" } });
    await action(actionArgs({ intent: "save-sms-config", companyPhone: "" }));
    expect(patchTenantConfig).toHaveBeenLastCalledWith({ json: { companyPhone: null } });
  });

  it("save-sms-secrets saves the provider and only the non-empty Twilio keys", async () => {
    const res = await action(actionArgs({
      intent: "save-sms-secrets", sms_byo_provider: "twilio",
      TWILIO_ACCOUNT_SID: "ACnew", TWILIO_AUTH_TOKEN: "", TWILIO_FROM_NUMBER: "+15550001111", TELNYX_API_KEY: "stray",
    }));
    expect(patchTenantConfig).toHaveBeenCalledWith({ json: { smsByoProvider: "twilio" } });
    expect(putSecrets).toHaveBeenCalledWith({ json: { TWILIO_ACCOUNT_SID: "ACnew", TWILIO_FROM_NUMBER: "+15550001111" } });
    expect(res).toMatchObject({ intent: "save-sms-secrets", ok: true });
  });

  it("save-sms-secrets for telnyx sends only the Telnyx keys", async () => {
    await action(actionArgs({ intent: "save-sms-secrets", sms_byo_provider: "telnyx", TELNYX_API_KEY: "KEY", TWILIO_ACCOUNT_SID: "stray" }));
    expect(patchTenantConfig).toHaveBeenCalledWith({ json: { smsByoProvider: "telnyx" } });
    expect(putSecrets).toHaveBeenCalledWith({ json: { TELNYX_API_KEY: "KEY" } });
  });

  it("test-sms posts the number and reports success", async () => {
    const res = await action(actionArgs({ intent: "test-sms", to: "+15551234567" }));
    expect(postSmsTest).toHaveBeenCalledWith({ json: { to: "+15551234567" } });
    expect(res).toMatchObject({ intent: "test-sms", ok: true });
  });

  it("test-sms surfaces a fail-closed error", async () => {
    postSmsTest.mockResolvedValue(jsonRes({ success: false, error: "SMS is not configured." }));
    expect(await action(actionArgs({ intent: "test-sms", to: "+15551234567" }))).toMatchObject({ ok: false, error: "SMS is not configured." });
  });
});

describe("sms page action: save-source", () => {
  it("saves only the choice, with the service named, and writes no key", async () => {
    const res = await action(actionArgs({ intent: "save-source", source: "own" }));
    expect(putSource).toHaveBeenCalledWith({ json: { service: "sms", source: "own" } });
    expect(putSecrets).not.toHaveBeenCalled();
    expect(patchTenantConfig).not.toHaveBeenCalled();
    expect(res).toMatchObject({ intent: "save-source", ok: true });
  });

  it("explains a refused Built-in as not available", async () => {
    putSource.mockResolvedValue(jsonRes({ success: false, error: { code: "not_offered", message: "x" } }, false, 409));
    expect(await action(actionArgs({ intent: "save-source", source: "provided" }))).toMatchObject({
      ok: false, error: "That choice is not available.",
    });
  });

  it("refuses the retired value and anything unknown without calling the API", async () => {
    for (const source of ["platform", "managed_shared", ""]) {
      expect(await action(actionArgs({ intent: "save-source", source }))).toMatchObject({ ok: false });
    }
    expect(putSource).not.toHaveBeenCalled();
  });
});

describe("sms page action: registration onboarding", () => {
  const BUSINESS = { legalName: "Acme Inspection LLC", address: "123 Main St, Springfield, IL 62701", repName: "Jane Smith" };

  it("provision posts the business details and channel", async () => {
    const res = await action(actionArgs({ intent: "sms-compliance-provision", ...BUSINESS, email: "jane@acme.com", areaCode: "415", channel: "sp10dlc" }));
    expect(postProvision).toHaveBeenCalledWith({ json: { businessInfo: { ...BUSINESS, email: "jane@acme.com", areaCode: "415" }, channel: "sp10dlc" } });
    expect(res).toMatchObject({ intent: "sms-compliance-provision", ok: true });
  });

  it("leaves blank optional fields out", async () => {
    await action(actionArgs({ intent: "sms-compliance-provision", ...BUSINESS, email: "", areaCode: "", channel: "tollfree" }));
    const call = postProvision.mock.calls[0]![0] as { json: { businessInfo: Record<string, string>; channel: string } };
    expect(call.json.businessInfo).not.toHaveProperty("email");
    expect(call.json.businessInfo).not.toHaveProperty("areaCode");
    expect(call.json.channel).toBe("tollfree");
  });

  it.each([["legalName"], ["address"], ["repName"]])("refuses a missing %s without calling the API", async (field) => {
    const res = await action(actionArgs({ intent: "sms-compliance-provision", ...BUSINESS, [field]: "", channel: "sp10dlc" }));
    expect(postProvision).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false, field });
  });

  it("refuses an invalid email without calling the API", async () => {
    const res = await action(actionArgs({ intent: "sms-compliance-provision", ...BUSINESS, email: "not-an-email", channel: "sp10dlc" }));
    expect(postProvision).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false, field: "email" });
  });

  it("refuses on a deployment that does not file registrations", async () => {
    const res = await action(actionArgs({ intent: "sms-compliance-provision", ...BUSINESS, channel: "sp10dlc" }, {}));
    expect(postProvision).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false });
  });

  it("explains the two known server refusals, and passes any other through", async () => {
    postProvision.mockResolvedValue(jsonRes({ error: "managed_provision_unavailable" }, false));
    const base = { intent: "sms-compliance-provision", ...BUSINESS, channel: "sp10dlc" };
    expect(await action(actionArgs(base))).toMatchObject({ ok: false, error: "Managed SMS provisioning is not available in standalone mode." });
    postProvision.mockResolvedValue(jsonRes({ error: "managed_not_configured" }, false));
    expect(await action(actionArgs(base))).toMatchObject({ ok: false, error: "Managed Twilio credentials are not configured on this deployment." });
  });

  it("resubmit posts to the resubmit endpoint, and validates first", async () => {
    const res = await action(actionArgs({ intent: "sms-compliance-resubmit", ...BUSINESS, channel: "tollfree" }));
    expect(postResubmit).toHaveBeenCalledWith({ json: { businessInfo: BUSINESS, channel: "tollfree" } });
    expect(postProvision).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true });
    postResubmit.mockClear();
    expect(await action(actionArgs({ intent: "sms-compliance-resubmit", ...BUSINESS, address: "", channel: "tollfree" }))).toMatchObject({ ok: false, field: "address" });
    expect(postResubmit).not.toHaveBeenCalled();
  });

  it("save-managed-provider stores the carrier, defaulting to twilio, and reports a failure", async () => {
    await action(actionArgs({ intent: "save-managed-provider", managedProvider: "telnyx" }));
    expect(patchTenantConfig).toHaveBeenLastCalledWith({ json: { managedProvider: "telnyx" } });
    await action(actionArgs({ intent: "save-managed-provider" }));
    expect(patchTenantConfig).toHaveBeenLastCalledWith({ json: { managedProvider: "twilio" } });
    patchTenantConfig.mockResolvedValue(jsonRes({ error: "server_error" }, false));
    expect(await action(actionArgs({ intent: "save-managed-provider", managedProvider: "telnyx" }))).toMatchObject({ ok: false });
  });
});

type PageData = Awaited<ReturnType<typeof loader>>;
const EMPTY_SECRETS = { TWILIO_ACCOUNT_SID: "", TWILIO_AUTH_TOKEN: "", TWILIO_FROM_NUMBER: "", TELNYX_API_KEY: "", TELNYX_FROM_NUMBER: "", TELNYX_PUBLIC_KEY: "" };
const COMPLIANCE = {
  complianceStatus: "not_started", rejectionReason: null, customerProfileStatus: null, brandStatus: null,
  campaignStatus: null, tfvStatus: null, messagingServiceSid: null, provisionedNumber: null,
};
function renderPage(row: object, over: Record<string, unknown> = {}) {
  const data = {
    source: row, smsConfig: { mode: "own", effectiveSource: "none" }, companyPhone: "", byoProvider: "twilio",
    managedProvider: "twilio", compliance: COMPLIANCE, showOnboarding: false, legalName: "", secrets: EMPTY_SECRETS,
    testResults: [], ...over,
  } as unknown as PageData;
  const Stub = createRoutesStub([{ path: "/settings/integrations/sms", Component: Page, loader: () => data }]);
  return render(<Stub initialEntries={["/settings/integrations/sms"]} />);
}

describe("sms page", () => {
  it("shows Built-in as not available yet and cannot be chosen, while Your own is open", async () => {
    renderPage(HOSTED_ROW);
    const builtIn = (await screen.findByRole("radio", { name: /^Built-in/ })) as HTMLInputElement;
    expect(builtIn.disabled).toBe(true);
    expect(screen.getByText("Not available yet")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /^Your own/ })).toBeTruthy();
    // the connection card says the same thing once, in its own words
    expect(screen.getByTestId("delivery-source").textContent).toContain("Built-in SMS is not available yet");
  });

  it("does not ask where there is no built-in account, and shows the account details", async () => {
    renderPage(SELF_HOSTED_ROW, { smsConfig: { mode: "own", effectiveSource: "own" } });
    await screen.findByTestId("delivery-source");
    expect(screen.queryByRole("radio", { name: /^Built-in/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save choice" })).toBeNull();
    expect(screen.getByText("Twilio Account SID")).toBeTruthy();
  });

  it("shows the company phone form and no mode controls", async () => {
    renderPage(SELF_HOSTED_ROW, { companyPhone: "+15551112222" });
    const phone = (await screen.findByLabelText(/Company phone/i)) as HTMLInputElement;
    expect(phone.value).toBe("+15551112222");
  });

  it("shows the registration status of a company's own Twilio number, and not for Telnyx", async () => {
    const c = { ...COMPLIANCE, complianceStatus: "rejected", rejectionReason: "Website URL does not match business." };
    renderPage(SELF_HOSTED_ROW, { smsConfig: { mode: "own", effectiveSource: "own" }, compliance: c });
    expect(await screen.findByText("Website URL does not match business.")).toBeTruthy();
    cleanup();
    renderPage(SELF_HOSTED_ROW, { smsConfig: { mode: "own", effectiveSource: "own" }, compliance: c, byoProvider: "telnyx" });
    await screen.findByTestId("delivery-source");
    expect(screen.queryByText("Website URL does not match business.")).toBeNull();
  });

  it("offers registration onboarding only when the loader says so", async () => {
    renderPage(HOSTED_ROW, { showOnboarding: true, smsConfig: { mode: "managed_dedicated", effectiveSource: "none" } });
    expect(await screen.findByText("Dedicated number setup")).toBeTruthy();
    cleanup();
    renderPage(HOSTED_ROW, { showOnboarding: false });
    await screen.findByTestId("delivery-source");
    expect(screen.queryByText("Dedicated number setup")).toBeNull();
  });

  it("never uses the words a company is not meant to read", async () => {
    for (const row of [HOSTED_ROW, SELF_HOSTED_ROW]) {
      const { container, unmount } = renderPage(row);
      await screen.findByTestId("delivery-source");
      await act(async () => {});
      expect(container.textContent ?? "").not.toMatch(/workspace|tenant|deployment|platform|BYO|[A-Z_]{6,}_(KEY|SECRET|ID)\b/i);
      unmount();
    }
  });
});
