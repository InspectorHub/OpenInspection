import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { AddressAutocomplete } from "./AddressAutocomplete";
import type { AddressSelection } from "~/routes/resources/places";

const SAMPLE: AddressSelection = {
  placeId: "p1",
  formatted: "123 Main St, Austin, TX 78701",
  street: "123 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  county: "Travis",
  lat: 30.26,
  lng: -97.74,
};

function mountWith(onSelect: (s: AddressSelection) => void) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => {
        const [val, setVal] = useState("");
        return <AddressAutocomplete value={val} onValueChange={setVal} onSelect={onSelect} />;
      },
    },
    {
      path: "/resources/places",
      loader: ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("placeId")) {
          return { suggestions: [], address: SAMPLE };
        }
        return {
          suggestions: [
            { placeId: "p1", description: "123 Main St, Austin, TX", mainText: "123 Main St", secondaryText: "Austin, TX" },
          ],
          address: null,
        };
      },
    },
  ]);
  return render(<Stub />);
}

describe("AddressAutocomplete", () => {
  it("shows suggestions while typing and emits a structured selection on click", async () => {
    const onSelect = vi.fn();
    mountWith(onSelect);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "123 Main" } });

    const option = await waitFor(() => screen.getByText("123 Main St"));
    fireEvent.mouseDown(option);

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ placeId: "p1", lat: expect.any(Number), lng: expect.any(Number) }),
      ),
    );
  });

  it("does not query for inputs shorter than 2 characters", async () => {
    const onSelect = vi.fn();
    mountWith(onSelect);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
    // Give any (incorrectly scheduled) debounce time to fire.
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
