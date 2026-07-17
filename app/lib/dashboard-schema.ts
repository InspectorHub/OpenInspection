import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Inspection {
  id: string;
  date: string | null;
  address: string | null;
  propertyAddress?: string | null;
  clientName: string | null;
  clientEmail?: string | null;
  status: string;
  reportStatus?: string;
  confirmedAt?: string | null;
  price?: number | null;
  paymentStatus?: string | null;
  agentName?: string | null;
  agentId?: string | null;
  tagIds?: string[];
  defectStats?: { safety: number; recommendation: number; maintenance: number };
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
}

/** Template option for the New Inspection wizard picker (B-6). */
export interface TemplateOption {
  id: string;
  name: string;
  itemCount?: number;
}

/** Service option for the New Inspection wizard Services step (B-8). */
export interface ServiceOption {
  id: string;
  name: string;
  price?: number | null;
}

export interface DashboardData {
  needsAttention: Inspection[];
  today: Inspection[];
  thisWeek: Inspection[];
  later: Inspection[];
  laterTotal?: number;
  recentReports: Inspection[];
  cancelled: Inspection[];
  conciergePending?: number;
}

/* ------------------------------------------------------------------ */
/*  Column registry                                                    */
/* ------------------------------------------------------------------ */

export interface ColumnDef {
  id: string;
  label: string;
  defaultOn: boolean;
  alwaysOn?: boolean;
}

// Labels are exposed as getters so the string resolves at render time (under
// the active paraglide locale), not frozen at module-import time.
export const COLUMN_REGISTRY: ColumnDef[] = [
  { id: "propertyAddress", get label() { return m.label_col_property_address(); }, defaultOn: true, alwaysOn: true },
  { id: "clientName", get label() { return m.label_col_client_name(); }, defaultOn: true },
  { id: "date", get label() { return m.label_col_inspection_date(); }, defaultOn: true },
  { id: "inspector", get label() { return m.label_col_inspector(); }, defaultOn: false },
  { id: "statusIcons", get label() { return m.label_col_status_icons(); }, defaultOn: true },
  { id: "defectChips", get label() { return m.label_col_defect_counts(); }, defaultOn: true },
  { id: "agent", get label() { return m.label_col_agent(); }, defaultOn: true },
  { id: "price", get label() { return m.label_col_price(); }, defaultOn: true },
  { id: "closingDate", get label() { return m.label_col_closing_date(); }, defaultOn: true },
  { id: "referenceNumber", get label() { return m.label_col_reference_number(); }, defaultOn: false },
  { id: "referralSource", get label() { return m.label_col_referral_source(); }, defaultOn: false },
  { id: "propertyFacts", get label() { return m.label_col_property_facts(); }, defaultOn: false },
];

export const DEFAULT_COLUMNS = COLUMN_REGISTRY.filter((c) => c.defaultOn).map((c) => c.id);
export const ALWAYS_ON = new Set(COLUMN_REGISTRY.filter((c) => c.alwaysOn).map((c) => c.id));

/* ------------------------------------------------------------------ */
/*  Time filter helpers                                                */
/* ------------------------------------------------------------------ */

export const INSPECTION_FILTERS = [
  { id: "all", get label() { return m.label_filter_all(); } },
  { id: "past", get label() { return m.label_filter_past(); } },
  { id: "yesterday", get label() { return m.label_filter_yesterday(); } },
  { id: "today", get label() { return m.label_filter_today(); } },
  { id: "tomorrow", get label() { return m.label_filter_tomorrow(); } },
  { id: "this_week", get label() { return m.label_filter_this_week(); } },
  { id: "future", get label() { return m.label_filter_future(); } },
  { id: "unconfirmed", get label() { return m.label_filter_unconfirmed(); } },
  { id: "in_progress", get label() { return m.label_filter_in_progress(); } },
] as const;

export type FilterId = (typeof INSPECTION_FILTERS)[number]["id"];

/* ------------------------------------------------------------------ */
/*  Workflow tabs                                                       */
/* ------------------------------------------------------------------ */

export const TABS = [
  { key: "all", get label() { return m.label_tab_all(); } },
  { key: "active", get label() { return m.label_tab_active(); } },
  { key: "requested", get label() { return m.label_tab_requested(); } },
  { key: "to_review", get label() { return m.label_tab_to_review(); } },
  { key: "awaiting_payment", get label() { return m.label_tab_awaiting_payment(); } },
  { key: "published", get label() { return m.label_tab_published(); } },
  { key: "cancelled", get label() { return m.label_tab_cancelled(); } },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

/* ------------------------------------------------------------------ */
/*  Report-state badge (Published tab)                                 */
/* ------------------------------------------------------------------ */

// Report-state pill for the Published/to_review tabs (uses reportStatus axis).
export const REPORT_STATE_TONE: Record<string, "monitor" | "sat" | "warning"> = {
  in_progress: "monitor",
  submitted: "warning",
  published: "sat",
};

/* ------------------------------------------------------------------ */
/*  Bucket labels                                                      */
/* ------------------------------------------------------------------ */

export const BUCKET_META: Record<string, { label: string; hint: string }> = {
  needsAttention: { get label() { return m.label_bucket_needs_attention(); }, get hint() { return m.label_bucket_needs_attention_hint(); } },
  today: { get label() { return m.label_bucket_today(); }, get hint() { return m.label_bucket_today_hint(); } },
  thisWeek: { get label() { return m.label_bucket_this_week(); }, get hint() { return m.label_bucket_this_week_hint(); } },
  later: { get label() { return m.label_bucket_later(); }, get hint() { return m.label_bucket_later_hint(); } },
  recentReports: { get label() { return m.label_bucket_recent_reports(); }, get hint() { return m.label_bucket_recent_reports_hint(); } },
  cancelled: { get label() { return m.label_bucket_cancelled(); }, get hint() { return m.label_bucket_cancelled_hint(); } },
};

export const PAGE_SIZE = 25;
