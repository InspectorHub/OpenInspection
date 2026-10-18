import { useCallback, useRef, useState } from "react";
import type { RoleProfile } from "~/components/contacts/contacts-helpers";
import type { TeamMember } from "~/components/inspector-portal/ScheduleCard";
import type { HubPickers } from "~/routes/resources/hub-pickers";

type PickerStatus = "idle" | "loading" | "ready" | "error";
export interface PickerList<T> { status: PickerStatus; data: T[] }

const EMPTY: never[] = [];

type Phase = { kind: "idle" } | { kind: "loading" } | { kind: "failed" } | { kind: "done"; data: HubPickers };

/**
 * The inspection page's picker lists (inspectors, role profiles, referral
 * sources), fetched on first use rather than with the page.
 *
 * `request()` starts the one read, once; `retry()` starts it again after a
 * failure. Each list has its own status: `ready` means the read worked (an empty
 * `data` then means there really are none), `error` means it could not be read,
 * and `idle` / `loading` mean it has not arrived. Never treat anything but
 * `ready` as an answer, and never enable a control that writes on the strength
 * of a list that is not `ready`.
 *
 * It uses a plain same-origin `fetch` of resources/hub-pickers (which answers
 * JSON), not a router fetcher: a fetcher whose request fails (dropped connection,
 * a response that is not data) hands the error to the nearest error boundary,
 * which would replace the whole page and any unsaved edits. Here every failure,
 * including a network error or a non-JSON answer, is the `error` status.
 */
export function useHubPickers() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const asked = useRef(false);
  // A retry started while an older request is still in flight must win.
  const generation = useRef(0);

  const start = useCallback(() => {
    asked.current = true;
    const mine = ++generation.current;
    setPhase({ kind: "loading" });
    void (async () => {
      try {
        const res = await fetch("/resources/hub-pickers", { headers: { accept: "application/json" }, credentials: "same-origin" });
        if (!res.ok) throw new Error(`hub-pickers ${res.status}`);
        const data = (await res.json()) as HubPickers;
        if (mine === generation.current) setPhase({ kind: "done", data });
      } catch {
        if (mine === generation.current) setPhase({ kind: "failed" });
      }
    })();
  }, []);
  const request = useCallback(() => {
    if (!asked.current) start();
  }, [start]);

  const pick = <T,>(value: T[] | null | undefined): PickerList<T> => {
    if (phase.kind === "idle") return { status: "idle", data: EMPTY };
    if (phase.kind === "loading") return { status: "loading", data: EMPTY };
    if (phase.kind === "failed" || !value) return { status: "error", data: EMPTY };
    return { status: "ready", data: value };
  };
  const data = phase.kind === "done" ? phase.data : null;

  return {
    members: pick<TeamMember>(data?.members),
    roleProfiles: pick<RoleProfile>(data?.roleProfiles),
    referralSources: pick<string>(data?.referralSources),
    request,
    retry: start,
  };
}
