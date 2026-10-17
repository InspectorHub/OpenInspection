// @vitest-environment happy-dom
/**
 * Permission templates on the Team page: the pure decisions (which template a
 * person matches, which one a manager may not offer), the invite and edit drawers
 * that start from one, and the repeat-click guards on the writes.
 *
 * The fixture is built from the REAL built-in templates, so a change to them is
 * seen here rather than assumed away.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, fireEvent, screen } from "@testing-library/react";
import { SYSTEM_TEMPLATES, resolveTemplate } from "../../../server/lib/auth/permission-templates";
import { getCapabilities, type CapabilitySet } from "../../../server/lib/auth/capabilities";

const fetcherMock = vi.hoisted(() => ({ state: "idle" as "idle" | "submitting", submit: vi.fn(), data: undefined as unknown }));

vi.mock("react-router", async () => {
    const actual = await vi.importActual<typeof import("react-router")>("react-router");
    return {
        ...actual,
        useFetcher: () => ({ state: fetcherMock.state, data: fetcherMock.data, submit: fetcherMock.submit, load: vi.fn() }),
    };
});

import { InviteSeatDrawer } from "../modals/InviteSeatDrawer";
import { EditMemberDrawer } from "../modals/EditMemberDrawer";
import { PermissionTemplatesPanel, TemplateBadge } from "./PermissionTemplatesPanel";
import { matchedTemplate, templateBadge, templateBeyondActor, templateMatchesForm, type TemplateOption } from "./permission-template-ui";

const BUILT_IN: TemplateOption[] = SYSTEM_TEMPLATES.map((t) => ({
    id: t.key, system: true, name: t.name, description: t.description, baseRole: t.baseRole,
    overrides: resolveTemplate(t.key).permissionOverrides ?? {},
}));
const COMPANY: TemplateOption = {
    id: "co-1", system: false, name: "Weekend helper", description: null, baseRole: "inspector", overrides: { publish: false },
};
const TEMPLATES = [...BUILT_IN, COMPANY];
const OWNER: { role: string; capabilities: Partial<CapabilitySet> | null } = { role: "owner", capabilities: null };
const byId = (id: string) => TEMPLATES.find((t) => t.id === id) as TemplateOption;

beforeEach(() => {
    fetcherMock.state = "idle";
    fetcherMock.data = undefined;
    fetcherMock.submit.mockReset();
});
afterEach(cleanup);

/** The FormData the last submit carried, as a plain object. */
function lastSubmitted(): Record<string, string> {
    const call = fetcherMock.submit.mock.calls.at(-1);
    if (!call) throw new Error("nothing was submitted");
    // The guarded submit sends a plain object with its idempotency key; the drawers' own submit sends FormData.
    const sent = call[0] instanceof FormData ? Object.fromEntries(call[0].entries()) : { ...(call[0] as Record<string, string>) };
    delete sent.idempotencyKey;
    return sent as Record<string, string>;
}

