import { describe, it, expect } from "vitest";
import { keepNotReached } from "~/lib/send-delivery";
import type { PersonRow } from "~/components/inspection/PeopleEditor";

const p = (id: string, over: Partial<PersonRow> = {}): PersonRow => ({
  id, contactId: `c-${id}`, roleProfileId: "rp", roleKey: "client", roleLabel: "Client", kind: "client",
  name: id, email: `${id}@example.com`, phone: `+1555000${id.length}${id}`, agency: null, ...over,
});
const people = [p("a"), p("b"), p("c")];
const anyone = () => true;
const outcome = (...recipients: string[]) => ({ sent: 3 - recipients.length, skipped: recipients.map((recipient) => ({ recipient, reason: "x" })) });

describe("keepNotReached", () => {
  it("keeps ticked people the send skipped, whichever way the route named them (contact id, address, number)", () => {
    const all = new Set(["a", "b", "c"]);
    expect([...keepNotReached(all, outcome("c-a"), people, anyone)]).toEqual(["a"]);
    expect([...keepNotReached(all, outcome("b@example.com"), people, anyone)]).toEqual(["b"]);
    expect([...keepNotReached(all, outcome(people[2]!.phone!), people, anyone)]).toEqual(["c"]);
  });
  it("never adds a person who was not ticked", () => {
    expect([...keepNotReached(new Set(["a"]), outcome("c-a", "c-b"), people, anyone)]).toEqual(["a"]);
  });
  it("control: no outcome, or nobody skipped, leaves the selection as it was; a skip it cannot place drops everyone", () => {
    const sel = new Set(["a", "b"]);
    expect([...keepNotReached(sel, null, people, anyone)]).toEqual(["a", "b"]);
    expect([...keepNotReached(sel, { sent: 2, skipped: [] }, people, anyone)]).toEqual(["a", "b"]);
    expect([...keepNotReached(sel, outcome("someone-else"), people, anyone)]).toEqual([]);
  });
  it("drops a skipped person who cannot receive the message at all, so no ticked row is greyed out", () => {
    const noEmail = [p("a"), p("b", { email: null }), p("c")];
    const all = new Set(["a", "b", "c"]);
    const skipped = outcome("c-a", "c-b");
    expect([...keepNotReached(all, skipped, noEmail, (x) => !!x.email)]).toEqual(["a"]);
    // control: the same outcome with no such rule keeps the person, which is the defect
    expect([...keepNotReached(all, skipped, noEmail, anyone)]).toEqual(["a", "b"]);
  });
});
