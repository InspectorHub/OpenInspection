/**
 * Track I-a Task 9 — SignerList presentation logic. The repo has no
 * component-render harness in happy-dom (see file-dropzone / checkout-steps);
 * the rendered rows + clipboard / remind interactions are Chrome-verified. The
 * pure state mappers below ARE unit-tested so the status chip, role label,
 * terminal detection, and rate-limit affordance can't silently regress.
 */
import { describe, it, expect } from "vitest";
import { statusChip, roleLabel, isTerminal, remindState } from "~/components/agreements/SignerList";

describe("statusChip", () => {
    it("maps each known status to a tone + label", () => {
        expect(statusChip("signed")).toEqual({ tone: "sat", label: "Signed" });
        expect(statusChip("viewed")).toEqual({ tone: "info", label: "Viewed" });
        expect(statusChip("sent")).toEqual({ tone: "monitor", label: "Sent" });
        expect(statusChip("declined")).toEqual({ tone: "defect", label: "Declined" });
        expect(statusChip("expired")).toEqual({ tone: "neutral", label: "Expired" });
        expect(statusChip("pending")).toEqual({ tone: "neutral", label: "Pending" });
    });
    it("title-cases an unknown status with a neutral tone", () => {
        expect(statusChip("weird")).toEqual({ tone: "neutral", label: "Weird" });
    });
});

describe("roleLabel", () => {
    it("humanizes known roles and passes through unknown ones", () => {
        expect(roleLabel("client")).toBe("Client");
        expect(roleLabel("co_client")).toBe("Co-client");
        expect(roleLabel("agent")).toBe("Agent");
        expect(roleLabel("other")).toBe("Other");
        expect(roleLabel("custom")).toBe("custom");
    });
});

describe("isTerminal", () => {
    it("treats signed/declined/expired as terminal", () => {
        expect(isTerminal("signed")).toBe(true);
        expect(isTerminal("declined")).toBe(true);
        expect(isTerminal("expired")).toBe(true);
    });
    it("treats in-flight statuses as non-terminal", () => {
        expect(isTerminal("pending")).toBe(false);
        expect(isTerminal("sent")).toBe(false);
        expect(isTerminal("viewed")).toBe(false);
    });
});

describe("remindState", () => {
    const NOW = 1_000_000_000_000;
    it("allows a reminder for a never-reminded non-terminal signer", () => {
        expect(remindState({ status: "sent", lastRemindedAt: null }, NOW)).toEqual({ canRemind: true, reason: null });
    });
    it("blocks a terminal signer with a friendly reason (no alert)", () => {
        const r = remindState({ status: "signed", lastRemindedAt: null }, NOW);
        expect(r.canRemind).toBe(false);
        expect(r.reason).toMatch(/no longer awaiting/i);
    });
    it("blocks when reminded within the last hour", () => {
        const r = remindState({ status: "sent", lastRemindedAt: NOW - 60_000 }, NOW);
        expect(r.canRemind).toBe(false);
        expect(r.reason).toMatch(/within the last hour/i);
    });
    it("re-allows once the hour has elapsed", () => {
        const r = remindState({ status: "sent", lastRemindedAt: NOW - 3_600_001 }, NOW);
        expect(r).toEqual({ canRemind: true, reason: null });
    });
});
