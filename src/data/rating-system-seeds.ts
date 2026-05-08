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
    abbr:    string;
    label:   string;
    color:   string;
    bucket:  'satisfactory' | 'monitor' | 'defect' | 'na';
    hotkey?: string;
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
            { abbr: 'Sat', label: 'Satisfactory',    color: '#10b981', bucket: 'satisfactory', hotkey: '1' },
            { abbr: 'Mon', label: 'Monitor',         color: '#f59e0b', bucket: 'monitor',      hotkey: '2' },
            { abbr: 'D',   label: 'Defect',          color: '#ef4444', bucket: 'defect',       hotkey: '3' },
            { abbr: 'NI',  label: 'Not Inspected',   color: '#94a3b8', bucket: 'na',           hotkey: '4' },
            { abbr: 'NP',  label: 'Not Present',     color: '#cbd5e1', bucket: 'na',           hotkey: '5' },
        ],
    },
    {
        slug:        'trec',
        name:        'TREC (Texas REC 4-level)',
        description: 'Texas Real Estate Commission standard: Inspected / Not Inspected / Not Present / Deficient.',
        isDefault:   false,
        levels: [
            { abbr: 'I',  label: 'Inspected',     color: '#10b981', bucket: 'satisfactory', hotkey: '1' },
            { abbr: 'NI', label: 'Not Inspected', color: '#94a3b8', bucket: 'na',           hotkey: '2' },
            { abbr: 'NP', label: 'Not Present',   color: '#cbd5e1', bucket: 'na',           hotkey: '3' },
            { abbr: 'D',  label: 'Deficient',     color: '#ef4444', bucket: 'defect',       hotkey: '4' },
        ],
    },
    {
        slug:        'itb',
        name:        'Inspector Toolbelt (ITB) 8-level',
        description: 'Inspector Toolbelt full granularity scheme — finer severity tracking for detailed reports.',
        isDefault:   false,
        levels: [
            { abbr: 'F',   label: 'Functional',      color: '#10b981', bucket: 'satisfactory', hotkey: '1' },
            { abbr: 'LM',  label: 'Low Maintenance', color: '#34d399', bucket: 'satisfactory', hotkey: '2' },
            { abbr: 'Mon', label: 'Monitor',         color: '#fbbf24', bucket: 'monitor',      hotkey: '3' },
            { abbr: 'Mar', label: 'Marginal',        color: '#f59e0b', bucket: 'monitor',      hotkey: '4' },
            { abbr: 'D',   label: 'Deficiency',      color: '#ef4444', bucket: 'defect',       hotkey: '5' },
            { abbr: 'H',   label: 'Hazard',          color: '#dc2626', bucket: 'defect',       hotkey: '6' },
            { abbr: 'NP',  label: 'Not Present',     color: '#cbd5e1', bucket: 'na',           hotkey: '7' },
            { abbr: 'NI',  label: 'Not Inspected',   color: '#94a3b8', bucket: 'na',           hotkey: '8' },
        ],
    },
    {
        slug:        'itb-3',
        name:        'Inspector Toolbelt (ITB) 3-tier',
        description: 'Inspector Toolbelt simplified scheme — Functional / Marginal / Deficient. Fast for screening visits.',
        isDefault:   false,
        levels: [
            { abbr: 'F',   label: 'Functional', color: '#10b981', bucket: 'satisfactory', hotkey: '1' },
            { abbr: 'Mar', label: 'Marginal',   color: '#f59e0b', bucket: 'monitor',      hotkey: '2' },
            { abbr: 'D',   label: 'Deficient',  color: '#ef4444', bucket: 'defect',       hotkey: '3' },
        ],
    },
];
