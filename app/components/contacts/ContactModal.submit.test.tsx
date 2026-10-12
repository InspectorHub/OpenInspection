// @vitest-environment happy-dom
/**
 * A fast double click on Save must post the contact once.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { ContactModal } from "./ContactModal";

afterEach(cleanup);

describe("ContactModal - Save", () => {
  it("reaches the action once when clicked twice in one frame", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const Stub = createRoutesStub([
      {
        path: "/contacts",
        Component: () => <ContactModal open onClose={() => {}} contact={null} />,
        action: async () => {
          calls += 1;
          await new Promise<void>((resolve) => { release = resolve; });
          return null;
        },
      },
    ]);
    render(<Stub initialEntries={["/contacts"]} />);
    await screen.findByRole("button", { name: "Save" });
    const name = document.querySelector<HTMLInputElement>("input[name=name]");
    if (!name) throw new Error("name input missing");
    fireEvent.change(name, { target: { value: "Tomas Beck" } });

    const save = screen.getByRole("button", { name: "Save" });
    act(() => { save.click(); save.click(); });
    await waitFor(() => expect(calls).toBe(1));
    expect(calls).toBe(1);
    await waitFor(() => expect(save.getAttribute("aria-disabled")).toBe("true"));
    await act(async () => { release(); });
  });
});
