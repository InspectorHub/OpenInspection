import { useCallback, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { RoleProfile } from "~/components/contacts/contacts-helpers";
import type { TeamMember } from "~/components/inspector-portal/ScheduleCard";
import type { loader } from "~/routes/resources/hub-pickers";

export type PickerStatus = "idle" | "loading" | "ready" | "error";
export interface PickerList<T> { status: PickerStatus; data: T[] }

const EMPTY: never[] = [];

/**
 * The inspection page's picker lists (inspectors, role profiles, referral
 * sources), fetched on first use rather than with the page.
 *
 * `request()` starts the one read, once; `retry()` starts it again after a
 * failure. Each list has its own status: `ready` means the read worked (an empty
 * `data` then means there really are none), `error` means it could not be read,
 * and `idle` / `loading` mean it has not arrived. The resource route answers every
 * failure as null (it never throws, because a throwing fetcher would replace the
 * page with its error boundary), so there is no separate transport-error state. Never treat anything but
 * `ready` as an answer, and never enable a control that writes on the strength
 * of a list that is not `ready`.
 */
export function useHubPickers() {
  const fetcher = useFetcher<typeof loader>();
  const [asked, setAsked] = useState(false);
  const askedRef = useRef(false);

  const start = useCallback(() => {
    askedRef.current = true;
    setAsked(true);
    fetcher.load("/resources/hub-pickers");
  }, [fetcher]);
  const request = useCallback(() => {
    if (!askedRef.current) start();
  }, [start]);
  const retry = useCallback(() => start(), [start]);

  const pick = <T,>(value: T[] | null | undefined): PickerList<T> => {
    if (!asked) return { status: "idle", data: EMPTY };
    if (fetcher.data !== undefined) return value ? { status: "ready", data: value } : { status: "error", data: EMPTY };
    return { status: "loading", data: EMPTY };
  };

  return {
    members: pick<TeamMember>(fetcher.data?.members),
    roleProfiles: pick<RoleProfile>(fetcher.data?.roleProfiles),
    referralSources: pick<string>(fetcher.data?.referralSources),
    request,
    retry,
  };
}
