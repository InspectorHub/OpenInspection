// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { NativeConsent } from "./NativeConsent";
import { ConsentForm } from "./ConsentForm";

afterEach(cleanup);

function countPosts() {
  const state = { posted: 0, submitters: [] as (string | null)[] };
  const onSubmit = (e: Event) => {
    if (!e.defaultPrevented) {
      state.posted += 1;
      const s = (e as SubmitEvent).submitter as HTMLButtonElement | null;
      state.submitters.push(s?.getAttribute("name") ?? null);
    }
    e.preventDefault();
  };
  document.addEventListener("submit", onSubmit);
  return { state, stop: () => document.removeEventListener("submit", onSubmit) };
}

describe("NativeConsent", () => {
  it("shows the app heading and description, the oauthReq field, and no module grid", () => {
    render(<NativeConsent appName="Acme Field" redirectScheme="io.acme.field" redirectLoopback={false} oauthReqJson='{"a":1}' />);
    expect(screen.getByRole("heading", { name: "Sign in to the Acme Field app" })).toBeTruthy();
    expect(screen.getByText(/same access you have in the browser/)).toBeTruthy();
    expect((document.querySelector('input[name="oauthReq"]') as HTMLInputElement).value).toBe('{"a":1}');
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
    expect(document.querySelectorAll('input[type="checkbox"]').length).toBe(0);
  });

  it("marks the app unverified and states how it will be opened: the scheme, or this computer for a loopback", () => {
    render(<NativeConsent appName="Acme Field" redirectScheme="io.acme.field" redirectLoopback={false} oauthReqJson="{}" />);
    expect(screen.getByText("Unverified app")).toBeTruthy();
    expect(screen.getByText("This app will be opened through: io.acme.field")).toBeTruthy();
    expect(screen.queryByText(/this computer/)).toBeNull();
    cleanup();
    render(<NativeConsent appName="Acme Field" redirectScheme="" redirectLoopback oauthReqJson="{}" />);
    expect(screen.getByText("This app will be opened through: this computer")).toBeTruthy();
    expect(screen.queryByText(/io\.acme/)).toBeNull();
  });

  it("Cancel posts the cancel field; Allow does not", () => {
    const { state, stop } = countPosts();
    try {
      render(<NativeConsent appName="Acme" redirectScheme="io.acme" redirectLoopback={false} oauthReqJson="{}" />);
      act(() => { screen.getByRole("button", { name: "Cancel" }).click(); });
      expect(state.submitters).toEqual(["cancel"]);
    } finally {
      stop();
    }
    const again = countPosts();
    try {
      cleanup();
      render(<NativeConsent appName="Acme" redirectScheme="io.acme" redirectLoopback={false} oauthReqJson="{}" />);
      act(() => { screen.getByTestId("oauth-native-allow").click(); });
      expect(again.state.submitters).toEqual([null]);
    } finally {
      again.stop();
    }
  });

  it("posts once when Allow is clicked twice in one frame", () => {
    const { state, stop } = countPosts();
    try {
      render(<NativeConsent appName="Acme" redirectScheme="io.acme" redirectLoopback={false} oauthReqJson="{}" />);
      const allow = screen.getByTestId("oauth-native-allow");
      act(() => { allow.click(); allow.click(); });
      expect(state.posted).toBe(1);
    } finally {
      stop();
    }
  });

  it("control: the MCP consent form still renders its module grid", () => {
    render(
      <ConsentForm
        clientName="Acme"
        role="admin"
        modules={[{ key: "inspections", label: "Inspections" } as never]}
        canWrite
        oauthReqJson="{}"
      />,
    );
    expect(screen.getByTestId("module-inspections")).toBeTruthy();
    expect(screen.queryByText(/Sign in to the/)).toBeNull();
    expect(screen.queryByText("Unverified app")).toBeNull();
  });
});
