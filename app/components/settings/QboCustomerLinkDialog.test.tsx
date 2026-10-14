// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent, within } from "@testing-library/react";
import {
  QboCustomerLinkDialog,
  type CustomerLinkResult,
  type CustomerSearchFailure,
  type CustomerSearchRow,
} from "./QboCustomerLinkDialog";

afterEach(cleanup);

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

function row(over: Partial<CustomerSearchRow> = {}): CustomerSearchRow {
  return {
    id: "58", displayName: "Amy's Bird Sanctuary", companyName: "Amy's Birds LLC", email: "amy@birds.test",
    linkedContactId: null, linkedContactName: null, ...over,
  };
}

type Props = React.ComponentProps<typeof QboCustomerLinkDialog>;

function view(over: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    contact: { id: "c-1", name: "Pat Smith" },
    currentLink: null,
    onClose: vi.fn(),
    onLinked: vi.fn(),
    search: vi.fn(async () => [row()]),
    link: vi.fn(async (): Promise<CustomerLinkResult> => ({ ok: true, displayName: "Amy's Bird Sanctuary" })),
    ...over,
  };
  const utils = render(<QboCustomerLinkDialog {...props} />);
  return { ...utils, props, rerenderWith: (next: Partial<Props>) => utils.rerender(<QboCustomerLinkDialog {...props} {...next} />) };
}

const input = () => screen.getByLabelText("Search QuickBooks customers") as HTMLInputElement;
const searchButton = () => screen.getByRole("button", { name: "Search" });

function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
}

async function searchFor(text: string) {
  type(text);
  await act(async () => { fireEvent.submit(input().closest("form")!); });
  await settle();
}

async function pick(name: RegExp | string) {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
}

