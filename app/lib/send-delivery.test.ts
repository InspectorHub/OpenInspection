import { describe, it, expect } from "vitest";
import { keepNotReached } from "~/lib/send-delivery";
import type { PersonRow } from "~/components/inspection/PeopleEditor";

const p = (id: string, over: Partial<PersonRow> = {}): PersonRow => ({
  id, contactId: `c-${id}`, roleProfileId: "rp", roleKey: "client", roleLabel: "Client", kind: "client",
  name: id, email: `${id}@example.com`, phone: `+1555000${id.length}${id}`, agency: null, ...over,
});
const people = [p("a"), p("b"), p("c")];
const outcome = (...recipients: string[]) => ({ sent: 3 - recipients.length, skipped: recipients.map((recipient) => ({ recipient, reason: "x" })) });

describe("keepNotReached", () => {
  it("keeps ticked people the send skipped, whichever way the route named them (contact id, address, number)", () => {
    const all = new Set(["a", "b", "c"]);
    expect([...keepNotReached(all, outcome("c-a"), people)]).toEqual(["a"]);
    expect([...keepNotReached(all, outcome("b@example.com"), people)]).toEqual(["b"]);
    expect([...keepNotReached(all, outcome(people[2]!.phone!), people)]).toEqual(["c"]);
  });
  it("never adds a person who was not ticked", () => {
    expect([...keepNotReached(new Set(["a"]), outcome("c-a", "c-b"), people)]).toEqual(["a"]);
  });
  it("control: no outcome, or nobody skipped, leaves the selection as it was; a skip it cannot place drops everyone", () => {
    const sel = new Set(["a", "b"]);
    expect([...keepNotReached(sel, null, people)]).toEqual(["a", "b"]);
    expect([...keepNotReached(sel, { sent: 2, skipped: [] }, people)]).toEqual(["a", "b"]);
    expect([...keepNotReached(sel, outcome("someone-else"), people)]).toEqual([]);
  });
});
