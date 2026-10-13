// @vitest-environment happy-dom
/**
 * MessagesSection same-frame guards: the composer's busy flags only land after a render, so two sends or two
 * attaches handed to this section in ONE frame must each reach the API once (a repeat posts a duplicate message
 * to the inspector, or a second stored upload plus message).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";

const thread = vi.hoisted(() => ({
    props: null as null | { onSend: (b: string) => Promise<void>; onAttach: (f: File) => Promise<void> },
}));
vi.mock("~/components/messaging/MessageThread", () => ({
    MessageThread: (p: { onSend: (b: string) => Promise<void>; onAttach: (f: File) => Promise<void> }) => {
        thread.props = p;
        return null;
    },
}));

import { MessagesSection } from "./MessagesSection";

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
    fetchMock = vi.fn(async (url: string) =>
        String(url).includes("/upload")
            ? ok({ id: "a1", key: "k", name: "photo.jpg", size: 1, type: "image/jpeg", uploadedAt: 1 })
            : ok([]));
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

async function mount() {
    const Stub = createRoutesStub([{ path: "/", Component: () => <MessagesSection inspectionId="insp-1" token="tok" /> }]);
    render(<Stub initialEntries={["/"]} />);
    await settle();
    fetchMock.mockClear();
}
const posts = (suffix = "") =>
    fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST" && String(c[0]).includes(`/messages${suffix}`));

describe("MessagesSection latch", () => {
    it("posts ONE message for two same-frame sends", async () => {
        await mount();
        act(() => { void thread.props!.onSend("hello"); void thread.props!.onSend("hello"); });
        await settle();
        expect(posts()).toHaveLength(1);
    });

    it("CONTROL - a later send goes through", async () => {
        await mount();
        act(() => { void thread.props!.onSend("one"); });
        await settle();
        act(() => { void thread.props!.onSend("two"); });
        await settle();
        expect(posts()).toHaveLength(2);
    });

    it("uploads ONE file for two same-frame attaches", async () => {
        await mount();
        const f = new File(["x"], "photo.jpg", { type: "image/jpeg" });
        act(() => { void thread.props!.onAttach(f); void thread.props!.onAttach(f); });
        await settle();
        expect(posts("/upload")).toHaveLength(1);
        // the one attach also sent exactly one bodied message
        expect(posts().filter((c) => !String(c[0]).includes("/upload"))).toHaveLength(1);
    });

    it("CONTROL - a later attach goes through", async () => {
        await mount();
        const f = new File(["x"], "photo.jpg", { type: "image/jpeg" });
        act(() => { void thread.props!.onAttach(f); });
        await settle();
        act(() => { void thread.props!.onAttach(f); });
        await settle();
        expect(posts("/upload")).toHaveLength(2);
    });
});
