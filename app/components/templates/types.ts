export interface Template {
  id: string;
  name: string;
  version: number;
  description?: string;
  source?: string;
  marketplaceTemplateId?: string;
  upstreamUpdateAvailable?: boolean;
  usageCount?: number;
  itemCount?: number;
  createdAt?: string;
  updatedAt?: string;
  schema?: {
    schemaVersion?: number;
    sections?: { id: string; title?: string; name?: string; items?: unknown[] }[];
  };
}

export type SortKey = "name" | "date" | "usage";

export function countItems(t: Template): number {
  if (t.itemCount != null) return t.itemCount;
  const sections = t.schema?.sections;
  if (!Array.isArray(sections)) return 0;
  return sections.reduce((acc, s) => acc + (Array.isArray(s.items) ? s.items.length : 0), 0);
}
