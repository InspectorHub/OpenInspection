import { useMemo, useState, useEffect, useCallback } from "react";
import { rankTypeaheadMatches, type TypeaheadEntry } from "../lib/comment-typeahead";

export function useCommentTypeahead(
  entries: TypeaheadEntry[],
  query: string,
  opts?: { max?: number },
) {
  const max = opts?.max ?? 8;
  const matches = useMemo(
    () => rankTypeaheadMatches(entries, query).slice(0, max),
    [entries, query, max],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset highlight whenever the candidate set changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, matches.length]);

  const move = useCallback(
    (delta: number) => {
      setSelectedIndex((i) => {
        const n = matches.length;
        if (n === 0) return 0;
        return ((i + delta) % n + n) % n;
      });
    },
    [matches.length],
  );

  const current = useCallback(
    () => matches[selectedIndex] ?? null,
    [matches, selectedIndex],
  );

  return { matches, selectedIndex, setSelectedIndex, move, current };
}
