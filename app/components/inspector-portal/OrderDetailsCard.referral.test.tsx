// @vitest-environment happy-dom
/**
 * The referral dropdown's list loads when the editor is first opened. Until it
 * arrives the dropdown holds only the value the order already has, and that must
 * be what a save sends: a late list can never turn into an erased referral.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { OrderDetailsCard } from "~/components/inspector-portal/OrderDetailsCard";
import { asSelect } from "../../../tests/helpers/dom";

const posted: Array<Record<string, FormDataEntryValue>> = [];

function mount(extra: { sources: string[]; onRequestSources?: () => void }) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <OrderDetailsCard
          closingDate="2026-09-30"
          referenceNumber="REF-7"
          referralSource="Podcast"
          referralSources={extra.sources}
          {...(extra.onRequestSources ? { onRequestSources: extra.onRequestSources } : {})}
          referredByContactId={null}
          referredByName={null}
        />
      ),
      action: async ({ request }) => {
        posted.push(Object.fromEntries(await request.formData()));
        return { intent: "save-order", ok: true };
      },
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

beforeEach(() => { posted.length = 0; });

describe("OrderDetailsCard referral source before its list has loaded", () => {
  it("asks for the list when the editor opens", async () => {
    const onRequestSources = vi.fn();
    mount({ sources: [], onRequestSources });
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }));
    expect(onRequestSources).toHaveBeenCalledTimes(1);
  });

  it("with no list yet, the dropdown still holds the current value and saving sends it unchanged", async () => {
    mount({ sources: [] });
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }));
    const select = asSelect(await screen.findByTestId("hub-details-referral"), "the referral dropdown");
    expect(select.value).toBe("Podcast");
    fireEvent.submit(select.closest("form") as HTMLFormElement);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(JSON.parse(String(posted[0]!.payload)).referralSource).toBe("Podcast");
  });
});