describe("QboCustomerLinkDialog - searching", () => {
  it("searches only on an explicit submit, once, with the trimmed text", async () => {
    const { props } = view();
    type("  amy  ");
    // Typing alone sends nothing (control for the submit below).
    await settle();
    expect(props.search).not.toHaveBeenCalled();

    await act(async () => { fireEvent.submit(input().closest("form")!); });
    await settle();
    expect(props.search).toHaveBeenCalledTimes(1);
    expect(props.search).toHaveBeenCalledWith("amy");
  });

  it("disables Search under two characters and enables it at two", () => {
    view();
    type("a");
    expect(searchButton()).toBeDisabled();
    type("am");
    expect(searchButton()).toBeEnabled();
  });

  it("does not search from Enter under two characters", async () => {
    const { props } = view();
    await searchFor("a");
    expect(props.search).not.toHaveBeenCalled();
    await searchFor("am");
    expect(props.search).toHaveBeenCalledTimes(1);
  });

  it("sends one request when the form is submitted twice in the same frame", async () => {
    let finish!: (rows: CustomerSearchRow[]) => void;
    const search = vi.fn(() => new Promise<CustomerSearchRow[]>((r) => { finish = r; }));
    view({ search });
    type("amy");
    const form = input().closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(search).toHaveBeenCalledTimes(1);
    await act(async () => { finish([row()]); });
    await settle();
    // Control: once the first answer is in, a new submit goes through.
    await searchFor("amy");
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("on a rate-limited answer shows the wait message and keeps the earlier results", async () => {
    const search = vi.fn<(q: string) => Promise<CustomerSearchRow[] | { error: CustomerSearchFailure }>>()
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce({ error: "rate_limited" });
    view({ search });
    await searchFor("amy");
    expect(screen.getByRole("button", { name: /Amy's Bird Sanctuary/ })).toBeInTheDocument();
    // Control: no message while the search is succeeding.
    expect(screen.queryByText("Too many searches. Wait a minute and try again.")).not.toBeInTheDocument();

    await searchFor("amy");
    expect(screen.getByRole("alert")).toHaveTextContent("Too many searches. Wait a minute and try again.");
    expect(screen.getByRole("button", { name: /Amy's Bird Sanctuary/ })).toBeInTheDocument();
  });

  it("says when nothing matched (control: not shown before a search)", async () => {
    view({ search: vi.fn(async () => []) });
    expect(screen.queryByText("No active QuickBooks customers match that search.")).not.toBeInTheDocument();
    await searchFor("zzz");
    expect(screen.getByText("No active QuickBooks customers match that search.")).toBeInTheDocument();
  });

  it("tells the person when this contact already has a match", () => {
    view({ currentLink: { qboCustomerId: "9", displayName: "Old Customer Inc." } });
    expect(screen.getByText(/Currently matched to Old Customer Inc\./)).toBeInTheDocument();
  });
});

describe("QboCustomerLinkDialog - results", () => {
  const rows = [
    row(),
    row({ id: "59", displayName: "Taken Co", companyName: null, email: null, linkedContactId: "c-9", linkedContactName: "Lee Park" }),
  ];

  it("shows display name, company and email on each row", async () => {
    view({ search: vi.fn(async () => rows) });
    await searchFor("amy");
    const free = screen.getByRole("button", { name: /Amy's Bird Sanctuary/ });
    expect(free).toHaveTextContent("Amy's Birds LLC");
    expect(free).toHaveTextContent("amy@birds.test");
  });

  it("greys out a customer already matched to another contact and names that contact", async () => {
    view({ search: vi.fn(async () => rows) });
    await searchFor("amy");
    const taken = screen.getByRole("button", { name: /Taken Co/ });
    expect(taken).toBeDisabled();
    expect(taken).toHaveTextContent("Already matched to Lee Park");
    // Control: the free row is selectable and says nothing of the kind.
    const free = screen.getByRole("button", { name: /Amy's Bird Sanctuary/ });
    expect(free).toBeEnabled();
    expect(free).not.toHaveTextContent("Already matched");
  });

  it("does not move to the confirmation when a greyed-out row is pressed", async () => {
    view({ search: vi.fn(async () => rows) });
    await searchFor("amy");
    await pick(/Taken Co/);
    expect(screen.queryByRole("button", { name: "Match contact" })).not.toBeInTheDocument();
    await pick(/Amy's Bird Sanctuary/);
    expect(screen.getByRole("button", { name: "Match contact" })).toBeInTheDocument();
  });
});

describe("QboCustomerLinkDialog - confirming", () => {
  it("explains that edits will now update the QuickBooks customer, and links nothing until confirmed", async () => {
    const { props } = view();
    await searchFor("amy");
    await pick(/Amy's Bird Sanctuary/);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "From now on, editing this contact in OpenInspection updates this QuickBooks customer's name, email and phone.",
    );
    expect(dialog).toHaveTextContent("Match Pat Smith to Amy's Bird Sanctuary?");
    expect(props.link).not.toHaveBeenCalled();

    await act(async () => { screen.getByRole("button", { name: "Match contact" }).click(); });
    await settle();
    expect(props.link).toHaveBeenCalledTimes(1);
    expect(props.link).toHaveBeenCalledWith("58");
    expect(props.onLinked).toHaveBeenCalledWith({ qboCustomerId: "58", displayName: "Amy's Bird Sanctuary" });
  });

  it("goes back to the results without linking", async () => {
    const { props } = view();
    await searchFor("amy");
    await pick(/Amy's Bird Sanctuary/);
    await act(async () => { screen.getByRole("button", { name: "Back" }).click(); });
    expect(screen.getByRole("button", { name: /Amy's Bird Sanctuary/ })).toBeInTheDocument();
    expect(props.link).not.toHaveBeenCalled();
  });
});

describe("QboCustomerLinkDialog - refusals", () => {
  async function refuse(result: CustomerLinkResult) {
    const utils = view({ link: vi.fn(async () => result) });
    await searchFor("amy");
    await pick(/Amy's Bird Sanctuary/);
    await act(async () => { screen.getByRole("button", { name: "Match contact" }).click(); });
    await settle();
    return utils;
  }
  const alertText = () => screen.getByRole("alert").textContent ?? "";

  it("names the holder when the customer is taken", async () => {
    const { props } = await refuse({ ok: false, reason: "taken", holderName: "Lee Park" });
    expect(alertText()).toContain("Lee Park is already matched to this QuickBooks customer");
    expect(alertText()).not.toContain("archived");
    expect(props.onLinked).not.toHaveBeenCalled();
  });

  it("sends the person to the archived holder's page to remove the match", async () => {
    await refuse({ ok: false, reason: "taken", holderName: "Lee Park", holderArchived: true });
    expect(alertText()).toContain("Lee Park is archived but is still matched");
    expect(alertText()).toContain("Open that contact's page and remove the match there");
  });

  it("gives each other reason its own wording", async () => {
    const texts = new Set<string>();
    for (const reason of ["inactive", "not_connected", "other"] as const) {
      cleanup();
      await refuse({ ok: false, reason });
      texts.add(alertText());
    }
    expect(texts.size).toBe(3);
    const [inactive, notConnected, other] = [...texts];
    expect(inactive).toContain("inactive");
    expect(notConnected).toContain("not connected");
    expect(other).toContain("could not be saved");
  });

  it("never shows a raw error body", async () => {
    const withBody = { ok: false, reason: "other", message: "<Fault>Stale object</Fault>" } as CustomerLinkResult;
    await refuse(withBody);
    expect(alertText()).not.toContain("Fault");
    // Control: the fixed wording is there.
    expect(alertText()).toContain("could not be saved");
  });

  it("uses no word the wording rules rule out", async () => {
    await refuse({ ok: false, reason: "taken", holderName: "Lee Park" });
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).not.toMatch(/\blink(ed)?\b|workspace|tenant|platform/i);
    expect(text).toContain("matched");
  });
});

describe("QboCustomerLinkDialog - double click", () => {
  it("links once when the confirm button is clicked twice in one frame", async () => {
    let finish!: (r: CustomerLinkResult) => void;
    const link = vi.fn(() => new Promise<CustomerLinkResult>((r) => { finish = r; }));
    view({ link });
    await searchFor("amy");
    await pick(/Amy's Bird Sanctuary/);
    const confirm = screen.getByRole("button", { name: "Match contact" });
    await act(async () => { confirm.click(); confirm.click(); });
    expect(link).toHaveBeenCalledTimes(1);

    // Control: after the first attempt fails, a new selection can submit again.
    await act(async () => { finish({ ok: false, reason: "other" }); });
    await settle();
    await act(async () => { screen.getByRole("button", { name: "Back" }).click(); });
    await pick(/Amy's Bird Sanctuary/);
    await act(async () => { screen.getByRole("button", { name: "Match contact" }).click(); });
    expect(link).toHaveBeenCalledTimes(2);
  });
});

describe("QboCustomerLinkDialog - closing", () => {
  it("resets the search, results and confirmation when it closes", async () => {
    const { rerenderWith } = view();
    await searchFor("amy");
    await pick(/Amy's Bird Sanctuary/);
    expect(screen.getByRole("button", { name: "Match contact" })).toBeInTheDocument();

    rerenderWith({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerenderWith({ open: true });
    await settle();

    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Match contact" })).not.toBeInTheDocument();
    expect(input().value).toBe("");
    expect(screen.queryByRole("button", { name: /Amy's Bird Sanctuary/ })).not.toBeInTheDocument();
  });

  it("ignores an answer that arrives after the dialog was closed", async () => {
    let finish!: (rows: CustomerSearchRow[]) => void;
    const search = vi.fn(() => new Promise<CustomerSearchRow[]>((r) => { finish = r; }));
    const { rerenderWith } = view({ search });
    type("amy");
    await act(async () => { fireEvent.submit(input().closest("form")!); });
    rerenderWith({ open: false });
    rerenderWith({ open: true });
    await act(async () => { finish([row()]); });
    await settle();
    expect(screen.queryByRole("button", { name: /Amy's Bird Sanctuary/ })).not.toBeInTheDocument();
  });

  it("shows the same answer when the dialog was not closed (control for the case above)", async () => {
    let finish!: (rows: CustomerSearchRow[]) => void;
    const search = vi.fn(() => new Promise<CustomerSearchRow[]>((r) => { finish = r; }));
    view({ search });
    type("amy");
    await act(async () => { fireEvent.submit(input().closest("form")!); });
    await act(async () => { finish([row()]); });
    await settle();
    expect(screen.getByRole("button", { name: /Amy's Bird Sanctuary/ })).toBeInTheDocument();
  });
});
