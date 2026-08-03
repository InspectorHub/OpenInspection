// @vitest-environment happy-dom
/**
 * IA-36 ⑦ — one control, two places (Settings → Inspection, and the People
 * card). It expresses a DURATION, never a date: the value therefore cannot land
 * in the past, which removes min-validation, an error state, and the footnote
 * that would have to explain "to kill it now, use a different button". The
 * absolute date is shown as a CONSEQUENCE of the duration.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useRouteLoaderData: () => undefined };
});

import { LinkExpiryControl } from "./LinkExpiryControl";

const FROM = Date.UTC(2026, 0, 31, 12, 0, 0);

describe("LinkExpiryControl", () => {
  it("offers no date input at all — only never / count + unit", () => {
    const { container } = render(<LinkExpiryControl value="never" onChange={() => {}} from={FROM} />);
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it("never says the links keep working, with no date", () => {
    const { getByTestId } = render(<LinkExpiryControl value="never" onChange={() => {}} from={FROM} />);
    expect(getByTestId("link-expiry-preview").textContent).toMatch(/keep working/i);
  });

  it("previews the absolute date a duration resolves to", () => {
    const { getByTestId } = render(
      <LinkExpiryControl value={{ count: 90, unit: "days" }} onChange={() => {}} from={FROM} />,
    );
    // 2026-01-31 + 90 days = 2026-05-01
    expect(getByTestId("link-expiry-preview").textContent).toContain("May 1, 2026");
  });

  it("switching to a duration hands back a real default rather than an empty value", () => {
    const onChange = vi.fn();
    const { getByTestId } = render(<LinkExpiryControl value="never" onChange={onChange} from={FROM} />);
    fireEvent.change(getByTestId("link-expiry-mode"), { target: { value: "after" } });
    expect(onChange).toHaveBeenCalledWith({ count: 90, unit: "days" });
  });

  it("switching back to never drops the duration entirely", () => {
    const onChange = vi.fn();
    const { getByTestId } = render(
      <LinkExpiryControl value={{ count: 12, unit: "months" }} onChange={onChange} from={FROM} />,
    );
    fireEvent.change(getByTestId("link-expiry-mode"), { target: { value: "never" } });
    expect(onChange).toHaveBeenCalledWith("never");
  });

  it("changing the unit keeps the count", () => {
    const onChange = vi.fn();
    const { getByTestId } = render(
      <LinkExpiryControl value={{ count: 2, unit: "days" }} onChange={onChange} from={FROM} />,
    );
    fireEvent.change(getByTestId("link-expiry-unit"), { target: { value: "years" } });
    expect(onChange).toHaveBeenCalledWith({ count: 2, unit: "years" });
  });

  it("a cleared number field does not silently become a different policy", () => {
    const onChange = vi.fn();
    const { getByTestId } = render(
      <LinkExpiryControl value={{ count: 90, unit: "days" }} onChange={onChange} from={FROM} />,
    );
    fireEvent.change(getByTestId("link-expiry-count"), { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clamps a zero/negative count to 1 — an expiry of zero is not a way to kill a link", () => {
    const onChange = vi.fn();
    const { getByTestId } = render(
      <LinkExpiryControl value={{ count: 90, unit: "days" }} onChange={onChange} from={FROM} />,
    );
    fireEvent.change(getByTestId("link-expiry-count"), { target: { value: "0" } });
    expect(onChange).toHaveBeenCalledWith({ count: 1, unit: "days" });
  });
});
