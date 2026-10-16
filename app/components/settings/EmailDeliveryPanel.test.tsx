// @vitest-environment happy-dom
/**
 * A fast double click on Save must post the email settings once.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { useForm } from "@conform-to/react";
import { EmailDeliveryPanel } from "./EmailDeliveryPanel";

afterEach(cleanup);

type Shape = {
  senderEmail?: string | undefined;
  replyTo?: string | undefined;
  emailMode?: "platform" | "own" | undefined;
  senderDisplayName?: string | undefined;
  pointOfContact?: "inspector" | "company" | undefined;
};

function Harness() {
  const [form, fields] = useForm<Shape>({});
  return (
    <EmailDeliveryPanel
      config={{
        senderEmail: "a@example.com", replyTo: "a@example.com", resendConfigured: true,
        emailMode: "own", senderDisplayName: null, companyName: "Acme", pointOfContact: "company",
      }}
      emailByoProvider="resend"
      ownProviderConfigured
      mode="own"
      overrideName={false}
      setOverrideName={() => {}}
      poc="company"
      setPoc={() => {}}
      emailForm={form}
      emailFields={fields}
      secretFormError={() => null}
    />
  );
}

describe("EmailDeliveryPanel - Save", () => {
  it("reaches the action once when clicked twice in one frame", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const Stub = createRoutesStub([
      {
        path: "/settings",
        Component: Harness,
        action: async () => {
          calls += 1;
          await new Promise<void>((resolve) => { release = resolve; });
          return null;
        },
      },
    ]);
    render(<Stub initialEntries={["/settings"]} />);
    const save = await screen.findByRole("button", { name: "Save" });
    act(() => { save.click(); save.click(); });
    await waitFor(() => expect(calls).toBe(1));
    expect(calls).toBe(1);
    await waitFor(() => expect(save.getAttribute("aria-disabled")).toBe("true"));
    await act(async () => { release(); });
  });
});
