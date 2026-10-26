/* eslint-disable no-restricted-syntax -- role names are the session values the panel reads; the package cannot import server/lib/auth/roles.ts */
// @vitest-environment happy-dom
/**
 * The compliance panel on the provider and a fake data source. Every write is a `compliance` (or
 * `save-pca-narrative`) command, so these tests assert on the COMMANDS it issued, on the reload it asks
 * for after the writes the screen cannot show on its own, and on the same-frame guard of each write
 * surface. The form posts those commands become are pinned by the web adapter tests.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import type { SessionInfo } from "../../data-source";
import { m } from "../../i18n";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import type { FakeDataSource } from "../../testing/fake-data-source";
import type { CompliancePanelData } from "../../data-source-types";
import { CompliancePanel } from "./CompliancePanel";

afterEach(cleanup);

const base: CompliancePanelData = {
  reportSignoffs: [],
  psq: null,
  documentReview: [],
  conformance: { standard: "E2018-24", conforms: false },
  relianceText: { userReliance: "a", pointInTime: "b", siteSpecific: "c" },
};

const priorPcrs = { documentKey: "prior_pcrs", label: "Prior PCRs", requested: false, received: false, reviewed: false, na: false, notes: null };

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

function renderPanel(data: CompliancePanelData, session: Partial<SessionInfo> = {}) {
  const fake: FakeDataSource = createFakeDataSource({ data: createEmptyEditorData(), session });
  const utils = render(
    <FieldDataSourceProvider dataSource={fake}>
      <CompliancePanel inspectionId="i1" data={data} />
    </FieldDataSourceProvider>,
  );
  return { ...utils, fake };
}

/** The commands issued, without the inspection id and key. */
const sent = (fake: FakeDataSource) => fake.commands.map((c) => c.cmd);

describe("CompliancePanel", () => {
  it("shows the conformance preview as non-conformant with no reviewer", () => {
    const { getByText } = renderPanel(base);
    expect(getByText(/not conform|non-?conformant/i)).toBeTruthy();
  });

  it("lists the document-review items", () => {
    const { getByText } = renderPanel({ ...base, documentReview: [priorPcrs] });
    expect(getByText("Prior PCRs")).toBeTruthy();
  });

  it("renders editable reliance textareas seeded from the reliance values", () => {
    const { getByTestId } = renderPanel({
      ...base,
      relianceText: { userReliance: "who may rely", pointInTime: "as of the date", siteSpecific: "site only" },
    });
    const section = getByTestId("reliance-section");
    const textareas = section.querySelectorAll("textarea");
    expect(textareas.length).toBe(3);
    const values = Array.from(textareas).map((t) => (t as HTMLTextAreaElement).value);
    expect(values).toEqual(["who may rely", "as of the date", "site only"]);
  });

  it("writes nothing and asks for no reload just by rendering", async () => {
    const { fake } = renderPanel({ ...base, documentReview: [priorPcrs] });
    await settle();
    expect(fake.commands).toEqual([]);
    expect(fake.reloadCount).toBe(0);
  });
});

