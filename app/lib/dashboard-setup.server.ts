/**
 * The onboarding checklist's inputs on the dashboard.
 *
 * The checklist needs three facts: how many templates and services the company
 * has, and whether a schedule is set (a dismissed checklist still shows its
 * progress in one collapsed row, so they are always needed). The counts need no
 * list: the smallest page carries the total in its meta, and the service
 * catalogue is short. The wizard's own lists are not read here.
 *
 * Every read is best-effort and bounded. A failure or a stall reads as "not
 * done yet", which is the checklist's safe default (the person can still
 * dismiss it), and never delays or fails the page.
 */
import type { createApi } from "~/lib/api-client.server";
import { settled } from "~/lib/concurrency";
import { getScheduleSet } from "~/lib/schedule-onboarding.server";

type Api = ReturnType<typeof createApi>;

/**
 * The smallest page the list routes accept. The shared pagination schema only
 * allows 12, 25, 50 or 100; any other value is a 400, which the best-effort
 * read below would swallow and report as "no templates".
 */
export const SMALLEST_PAGE_SIZE = "12";

/** How long the dashboard waits for these before rendering without them. */
const CHECKLIST_INPUT_TIMEOUT_MS = 2000;

export interface ChecklistInputs {
  templateCount: number;
  serviceCount: number;
  scheduleSet: boolean;
}

export async function loadChecklistInputs(api: Api): Promise<ChecklistInputs> {
  const opts = { timeoutMs: CHECKLIST_INPUT_TIMEOUT_MS };
  const [templateCount, serviceCount, scheduleSet] = await Promise.all([
    settled(async () => {
      const res = await api.inspections.templates.$get({ query: { page: "1", pageSize: SMALLEST_PAGE_SIZE } });
      if (!res.ok) return 0;
      const body = (await res.json()) as { data?: unknown[]; meta?: { total?: number } };
      return body.meta?.total ?? body.data?.length ?? 0;
    }, { ...opts, fallback: 0, label: "dashboard template count" }),
    settled(async () => {
      const res = await api.services.index.$get();
      if (!res.ok) return 0;
      const body = (await res.json()) as { data?: unknown[] };
      return Array.isArray(body.data) ? body.data.length : 0;
    }, { ...opts, fallback: 0, label: "dashboard service count" }),
    settled(() => getScheduleSet(api), { ...opts, fallback: false, label: "dashboard schedule" }),
  ]);
  return { templateCount, serviceCount, scheduleSet };
}