function choose(label: string | RegExp, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("template decisions", () => {
    it("a form that still shows the template is not customized; one extra switch is", () => {
        const trainee = byId("inspector_trainee");
        const caps = getCapabilities("inspector", trainee.overrides);
        expect(templateMatchesForm(trainee, "inspector", caps)).toBe(true);
        expect(templateMatchesForm(trainee, "inspector", { ...caps, scheduleOthers: true })).toBe(false);
        expect(templateMatchesForm(trainee, "manager", caps)).toBe(false);
    });

    it("a member is matched on resolved switches, a company template wins over an identical built-in, and no match is null", () => {
        expect(matchedTemplate("inspector", null, TEMPLATES)?.id).toBe("inspector_standard");
        expect(matchedTemplate("inspector", { publish: false }, TEMPLATES)?.id).toBe("co-1");
        expect(matchedTemplate("inspector", { publish: false, scheduleOthers: true }, TEMPLATES)).toBeNull();
    });

    it("the badge names the match, says Custom otherwise, and says nothing for owners, pending invites or no templates", () => {
        const active = (role: string, permissionOverrides: Record<string, boolean> | null) => ({ role, status: "active", permissionOverrides });
        expect(templateBadge(active("inspector", null), TEMPLATES)).toBe("Inspector");
        expect(templateBadge(active("inspector", { scheduleOthers: true, publish: false }), TEMPLATES)).toBe("Custom");
        expect(templateBadge(active("owner", null), TEMPLATES)).toBeNull();
        expect(templateBadge({ role: "inspector", status: "pending", permissionOverrides: null }, TEMPLATES)).toBeNull();
        expect(templateBadge(active("inspector", null), [])).toBeNull();
    });

    it("a manager may not offer a template that turns on what they lack, but may keep what the person already holds", () => {
        const managerNoFinance = { role: "manager", capabilities: { ...getCapabilities("manager", null), companyFinance: false } };
        const mgr = byId("manager_standard");
        expect(templateBeyondActor(managerNoFinance, mgr, null)).toBe(true);
        expect(templateBeyondActor(OWNER, mgr, null)).toBe(false);
        expect(templateBeyondActor(managerNoFinance, byId("inspector_trainee"), null)).toBe(false);
        // The person already holds company finance, so keeping it is not a grant.
        expect(templateBeyondActor(managerNoFinance, mgr, { role: "manager", overrides: null })).toBe(false);
        // An unknown viewer is offered nothing.
        expect(templateBeyondActor(null, byId("inspector_standard"), null)).toBe(true);
    });

    it("renders the badge only when there is a label", () => {
        const { container } = render(<TemplateBadge member={{ role: "owner", status: "active", permissionOverrides: null }} templates={TEMPLATES} />);
        expect(container.textContent).toBe("");
        cleanup();
        const shown = render(<TemplateBadge member={{ role: "staff", status: "active", permissionOverrides: null }} templates={TEMPLATES} />);
        expect(shown.container.textContent).toBe("Office scheduler");
    });
});

describe("InviteSeatDrawer with templates", () => {
    const drawer = (actor = OWNER) => <InviteSeatDrawer actor={actor} open onClose={() => {}} templates={TEMPLATES} />;
    const form = () => document.getElementById("invite-seat-form") as HTMLFormElement;

    it("without templates the picker is not there (the plain form)", () => {
        render(<InviteSeatDrawer actor={OWNER} open onClose={() => {}} />);
        expect(screen.queryByText("Start from a template")).toBeNull();
        expect(screen.queryByText("Save as template")).toBeNull();
    });

    it("choosing a template sets the role and the switches, and an unedited template is sent by id alone", () => {
        render(drawer());
        choose("Start from a template", "inspector_trainee");
        expect((screen.getByLabelText("Role") as unknown as HTMLSelectElement).value).toBe("inspector");
        fireEvent.click(screen.getByText("Advanced permissions"));
        expect((screen.getByLabelText("Publish reports") as HTMLInputElement).checked).toBe(false);
        expect(screen.queryByText("Customized")).toBeNull();

        act(() => { form().requestSubmit(); });
        expect(lastSubmitted()).toMatchObject({ intent: "invite", templateId: "inspector_trainee" });
        expect(lastSubmitted()).not.toHaveProperty("role");
        expect(lastSubmitted()).not.toHaveProperty("permissionOverrides");
    });

    it("editing a switch after choosing reads Customized and is sent as role plus switches, not by id", () => {
        render(drawer());
        choose("Start from a template", "inspector_trainee");
        fireEvent.click(screen.getByText("Advanced permissions"));
        fireEvent.click(screen.getByLabelText("Schedule for others"));
        expect(screen.getByText("Customized")).toBeTruthy();

        act(() => { form().requestSubmit(); });
        const sent = lastSubmitted();
        expect(sent).not.toHaveProperty("templateId");
        expect(sent.role).toBe("inspector");
        expect(JSON.parse(sent.permissionOverrides as string)).toMatchObject({ publish: false, scheduleOthers: true, deleteInspection: false });
    });

    it("a company template is offered and a template that moves the role changes the role select", () => {
        render(drawer());
        expect(screen.getByRole("option", { name: "Weekend helper" })).toBeTruthy();
        choose("Start from a template", "office_scheduler");
        expect((screen.getByLabelText("Role") as unknown as HTMLSelectElement).value).toBe("staff");
    });

    it("a manager who lacks a switch sees the template that carries it disabled, and an owner does not", () => {
        const managerNoFinance = { role: "manager", capabilities: { ...getCapabilities("manager", null), companyFinance: false } };
        const { unmount } = render(drawer(managerNoFinance));
        // By value: the role select also has an option named Manager.
        const option = (value: string) => document.querySelector(`option[value="${value}"]`) as HTMLOptionElement;
        expect(option("manager_standard").disabled).toBe(true);
        expect(option("inspector_trainee").disabled).toBe(false);
        unmount();
        render(drawer(OWNER));
        expect(option("manager_standard").disabled).toBe(false);
    });

    it("Save as template submits the role and the switches once for two triggers in one frame", () => {
        render(drawer());
        choose("Start from a template", "inspector_trainee");
        fireEvent.click(screen.getByText("Save as template"));
        fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Field trainee" } });
        const save = screen.getByText("Save template");
        act(() => { (save as HTMLButtonElement).click(); (save as HTMLButtonElement).click(); });
        expect(fetcherMock.submit).toHaveBeenCalledTimes(1);
        expect(lastSubmitted()).toMatchObject({ intent: "create-template", name: "Field trainee", baseRole: "inspector" });
        expect(JSON.parse(lastSubmitted().overrides as string)).toMatchObject({ publish: false, deleteInspection: false });
    });

    it("CONTROL - Save as template goes through again once the first has settled", () => {
        const { rerender } = render(drawer());
        fireEvent.click(screen.getByText("Save as template"));
        fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "One" } });
        act(() => { (screen.getByText("Save template") as HTMLButtonElement).click(); });
        fetcherMock.state = "submitting";
        rerender(drawer());
        fetcherMock.state = "idle";
        rerender(drawer());
        act(() => { (screen.getByText("Save template") as HTMLButtonElement).click(); });
        expect(fetcherMock.submit).toHaveBeenCalledTimes(2);
    });

    it("Save as template says the limit instead of failing, when the company is at it", () => {
        const full = [...BUILT_IN, ...Array.from({ length: 25 }, (_, i): TemplateOption => ({ ...COMPANY, id: `c${i}`, name: `T${i}` }))];
        render(<InviteSeatDrawer actor={OWNER} open onClose={() => {}} templates={full} />);
        expect((screen.getByText("Save as template") as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText(/can keep 25 templates/)).toBeTruthy();
    });
});