// Editing a reliance field and blurring it must issue a `save-pca-narrative` command carrying the
// right key/value — the same command the narrative prose blocks use (the PATCH schema declares these
// three keys, so they persist).
describe("CompliancePanel reliance editing", () => {
  it("issues save-pca-narrative with the correct key/value on blur", async () => {
    const { getByTestId, fake } = renderPanel({
      ...base,
      relianceText: { userReliance: "orig reliance", pointInTime: "orig pit", siteSpecific: "orig site" },
    });
    const first = getByTestId("reliance-section").querySelectorAll("textarea")[0] as HTMLTextAreaElement;
    fireEvent.change(first, { target: { value: "edited reliance" } });
    fireEvent.blur(first);

    await waitFor(() => expect(fake.commands).toHaveLength(1));
    expect(fake.commands[0]).toMatchObject({
      inspectionId: "i1",
      cmd: { type: "save-pca-narrative", key: "userReliance", value: "edited reliance" },
    });
  });

  it("does not write when a reliance field is blurred without an edit", async () => {
    const { getByTestId, fake } = renderPanel(base);
    // Tab through (focus + blur) every reliance textarea without changing any
    // value — the dirty check must suppress every no-op save/audit write.
    for (const ta of Array.from(getByTestId("reliance-section").querySelectorAll("textarea"))) {
      fireEvent.focus(ta);
      fireEvent.blur(ta);
    }
    await settle();
    expect(fake.commands).toEqual([]);
  });

  it("each clause has its own guard: three clauses blurred in one frame all write", async () => {
    const { getByTestId, fake } = renderPanel(base);
    const areas = Array.from(getByTestId("reliance-section").querySelectorAll("textarea")) as HTMLTextAreaElement[];
    areas.forEach((ta, i) => fireEvent.change(ta, { target: { value: `edit ${i}` } }));
    act(() => {
      for (const ta of areas) ta.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();
    expect(sent(fake).map((c) => (c as { key: string }).key).sort()).toEqual(["pointInTime", "siteSpecific", "userReliance"]);
  });
});

// The doc-review seed button renders straight off loader props (no local optimistic copy, unlike
// PsqPanel/DocReviewRow) — a successful seed must ask the data source to reload or the checklist
// appears to do nothing.
describe("CompliancePanel doc-review seed", () => {
  it("issues the seed command and reloads once it lands", async () => {
    const { findByText, fake } = renderPanel(base);
    fireEvent.click(await findByText("Load standard checklist"));
    await waitFor(() => expect(fake.reloadCount).toBe(1));
    expect(sent(fake)).toEqual([{ type: "compliance", op: "doc-review-seed" }]);
  });

  it("does NOT reload when the seed is refused", async () => {
    const { findByText, fake } = renderPanel(base);
    fake.failExecute("compliance", "no");
    fireEvent.click(await findByText("Load standard checklist"));
    await settle();
    expect(fake.commands).toHaveLength(1);
    expect(fake.reloadCount).toBe(0);
  });

  it("seeds ONCE for two same-frame presses (twice would create the checklist twice)", async () => {
    const { findByText, fake } = renderPanel(base);
    const seed = await findByText("Load standard checklist");
    act(() => { seed.click(); seed.click(); });
    await settle();
    expect(fake.commands).toHaveLength(1);
    expect(fake.reloadCount).toBe(1);
  });
});

describe("CompliancePanel sign-off", () => {
  function fill(role: "field_observer" | "pcr_reviewer", values: { license?: string; dual?: boolean } = {}) {
    const card = screen.getByTestId(`signoff-${role}`);
    if (values.license) fireEvent.change(within(card).getByPlaceholderText(/license/i), { target: { value: values.license } });
    if (values.dual) fireEvent.click(within(card).getByRole("checkbox"));
    return card;
  }

  it("signs off with the trimmed license and the role of the card, then reloads, naming no person", async () => {
    const { fake } = renderPanel(base);
    const card = fill("pcr_reviewer", { license: " L1 ", dual: true });
    fireEvent.click(within(card).getByRole("button", { name: /sign off/i }));
    await waitFor(() => expect(fake.reloadCount).toBe(1));
    expect(sent(fake)).toEqual([
      { type: "compliance", op: "signoff", role: "pcr_reviewer", license: "L1", dualRole: true },
    ]);
  });

  // The web host's userId is a session marker (a truncated hash), the native host's is null:
  // neither is a user id, so the panel must never put it in a field or a command.
  it.each([["inspector", "k3f9a1c2b7d4e605"], ["inspector", null], ["staff", null]] as const)(
    "a %s (userId %s) sees no Person ID or Name input, can sign off with nothing typed, and sends no person",
    async (role, userId) => {
      const { fake } = renderPanel(base, { role, userId });
      const card = screen.getByTestId("signoff-field_observer");
      expect(within(card).queryByPlaceholderText("Person ID")).toBeNull();
      expect(within(card).queryByPlaceholderText("Name")).toBeNull();
      expect(within(card).getByPlaceholderText(/license/i)).toBeTruthy();
      const button = within(card).getByRole("button", { name: /sign off/i });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      await waitFor(() => expect(fake.reloadCount).toBe(1));
      const command = sent(fake)[0] as Record<string, unknown>;
      expect(command).not.toHaveProperty("personId");
      expect(command).not.toHaveProperty("name");
    },
  );

  it.each(["owner", "manager"] as const)("%s sees the optional Person ID and Name inputs, empty (no pre-fill), and can still sign as themself", async (role) => {
    const { fake } = renderPanel(base, { role, userId: "k3f9a1c2b7d4e605" });
    const card = screen.getByTestId("signoff-field_observer");
    expect(within(card).getByPlaceholderText("Person ID")).toHaveValue("");
    expect(within(card).getByPlaceholderText("Name")).toHaveValue("");
    const button = within(card).getByRole("button", { name: /sign off/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(fake.reloadCount).toBe(1));
    const command = sent(fake)[0] as Record<string, unknown>;
    expect(command).not.toHaveProperty("personId");
    expect(command).not.toHaveProperty("name");
  });

  it("an owner who types a person sends the trimmed values", async () => {
    const { fake } = renderPanel(base, { role: "owner" });
    const card = screen.getByTestId("signoff-pcr_reviewer");
    fireEvent.change(within(card).getByPlaceholderText("Person ID"), { target: { value: " P-7 " } });
    fireEvent.change(within(card).getByPlaceholderText("Name"), { target: { value: " Ada Lovelace " } });
    fireEvent.click(within(card).getByRole("button", { name: /sign off/i }));
    await waitFor(() => expect(fake.reloadCount).toBe(1));
    expect(sent(fake)).toEqual([
      { type: "compliance", op: "signoff", role: "pcr_reviewer", personId: "P-7", name: "Ada Lovelace", license: "", dualRole: false },
    ]);
  });

  describe("naming a person", () => {
    const typeInto = (card: HTMLElement, placeholder: string, value: string) =>
      fireEvent.change(within(card).getByPlaceholderText(placeholder), { target: { value } });
    const signOff = (card: HTMLElement) => fireEvent.click(within(card).getByRole("button", { name: /sign off/i }));

    it.each([["Person ID", "P-7"], ["Name", "Ada Lovelace"]])("typing only the %s sends nothing and says both are needed", async (placeholder, value) => {
      const { fake } = renderPanel(base, { role: "owner" });
      const card = screen.getByTestId("signoff-pcr_reviewer");
      typeInto(card, placeholder, value);
      signOff(card);
      await settle();
      expect(fake.commands).toEqual([]);
      expect(within(card).getByRole("alert").textContent).toBe(m.editor_compliance_signoff_pair_needed());
      expect(fake.reloadCount).toBe(0);
    });

    it("a whitespace-only input counts as empty: a name beside a blank person ID is still one-sided", async () => {
      const { fake } = renderPanel(base, { role: "owner" });
      const card = screen.getByTestId("signoff-pcr_reviewer");
      typeInto(card, "Person ID", "   ");
      typeInto(card, "Name", "Ada Lovelace");
      signOff(card);
      await settle();
      expect(fake.commands).toEqual([]);
      expect(within(card).getByRole("alert")).toBeTruthy();
    });

    it("CONTROL - the message is not shown before a sign-off is tried, and goes once the pair is complete", async () => {
      const { fake } = renderPanel(base, { role: "owner" });
      const card = screen.getByTestId("signoff-pcr_reviewer");
      typeInto(card, "Person ID", "P-7");
      expect(within(card).queryByRole("alert")).toBeNull();
      signOff(card);
      expect(within(card).getByRole("alert")).toBeTruthy();
      typeInto(card, "Name", "Ada Lovelace");
      expect(within(card).queryByRole("alert")).toBeNull();
      signOff(card);
      await waitFor(() => expect(fake.commands).toHaveLength(1));
    });

    it("CONTROL - two blank (whitespace-only) inputs sign as the signed-in user, with no pair sent", async () => {
      const { fake } = renderPanel(base, { role: "owner" });
      const card = screen.getByTestId("signoff-pcr_reviewer");
      typeInto(card, "Person ID", "  ");
      typeInto(card, "Name", " ");
      signOff(card);
      await waitFor(() => expect(fake.commands).toHaveLength(1));
      expect(sent(fake)[0]).not.toHaveProperty("personId");
      expect(within(card).queryByRole("alert")).toBeNull();
    });
  });

  describe("a refused sign-off", () => {
    it("shows the server's message as an error notice", async () => {
      const { fake } = renderPanel(base);
      fake.failExecute("compliance", "Only an owner or manager can sign for someone else.");
      const card = fill("field_observer");
      fireEvent.click(within(card).getByRole("button", { name: /sign off/i }));
      await waitFor(() => expect(fake.notifications).toHaveLength(1));
      expect(fake.notifications[0]).toMatchObject({ message: "Only an owner or manager can sign for someone else.", variant: "error" });
    });

    it("says so even when the answer carries no message", async () => {
      const { fake } = renderPanel(base);
      const execute = fake.execute;
      fake.execute = (async (...args: Parameters<typeof execute>) => (args[1].type === "compliance" ? { ok: false } : execute(...args))) as typeof execute;
      const card = fill("field_observer");
      fireEvent.click(within(card).getByRole("button", { name: /sign off/i }));
      await waitFor(() => expect(fake.notifications).toHaveLength(1));
      expect(fake.notifications[0]).toMatchObject({ message: m.editor_compliance_signoff_failed(), variant: "error" });
    });

    it("CONTROL - an accepted sign-off shows no notice", async () => {
      const { fake } = renderPanel(base);
      const card = fill("field_observer");
      fireEvent.click(within(card).getByRole("button", { name: /sign off/i }));
      await waitFor(() => expect(fake.reloadCount).toBe(1));
      expect(fake.notifications).toEqual([]);
    });
  });

  it("does not reload when the sign-off is refused, and keeps what was typed", async () => {
    const { fake } = renderPanel(base);
    fake.failExecute("compliance", "refused");
    const card = fill("field_observer", { license: "L-5" });
    fireEvent.click(within(card).getByRole("button", { name: /sign off/i }));
    await settle();
    expect(fake.commands).toHaveLength(1);
    expect(fake.reloadCount).toBe(0);
    expect((within(card).getByPlaceholderText(/license/i) as HTMLInputElement).value).toBe("L-5");
  });

  it("signs off ONCE for two same-frame presses", async () => {
    const { fake } = renderPanel(base);
    const card = fill("field_observer");
    const btn = within(card).getByRole("button", { name: /sign off/i });
    act(() => { btn.click(); btn.click(); });
    await settle();
    expect(fake.commands).toHaveLength(1);
  });

  it("each role card has its own guard: both roles signing in one frame both write", async () => {
    const { fake } = renderPanel(base);
    const a = fill("field_observer");
    const b = fill("pcr_reviewer");
    act(() => {
      within(a).getByRole("button", { name: /sign off/i }).click();
      within(b).getByRole("button", { name: /sign off/i }).click();
    });
    await settle();
    expect(sent(fake).map((c) => (c as { role: string }).role).sort()).toEqual(["field_observer", "pcr_reviewer"]);
  });

  const signed = {
    ...base,
    reportSignoffs: [{ role: "pcr_reviewer" as const, personId: "P-2", name: "Ada Lovelace", license: "L9", signedAt: Date.UTC(2026, 0, 15, 23, 30) }],
  };

  it("shows the signed date in the viewer's time zone from the session, UTC when it has none", () => {
    const utc = renderPanel(signed);
    expect(utc.getByText(/Jan 15, 2026/)).toBeTruthy();
    cleanup();
    const tokyo = renderPanel(signed, { timeZone: "Asia/Tokyo" });
    expect(tokyo.getByText(/Jan 16, 2026/)).toBeTruthy();
  });

  it("formats the signed date in the viewer's language from the session", () => {
    const { container } = renderPanel(signed, { locale: "de-DE", timeZone: "UTC" });
    expect(container.textContent).toMatch(/15\. Jan\.? 2026/);
  });

  it("removing asks first, then retracts the sign-off for that role and reloads", async () => {
    const { fake } = renderPanel(signed);
    fireEvent.click(within(screen.getByTestId("signoff-pcr_reviewer")).getByRole("button", { name: /remove/i }));
    expect(fake.commands).toHaveLength(0);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /remove/i }));
    await waitFor(() => expect(fake.reloadCount).toBe(1));
    expect(sent(fake)).toEqual([{ type: "compliance", op: "remove-signoff", role: "pcr_reviewer" }]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("removes ONCE for two same-frame presses of the confirm button", async () => {
    const { fake } = renderPanel(signed);
    fireEvent.click(within(screen.getByTestId("signoff-pcr_reviewer")).getByRole("button", { name: /remove/i }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: /remove/i });
    act(() => { confirm.click(); confirm.click(); });
    await settle();
    expect(fake.commands).toHaveLength(1);
  });
});

describe("CompliancePanel PSQ", () => {
  const withPsq = (status: "sent" | "received" | "declined" | null) => ({
    ...base,
    psq: status ? { status, responses: { knownDeficiencies: "roof" } } : null,
  });

  it("saves the whole questionnaire on blur of any question", async () => {
    const { fake } = renderPanel(withPsq("sent"));
    const [first] = Array.from(screen.getByTestId("psq-panel").querySelectorAll("textarea")) as HTMLTextAreaElement[];
    fireEvent.change(first!, { target: { value: "roof leaks" } });
    fireEvent.blur(first!);
    await settle();
    expect(sent(fake)).toEqual([
      {
        type: "compliance",
        op: "psq",
        responses: { knownDeficiencies: "roof leaks", pendingViolations: "", environmentalConcerns: "", plannedImprovements: "" },
      },
    ]);
    // The questionnaire is shown from local state, so no reload.
    expect(fake.reloadCount).toBe(0);
  });

  it("records a status change and shows it at once", async () => {
    const { fake } = renderPanel(withPsq("sent"));
    fireEvent.click(screen.getByRole("radio", { name: /received/i }));
    await settle();
    expect(sent(fake)).toEqual([{ type: "compliance", op: "psq-status", status: "received" }]);
    expect(screen.getByRole("radio", { name: /received/i })).toHaveAttribute("aria-checked", "true");
    expect(fake.reloadCount).toBe(0);
  });

  it("declining asks for a reason first; the command carries it, and the dialog closes", async () => {
    const { fake } = renderPanel(withPsq("sent"));
    fireEvent.click(screen.getByRole("radio", { name: /declined/i }));
    expect(fake.commands).toHaveLength(0);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "  owner refused " } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^decline/i }));
    await settle();
    expect(sent(fake)).toEqual([{ type: "compliance", op: "psq-status", status: "declined", reason: "owner refused" }]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("radio", { name: /declined/i })).toHaveAttribute("aria-checked", "true");
  });

  it("a decline with no reason says so in the command", async () => {
    const { fake } = renderPanel(withPsq("sent"));
    fireEvent.click(screen.getByRole("radio", { name: /declined/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^decline/i }));
    await settle();
    expect(sent(fake)).toEqual([{ type: "compliance", op: "psq-status", status: "declined", reason: "(no reason provided)" }]);
  });

  it("declines ONCE for two same-frame presses of the decline button", async () => {
    const { fake } = renderPanel(withPsq("sent"));
    fireEvent.click(screen.getByRole("radio", { name: /declined/i }));
    const dialog = await screen.findByRole("dialog");
    const decline = within(dialog).getByRole("button", { name: /^decline/i });
    act(() => { decline.click(); decline.click(); });
    await settle();
    expect(fake.commands).toHaveLength(1);
  });

  it("the questionnaire and the status have separate guards: both written in one frame", async () => {
    const { fake } = renderPanel(withPsq("sent"));
    const [first] = Array.from(screen.getByTestId("psq-panel").querySelectorAll("textarea")) as HTMLTextAreaElement[];
    fireEvent.change(first!, { target: { value: "x" } });
    act(() => {
      first!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      screen.getByRole("radio", { name: /received/i }).click();
    });
    await settle();
    expect(sent(fake).map((c) => (c as { op: string }).op).sort()).toEqual(["psq", "psq-status"]);
  });
});

