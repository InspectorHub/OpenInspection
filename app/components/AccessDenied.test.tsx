// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

let role: string | undefined;
vi.mock("~/hooks/useSessionContext", () => ({
  useSessionContext: () => (role ? { user: { role } } : null),
}));

import { AccessDenied } from "./AccessDenied";

describe("AccessDenied", () => {
  beforeEach(() => {
    role = undefined;
  });

  it("names the role the viewer is signed in as, who the page is for, and how to get in", () => {
    role = "inspector";
    const { container } = render(<AccessDenied />);
    const text = container.textContent ?? "";
    expect(text).toContain("You are signed in as an Inspector.");
    expect(text).toContain("This page is for owners and managers.");
    expect(text).toContain("change your role on the Team page");
  });

  it("describes an office staff member in plain words", () => {
    role = "staff";
    expect(render(<AccessDenied />).container.textContent).toContain("You are signed in as an office staff member.");
  });

  it("asks an owner, not an owner or manager, for an owner-only page", () => {
    role = "manager";
    const text = render(<AccessDenied needs="owner" />).container.textContent ?? "";
    expect(text).toContain("You are signed in as a Manager.");
    expect(text).toContain("This page is for the owner. Ask an owner to open it for you");
    expect(text).not.toContain("owners and managers");
  });

  it("for a page gated by one permission, names the permission and sends a manager to an owner, not to themselves", () => {
    role = "manager";
    const text = render(<AccessDenied needs="companyFinance" />).container.textContent ?? "";
    expect(text).toContain("You are signed in as a Manager.");
    expect(text).toContain("needs the “Company finances” permission");
    expect(text).toContain("Ask an owner to turn it on");
    expect(text).not.toContain("owners and managers");
  });

  it("for a page that only office staff are kept out of, says that instead of claiming it is for owners and managers", () => {
    role = "staff";
    const text = render(<AccessDenied needs="notStaff" />).container.textContent ?? "";
    expect(text).toContain("You are signed in as an office staff member.");
    expect(text).toContain("not available to office staff accounts");
    expect(text).not.toContain("owners and managers");
  });

  it("uses the neutral title for anything but the owner/manager pages", () => {
    role = "inspector";
    expect(render(<AccessDenied />).container.textContent).toContain("Admins only");
    expect(render(<AccessDenied needs="owner" />).container.textContent).not.toContain("Admins only");
  });

  it("still explains the block when the session cannot be read, without inventing a role", () => {
    const text = render(<AccessDenied />).container.textContent ?? "";
    expect(text).toContain("You don’t have permission to view this page.");
    expect(text).not.toContain("signed in as");
  });
});
