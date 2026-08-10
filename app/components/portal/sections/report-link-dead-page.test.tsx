// @vitest-environment happy-dom
/**
 * IA-36 ⑨ — one page for a report link that does not work, whichever way it
 * stopped working.
 *
 * 404 ("this token names nothing") and 410 ("we took this link offline") land
 * on the SAME screen on purpose. Rotating a link overwrites its row in place,
 * so a recipient still holding the superseded URL arrives as a 404 —
 * indistinguishable from someone who mistyped one. Splitting the copy would
 * mean confidently telling a legitimate client "no such report" when we in
 * fact replaced their link ten minutes ago.
 *
 * These assert what the reader SEES. The wire keeps 404 and 410 distinct
 * (support and the audit trail need the difference); that is not this file's
 * subject.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ErrorState } from "../../ErrorState";
import { ReportView, reportViewProps } from "./ReportView";
import { EMPTY_BRAND } from "~/lib/brand";

afterEach(cleanup);

type ReportLoaderData = Parameters<typeof reportViewProps>[0];

/**
 * Render the report surface as a loader that FAILED would hand it over.
 *
 * The payload is deliberately PARTIAL — that is the case under test.
 * `reportViewProps` is written for it (every field it reads is `?? default`),
 * but its parameter type still asks for the whole success payload, so the gap
 * is bridged once, here. `Partial<ReportLoaderData>` rather than the `as never`
 * this used to carry: a key the loader result does not have is still an error,
 * which is what caught nothing before.
 */
function renderReport(loader: Partial<ReportLoaderData>) {
  return render(<ReportView {...reportViewProps(loader as ReportLoaderData)} />);
}

const BRAND = {
  companyName: "Acme Inspections",
  supportEmail: "help@acme.example",
  companyPhone: "(555) 010-1234",
};

describe("404 and 410 are the same screen to the reader", () => {
  // Whatever this copy becomes, the two cases must not diverge. The assertions
  // below compare the two renders against each OTHER rather than against a
  // fixed string, so rewording the page cannot quietly re-split them.
  const brand = {
    ...EMPTY_BRAND,
    companyName: BRAND.companyName,
    supportEmail: BRAND.supportEmail,
    companyPhone: null,
  };

  it("a 404 and a 410 produce identical text", () => {
    const { container: notFound } = renderReport({ error: "Report not found", brand });
    const a = notFound.textContent;
    cleanup();
    const { container: gone } = renderReport({ error: "Report not found", linkInactive: true, brand });
    expect(gone.textContent).toBe(a);
  });

  it("neither says 'not found' — we cannot tell a rotated link from a typo", () => {
    renderReport({ error: "Report not found", brand });
    expect(screen.queryByText(/not found/i)).toBeNull();
  });

  it("names the company and offers its contact channel", () => {
    renderReport({ error: "Report not found", brand });
    expect(screen.getByText(new RegExp(BRAND.companyName))).toBeTruthy();
    expect(screen.getByText(BRAND.supportEmail).getAttribute("href")).toBe(
      `mailto:${BRAND.supportEmail}`,
    );
  });

  it("a genuine service failure stays a DIFFERENT page — it is not the link's fault", () => {
    renderReport({ error: "Service unavailable", brand });
    expect(screen.queryByText(/isn't working/i)).toBeNull();
  });

  it("an unpublished report also stays its own page", () => {
    renderReport({ error: "Report not found", notPublished: true, brand });
    expect(screen.queryByText(/isn't working/i)).toBeNull();
  });
});

describe("the dead-link page gives the reader somewhere to go", () => {
  it("renders the company's email and phone as working links", () => {
    render(
      <ErrorState
        title="This report link isn't working"
        message={`Contact ${BRAND.companyName}.`}
        contacts={{ email: BRAND.supportEmail, phone: BRAND.companyPhone }}
      />,
    );
    expect(screen.getByText(BRAND.supportEmail).getAttribute("href")).toBe(
      `mailto:${BRAND.supportEmail}`,
    );
    // Punctuation is stripped from the dial string but kept in the label —
    // a tel: href with spaces and parens is not reliably dialable.
    expect(screen.getByText(BRAND.companyPhone).getAttribute("href")).toBe("tel:5550101234");
  });

  it("omits the contact block entirely when the tenant has set neither", () => {
    const { container } = render(
      <ErrorState title="This report link isn't working" contacts={{ email: null, phone: null }} />,
    );
    // No empty rule-off, no orphan divider promising details that never come.
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("treats a whitespace-only contact as unset rather than rendering a blank link", () => {
    const { container } = render(
      <ErrorState title="x" contacts={{ email: "   ", phone: "" }} />,
    );
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("renders whichever single channel the tenant configured", () => {
    render(<ErrorState title="x" contacts={{ email: null, phone: "555-0100" }} />);
    expect(screen.getByText("555-0100").getAttribute("href")).toBe("tel:5550100");
    expect(screen.queryByText(/@/)).toBeNull();
  });
});
