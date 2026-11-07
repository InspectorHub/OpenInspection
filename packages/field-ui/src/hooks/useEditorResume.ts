import { useEffect, useRef } from "react";
import type { NavSection } from "../editor/item-neighbours";

/**
 * Where the editor opens: on the item the person was last on in this inspection (on this browser or device), or on the first item
 * when there is no such place or it is gone. Without it a phone opens on a blank page and the person has to find a section first.
 */
const keyFor = (inspectionId: string): string => `oi:editor:last-item:${inspectionId}`;

export interface LastPlace {
  sectionId: string;
  itemId: string;
}

export function readLastPlace(inspectionId: string): LastPlace | null {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(keyFor(inspectionId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { sectionId, itemId } = parsed as Record<string, unknown>;
    return typeof sectionId === "string" && typeof itemId === "string" ? { sectionId, itemId } : null;
  } catch {
    return null;
  }
}

function writeLastPlace(inspectionId: string, place: LastPlace): void {
  try {
    localStorage.setItem(keyFor(inspectionId), JSON.stringify(place));
  } catch {
    // Private mode or a full store: the place is a convenience, not data.
  }
}

/** The place to open on, from what is saved and what the inspection holds now. Null when there is no item at all. */
export function placeToOpen(sections: ReadonlyArray<NavSection>, saved: LastPlace | null): LastPlace | null {
  if (saved) {
    const section = sections.find((s) => s.id === saved.sectionId);
    if (section?.items?.some((item) => item.id === saved.itemId)) return saved;
  }
  for (const section of sections) {
    const first = section.items?.[0];
    if (first) return { sectionId: section.id, itemId: first.id };
  }
  return null;
}

export interface EditorResumeInput {
  inspectionId: string;
  sections: ReadonlyArray<NavSection>;
  activeItemId: string | null;
  activeSectionId: string | undefined;
  openPlace(place: LastPlace): void;
}

export function useEditorResume({ inspectionId, sections, activeItemId, activeSectionId, openPlace }: EditorResumeInput): void {
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || sections.length === 0) return;
    opened.current = true;
    if (activeItemId !== null) return;
    const place = placeToOpen(sections, readLastPlace(inspectionId));
    if (place) openPlace(place);
  }, [sections, activeItemId, inspectionId, openPlace]);

  useEffect(() => {
    if (!opened.current || activeItemId === null || activeSectionId === undefined) return;
    writeLastPlace(inspectionId, { sectionId: activeSectionId, itemId: activeItemId });
  }, [inspectionId, activeItemId, activeSectionId]);
}
