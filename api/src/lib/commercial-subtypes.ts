/**
 * Gap 16 — Platform-level commercial subtype constants.
 *
 * 6 locked platform subtypes. Org-custom subtypes stored in DB
 * (commercial_subtypes table) with basedOn pointing to a platform ID.
 *
 * Canonical source: Design System 0523 Catalog.jsx PLATFORM_SUBTYPES.
 */

export interface PlatformSubtype {
    id: string;
    label: string;
    locked: true;
}

export const PLATFORM_SUBTYPES: readonly PlatformSubtype[] = [
    { id: 'office',        label: 'Office',        locked: true },
    { id: 'retail',        label: 'Retail',        locked: true },
    { id: 'hospitality',   label: 'Hospitality',   locked: true },
    { id: 'industrial',    label: 'Industrial',    locked: true },
    { id: 'institutional', label: 'Institutional', locked: true },
    { id: 'mixed-use',     label: 'Mixed-use',     locked: true },
] as const;

export interface PropertyMetaField {
    id: string;
    label: string;
    type: 'text' | 'number' | 'select' | 'boolean' | 'date';
    group?: string;
    required?: boolean;
    unit?: string;
    options?: string[];
}

export const METADATA_PRESETS: Record<string, PropertyMetaField[]> = {
    'single-family': [
        { id: 'yearBuilt',  label: 'Year built',  type: 'number', group: 'identity', required: true },
        { id: 'sqft',       label: 'Sq ft',       type: 'number', unit: 'sqft', group: 'physical' },
        { id: 'foundation', label: 'Foundation',   type: 'select', group: 'physical',
          options: ['Slab on grade', 'Crawl space', 'Basement', 'Pier & beam', 'Other'] },
        { id: 'lotSize',    label: 'Lot size',     type: 'number', unit: 'sqft', group: 'physical' },
        { id: 'garageSize', label: 'Garage',       type: 'select', group: 'physical',
          options: ['None', '1-car', '2-car', '3+ car', 'Detached'] },
    ],
    'multi-unit': [
        { id: 'yearBuilt',       label: 'Year built',          type: 'number', group: 'identity', required: true },
        { id: 'totalUnits',      label: 'Total dwelling units', type: 'number', group: 'identity', required: true },
        { id: 'occupiedUnits',   label: 'Occupied units',      type: 'number', group: 'occupancy' },
        { id: 'hoaStatus',       label: 'HOA status',          type: 'select', group: 'compliance',
          options: ['Self-managed', 'Professionally managed', 'None'] },
        { id: 'lastRoofReplaced', label: 'Last roof replaced', type: 'date',   group: 'maintenance' },
    ],
    'commercial:office': [
        { id: 'yearBuilt',       label: 'Year built',          type: 'number', group: 'identity', required: true },
        { id: 'nra',             label: 'Net rentable area',   type: 'number', unit: 'sqft', group: 'physical', required: true },
        { id: 'floorCount',      label: 'Number of floors',    type: 'number', group: 'physical' },
        { id: 'occupancyClass',  label: 'Occupancy classification', type: 'select', group: 'compliance',
          options: ['B (Business)', 'A-3 (Assembly)', 'M (Mercantile)', 'Other'] },
        { id: 'sprinklered',     label: 'Sprinklered',         type: 'select', group: 'compliance',
          options: ['Full', 'Partial', 'None'] },
        { id: 'lastRenovation',  label: 'Last major renovation', type: 'date', group: 'maintenance' },
    ],
    'commercial:retail': [
        { id: 'yearBuilt',       label: 'Year built',          type: 'number', group: 'identity', required: true },
        { id: 'gla',             label: 'Gross leasable area', type: 'number', unit: 'sqft', group: 'physical', required: true },
        { id: 'storefrontCount', label: 'Storefronts',         type: 'number', group: 'physical' },
        { id: 'anchorTenant',    label: 'Anchor tenant',       type: 'text',   group: 'occupancy' },
        { id: 'parkingSpaces',   label: 'Parking spaces',      type: 'number', group: 'physical' },
    ],
    'commercial:hospitality': [
        { id: 'yearBuilt',       label: 'Year built',          type: 'number', group: 'identity', required: true },
        { id: 'roomCount',       label: 'Guest rooms',         type: 'number', group: 'identity', required: true },
        { id: 'brandAffiliation', label: 'Brand affiliation',  type: 'text',   group: 'identity' },
        { id: 'aaaRating',       label: 'AAA / Forbes rating', type: 'select', group: 'compliance',
          options: ['Unrated', '1 Diamond', '2 Diamond', '3 Diamond', '4 Diamond', '5 Diamond'] },
        { id: 'lastRenovation',  label: 'Last major renovation', type: 'date', group: 'maintenance' },
    ],
    'commercial:industrial': [
        { id: 'yearBuilt',       label: 'Year built',          type: 'number', group: 'identity', required: true },
        { id: 'sqft',            label: 'Building area',       type: 'number', unit: 'sqft', group: 'physical', required: true },
        { id: 'clearHeight',     label: 'Clear height',        type: 'number', unit: 'ft', group: 'physical' },
        { id: 'dockCount',       label: 'Loading docks',       type: 'number', group: 'physical' },
        { id: 'powerCapacity',   label: 'Power capacity',      type: 'number', unit: 'amps', group: 'utilities' },
        { id: 'railSpur',        label: 'Rail spur',           type: 'select', group: 'utilities',
          options: ['None', 'Active', 'Removed'] },
    ],
    'commercial:institutional': [
        { id: 'yearBuilt',       label: 'Year built',          type: 'number', group: 'identity', required: true },
        { id: 'sqft',            label: 'Building area',       type: 'number', unit: 'sqft', group: 'physical', required: true },
        { id: 'occupancyType',   label: 'Occupancy type',      type: 'select', group: 'compliance',
          options: ['E (Educational)', 'I-1 (Custodial care)', 'I-2 (Medical)', 'I-3 (Detention)', 'I-4 (Day care)'] },
        { id: 'sprinklered',     label: 'Sprinklered',         type: 'select', group: 'compliance',
          options: ['Full', 'Partial', 'None'] },
    ],
    'commercial:mixed-use': [
        { id: 'yearBuilt',       label: 'Year built',          type: 'number', group: 'identity', required: true },
        { id: 'residentialUnits', label: 'Residential units',  type: 'number', group: 'identity' },
        { id: 'commercialSqft',  label: 'Commercial sq ft',    type: 'number', unit: 'sqft', group: 'identity' },
    ],
};

export function getSubtypeDef(subtypeId: string): PlatformSubtype | null {
    return PLATFORM_SUBTYPES.find(s => s.id === subtypeId) ?? null;
}

export function getMetadataPreset(
    propertyType: string,
    subtypeId?: string | null,
): PropertyMetaField[] {
    if (propertyType === 'commercial' && subtypeId) {
        const key = `commercial:${subtypeId}`;
        if (METADATA_PRESETS[key]) return METADATA_PRESETS[key];
    }
    return METADATA_PRESETS[propertyType] ?? [];
}
