import { describe, it, expect, vi } from "vitest";
import { handleDepositIntent } from "./booking-policy-actions";

function api(ok = true, errorMessage?: string) {
    const post = vi.fn().mockResolvedValue({
        ok,
        json: async () => (errorMessage ? { error: { message: errorMessage } } : {}),
    });
    return { post, client: { adminBranding: { branding: { $post: post } } } };
}

function form(fields: Record<string, string>) {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
}

describe("handleDepositIntent", () => {
    it("ignores every other intent", async () => {
        const { client, post } = api();
        expect(await handleDepositIntent(client, form({ depositPolicy: "null" }), "policies-save")).toBeNull();
        expect(post).not.toHaveBeenCalled();
    });

    it("sends only the deposit, as a whole percent", async () => {
        const { client, post } = api();
        const r = await handleDepositIntent(
            client, form({ depositPolicy: JSON.stringify({ type: "percent", percent: 100 }) }), "deposit-save",
        );
        expect(r).toEqual({ ok: true, intent: "deposit-save", message: undefined });
        expect(post).toHaveBeenCalledWith({ json: { depositPolicy: { type: "percent", percent: 100 } } });
    });

    it("sends null to clear the deposit when the owner turns it off", async () => {
        const { client, post } = api();
        await handleDepositIntent(client, form({ depositPolicy: "null" }), "deposit-save");
        expect(post).toHaveBeenCalledWith({ json: { depositPolicy: null } });
    });

    it("never turns a missing field into a clear", async () => {
        const { client, post } = api();
        const r = await handleDepositIntent(client, form({}), "deposit-save");
        expect(r?.ok).toBe(false);
        expect(post).not.toHaveBeenCalled();
    });

    it.each(["{}", '"x"', "[]", "7", JSON.stringify({ type: "percent" })])(
        "rejects %s as invalid instead of clearing the deposit",
        async (raw) => {
            const { client, post } = api();
            const r = await handleDepositIntent(client, form({ depositPolicy: raw }), "deposit-save");
            expect(r?.ok).toBe(false);
            expect(post).not.toHaveBeenCalled();
        },
    );

    it("surfaces the server's refusal", async () => {
        const { client } = api(false, "Nope");
        const r = await handleDepositIntent(client, form({ depositPolicy: "null" }), "deposit-save");
        expect(r).toEqual({ ok: false, intent: "deposit-save", message: "Nope" });
    });
});