describe("CompliancePanel document review rows", () => {
  it("a checkbox issues the whole row, with the notes as null when empty, and shows the change at once", async () => {
    const { fake, getByTestId } = renderPanel({ ...base, documentReview: [priorPcrs] });
    const row = getByTestId("doc-review-prior_pcrs");
    const [requested] = Array.from(row.querySelectorAll("input[type=checkbox]")) as HTMLInputElement[];
    fireEvent.click(requested!);
    await settle();
    expect(sent(fake)).toEqual([
      { type: "compliance", op: "doc-review", documentKey: "prior_pcrs", requested: true, received: false, reviewed: false, na: false, notes: null },
    ]);
    expect(requested!.checked).toBe(true);
    expect(fake.reloadCount).toBe(0);
  });

  it("the notes are written on blur, as typed", async () => {
    const { fake, getByTestId } = renderPanel({ ...base, documentReview: [priorPcrs] });
    const notes = getByTestId("doc-review-prior_pcrs").querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "asked twice" } });
    fireEvent.blur(notes);
    await settle();
    expect(sent(fake)).toEqual([
      { type: "compliance", op: "doc-review", documentKey: "prior_pcrs", requested: false, received: false, reviewed: false, na: false, notes: "asked twice" },
    ]);
  });

  it("two checkboxes of ONE row in the same frame write once; two different rows both write", async () => {
    const other = { ...priorPcrs, documentKey: "permits", label: "Permits" };
    const { fake, getByTestId } = renderPanel({ ...base, documentReview: [priorPcrs, other] });
    const a = Array.from(getByTestId("doc-review-prior_pcrs").querySelectorAll("input[type=checkbox]")) as HTMLInputElement[];
    const b = Array.from(getByTestId("doc-review-permits").querySelectorAll("input[type=checkbox]")) as HTMLInputElement[];
    act(() => { a[0]!.click(); a[1]!.click(); });
    await settle();
    expect(fake.commands).toHaveLength(1);
    act(() => { a[2]!.click(); b[0]!.click(); });
    await settle();
    expect(sent(fake).map((c) => (c as { documentKey: string }).documentKey).sort()).toEqual(["permits", "prior_pcrs", "prior_pcrs"]);
  });
});
