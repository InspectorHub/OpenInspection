import { useCallback } from "react";
import { fKey } from "../useInspection";
import type { FindingsContext } from "./shared";

/**
 * Canned-comment slice: toggle a canned comment on/off, patch a defect's
 * structured fields (location / trade / deadline / timeframe), and insert a
 * comment from the library into the notes textarea.
 */
export function useFindingsCanned(ctx: FindingsContext) {
  const { setResults, fetcher, setDirty, tryEnqueueOffline } = ctx;

  /* ---------------------------------------------------------------- */
  /*  Canned comment toggling                                          */
  /* ---------------------------------------------------------------- */

  const toggleCannedComment = useCallback(
    (
      sectionId: string,
      itemId: string,
      tabName: string,
      cannedId: string,
      included: boolean,
    ) => {
      const key = fKey(sectionId, itemId);
      setResults((prev) => {
        const existing =
          (prev[key] as Record<string, unknown>) || {};
        const existingTabs =
          (existing.tabs as Record<
            string,
            Array<{ cannedId: string; included: boolean }>
          >) || {};
        const tabEntries = [...(existingTabs[tabName] || [])];
        const idx = tabEntries.findIndex((e) => e.cannedId === cannedId);
        if (idx >= 0) {
          tabEntries[idx] = { ...tabEntries[idx], included };
        } else {
          tabEntries.push({ cannedId, included });
        }
        const updated = {
          ...existing,
          tabs: { ...existingTabs, [tabName]: tabEntries },
        };
        return {
          ...prev,
          [key]: updated,
          [itemId]: updated,
        };
      });
      if (
        !tryEnqueueOffline("toggle-canned", itemId, `canned:${tabName}:${cannedId}`, {
          tabName,
          cannedId,
          included,
          sectionId,
        })
      ) {
        fetcher.submit(
          {
            intent: "toggle-canned",
            itemId,
            sectionId,
            tabName,
            cannedId,
            included: String(included),
          },
          { method: "POST" },
        );
      }
      setDirty(true);
    },
    [setResults, fetcher, setDirty, tryEnqueueOffline],
  );

  /* ---------------------------------------------------------------- */
  /*  Defect structured fields (location / trade / deadline / timeframe) */
  /* ---------------------------------------------------------------- */

  const setDefectFields = useCallback(
    (
      sectionId: string,
      itemId: string,
      cannedId: string,
      patch: { location?: string | null; trade?: string | null; deadline?: string | null; timeframe?: string | null },
    ) => {
      const key = fKey(sectionId, itemId);
      setResults((prev) => {
        const existing = (prev[key] as Record<string, unknown>) || {};
        const existingTabs = (existing.tabs as Record<string, Array<Record<string, unknown>>>) || {};
        const defects = [...(existingTabs.defects || [])];
        const idx = defects.findIndex((d) => d.cannedId === cannedId);
        const next: Record<string, unknown> =
          idx >= 0 ? { ...defects[idx] } : { cannedId, included: true };
        if ("location"  in patch) next.location  = patch.location;
        if ("trade"     in patch) next.trade     = patch.trade;
        if ("deadline"  in patch) next.deadline  = patch.deadline;
        if ("timeframe" in patch) next.timeframe = patch.timeframe;
        if (idx >= 0) defects[idx] = next;
        else defects.push(next);
        const updated = { ...existing, tabs: { ...existingTabs, defects } };
        return { ...prev, [key]: updated, [itemId]: updated };
      });
      if (
        !tryEnqueueOffline("set-defect-fields", itemId, `defect-fields:${cannedId}`, {
          cannedId,
          sectionId,
          ...patch,
        })
      ) {
        fetcher.submit(
          {
            intent: "set-defect-fields",
            itemId,
            sectionId,
            cannedId,
            patch: JSON.stringify(patch),
          },
          { method: "POST" },
        );
      }
      setDirty(true);
    },
    [setResults, fetcher, setDirty, tryEnqueueOffline],
  );

  /* ---------------------------------------------------------------- */
  /*  Comment insertion (from library)                                  */
  /* ---------------------------------------------------------------- */

  const insertComment = useCallback(
    (
      sectionId: string,
      itemId: string,
      text: string,
      withExtraNewline = false,
    ) => {
      const key = fKey(sectionId, itemId);
      setResults((prev) => {
        const existing =
          (prev[key] as Record<string, unknown>) || {};
        const oldNotes = (existing.notes as string) || "";
        const sep = withExtraNewline ? "\n\n" : "\n";
        const newNotes = oldNotes
          ? oldNotes.trimEnd() + sep + text
          : text;
        const updated = { ...existing, notes: newNotes };
        return {
          ...prev,
          [key]: updated,
          [itemId]: updated,
        };
      });
      setDirty(true);
    },
    [setResults, setDirty],
  );

  return { toggleCannedComment, setDefectFields, insertComment };
}
