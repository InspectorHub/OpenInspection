// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { useHubPickers } from "~/hooks/useHubPickers";

type Payload = { members: unknown[] | null; roleProfiles: unknown[] | null; referralSources: string[] | null };
let replies: Array<() => Promise<Payload> | Payload> = [];
let loads = 0;

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

function mount() {
  const Stub = createRoutesStub([
    { path: "/", Component: Probe },
    {
      path: "/resources/hub-pickers",
      loader: async () => {
        const reply = replies[Math.min(loads, replies.length - 1)]!;
        loads += 1;
        return await reply();
      },
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

beforeEach(() => {
  loads = 0;
  replies = [];
});

const text = (id: string) => screen.getByTestId(id).textContent;

describe("useHubPickers", () => {
  it("reads nothing until a picker is asked for", async () => {
    replies = [() => ({ members: [{ id: "u" }], roleProfiles: [], referralSources: ["Realtor"] })];
    mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(loads).toBe(0);
    expect(text("members")).toBe("idle:0");
  });

  it("loads once on the first request, shows loading, then ready with the data", async () => {
    let release: (p: Payload) => void = () => {};
    replies = [() => new Promise<Payload>((res) => { release = res; })];
    mount();
    fireEvent.click(screen.getByText("request"));
    fireEvent.click(screen.getByText("request"));
    await waitFor(() => expect(text("members")).toBe("loading:0"));
    release({ members: [{ id: "u" }], roleProfiles: [{ id: "r" }, { id: "s" }], referralSources: ["Realtor"] });
    await waitFor(() => expect(text("members")).toBe("ready:1"));
    expect(text("roles")).toBe("ready:2");
    expect(text("referrals")).toBe("ready:1");
    expect(loads).toBe(1);
  });

  it("a list that failed is an error, not an empty ready list, and the others stay usable", async () => {
    replies = [() => ({ members: null, roleProfiles: [], referralSources: ["Realtor"] })];
    mount();
    fireEvent.click(screen.getByText("request"));
    await waitFor(() => expect(text("members")).toBe("error:0"));
    expect(text("roles")).toBe("ready:0");
    expect(text("referrals")).toBe("ready:1");
  });

  it("retry asks again after a list failed, and the new answer replaces the error", async () => {
    replies = [() => ({ members: null, roleProfiles: null, referralSources: null }), () => ({ members: [{ id: "u" }], roleProfiles: [], referralSources: [] })];
    mount();
    fireEvent.click(screen.getByText("request"));
    await waitFor(() => expect(text("members")).toBe("error:0"));
    expect(text("roles")).toBe("error:0");
    fireEvent.click(screen.getByText("retry"));
    await waitFor(() => expect(text("members")).toBe("ready:1"));
    expect(loads).toBe(2);
  });
});
