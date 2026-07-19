/**
 * Spec 2 Task 7 — "Send report" modal. `SendReportModal` receives its
 * fetcher as a prop (independent per-mutation fetcher, B-17), so tests build
 * a plain fetcher stub rather than mocking react-router's `useFetcher` (the
 * component never calls that hook itself).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { createElement } from "react";
import type { useFetcher } from "react-router";
import { SendReportModal } from "~/components/inspection/SendReportModal";
import type { PersonRow } from "~/components/inspection/PeopleEditor";
import type { RoleProfile } from "~/components/contacts/contacts-helpers";
import type { action } from "~/routes/inspection-hub";

afterEach(cleanup);

type Fetcher = ReturnType<typeof useFetcher<typeof action>>;

function makeFetcher(overrides: Partial<Fetcher> = {}): Fetcher {
  return {
    state: "idle",
    data: undefined,
    Form: ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) =>
      createElement("form", props, children),
    ...overrides,
  } as unknown as Fetcher;
}

const people: PersonRow[] = [
  {
    id: "p1",
    contactId: "c1",
    roleProfileId: "rp1",
    roleKey: "client",
    roleLabel: "Client",
    kind: "client",
    name: "Alice Buyer",
    email: "alice@example.com",
    phone: null,
    agency: null,
  },
  {
    id: "p2",
    contactId: "c2",
    roleProfileId: "rp2",
    roleKey: "buyer_agent",
    roleLabel: "Buyer Agent",
    kind: "agent",
    name: "Bob Agent",
    email: "bob@example.com",
    phone: null,
    agency: "Acme Realty",
  },
  {
    id: "p3",
    contactId: "c3",
    roleProfileId: "rp3",
    roleKey: "seller",
    roleLabel: "Seller",
    kind: "other",
    name: "Carol Seller",
    email: null,
    phone: null,
    agency: null,
  },
];

const roleProfiles: RoleProfile[] = [
  { id: "rp1", key: "client", label: "Client", kind: "client", emailTemplateId: null, smsTemplateId: null, isSystem: true, sortOrder: 0, active: true },
  { id: "rp2", key: "buyer_agent", label: "Buyer Agent", kind: "agent", emailTemplateId: null, smsTemplateId: null, isSystem: true, sortOrder: 1, active: true },
  { id: "rp3", key: "seller", label: "Seller", kind: "other", emailTemplateId: null, smsTemplateId: null, isSystem: false, sortOrder: 2, active: true },
];

function recipientsField(container: HTMLElement): Array<Record<string, unknown>> {
  const el = container.querySelector('input[name="recipients"]') as HTMLInputElement;
  return JSON.parse(el.value);
}

function submitButton() {
  return screen.getByText("Send").closest("button") as HTMLButtonElement;
}

describe("SendReportModal", () => {
  it("renders the inspection's people grouped by role; a person without an email is disabled", () => {
    const { container } = render(
      <SendReportModal people={people} roleProfiles={roleProfiles} fetcher={makeFetcher()} onClose={vi.fn()} />,
    );

    expect(screen.getByTestId("people-group-client")).toBeTruthy();
    expect(screen.getByTestId("people-group-agent")).toBeTruthy();
    expect(screen.getByTestId("people-group-other")).toBeTruthy();

    expect(screen.getByText("Alice Buyer")).toBeTruthy();
    expect(screen.getByText("Bob Agent")).toBeTruthy();
    expect(screen.getByText("Carol Seller")).toBeTruthy();
    expect(screen.getByText("No email on file")).toBeTruthy();

    const carolCheckbox = container.querySelector('input[data-testid="send-report-person-p3"]') as HTMLInputElement;
    expect(carolCheckbox.disabled).toBe(true);
  });

  it("submit is disabled when nothing is selected or entered", () => {
    render(<SendReportModal people={people} roleProfiles={roleProfiles} fetcher={makeFetcher()} onClose={vi.fn()} />);
    expect(submitButton().disabled).toBe(true);
  });

  it("selecting two people serializes both as {contactId, roleKey} into the hidden recipients field", () => {
    const { container } = render(
      <SendReportModal people={people} roleProfiles={roleProfiles} fetcher={makeFetcher()} onClose={vi.fn()} />,
    );

    fireEvent.click(container.querySelector('input[data-testid="send-report-person-p1"]') as HTMLInputElement);
    fireEvent.click(container.querySelector('input[data-testid="send-report-person-p2"]') as HTMLInputElement);

    const recipients = recipientsField(container);
    expect(recipients).toEqual(
      expect.arrayContaining([
        { contactId: "c1", roleKey: "client" },
        { contactId: "c2", roleKey: "buyer_agent" },
      ]),
    );
    expect(recipients).toHaveLength(2);
    expect(submitButton().disabled).toBe(false);
  });

  it("filling the one-off email + role includes {email, roleKey} in recipients", () => {
    const { container } = render(
      <SendReportModal people={people} roleProfiles={roleProfiles} fetcher={makeFetcher()} onClose={vi.fn()} />,
    );

    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "extra@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "seller" } });

    const recipients = recipientsField(container);
    expect(recipients).toEqual([{ email: "extra@example.com", roleKey: "seller" }]);
    expect(submitButton().disabled).toBe(false);
  });

  it("does not include a one-off recipient with an email but no role selected", () => {
    const { container } = render(
      <SendReportModal people={people} roleProfiles={roleProfiles} fetcher={makeFetcher()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText("name@example.com"), {
      target: { value: "extra@example.com" },
    });
    expect(recipientsField(container)).toEqual([]);
    expect(submitButton().disabled).toBe(true);
  });

  it("auto-closes once the fetcher settles idle with a successful send-report result", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <SendReportModal
        people={people}
        roleProfiles={roleProfiles}
        fetcher={makeFetcher({ state: "submitting", data: undefined })}
        onClose={onClose}
      />,
    );
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <SendReportModal
        people={people}
        roleProfiles={roleProfiles}
        fetcher={makeFetcher({
          state: "idle",
          data: { ok: true, intent: "send-report", error: undefined },
        })}
        onClose={onClose}
      />,
    );

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when the fetcher settles idle with a failed send-report result, and shows the error", () => {
    const onClose = vi.fn();
    render(
      <SendReportModal
        people={people}
        roleProfiles={roleProfiles}
        fetcher={makeFetcher({
          state: "idle",
          data: { ok: false, intent: "send-report", error: "Could not send the report. Please try again." },
        })}
        onClose={onClose}
      />,
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Could not send the report. Please try again.")).toBeTruthy();
  });
});
