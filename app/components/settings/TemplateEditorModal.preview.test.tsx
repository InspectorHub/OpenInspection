// @vitest-environment happy-dom
/**
 * The email preview shows author-controlled HTML (with sample values filled in), so it renders in an
 * iframe whose sandbox grants nothing, never inside the host document.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { TemplateEditorModal, type EditorTarget } from "./TemplateEditorModal";
import { AUTOMATION_VARIABLES } from "../../../server/services/automation/variable-catalogue";

afterEach(cleanup);

const HOSTILE = '<p>Hello</p><img src="x" alt="probe"><script>window.__probe = 1</script>';
const target: EditorTarget = { kind: "new", channel: "email", locale: "en", prefill: null };

function mount() {
    const Stub = createRoutesStub([
        {
            path: "/",
            Component: () => <TemplateEditorModal target={target} onClose={() => {}} />,
            action: async () => ({ ok: true, intent: "preview", preview: { subject: "Subject", html: HOSTILE } }),
        },
    ]);
    return render(<Stub initialEntries={["/"]} />);
}

describe("TemplateEditorModal email preview", () => {
    it("renders the body in a sandboxed iframe, not in the host document", async () => {
        mount();
        fireEvent.change(screen.getByLabelText(/body/i), { target: { value: "Hi" } });
        fireEvent.click(screen.getByRole("button", { name: /refresh preview/i }));
        const frame = await waitFor(() => {
            const f = document.querySelector("iframe");
            expect(f).not.toBeNull();
            return f!;
        });
        expect(frame.getAttribute("srcdoc")).toBe(HOSTILE);
        // An empty sandbox attribute is the most restrictive form: no scripts, no same-origin, no forms, no popups.
        expect(frame.getAttribute("sandbox")).toBe("");
        expect(document.querySelector("img[alt='probe']")).toBeNull();
        expect(document.querySelector("script")).toBeNull();
        expect((window as unknown as { __probe?: number }).__probe).toBeUndefined();
    });
});

describe("TemplateEditorModal placeholder examples", () => {
    it.each(["email", "sms"] as const)("%s example only names catalogue variables", (channel) => {
        const Stub = createRoutesStub([{
            path: "/",
            Component: () => <TemplateEditorModal target={{ ...target, channel }} onClose={() => {}} />,
        }]);
        render(<Stub initialEntries={["/"]} />);
        const placeholder = screen.getByLabelText(/body/i).getAttribute("placeholder") ?? "";
        const tokens = [...placeholder.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!);
        expect(tokens.length).toBeGreaterThan(0);
        for (const t of tokens) expect(AUTOMATION_VARIABLES as readonly string[], t).toContain(t);
    });
});
