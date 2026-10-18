// @vitest-environment happy-dom
/**
 * The Schedule card's inspector picker is fed by a list that loads when the
 * editor is first opened. Until that list is in, saving would send "no
 * inspector" for an inspection that has one (the select would have nothing to
 * show and its value would read empty). So while the list is loading, or failed,
 * the picker is disabled, Save is disabled, and a submit that gets through some
 * other way (Enter in the date field) sends nothing at all.
 */
import { useState } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { ScheduleCard, type TeamMember } from "~/components/inspector-portal/ScheduleCard";
import { asSelect } from "../../../tests/helpers/dom";

const posted: Array<Record<string, FormDataEntryValue>> = [];
const MEMBERS: TeamMember[] = [
  { id: "u-ann", name: "Ann Inspector", email: "ann@example.com" },
  { id: "u-bob", name: "Bob Inspector", email: "bob@example.com" },
];

type Status = "idle" | "loading" | "ready" | "error";
interface Props { status?: Status; members?: TeamMember[]; onRequest?: () => void; onRetry?: () => void }

let setExternal: (p: Props) => void = () => {};

function Card(initial: Props) {
  const [props, setProps] = useState<Props>(initial);
  setExternal = setProps;
  return (
    <ScheduleCard
      inspectionId="insp-1"
      date="2026-10-20T14:00:00.000Z"
      inspectorId="u-bob"
      inspectorName="Bob Inspector"
      members={props.members ?? []}
      displayTz="UTC"
      canEdit
      {...(props.status ? { membersStatus: props.status } : {})}
      {...(props.onRequest ? { onRequestMembers: props.onRequest } : {})}
      {...(props.onRetry ? { onRetryMembers: props.onRetry } : {})}
    />
  );
}

function mount(props: Props) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => <Card {...props} />,
      action: async ({ request }) => {
        posted.push(Object.fromEntries(await request.formData()));
        return { intent: "save-order", ok: true };
      },
    },
  ]);
  const utils = render(<Stub initialEntries={["/"]} />);
  return { ...utils, rerenderWith: (p: Props) => act(async () => { setExternal(p); }) };
}

const openEditor = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Edit schedule" }));
  return asSelect(await screen.findByTestId("hub-schedule-inspector"), "the inspector picker");
};
const saveButton = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

beforeEach(() => { posted.length = 0; });

describe("ScheduleCard inspector picker while its list is not loaded", () => {
  it.each(["idle", "loading", "error"] as const)("(%s) disables the picker and Save, and asks for the list when opened", async (status) => {
    const onRequest = vi.fn();
    mount({ status, onRequest });
    const select = await openEditor();
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(select.disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
    // It shows the inspector the inspection already has, and nothing else to choose from.
    expect([...select.options].map((o) => o.value)).toEqual(["", "u-bob"]);
    expect(select.value).toBe("u-bob");
  });

  it.each(["idle", "loading", "error"] as const)("(%s) a submit that gets through (Enter in a field) sends nothing", async (status) => {
    mount({ status });
    await openEditor();
    const form = document.getElementById("schedule-form-insp-1") as HTMLFormElement;
    fireEvent.submit(form);
    form.requestSubmit();
    await settle();
    expect(posted).toEqual([]);
  });

  it("says it is loading while loading, and gives a way to retry when it failed", async () => {
    const onRetry = vi.fn();
    const first = mount({ status: "loading" });
    await openEditor();
    expect(screen.getByTestId("hub-schedule-members-status").textContent).toMatch(/loading/i);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await first.rerenderWith({ status: "error", onRetry });
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("hub-schedule-members-status").textContent).not.toMatch(/loading/i);
  });

  it("when the list arrives late, the picker enables and still holds the current inspector (not Unassigned)", async () => {
    const h = mount({ status: "loading" });
    await openEditor();
    await h.rerenderWith({ status: "ready", members: MEMBERS });
    await waitFor(() => expect(asSelect(screen.getByTestId("hub-schedule-inspector"), "the inspector picker").disabled).toBe(false));
    const select = asSelect(screen.getByTestId("hub-schedule-inspector"), "the inspector picker");
    expect(select.value).toBe("u-bob");
    expect(saveButton().disabled).toBe(false);
    fireEvent.submit(document.getElementById("schedule-form-insp-1") as HTMLFormElement);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(JSON.parse(String(posted[0]!.payload)).inspectorId).toBe("u-bob");
  });

  it("POSITIVE CONTROL: with the list ready from the start, saving sends the chosen inspector", async () => {
    mount({ status: "ready", members: MEMBERS });
    const select = await openEditor();
    expect(select.disabled).toBe(false);
    fireEvent.change(select, { target: { value: "u-ann" } });
    fireEvent.submit(document.getElementById("schedule-form-insp-1") as HTMLFormElement);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(JSON.parse(String(posted[0]!.payload)).inspectorId).toBe("u-ann");
  });

  it("POSITIVE CONTROL: unassigning stays possible once the list is ready", async () => {
    mount({ status: "ready", members: MEMBERS });
    const select = await openEditor();
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.submit(document.getElementById("schedule-form-insp-1") as HTMLFormElement);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(JSON.parse(String(posted[0]!.payload)).inspectorId).toBeNull();
  });

  it("without a status prop it behaves as before (list treated as ready)", async () => {
    mount({ members: MEMBERS });
    const select = await openEditor();
    expect(select.disabled).toBe(false);
    expect(saveButton().disabled).toBe(false);
  });
});
