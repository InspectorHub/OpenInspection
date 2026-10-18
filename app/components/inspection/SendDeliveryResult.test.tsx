// @vitest-environment happy-dom
/**
 * What the report and text dialogs do with the answer of a send: close only when everyone was reached,
 * otherwise stay open and say who was reached, who was not, and why, in words rather than server strings.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { createElement } from "react";
import type { useFetcher } from "react-router";
import { SendReportModal } from "~/components/inspection/SendReportModal";
import { SendSmsModal } from "~/components/inspection/SendSmsModal";
import type { PersonRow } from "~/components/inspection/PeopleEditor";
import type { action } from "~/routes/inspector-portal";

afterEach(cleanup);

type Fetcher = ReturnType<typeof useFetcher<typeof action>>;
const Form = ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) => createElement("form", props, children);
const fetcherWith = (data: unknown, state = "idle"): Fetcher => ({ state, data, Form }) as unknown as Fetcher;

const person = (over: Partial<PersonRow>): PersonRow => ({
  id: "p1", contactId: "c1", roleProfileId: "rp1", roleKey: "client", roleLabel: "Client", kind: "client",
  name: "Alice Buyer", email: "alice@example.com", phone: "+15551110001", agency: null, ...over,
});
const people = [
  person({}),
  person({ id: "p2", contactId: "c2", roleKey: "buyer_agent", roleLabel: "Buyer Agent", kind: "agent", name: "Bob Agent", email: "bob@example.com", phone: "+15551110002" }),
];

const ALL = { ok: true, intent: "send-sms", error: undefined };
const PARTIAL = {
  ok: false, intent: "send-sms", error: undefined,
  delivery: { sent: 1, skipped: [{ recipient: "c1", reason: "no sms consent", outcome: "skipped" }] },
};
const NONE = {
  ok: false, intent: "send-sms", error: undefined,
  delivery: { sent: 0, skipped: [{ recipient: "c1", reason: "auth account AC999 does not exist", outcome: "failed" }, { recipient: "c2", reason: "No phone on file for this recipient", outcome: "skipped" }] },
};

describe.each([
  ["SendSmsModal", "send-sms", (f: Fetcher, onClose: () => void) => <SendSmsModal people={people} fetcher={f} onClose={onClose} />],
  ["SendReportModal", "send-report", (f: Fetcher, onClose: () => void) => <SendReportModal people={people} fetcher={f} onClose={onClose} />],
] as const)("%s", (_name, intent, ui) => {
  const withIntent = (d: Record<string, unknown>) => ({ ...d, intent });

  it("closes when everyone was reached", () => {
    const onClose = vi.fn();
    const { rerender } = render(ui(fetcherWith(undefined), onClose));
    rerender(ui(fetcherWith(withIntent(ALL)), onClose));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("partial: stays open, says who was reached and who was not, with the reason in words", () => {
    const onClose = vi.fn();
    const { rerender } = render(ui(fetcherWith(undefined), onClose));
    rerender(ui(fetcherWith(withIntent(PARTIAL)), onClose));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Reached 1 of 2.")).toBeTruthy();
    expect(screen.getByText("Alice Buyer")).toBeTruthy();
    expect(document.body.textContent).not.toContain("no sms consent");
    expect(document.body.textContent).toMatch(/hasn't agreed to receive texts/);
    // a person who was reached is not listed as not reached
    expect(screen.queryByText("Bob Agent")).toBeNull();
  });

  it("none reached, including a provider rejection: every person with a sentence, nothing raw", () => {
    const onClose = vi.fn();
    const { rerender } = render(ui(fetcherWith(undefined), onClose));
    rerender(ui(fetcherWith(withIntent(NONE)), onClose));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Nobody was reached.")).toBeTruthy();
    expect(screen.getByText("Alice Buyer")).toBeTruthy();
    expect(screen.getByText("Bob Agent")).toBeTruthy();
    expect(document.body.textContent).not.toContain("AC999");
    expect(document.body.textContent).not.toContain("No phone on file for this recipient");
  });

  it("Back returns to the form, Done closes", () => {
    const onClose = vi.fn();
    const { rerender } = render(ui(fetcherWith(undefined), onClose));
    rerender(ui(fetcherWith(withIntent(PARTIAL)), onClose));
    fireEvent.click(screen.getByText("Back"));
    expect(document.querySelector("form")).toBeTruthy();
    expect(screen.queryByText("Reached 1 of 2.")).toBeNull();
    rerender(ui(fetcherWith(withIntent(PARTIAL)), onClose));
    fireEvent.click(screen.getByText("Done"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Back after a partial send keeps only the people who were not reached ticked, so a second Send cannot repeat the first", () => {
    const { rerender } = render(ui(fetcherWith(undefined), vi.fn()));
    const box = (id: string) => document.querySelector<HTMLInputElement>(`[data-testid="${intent}-person-${id}"]`)!;
    for (const id of ["p1", "p2"]) if (!box(id).checked) fireEvent.click(box(id));
    expect([box("p1").checked, box("p2").checked]).toEqual([true, true]);
    rerender(ui(fetcherWith(withIntent(PARTIAL)), vi.fn()));
    fireEvent.click(screen.getByText("Back"));
    // Alice (c1) was skipped, Bob (c2) was reached
    expect(box("p1").checked).toBe(true);
    expect(box("p2").checked).toBe(false);
    const sent = JSON.parse(document.querySelector<HTMLInputElement>('input[name="recipients"]')!.value) as Array<{ contactId: string }>;
    expect(sent.map((r) => r.contactId)).toEqual(["c1"]);
  });

  it("control: when nobody was reached, Back keeps everybody ticked for the retry", () => {
    const { rerender } = render(ui(fetcherWith(undefined), vi.fn()));
    const box = (id: string) => document.querySelector<HTMLInputElement>(`[data-testid="${intent}-person-${id}"]`)!;
    for (const id of ["p1", "p2"]) if (!box(id).checked) fireEvent.click(box(id));
    rerender(ui(fetcherWith(withIntent(NONE)), vi.fn()));
    fireEvent.click(screen.getByText("Back"));
    expect([box("p1").checked, box("p2").checked]).toEqual([true, true]);
  });

  it("an error already on the fetcher when the dialog opens is not shown; one that arrives while it is open is", () => {
    const failed = withIntent({ ok: false, error: "Last time's failure text." });
    const { rerender } = render(ui(fetcherWith(failed), vi.fn()));
    expect(document.body.textContent).not.toContain("Last time's failure text.");
    rerender(ui(fetcherWith(withIntent({ ok: false, error: "This time's failure text." })), vi.fn()));
    expect(document.body.textContent).toContain("This time's failure text.");
  });

  it("a result already on the fetcher when the dialog opens is not shown", () => {
    render(ui(fetcherWith(withIntent(PARTIAL)), vi.fn()));
    expect(screen.queryByText("Reached 1 of 2.")).toBeNull();
    expect(document.querySelector("form")).toBeTruthy();
  });

  it("a request-level error (nothing was attempted) still shows its message in the form", () => {
    const { rerender } = render(ui(fetcherWith(undefined), vi.fn()));
    rerender(ui(fetcherWith(withIntent({ ok: false, error: "This report is not published." })), vi.fn()));
    expect(document.body.textContent).toContain("not published");
    expect(document.querySelector("form")).toBeTruthy();
  });
});