describe("EditMemberDrawer with templates", () => {
    const member = (permissionOverrides: Record<string, boolean> | null) => ({ id: "m-1", name: "Dana", email: "dana@example.com", role: "inspector", permissionOverrides });
    const drawer = (m: ReturnType<typeof member>) => <EditMemberDrawer actor={OWNER} open onClose={() => {}} member={m} templates={TEMPLATES} />;
    const form = () => document.getElementById("edit-member-form") as HTMLFormElement;

    it("starts on the template the member already matches, and applying it unchanged is sent by id", () => {
        render(drawer(member({ publish: false })));
        expect((screen.getByLabelText("Start from a template") as unknown as HTMLSelectElement).value).toBe("co-1");
        expect(screen.queryByText("Customized")).toBeNull();
        act(() => { form().requestSubmit(); });
        expect(lastSubmitted()).toMatchObject({ intent: "update", id: "m-1", templateId: "co-1" });
        expect(lastSubmitted()).not.toHaveProperty("role");
    });

    it("a member who matches no template starts on none and saves role plus switches as before", () => {
        render(drawer(member({ scheduleOthers: true, publish: false })));
        expect((screen.getByLabelText("Start from a template") as unknown as HTMLSelectElement).value).toBe("");
        act(() => { form().requestSubmit(); });
        expect(lastSubmitted()).not.toHaveProperty("templateId");
        expect(lastSubmitted().role).toBe("inspector");
        expect(JSON.parse(lastSubmitted().permissionOverrides as string)).toEqual({ scheduleOthers: true, publish: false });
    });

    it("choosing another template applies it, and tweaking afterwards reads Customized", () => {
        render(drawer(member(null)));
        choose("Start from a template", "inspector_trainee");
        act(() => { form().requestSubmit(); });
        expect(lastSubmitted().templateId).toBe("inspector_trainee");
        cleanup();
        fetcherMock.submit.mockReset();
        render(drawer(member(null)));
        choose("Start from a template", "inspector_trainee");
        fireEvent.click(screen.getByLabelText("Schedule for others"));
        expect(screen.getByText("Customized")).toBeTruthy();
    });
});

describe("PermissionTemplatesPanel", () => {
    it("says nothing when the template list did not load, and offers a hint when the company has none", () => {
        const { container } = render(<PermissionTemplatesPanel templates={[]} />);
        expect(container.textContent).toBe("");
        cleanup();
        render(<PermissionTemplatesPanel templates={BUILT_IN} />);
        expect(screen.getByText(/No templates yet/)).toBeTruthy();
    });

    it("renaming sends the role and the switches along, and only the company's templates are listed", () => {
        render(<PermissionTemplatesPanel templates={TEMPLATES} />);
        expect(screen.queryByText("Trainee inspector")).toBeNull();
        fireEvent.click(screen.getByText("Rename"));
        fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Weekend crew" } });
        act(() => { (screen.getByText("Save") as HTMLButtonElement).click(); });
        expect(lastSubmitted()).toMatchObject({ intent: "rename-template", id: "co-1", name: "Weekend crew", baseRole: "inspector" });
        expect(JSON.parse(lastSubmitted().overrides as string)).toEqual({ publish: false });
    });

    it("archiving asks first and submits once for two clicks in one frame", () => {
        render(<PermissionTemplatesPanel templates={TEMPLATES} />);
        fireEvent.click(screen.getAllByText("Archive")[0] as HTMLElement);
        expect(fetcherMock.submit).not.toHaveBeenCalled();
        const confirm = screen.getAllByRole("button", { name: "Archive" }).at(-1) as HTMLButtonElement;
        act(() => { confirm.click(); confirm.click(); });
        expect(fetcherMock.submit).toHaveBeenCalledTimes(1);
        expect(lastSubmitted()).toEqual({ intent: "archive-template", id: "co-1" });
    });
});
