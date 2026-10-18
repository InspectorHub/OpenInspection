// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useHubPickers } from "~/hooks/useHubPickers";

type Payload = { members: unknown[] | null; roleProfiles: unknown[] | null; referralSources: string[] | null };
let replies: Array<() => Promise<Response> | Response> = [];
let loads = 0;
const json = (p: Payload) => new Response(JSON.stringify(p), { status: 200, headers: { "content-type": "application/json" } });

function Probe() {
  const p = useHubPickers();
  return (
    <div>
      <p data-testid="members">{p.members.status}:{p.members.data.length}</p>
      <p data-testid="roles">{p.roleProfiles.status}:{p.roleProfiles.data.length}</p>
      <p data-testid="referrals">{p.referralSources.status}:{p.referralSources.data.length}</p>
      <button onClick={p.request}>request</button>
      <button onClick={p.retry}>retry</button>
    </div>
  );
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  loads = 0;
  replies = [];
  globalThis.fetch = vi.fn(async () => {
    const reply = replies[Math.min(loads, replies.length - 1)]!;
    loads += 1;
    return await reply();
  }) as never;
});
afterEach(() => { globalThis.fetch = realFetch; });

const text = (id: string) => screen.getByTestId(id).textContent;

describe("useHubPickers", () => {
  it("reads nothing until a picker is asked for", async () => {
    replies = [() => json({ members: [{ id: "u" }], roleProfiles: [], referralSources: ["Realtor"] })];
    render(<Probe />);
    await new Promise((r) => setTimeout(r, 30));
    expect(loads).toBe(0);
    expect(text("members")).toBe("idle:0");
  });

  it("loads once on the first request, shows loading, then ready with the data", async () => {
    let release: (r: Response) => void = () => {};
    replies = [() => new Promise<Response>((res) => { release = res; })];
    render(<Probe />);
    fireEvent.click(screen.getByText("request"));
    fireEvent.click(screen.getByText("request"));
    await waitFor(() => expect(text("members")).toBe("loading:0"));
    release(json({ members: [{ id: "u" }], roleProfiles: [{ id: "r" }, { id: "s" }], referralSources: ["Realtor"] }));
    await waitFor(() => expect(text("members")).toBe("ready:1"));
    expect(text("roles")).toBe("ready:2");
    expect(text("referrals")).toBe("ready:1");
    expect(loads).toBe(1);
  });

  it("a list that failed is an error, not an empty ready list, and the others stay usable", async () => {
    replies = [() => json({ members: null, roleProfiles: [], referralSources: ["Realtor"] })];
    render(<Probe />);
    fireEvent.click(screen.getByText("request"));
    await waitFor(() => expect(text("members")).toBe("error:0"));
    expect(text("roles")).toBe("ready:0");
    expect(text("referrals")).toBe("ready:1");
  });

  it("a request that fails outright (network error, non-OK, non-JSON) is an error, never a thrown error; retry recovers", async () => {
    for (const bad of [
      () => { throw new TypeError("network down"); },
      () => new Response("nope", { status: 500 }),
      () => new Response("<html>not json</html>", { status: 200 }),
    ]) {
      loads = 0;
      replies = [bad, () => json({ members: [{ id: "u" }], roleProfiles: [], referralSources: [] })];
      const { unmount } = render(<Probe />);
      fireEvent.click(screen.getByText("request"));
      await waitFor(() => expect(text("members")).toBe("error:0"));
      expect(text("roles")).toBe("error:0");
      fireEvent.click(screen.getByText("retry"));
      await waitFor(() => expect(text("members")).toBe("ready:1"));
      expect(loads).toBe(2);
      unmount();
    }
  });

  it("an older request that answers after a retry does not overwrite the newer answer", async () => {
    let releaseFirst: (r: Response) => void = () => {};
    replies = [() => new Promise<Response>((res) => { releaseFirst = res; }), () => json({ members: [{ id: "new" }], roleProfiles: [], referralSources: [] })];
    render(<Probe />);
    fireEvent.click(screen.getByText("request"));
    fireEvent.click(screen.getByText("retry"));
    await waitFor(() => expect(text("members")).toBe("ready:1"));
    releaseFirst(json({ members: [{ id: "a" }, { id: "b" }, { id: "c" }], roleProfiles: [], referralSources: [] }));
    await new Promise((r) => setTimeout(r, 30));
    expect(text("members")).toBe("ready:1");
  });
});
