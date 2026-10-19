// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ActionFailureAlert } from "~/components/ActionFailureAlert";

const show = (result: { ok?: boolean; intent?: string } | undefined) =>
    render(<ActionFailureAlert result={result} intents={["delete"]}>It failed</ActionFailureAlert>);

describe("ActionFailureAlert", () => {
    it("speaks (as an alert) for a refused write of a named intent", () => {
        const v = show({ ok: false, intent: "delete" });
        expect(v.getByRole("alert").textContent).toBe("It failed");
    });
    it("is hidden while the next attempt is under way, and returns if that fails too", () => {
        const v = render(<ActionFailureAlert result={{ ok: false, intent: "delete" }} intents={["delete"]} busy>It failed</ActionFailureAlert>);
        expect(v.queryByRole("alert")).toBeNull();
        v.rerender(<ActionFailureAlert result={{ ok: false, intent: "delete" }} intents={["delete"]}>It failed</ActionFailureAlert>);
        expect(v.getByRole("alert")).toBeTruthy();
    });
    it.each([
        ["before any answer", undefined],
        ["a success", { ok: true, intent: "delete" }],
        ["another intent failing", { ok: false, intent: "rename" }],
        ["an answer with no intent", { ok: false }],
    ])("is silent for %s", (_n, result) => {
        expect(show(result as never).queryByRole("alert")).toBeNull();
    });
});
