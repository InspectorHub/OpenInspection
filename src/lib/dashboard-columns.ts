/**
 * Round-2 backlog #2 — Inspection dashboard column registry (Spectora §5.1 / §E.7).
 *
 * Master list of every column the inspector can show / hide on the dashboard
 * inspection list. The registry is the single source of truth — used by:
 *   - the Customize Columns modal (rendered checkbox-per-column)
 *   - the dashboard row template (conditional render based on visible ids)
 *   - the DashboardPrefsService (validation: drop unknown ids on read/write)
 *   - the localStorage cache and tenant-default endpoint
 *
 * Every column is identified by an opaque id ("snake-cased camel"). The id
 * is what gets persisted in `localStorage.oi.dashboard.columns` and in
 * `tenant_configs.dashboard_column_prefs`. Adding a new column is a one-line
 * change here plus a render branch in dashboard.tsx; removing a column is
 * safe because unknown ids are dropped on read.
 */

export interface DashboardColumn {
    /** Stable identifier — never rename. Used in localStorage and DB JSON. */
    id: string;
    /** Human-readable label shown in the modal and any column-header surface. */
    label: string;
    /** Default visibility when no user / tenant override exists. */
    defaultOn: boolean;
    /**
     * When `true`, the column cannot be hidden — its checkbox renders disabled.
     * Reserved for the property address (the row's primary identifier and link
     * target — hiding it would orphan every row).
     */
    alwaysOn?: boolean;
    /**
     * When `false`, the column is dropped on small viewports even when toggled
     * on. Used for low-priority info columns to keep the mobile card readable.
     * Default `true` (visible on mobile).
     */
    mobileVisible?: boolean;
    /** Short hint shown in the modal under the label. Optional. */
    description?: string;
}

/**
 * Canonical column list. Order here drives the modal order. Visual order on
 * the inspection row is fixed in dashboard.tsx (the registry only governs
 * presence, not ordering — re-ordering is out of scope for round 2).
 */
export const DASHBOARD_COLUMNS: ReadonlyArray<DashboardColumn> = [
    {
        id: 'propertyAddress',
        label: 'Property Address',
        defaultOn: true,
        alwaysOn: true,
        description: 'The row anchor — always visible.',
    },
    {
        id: 'clientName',
        label: 'Client Name',
        defaultOn: true,
    },
    {
        id: 'date',
        label: 'Inspection Date',
        defaultOn: true,
    },
    {
        id: 'inspector',
        label: 'Inspector',
        defaultOn: false,
        description: 'Assigned inspector name.',
    },
    {
        id: 'statusIcons',
        label: 'Status Icons',
        defaultOn: true,
        description: 'Report ready, agreement signed, sent, flagged.',
    },
    {
        id: 'defectChips',
        label: 'Defect Counts',
        defaultOn: true,
        description: 'Three-color chip — safety / recommendation / maintenance.',
        mobileVisible: false,
    },
    {
        id: 'agent',
        label: 'Agent',
        defaultOn: true,
        description: 'Listing or buyer\'s agent on the inspection.',
    },
    {
        id: 'price',
        label: 'Price / Invoice Status',
        defaultOn: true,
    },
    {
        id: 'closingDate',
        label: 'Closing Date',
        defaultOn: true,
        mobileVisible: false,
    },
    {
        id: 'orderId',
        label: 'Order ID',
        defaultOn: false,
        mobileVisible: false,
    },
    {
        id: 'referralSource',
        label: 'Referral Source',
        defaultOn: false,
        mobileVisible: false,
    },
    {
        id: 'propertyFacts',
        label: 'Property Facts',
        defaultOn: false,
        description: 'Year built / square footage — toggled together.',
        mobileVisible: false,
    },
] as const;

/** Set of all known column ids — used to filter persisted prefs. */
export const DASHBOARD_COLUMN_IDS: ReadonlySet<string> = new Set(
    DASHBOARD_COLUMNS.map(c => c.id),
);

/** The default-on subset, in registry order. */
export const DEFAULT_DASHBOARD_COLUMNS: ReadonlyArray<string> = DASHBOARD_COLUMNS
    .filter(c => c.defaultOn)
    .map(c => c.id);

/** Always-on subset — these can never be removed by user / tenant prefs. */
export const ALWAYS_ON_DASHBOARD_COLUMNS: ReadonlyArray<string> = DASHBOARD_COLUMNS
    .filter(c => c.alwaysOn)
    .map(c => c.id);

/**
 * Sanitises a candidate prefs array (unknown source — DB JSON, localStorage,
 * API payload) into a valid set of column ids. Drops unknown ids, dedupes,
 * and re-injects every always-on id even if the caller forgot it.
 *
 * Returns ids in registry order so consumers can rely on a stable visual
 * sequence regardless of the input order.
 */
export function normalizeDashboardColumns(input: unknown): string[] {
    const ids = Array.isArray(input)
        ? input.filter((v): v is string => typeof v === 'string')
        : [];
    const wanted = new Set(ids.filter(id => DASHBOARD_COLUMN_IDS.has(id)));
    for (const id of ALWAYS_ON_DASHBOARD_COLUMNS) wanted.add(id);
    return DASHBOARD_COLUMNS.filter(c => wanted.has(c.id)).map(c => c.id);
}
