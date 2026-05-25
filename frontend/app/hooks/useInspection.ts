import { useState } from "react";

export interface Inspection {
  id: string;
  propertyAddress: string;
  clientName?: string;
  date: string;
  status: string;
  propertyType?: string;
  teamMode?: boolean;
  templateSnapshot?: unknown;
}

export interface InspectionData {
  inspection: Inspection;
  schema: { sections: Section[] };
  results: Record<string, unknown>;
}

export interface Section {
  id: string;
  title: string;
  items: Item[];
}

export interface Item {
  id: string;
  label: string;
  type: string;
  tabs?: unknown;
}

/**
 * Client-side hook for managing inspection editor state.
 *
 * Data is loaded server-side via the route loader; this hook manages the
 * in-memory editing state (active section, active item, results map).
 */
export function useInspectionState(initialData: InspectionData) {
  const [inspection] = useState(initialData.inspection);
  const [schema] = useState(initialData.schema);
  const [results, setResults] = useState<Record<string, unknown>>(
    initialData.results || {},
  );
  const [activeSection, setActiveSection] = useState<string>(
    initialData.schema.sections[0]?.id || "",
  );
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const currentSection = schema.sections.find((s) => s.id === activeSection);
  const currentItems = currentSection?.items || [];

  return {
    inspection,
    schema,
    results,
    setResults,
    activeSection,
    setActiveSection,
    activeItemId,
    setActiveItemId,
    currentSection,
    currentItems,
    saving,
    setSaving,
  };
}
