// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { VerifyExportForm } from "./VerifyExportForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ENVELOPE = "aaaaaaaa-0000-4000-8000-000000000001";

let fetchMock: ReturnType<typeof vi.fn>;
let release: () => void;
let saved: Array<{ name: string }>;

function answer(status: number): Response {
  return status === 200
    ? new Response("{}", { status, headers: { "content-disposition": 'attachment; filename="audit-aaaaaaaa.json"' } })
    : new Response(JSON.stringify({ error: "x" }), { status });
}

beforeEach(() => {
  saved = [];
  release = () => {};
  fetchMock = vi.fn(async () => answer(200));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => {} }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download });
  });
});

function mount() {
  const view = render(<VerifyExportForm envelopeId={ENVELOPE} siteKey={null} />);
  const email = view.container.querySelector<HTMLInputElement>("#verify-export-email")!;
  const postal = view.container.querySelector<HTMLInputElement>("#verify-export-postal")!;
  const form = view.container.querySelector("form")!;
  return { ...view, email, postal, form };
}

const submit = (form: HTMLFormElement) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const sentBody = () => JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;

describe("VerifyExportForm", () => {
  it("shows both fields, sends the email alone, and sends a postal code only beside the email", async () => {
    const a = mount();
    expect(a.email).not.toBeNull();
    expect(a.postal).not.toBeNull();
    fireEvent.change(a.email, { target: { value: "  jane@example.test " } });
    await act(async () => { submit(a.form); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/public/verify/${ENVELOPE}/export`);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("POST");
    expect(sentBody()).toEqual({ email: "jane@example.test" });
    cleanup();
    fetchMock.mockClear();

    const b = mount();
    fireEvent.change(b.email, { target: { value: "jane@example.test" } });
    fireEvent.change(b.postal, { target: { value: "78701" } });
    await act(async () => { submit(b.form); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ email: "jane@example.test", postalCode: "78701" });
  });

  it("does not send a postal code on its own: it asks for the email first", async () => {
    const view = mount();
    fireEvent.change(view.postal, { target: { value: "78701" } });
    await act(async () => { submit(view.form); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("Enter an email address recorded on this agreement.");
  });

  it("states what the file holds and that a postal code needs an email", () => {
    const view = mount();
    const text = view.container.textContent ?? "";
    for (const part of ["signer ids", "emails given at signing", "previous hash", "signature", "key fingerprint", "public keys", "time of the export"]) {
      expect(text, part).toContain(part);
    }
    expect(text).toContain("A postal code is never enough on its own");
  });

  it("downloads the file under the name the server gave it, and shows no error", async () => {
    const view = mount();
    fireEvent.change(view.email, { target: { value: "jane@example.test" } });
    await act(async () => { submit(view.form); });
    await waitFor(() => expect(saved).toEqual([{ name: "audit-aaaaaaaa.json" }]));
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    const status = view.container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("The signed record was downloaded.");
  });

  it("asks for a value before sending anything", async () => {
    const view = mount();
    await act(async () => { submit(view.form); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("Enter an email address recorded on this agreement.");
  });

  it.each([
    [403, "That did not match this agreement."],
    [429, "Too many attempts."],
    [400, "Check the values you entered and try again."],
    [503, "The verification service could not be reached."],
  ])("shows one neutral line for a %i answer, and downloads nothing", async (status, text) => {
    fetchMock.mockImplementation(async () => answer(status));
    const view = mount();
    fireEvent.change(view.email, { target: { value: "jane@example.test" } });
    await act(async () => { submit(view.form); });
    await waitFor(() => expect(view.container.textContent).toContain(text));
    expect(saved).toEqual([]);
  });

  it("limits the length of both inputs to what the server accepts", () => {
    const view = mount();
    expect(view.email.maxLength).toBe(254);
    expect(view.postal.maxLength).toBe(20);
  });

  it("shows a network line when the request itself fails", async () => {
    fetchMock.mockImplementation(async () => { throw new Error("offline"); });
    const view = mount();
    fireEvent.change(view.email, { target: { value: "jane@example.test" } });
    await act(async () => { submit(view.form); });
    await waitFor(() => expect(view.container.textContent).toContain("The download could not be completed."));
  });

  it("sends once for two submits in one frame, and a later submit goes through", async () => {
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { release = () => resolve(answer(200)); }));
    const view = mount();
    fireEvent.change(view.email, { target: { value: "jane@example.test" } });
    await act(async () => {
      submit(view.form);
      submit(view.form);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    await waitFor(() => expect(saved).toHaveLength(1));
    // Control: after the request settles the form is usable again.
    fetchMock.mockImplementation(async () => answer(200));
    await act(async () => { submit(view.form); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  describe("with a bot challenge configured", () => {
    type Opts = { callback: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void };
    let renders: Opts[];

    beforeEach(() => {
      renders = [];
      (window as unknown as { turnstile: unknown }).turnstile = { render: (_el: HTMLElement, opts: Opts) => { renders.push(opts); } };
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      document.head.appendChild(script);
    });
    afterEach(() => {
      document.head.querySelectorAll("script").forEach((el) => el.remove());
      delete (window as unknown as { turnstile?: unknown }).turnstile;
    });

    const mountWithKey = () => {
      const view = render(<VerifyExportForm envelopeId={ENVELOPE} siteKey="1x00000000000000000000AA" />);
      const email = view.container.querySelector<HTMLInputElement>("#verify-export-email")!;
      const form = view.container.querySelector("form")!;
      const button = view.container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      return { ...view, email, form, button };
    };
    const solve = async (n: number, token: string) => { await act(async () => { renders[n]!.callback(token); }); };

    it("keeps the button off and sends nothing until a token exists, then sends that token", async () => {
      const view = mountWithKey();
      fireEvent.change(view.email, { target: { value: "jane@example.test" } });
      expect(view.button.disabled).toBe(true);
      await act(async () => { submit(view.form); });
      expect(fetchMock).not.toHaveBeenCalled();
      await solve(0, "tok1");
      expect(view.button.disabled).toBe(false);
      await act(async () => { submit(view.form); });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(sentBody()).toEqual({ email: "jane@example.test", turnstileToken: "tok1" });
    });

    it("asks for a new token after a download that went through, so a second download works", async () => {
      const view = mountWithKey();
      fireEvent.change(view.email, { target: { value: "jane@example.test" } });
      await solve(0, "tok1");
      await act(async () => { submit(view.form); });
      await waitFor(() => expect(saved).toHaveLength(1));
      // The first token was spent: the challenge is asked again and the button waits for the new token.
      await waitFor(() => expect(renders).toHaveLength(2));
      expect(view.button.disabled).toBe(true);
      // The success line stays while the challenge is asked again, and goes when the next request starts.
      expect(view.container.querySelector('[role="status"]')?.textContent).toBe("The signed record was downloaded.");
      await act(async () => { submit(view.form); });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await solve(1, "tok2");
      await act(async () => { submit(view.form); });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string)).toEqual({ email: "jane@example.test", turnstileToken: "tok2" });
      await waitFor(() => expect(saved).toHaveLength(2));
    });

    it("drops an expired token and sends nothing until the challenge is answered again", async () => {
      const view = mountWithKey();
      fireEvent.change(view.email, { target: { value: "jane@example.test" } });
      await solve(0, "tok1");
      expect(view.button.disabled).toBe(false);
      await act(async () => { renders[0]!["expired-callback"]!(); });
      expect(view.button.disabled).toBe(true);
      await act(async () => { submit(view.form); });
      expect(fetchMock).not.toHaveBeenCalled();
      await solve(0, "tok1b");
      await act(async () => { submit(view.form); });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(sentBody()).toEqual({ email: "jane@example.test", turnstileToken: "tok1b" });
    });

    it("says the check could not load, and not that the value did not match, when the widget reports an error or its script fails", async () => {
      const view = mountWithKey();
      await act(async () => { renders[0]!["error-callback"]!(); });
      expect(view.container.textContent).toContain("The verification check could not load.");
      expect(view.container.textContent).not.toContain("did not match");
      expect(view.button.disabled).toBe(true);
      cleanup();
      delete (window as unknown as { turnstile?: unknown }).turnstile;
      document.head.querySelectorAll("script").forEach((el) => el.remove());
      const second = mountWithKey();
      const script = document.head.querySelector<HTMLScriptElement>('script[src*="turnstile"]')!;
      await act(async () => { script.onerror?.(new Event("error")); });
      expect(second.container.textContent).toContain("The verification check could not load.");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("clears the could-not-load line when the widget recovers by itself and hands over a token", async () => {
      const view = mountWithKey();
      await act(async () => { renders[0]!["error-callback"]!(); });
      expect(view.container.textContent).toContain("The verification check could not load.");
      await solve(0, "tok-recovered");
      expect(view.container.textContent).not.toContain("The verification check could not load.");
      expect(view.button.disabled).toBe(false);
    });

    it("removes the widget it rendered when the form goes away", () => {
      const removed: string[] = [];
      (window as unknown as { turnstile: unknown }).turnstile = {
        render: (_el: HTMLElement, opts: Opts) => { renders.push(opts); return "widget-1"; },
        remove: (id: string) => { removed.push(id); },
      };
      const view = mountWithKey();
      expect(removed).toEqual([]);
      view.unmount();
      expect(removed).toEqual(["widget-1"]);
    });
  });
});
