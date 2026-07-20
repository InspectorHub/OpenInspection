import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { PropertyInfoForm } from "./PropertyInfoForm";

function mount(
  actionResult: unknown,
  handlers: { onSave?: (id: string, v: unknown) => void; onCommit?: (f: Record<string, unknown>) => void },
) {
  const inspection: Record<string, unknown> = {
    propertyType: "single_family",
    propertyAddress: "123 Main St, Austin, TX 78701",
    bedrooms: "4", // already set — must NOT be overwritten
    // yearBuilt / sqft / etc. absent = empty = fillable
  };
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <PropertyInfoForm inspection={inspection} onSave={handlers.onSave} onCommit={handlers.onCommit} />
      ),
      action: () => actionResult,
    },
  ]);
  return render(<Stub />);
}

describe("PropertyInfoForm — Fetch property details (#200)", () => {
  it("fills only empty fields and never clobbers a value the inspector already set", async () => {
    const onSave = vi.fn();
    const onCommit = vi.fn();
    mount(
      { intent: "autofill-property-facts", facts: { yearBuilt: 1990, bedrooms: 3 }, reason: null },
      { onSave, onCommit },
    );

    fireEvent.click(screen.getByRole("button", { name: /fetch property details/i }));

    // The empty yearBuilt gets filled...
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("yearBuilt", 1990));
    // ...but the already-set bedrooms is left alone.
    expect(onSave).not.toHaveBeenCalledWith("bedrooms", 3);
    // The durable commit is a full snapshot: filled yearBuilt + preserved bedrooms.
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ yearBuilt: 1990, bedrooms: 4 }));
    // A summary of what was filled is surfaced.
    await waitFor(() => expect(screen.getByText(/filled 1 field/i)).toBeTruthy());
  });

  it("shows an 'unconfigured' message and commits nothing when the provider key is unset", async () => {
    const onSave = vi.fn();
    const onCommit = vi.fn();
    mount(
      { intent: "autofill-property-facts", facts: null, reason: "NO_API_KEY" },
      { onSave, onCommit },
    );

    fireEvent.click(screen.getByRole("button", { name: /fetch property details/i }));

    await waitFor(() => expect(screen.getByText(/isn.t configured/i)).toBeTruthy());
    expect(onCommit).not.toHaveBeenCalled();
  });
});
