import { useCallback, useRef } from "react";
import type { useFetcher } from "react-router";

const DEFAULT_UNIT = "_default";

/** Build a composite key: `unitId:sectionId:itemId` */
export function findingKey(
  unitId: string | null,
  sectionId: string,
  itemId: string,
): string {
  return `${unitId || DEFAULT_UNIT}:${sectionId}:${itemId}`;
}

/**
 * Client-side hook for reading / writing inspection findings.
 *
 * Mutations are submitted through a Remix `useFetcher` so they go through the
 * route action (BFF pattern) rather than calling the API directly from the
 * browser.
 */
export function useFindings(
  results: Record<string, unknown>,
  setResults: (
    fn: (prev: Record<string, unknown>) => Record<string, unknown>,
  ) => void,
  fetcher: ReturnType<typeof useFetcher>,
) {
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const getResult = useCallback(
    (sectionId: string, itemId: string) => {
      const key = findingKey(null, sectionId, itemId);
      return (
        (results[key] as Record<string, unknown>) ||
        (results[itemId] as Record<string, unknown>) ||
        {}
      );
    },
    [results],
  );

  const debouncedSubmit = useCallback(
    (data: Record<string, string>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        fetcher.submit(data, { method: "POST" });
      }, 500);
    },
    [fetcher],
  );

  const setRating = useCallback(
    (sectionId: string, itemId: string, rating: string) => {
      const key = findingKey(null, sectionId, itemId);
      setResults((prev) => ({
        ...prev,
        [key]: {
          ...((prev[key] as Record<string, unknown>) || {}),
          ...((prev[itemId] as Record<string, unknown>) || {}),
          rating,
        },
      }));
      debouncedSubmit({ intent: "rate", itemId, sectionId, rating });
    },
    [setResults, debouncedSubmit],
  );

  const setNotes = useCallback(
    (sectionId: string, itemId: string, notes: string) => {
      const key = findingKey(null, sectionId, itemId);
      setResults((prev) => ({
        ...prev,
        [key]: {
          ...((prev[key] as Record<string, unknown>) || {}),
          ...((prev[itemId] as Record<string, unknown>) || {}),
          notes,
        },
      }));
      debouncedSubmit({ intent: "notes", itemId, sectionId, notes });
    },
    [setResults, debouncedSubmit],
  );

  return { getResult, setRating, setNotes };
}
