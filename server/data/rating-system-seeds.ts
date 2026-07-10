/**
 * Sprint 2 S2-1 — Seed rating systems.
 *
 * Four ship-with-product rating systems. Tenants can clone any of them and
 * tweak the clone; the seeded rows themselves are immutable (`is_seed=1`,
 * service refuses edits / deletes).
 *
 * Hex colors mirror Tailwind v3 emerald/amber/rose/slate palette so the
 * inspector-facing rating buttons match the rest of the UI without bespoke
 * tokens.
 */

export interface SeedLevel {
    abbreviation: string;
    label:        string;
    color:        string;
    severity:     'good' | 'marginal' | 'significant' | 'minor';
    isDefect:     boolean;
    hotkey?:      string;
    /** Workflow shortcuts PR — pause auto-advance after rating with this level. */
    pausesAdvance?: boolean;
}

export interface SeedRatingSystem {
    slug:        string;
    name:        string;
    description: string;
    isDefault:   boolean;
    levels:      SeedLevel[];
}

export const RATING_SYSTEM_SEEDS: SeedRatingSystem[] = [
    {
        slug:        'oi-4tier',
        name:        'OpenInspection Default (4-tier)',
        description: 'Standard four-tier rating used in most residential inspections.',
        isDefault:   true,
        levels: [
            { abbreviation: 'Sat', label: 'Satisfactory',    color: '#10b981', severity: 'good',        isDefect: false, hotkey: '1', pausesAdvance: false },
            { abbreviation: 'Mon', label: 'Monitor',         color: '#f59e0b', severity: 'marginal',    isDefect: false, hotkey: '2', pausesAdvance: true  },
            { abbreviation: 'D',   label: 'Defect',          color: '#ef4444', severity: 'significant', isDefect: true,  hotkey: '3', pausesAdvance: true  },
            { abbreviation: 'NI',  label: 'Not Inspected',   color: '#94a3b8', severity: 'minor',       isDefect: false, hotkey: '4', pausesAdvance: false },
            { abbreviation: 'NP',  label: 'Not Present',     color: '#cbd5e1', severity: 'minor',       isDefect: false, hotkey: '5', pausesAdvance: false },
        ],
    },
    {
        slug:        'trec',
        name:        'TREC (Texas REC 4-level)',
        description: 'Texas Real Estate Commission standard: Inspected / Not Inspected / Not Present / Deficient.',
        isDefault:   false,
        levels: [
            { abbreviation: 'I',  label: 'Inspected',     color: '#10b981', severity: 'good',        isDefect: false, hotkey: '1', pausesAdvance: false },
            { abbreviation: 'NI', label: 'Not Inspected', color: '#94a3b8', severity: 'minor',       isDefect: false, hotkey: '2', pausesAdvance: false },
            { abbreviation: 'NP', label: 'Not Present',   color: '#cbd5e1', severity: 'minor',       isDefect: false, hotkey: '3', pausesAdvance: false },
            { abbreviation: 'D',  label: 'Deficient',     color: '#ef4444', severity: 'significant', isDefect: true,  hotkey: '4', pausesAdvance: true  },
        ],
    },
    {
        slug:        'itb',
        name:        'Inspector Toolbelt (ITB) 8-level',
        description: 'Inspector Toolbelt full granularity scheme — finer severity tracking for detailed reports.',
        isDefault:   false,
        levels: [
            { abbreviation: 'F',   label: 'Functional',      color: '#10b981', severity: 'good',        isDefect: false, hotkey: '1', pausesAdvance: false },
            { abbreviation: 'LM',  label: 'Low Maintenance', color: '#34d399', severity: 'good',        isDefect: false, hotkey: '2', pausesAdvance: false },
            { abbreviation: 'Mon', label: 'Monitor',         color: '#fbbf24', severity: 'marginal',    isDefect: false, hotkey: '3', pausesAdvance: true  },
            { abbreviation: 'Mar', label: 'Marginal',        color: '#f59e0b', severity: 'marginal',    isDefect: false, hotkey: '4', pausesAdvance: true  },
            { abbreviation: 'D',   label: 'Deficiency',      color: '#ef4444', severity: 'significant', isDefect: true,  hotkey: '5', pausesAdvance: true  },
            { abbreviation: 'H',   label: 'Hazard',          color: '#dc2626', severity: 'significant', isDefect: true,  hotkey: '6', pausesAdvance: true  },
            { abbreviation: 'NP',  label: 'Not Present',     color: '#cbd5e1', severity: 'minor',       isDefect: false, hotkey: '7', pausesAdvance: false },
            { abbreviation: 'NI',  label: 'Not Inspected',   color: '#94a3b8', severity: 'minor',       isDefect: false, hotkey: '8', pausesAdvance: false },
        ],
    },
    {
        slug:        'itb-3',
        name:        'Inspector Toolbelt (ITB) 3-tier',
        description: 'Inspector Toolbelt simplified scheme — Functional / Marginal / Deficient. Fast for screening visits.',
        isDefault:   false,
        levels: [
            { abbreviation: 'F',   label: 'Functional', color: '#10b981', severity: 'good',        isDefect: false, hotkey: '1', pausesAdvance: false },
            { abbreviation: 'Mar', label: 'Marginal',   color: '#f59e0b', severity: 'marginal',    isDefect: false, hotkey: '2', pausesAdvance: true  },
            { abbreviation: 'D',   label: 'Deficient',  color: '#ef4444', severity: 'significant', isDefect: true,  hotkey: '3', pausesAdvance: true  },
        ],
    },
];
