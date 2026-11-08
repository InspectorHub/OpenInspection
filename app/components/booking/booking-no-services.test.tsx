// @vitest-environment happy-dom
/**
 * The Services step with nothing bookable.
 *
 * The profile endpoint hides a service that is inactive or has no template, so a company whose
 * only services lack a template reaches the Services step with an empty list. The step used to
 * render only its heading above a disabled Continue, with no explanation. It must say, in
 * visitor-facing words, that nothing is open for online booking, and offer no dead Continue.
 */
import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";

import { BookingWizard } from "~/components/booking/BookingWizard";
import { useBookingFormState } from "~/components/booking/useBookingFormState";
import type { CompanyProfile } from "~/components/booking/booking-constants";

const EMPTY: CompanyProfile = { company: "Acme Inspections", bookingOpen: true, inspectors: [], services: [] };
const ONE: CompanyProfile = {
  ...EMPTY,
  services: [{ id: "svc", name: "Home inspection", price: 45000, duration: 180 }],
};

let form: ReturnType<typeof useBookingFormState>;

async function mount(profile: CompanyProfile) {
  function Harness() {
    form = useBookingFormState({ profile, preselected: null, tenant: "acme", agentRefSlug: null });
    return <BookingWizard profile={profile} privacyUrl={null} termsUrl={null} form={form} />;
  }
  const Stub = createRoutesStub([{ path: "/", Component: Harness }]);
  render(<Stub initialEntries={["/"]} />);
  await act(async () => { form.setAddress("1 Main St"); form.setStep(1); });
}

afterEach(cleanup);

describe("Services step with no bookable service", () => {
  it("explains that nothing is open for online booking and renders no Continue", async () => {
    await mount(EMPTY);
    expect(screen.getByRole("status").textContent).toMatch(/no services open for online booking/i);
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    // Back stays available.
    expect(screen.getByRole("button", { name: /back/i })).toBeTruthy();
  });

  it("uses no internal or plan wording", async () => {
    await mount(EMPTY);
    expect(screen.getByRole("status").textContent).not.toMatch(/template|plan|upgrade|admin|settings/i);
  });

  it("keeps the normal list and a Continue when a service is bookable", async () => {
    await mount(ONE);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Home inspection")).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue/i })).toBeTruthy();
  });
});
