import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { HeatmapDay } from "~/components/settings/AvailabilityHeatmapWeek";

/**
 * Loads the availability strip for a visible week.
 *
 * The calendar holds its visible week in client state, so the page loader
 * cannot know which week to summarize; this reads through a BFF resource route
 * instead. Pass `enabled: false` for views that render no strip.
 */
export function useWeekSummary({
  weekStart,
  userId,
  enabled,
}: {
  weekStart: string;
  userId?: string;
  enabled: boolean;
}): HeatmapDay[] {
  const fetcher = useFetcher<{ days: HeatmapDay[] }>();

  useEffect(() => {
    if (!enabled) return;
    const params = new URLSearchParams({ start: weekStart });
    if (userId) params.set("userId", userId);
    fetcher.load(`/resources/week-summary?${params.toString()}`);
  // fetcher is stable across renders — intentionally omitted per RR convention.
  }, [enabled, weekStart, userId]);

  return fetcher.data?.days ?? [];
}
