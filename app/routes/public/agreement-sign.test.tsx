// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import AgreementSign from "./agreement-sign";

/**
 * A client signing a binding agreement must see the entity they are
 * contracting with, not the platform that hosts it. The standalone signing
 * page painted "OpenInspection" because its loader never fetched the brand,
 * while the SAME envelope reached through checkout showed the tenant's name.
 *
 * `createRoutesStub` does NOT run middleware, which is fine here: these tests
 * assert rendering from loader data, not authorization. Do not add an auth
 * assertion to this file.
 */
describe("agreement-sign brand header", () => {
  it("renders the tenant's company name, not the platform's", async () => {
    const Stub = createRoutesStub([
      {
        path: "/agreements/sign/:tenant/:token",
        Component: AgreementSign,
        loader: () => ({
          agreement: null,
          error: "Agreement not found",
          token: "t",
          tenant: "acme",
          brand: { companyName: "Acme Home Inspections LLC", logoUrl: null, primaryColor: null },
        }),
      },
    ]);
    render(<Stub initialEntries={["/agreements/sign/acme/t"]} />);
    expect(await screen.findByText("Acme Home Inspections LLC")).toBeInTheDocument();
    expect(screen.queryByText("OpenInspection")).not.toBeInTheDocument();
  });

  it("falls back to the platform name when the brand is unavailable", async () => {
    const Stub = createRoutesStub([
      {
        path: "/agreements/sign/:tenant/:token",
        Component: AgreementSign,
        loader: () => ({
          agreement: null,
          error: "Agreement not found",
          token: "t",
          tenant: "acme",
          brand: null,
        }),
      },
    ]);
    render(<Stub initialEntries={["/agreements/sign/acme/t"]} />);
    expect(await screen.findByText("OpenInspection")).toBeInTheDocument();
  });
});
