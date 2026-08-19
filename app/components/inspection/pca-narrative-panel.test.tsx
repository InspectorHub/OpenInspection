// @vitest-environment happy-dom
/**
 * The PCA narrative editor.
 *
 * The assertion that earns its place is the #106 one: each block owns its OWN
 * guard. `useGuardedSubmit` refuses a second submit while one is in flight, so
 * a single shared guard across nine blocks would silently drop the second
 * block's text whenever a reader tabbed from one field to the next inside a
 * round trip. Blurring two DIFFERENT blocks must produce two writes.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { PcaNarrativePanel } from "~/components/inspection/PcaNarrativePanel";
import type { PcaNarrativeData } from "~/components/portal/sections/report/types";
import { IDEMPOTENCY_FIELD } from "~/hooks/useGuardedSubmit";

const narrative: PcaNarrativeData = {
  transmittalLetter: "TL", summaryGeneralDescription: "GD", summaryPhysicalCondition: "PC",
  summaryRecommendations: "REC", purpose: "PURP", scopeOfWork: "SCOPE",
  limitationsExceptions: "LIMITS", reconnaissance: "RECON", additionalConsiderations: "ADDL",
};

function renderPanel() {
  const calls: Record<string, string>[] = [];
  const Stub = createRoutesStub([
    {
      path: "/edit",
      Component: () => <PcaNarrativePanel narrative={narrative} />,
      action: async ({ request }) => {
        const form = await request.formData();
        calls.push(Object.fromEntries(form) as Record<string, string>);
        return { ok: true };
      },
    },
  ]);
  const utils = render(<Stub initialEntries={["/edit"]} />);
  return { ...utils, calls };
}

describe("PcaNarrativePanel", () => {
  it("renders a textarea per block seeded from the narrative", async () => {
    const { findByDisplayValue } = renderPanel();
    expect(await findByDisplayValue("PURP")).toBeTruthy();
    expect(await findByDisplayValue("SCOPE")).toBeTruthy();
  });

  it("saves the edited block on blur, with the key and the idempotency field", async () => {
    const { findByDisplayValue, calls } = renderPanel();
    const ta = await findByDisplayValue("PURP");
    fireEvent.change(ta, { target: { value: "edited purpose" } });
    fireEvent.blur(ta);

    await waitFor(() => expect(calls).toHaveLength(1));
    const { [IDEMPOTENCY_FIELD]: key, ...payload } = calls[0];
    expect(payload).toEqual({
      intent: "save-pca-narrative",
      key: "purpose",
      value: "edited purpose",
    });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not write when a block is blurred without an edit", async () => {
    const { findByDisplayValue, calls } = renderPanel();
    fireEvent.blur(await findByDisplayValue("SCOPE"));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
  });

  it("writes BOTH blocks when two different ones are blurred in one gesture", async () => {
    // The regression this file exists for. One shared guard across the panel
    // refuses the second call and the second block's text is lost with no
    // error anywhere — the failure mode is silence, so it needs its own test.
    const { findByDisplayValue, calls } = renderPanel();
    const purpose = await findByDisplayValue("PURP");
    const scope = await findByDisplayValue("SCOPE");

    fireEvent.change(purpose, { target: { value: "one" } });
    fireEvent.blur(purpose);
    fireEvent.change(scope, { target: { value: "two" } });
    fireEvent.blur(scope);

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((c) => `${c.key}=${c.value}`).sort()).toEqual([
      "purpose=one",
      "scopeOfWork=two",
    ]);
    // Two independent guards mean two independent keys.
    expect(calls[0][IDEMPOTENCY_FIELD]).not.toBe(calls[1][IDEMPOTENCY_FIELD]);
  });
});
