import { describe, it, expect } from "vitest";
import { maskSecret } from "../../server/lib/config-crypto";
import {
  environmentFromMask,
  resolveQboEnvironment,
  deriveUnconnectedCredentialSource,
  buildRegistration,
  qboAccessFrom,
} from "./qbo-settings-loader";

const NONE = { QBO_CLIENT_ID: "", QBO_CLIENT_SECRET: "", QBO_WEBHOOK_SECRET: "", QBO_ENV: "" };

describe("environmentFromMask", () => {
  // The settings API masks every stored value. The environment is the one
  // setting whose masked form still identifies it, because only two values pass
  // the format gate; asserting against the real masker keeps the two in step.
  it("recovers sandbox and production from what maskSecret actually returns", () => {
    expect(environmentFromMask(maskSecret("sandbox"))).toBe("sandbox");
    expect(environmentFromMask(maskSecret("production"))).toBe("production");
  });

  it("returns null for nothing stored", () => {
    expect(environmentFromMask("")).toBeNull();
  });
});

describe("resolveQboEnvironment", () => {
  it("prefers the connection's own answer", () => {
    expect(resolveQboEnvironment({ connected: "production", envValue: "sandbox", masked: "" })).toBe("production");
  });

  it("falls back to the Worker env value, then to the stored value, and never guesses", () => {
    expect(resolveQboEnvironment({ connected: undefined, envValue: "sandbox", masked: maskSecret("production") })).toBe("sandbox");
    expect(resolveQboEnvironment({ connected: undefined, envValue: undefined, masked: maskSecret("production") })).toBe("production");
    expect(resolveQboEnvironment({ connected: undefined, envValue: undefined, masked: "" })).toBeNull();
  });

  it("does not claim an environment for a near miss in the env value", () => {
    expect(resolveQboEnvironment({ connected: undefined, envValue: "Sandbox", masked: "" })).toBeNull();
  });
});

describe("deriveUnconnectedCredentialSource", () => {
  it("names the env as the origin when it supplies a key, even if a stored value exists too", () => {
    const src = deriveUnconnectedCredentialSource(
      { QBO_CLIENT_ID: "cid", QBO_CLIENT_SECRET: "sec" },
      { ...NONE, QBO_CLIENT_ID: maskSecret("stored-client-id") },
    );
    expect(src.clientId).toBe("env");
    expect(src.clientSecret).toBe("env");
  });

  it("names the tenant when only a stored value exists, and 'missing' when neither does", () => {
    const src = deriveUnconnectedCredentialSource({}, { ...NONE, QBO_WEBHOOK_SECRET: maskSecret("whk-token-12345") });
    expect(src.webhookToken).toBe("tenant");
    expect(src.clientId).toBe("missing");
    expect(src.environment).toBe("missing");
  });
});

describe("buildRegistration", () => {
  it("is null without a public origin, and carries the three addresses with one", () => {
    expect(buildRegistration(undefined)).toBeNull();
    expect(buildRegistration("")).toBeNull();
    const r = buildRegistration("https://dev.example.com");
    expect(r?.redirectUri).toBe("https://dev.example.com/api/integrations/qbo/callback");
    expect(r?.webhookUrl).toBe("https://dev.example.com/webhooks/quickbooks");
    expect(r?.secure).toBe(true);
  });

  it("flags a plain-http origin so the page can say Intuit will refuse it", () => {
    expect(buildRegistration("http://localhost:8787")?.secure).toBe(false);
  });
});

describe("qboAccessFrom", () => {
  it("is forbidden on 401 and 403, ok on anything else", () => {
    expect(qboAccessFrom({ status: 403 } as Response)).toBe("forbidden");
    expect(qboAccessFrom({ status: 401 } as Response)).toBe("forbidden");
    expect(qboAccessFrom({ status: 200 } as Response)).toBe("ok");
    // A failure of the service is not a refusal: it must not read as "not allowed".
    expect(qboAccessFrom({ status: 500 } as Response)).toBe("ok");
    expect(qboAccessFrom({ status: 404 } as Response)).toBe("ok");
    expect(qboAccessFrom(null)).toBe("ok");
  });
});
