// @vitest-environment happy-dom
/**
 * The PCA narrative editor.
 *
 * The assertion that earns its place is the #106 one: each block owns its OWN
 * guard. `useFieldCommand` refuses a second command while one is in flight, so
 * a single shared guard across nine blocks would silently drop the second
 * block's text whenever a reader tabbed from one field to the next inside a
 * round trip. Blurring two DIFFERENT blocks must produce two writes.
 *
 * The panel issues `save-pca-narrative` commands, so these tests run it on the
 * provider and a fake data source and assert on the COMMANDS. The form post they
 * become is pinned by the web adapter tests.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import type { CommandResult } from "../../commands";
import { FieldDataSourceProvider } from "../../context";
import type { PcaNarrativeData } from "../../data-source-types";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import type { FakeDataSource } from "../../testing/fake-data-source";

import { PcaNarrativePanel } from "./PcaNarrativePanel";

afterEach(cleanup);

const narrative: PcaNarrativeData = {
  transmittalLetter: "TL", summaryGeneralDescription: "GD", summaryPhysicalCondition: "PC",
  summaryRecommendations: "REC", purpose: "PURP", scopeOfWork: "SCOPE",
  limitationsExceptions: "LIMITS", reconnaissance: "RECON", additionalConsiderations: "ADDL",
};

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

function renderPanel() {
  const fake: FakeDataSource = createFakeDataSource({ data: createEmptyEditorData() });
  const utils = render(
    <FieldDataSourceProvider dataSource={fake}>
      <PcaNarrativePanel inspectionId="insp-1" narrative={narrative} />
    </FieldDataSourceProvider>,
  );
  return { ...utils, fake };
}

describe("PcaNarrativePanel", () => {
  it("renders a textarea per block seeded from the narrative", async () => {
    const { findByDisplayValue } = renderPanel();
    expect(await findByDisplayValue("PURP")).toBeTruthy();
    expect(await findByDisplayValue("SCOPE")).toBeTruthy();
  });

  it("saves the edited block on blur, with the key and an idempotency key", async () => {
    const { findByDisplayValue, fake } = renderPanel();
    const ta = await findByDisplayValue("PURP");
    fireEvent.change(ta, { target: { value: "edited purpose" } });
    fireEvent.blur(ta);

    await waitFor(() => expect(fake.commands).toHaveLength(1));
    expect(fake.commands[0]).toMatchObject({
      inspectionId: "insp-1",
      cmd: { type: "save-pca-narrative", key: "purpose", value: "edited purpose" },
    });
    expect(fake.commands[0]!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not write when a block is blurred without an edit", async () => {
    const { findByDisplayValue, fake } = renderPanel();
    fireEvent.blur(await findByDisplayValue("SCOPE"));
    await settle();
    expect(fake.commands).toEqual([]);
  });

  it("does not write the same text twice: a block blurred again after it was saved stays quiet", async () => {
    const { findByDisplayValue, fake } = renderPanel();
    const ta = await findByDisplayValue("PURP");
    fireEvent.change(ta, { target: { value: "once" } });
    fireEvent.blur(ta);
    await settle();
    fireEvent.blur(ta);
    await settle();
    expect(fake.commands).toHaveLength(1);
  });

  it("writes BOTH blocks when two different ones are blurred in one gesture", async () => {
    // The regression this file exists for. One shared guard across the panel
    // refuses the second call and the second block's text is lost with no
    // error anywhere — the failure mode is silence, so it needs its own test.
    const { findByDisplayValue, fake } = renderPanel();
    const purpose = await findByDisplayValue("PURP");
    const scope = await findByDisplayValue("SCOPE");

    fireEvent.change(purpose, { target: { value: "one" } });
    fireEvent.blur(purpose);
    fireEvent.change(scope, { target: { value: "two" } });
    fireEvent.blur(scope);

    await waitFor(() => expect(fake.commands).toHaveLength(2));
    expect(fake.commands.map((c) => c.cmd as { key: string; value: string }).map((c) => `${c.key}=${c.value}`).sort()).toEqual([
      "purpose=one",
      "scopeOfWork=two",
    ]);
    // Two independent guards mean two independent keys.
    expect(fake.commands[0]!.idempotencyKey).not.toBe(fake.commands[1]!.idempotencyKey);
  });

  it("writes both blocks even when both blurs land in ONE frame, because each block has its own guard", async () => {
    const { findByDisplayValue, fake } = renderPanel();
    const purpose = await findByDisplayValue("PURP");
    const scope = await findByDisplayValue("SCOPE");
    fireEvent.change(purpose, { target: { value: "one" } });
    fireEvent.change(scope, { target: { value: "two" } });
    act(() => {
      purpose.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      scope.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();
    expect(fake.commands).toHaveLength(2);
  });

  it("while a block is saving it is read-only and says so, and the answer frees it", async () => {
    const { findByDisplayValue, findByText, fake } = renderPanel();
    let settleWrite: (r: CommandResult<undefined>) => void = () => undefined;
    vi.spyOn(fake, "execute").mockImplementation((() =>
      new Promise<CommandResult<undefined>>((resolve) => { settleWrite = resolve; })) as FakeDataSource["execute"]);
    const ta = (await findByDisplayValue("PURP")) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "slow" } });
    fireEvent.blur(ta);
    expect(await findByText(/saving/i)).toBeTruthy();
    expect(ta.readOnly).toBe(true);
    settleWrite({ ok: true });
    await waitFor(() => expect(ta.readOnly).toBe(false));
  });

  it("a refused write is not retried by a blur with no edit (the text stays as typed), as before", async () => {
    const { findByDisplayValue, fake } = renderPanel();
    fake.failExecute("save-pca-narrative", "no");
    const ta = await findByDisplayValue("PURP");
    fireEvent.change(ta, { target: { value: "typed" } });
    fireEvent.blur(ta);
    await settle();
    fireEvent.blur(ta);
    await settle();
    expect(fake.commands).toHaveLength(1);
    expect((ta as HTMLTextAreaElement).value).toBe("typed");
  });
});
