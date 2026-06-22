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

export const COLUMN_REGISTRY: ColumnDef[] = [
  { id: "propertyAddress", label: "Property Address", defaultOn: true, alwaysOn: true },
  { id: "clientName", label: "Client Name", defaultOn: true },
  { id: "date", label: "Inspection Date", defaultOn: true },
  { id: "inspector", label: "Inspector", defaultOn: false },
  { id: "statusIcons", label: "Status Icons", defaultOn: true },
  { id: "defectChips", label: "Defect Counts", defaultOn: true },
  { id: "agent", label: "Agent", defaultOn: true },
  { id: "price", label: "Price", defaultOn: true },
  { id: "closingDate", label: "Closing Date", defaultOn: true },
  { id: "referenceNumber", label: "Reference #", defaultOn: false },
  { id: "referralSource", label: "Referral Source", defaultOn: false },
  { id: "propertyFacts", label: "Property Facts", defaultOn: false },
];

export const DEFAULT_COLUMNS = COLUMN_REGISTRY.filter((c) => c.defaultOn).map((c) => c.id);
export const ALWAYS_ON = new Set(COLUMN_REGISTRY.filter((c) => c.alwaysOn).map((c) => c.id));

/* ------------------------------------------------------------------ */
/*  Time filter helpers                                                */
/* ------------------------------------------------------------------ */

export const INSPECTION_FILTERS = [
  { id: "all", label: "All" },
  { id: "past", label: "Past" },
  { id: "yesterday", label: "Yesterday" },
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "this_week", label: "This Week" },
  { id: "future", label: "Future" },
  { id: "unconfirmed", label: "Unconfirmed" },
  { id: "in_progress", label: "In Progress" },
] as const;

export type FilterId = (typeof INSPECTION_FILTERS)[number]["id"];

/* ------------------------------------------------------------------ */
/*  Workflow tabs                                                       */
/* ------------------------------------------------------------------ */

export const TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "requested", label: "Requested" },
  { key: "to_review", label: "To Review" },
  { key: "awaiting_payment", label: "Awaiting payment" },
  { key: "published", label: "Published" },
  { key: "cancelled", label: "Cancelled" },
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
  needsAttention: { label: "Needs Attention", hint: "Inspections requiring action" },
  today: { label: "Today", hint: "Scheduled for today" },
  thisWeek: { label: "This Week", hint: "Upcoming this week" },
  later: { label: "Later", hint: "Future inspections" },
  recentReports: { label: "Recent Reports", hint: "Recently completed" },
  cancelled: { label: "Cancelled", hint: "Cancelled inspections" },
};

export const PAGE_SIZE = 25;
