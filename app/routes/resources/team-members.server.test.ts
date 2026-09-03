/**
 * What the invite form ACTUALLY sends, and what comes back.
 *
 * The drawer has offered a "Send email notification" checkbox since it was
 * written. It was never submitted: the form carried intent, email, role and
 * permissionOverrides, and nothing else — so unticking it emailed the invitee
 * anyway, and the one thing the control claimed to decide was the one thing it
 * could not touch.
 *
 * Nothing could see that. The server had no `notify` field to ignore, so no
 * server test could fail; the checkbox toggled its own state, so no rendering
 * test could fail either. It is a fact about the REQUEST, which is what this
 * file reads.
 *
 * The invite link is here for a related reason: the endpoint has returned it
 * since it was written, this action dropped it on the floor (`url: null`), and
 * it is what makes a silent invite reachable at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const invitePost = vi.fn();
const requireToken = vi.fn();

vi.mock("~/lib/session.server", () => ({
    getToken: vi.fn(),
    requireToken: (...args: unknown[]) => requireToken(...args),
}));
vi.mock("~/lib/api-client.server", () => ({
    createApi: vi.fn(() => ({ team: { invite: { $post: invitePost } } })),
}));

import { action } from "./team-members";
import { routeArgs } from "../../../tests/helpers/route-args";

const CONTEXT = {} as Parameters<typeof action>[0]["context"];

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
    vi.clearAllMocks();
    requireToken.mockResolvedValue("t");
    invitePost.mockResolvedValue(json({ success: true, data: { inviteLink: "https://x/join?token=abc" } }, 201));
});

function submit(fields: Record<string, string>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return action(routeArgs(
        new Request("https://x/resources/team-members", { method: "POST", body: form }),
        { params: {}, context: CONTEXT },
    ));
}

const sent = () => (invitePost.mock.calls[0]?.[0] as { json: Record<string, unknown> }).json;

describe("inviting a member — what reaches the API", () => {
    it("CONTROL — the action really calls the invite endpoint", async () => {
        // Without this, every "was it sent" assertion below is satisfied by an
        // action that posts nothing at all.
        await submit({ intent: "invite", email: "a@b.test", role: "inspector" });
        expect(invitePost).toHaveBeenCalledTimes(1);
    });

    it("sends notify:false when the checkbox is unticked", async () => {
        await submit({ intent: "invite", email: "a@b.test", role: "inspector", notify: "false" });
        expect(sent().notify).toBe(false);
    });

    it("sends notify:true when it is ticked", async () => {
        await submit({ intent: "invite", email: "a@b.test", role: "inspector", notify: "true" });
        expect(sent().notify).toBe(true);
    });

    it("treats an ABSENT field as true, because that is what the screen showed", async () => {
        // The checkbox defaulted to on for its whole life while sending nothing.
        // A caller that omits the field must keep getting the emailed invite it
        // has always got — the fix must not quietly stop the emails.
        await submit({ intent: "invite", email: "a@b.test", role: "inspector" });
        expect(sent().notify).toBe(true);
    });

    it("returns the invite link, which is the only way a silent invite is reachable", async () => {
        const out = await submit({ intent: "invite", email: "a@b.test", role: "inspector", notify: "false" });
        expect(out).toMatchObject({ ok: true, url: "https://x/join?token=abc" });
    });

    it("NEGATIVE CONTROL — a failed invite carries no link to copy", async () => {
        invitePost.mockResolvedValue(json({ error: "seat limit" }, 402));
        const out = await submit({ intent: "invite", email: "a@b.test", role: "inspector" });
        expect(out).toMatchObject({ ok: false, url: null });
    });
});
