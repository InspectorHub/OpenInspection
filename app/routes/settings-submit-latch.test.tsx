// @vitest-environment happy-dom
/**
 * Two clicks dispatched in one frame must reach the route action once.
 *
 * `navigation.state` is still "idle" when the second click lands, so the guard
 * is the shared submit latch, and the submit shows `aria-disabled` while busy.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ComponentType } from "react";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { m } from "~/paraglide/messages";
import SettingsAutomations from "./settings-automations";
import TemplateEditorRoute from "./settings-communication-template";
import SettingsCommunicationTemplates from "./settings-communication-templates";
import SettingsSecurityPage from "./settings-security";
import SettingsServices from "./settings-services";

afterEach(cleanup);

let intents: string[] = [];
let release: () => void = () => {};
beforeEach(() => {
    intents = [];
    release = () => {};
});

function mount(Component: ComponentType, loaderData: unknown, path = "/") {
    const Stub = createRoutesStub([
        {
            path,
            Component,
            loader: () => loaderData,
            action: async ({ request }) => {
                intents.push(String((await request.formData()).get("intent")));
                await new Promise<void>((resolve) => { release = resolve; });
                return null;
            },
        },
    ]);
    render(<Stub initialEntries={[path]} />);
}

async function doubleClick(button: HTMLElement) {
    act(() => { button.click(); button.click(); });
    await waitFor(() => expect(intents.length).toBe(1));
    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
    expect(intents).toHaveLength(1);
    await act(async () => { release(); });
}

describe("settings-automations", () => {
    it("posts the active toggle once for a double click", async () => {
        mount(SettingsAutomations, {
            rules: [{ id: "r1", name: "Rule one", trigger: "inspection_scheduled", active: true, isDefault: false, channels: ["email"], recipientKind: "client" }],
            services: [], recentLogs: [], reviewUrl: "", emailTemplates: [], smsTemplates: [], roleProfiles: [],
        });
        await doubleClick(await screen.findByLabelText(m.settings_automations_disable_aria()));
        expect(intents).toEqual(["toggle"]);
    });
});

describe("settings-communication-template", () => {
    const detail = {
        trigger: "inspection_scheduled", name: "Scheduled", subject: "Hi", blocks: [], enabled: true,
        required: true, variables: [],
    };

    it("posts the save once for a double click", async () => {
        mount(TemplateEditorRoute, { detail });
        await doubleClick(await screen.findByRole("button", { name: m.settings_comms_template_save_changes() }));
        expect(intents).toEqual(["save"]);
    });

    it("posts the reset once for a double click", async () => {
        mount(TemplateEditorRoute, { detail });
        (await screen.findByRole("button", { name: m.settings_comms_template_reset_default() })).click();
        await doubleClick(await screen.findByRole("button", { name: m.settings_comms_template_reset_button() }));
        expect(intents).toEqual(["reset"]);
    });
});

describe("settings-communication-templates", () => {
    it("posts the duplicate once for a double click", async () => {
        const row = {
            id: "t1", tenantId: "x", name: "Reminder", channel: "email", subject: "s", body: "b", variables: [],
            locale: "en", isSeeded: false, createdAt: 1, updatedAt: 1,
        };
        mount(SettingsCommunicationTemplates, { emailTemplates: [row], smsTemplates: [], loadFailed: false });
        await doubleClick(await screen.findByRole("button", { name: m.settings_msgtpl_duplicate() }));
        expect(intents).toEqual(["duplicate"]);
    });
});

describe("settings-security", () => {
    it("posts the account deletion once for a double click", async () => {
        mount(SettingsSecurityPage, { user: { email: "a@b.co", name: "A", totpEnabled: false }, secrets: { TURNSTILE_SECRET_KEY: "" } });
        (await screen.findByRole("button", { name: m.settings_security_delete_button() })).click();
        const input = await screen.findByLabelText(m.settings_security_delete_confirm_label());
        fireEvent.change(input, { target: { value: "a@b.co" } });
        await doubleClick(await screen.findByRole("button", { name: m.settings_security_delete_confirm_button() }));
        expect(intents).toEqual(["delete-account"]);
    });
});

describe("settings-services", () => {
    it("posts the new service once for a double click", async () => {
        mount(SettingsServices, {
            services: [], discounts: [], restrictionMap: {}, payRuleMap: {}, members: [], templates: [],
            companyDepositPolicy: null,
        });
        (await screen.findByRole("button", { name: m.settings_services_add_button() })).click();
        const name = await screen.findByRole("textbox", { name: /name/i });
        fireEvent.change(name, { target: { value: "Radon" } });
        const form = name.closest("form") as HTMLFormElement;
        const save = Array.from(form.querySelectorAll("button[type=submit]")).at(-1) as HTMLElement;
        await doubleClick(save);
        expect(intents).toEqual(["create-service"]);
    });
});
