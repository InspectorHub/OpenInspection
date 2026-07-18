/**
 * Sprint 2 S2-3 — Hardcoded contractor recommendation categories.
 *
 * Each defect can carry a `recommendation_id` slug pointing to one of these
 * categories. The published report card renders the matching `defaultPhrase`
 * after the inspector's defect notes so reports read like Spectora's
 * polished output ("Recommend a qualified electrician to evaluate.")
 * instead of a generic "contact a contractor."
 *
 * The list is intentionally hardcoded (not tenant-configurable) so we can
 * ship a 50+ entry catalog with consistent slugs across all tenants. The
 * catalog is grouped for the inspection-edit dropdown's <optgroup>.
 */

export interface RecommendationCategory {
    /** Stable slug. Stored verbatim on defects[].recommendation_id. */
    id:             string;
    /** Group label for the dropdown's <optgroup>. */
    group:          string;
    /** Inspector-facing label inside the dropdown option. */
    label:          string;
    /** Optional emoji for visual scanning. */
    icon?:          string;
    /** Phrase appended to the defect comment in the published report. */
    defaultPhrase:  string;
}

export const RECOMMENDATION_CATEGORIES: RecommendationCategory[] = [
    // ─── Roofing (4) ───────────────────────────────────────────────
    { id: 'roof-general',     group: 'Roofing',     label: 'Roofing contractor (general)',    icon: '🏠',
      defaultPhrase: 'Recommend a qualified roofing contractor evaluate and repair as needed.' },
    { id: 'roof-leak',        group: 'Roofing',     label: 'Roofing — leak repair',           icon: '💧',
      defaultPhrase: 'Recommend a qualified roofing contractor address the active leak immediately to prevent further water damage.' },
    { id: 'roof-replace',     group: 'Roofing',     label: 'Roofing — full replacement',      icon: '🔨',
      defaultPhrase: 'Recommend a qualified roofing contractor evaluate the roof for full replacement.' },
    { id: 'gutter',           group: 'Roofing',     label: 'Gutter / downspout',              icon: '🌧️',
      defaultPhrase: 'Recommend a qualified gutter contractor clean, repair, or replace as needed.' },

    // ─── Electrical (4) ────────────────────────────────────────────
    { id: 'electrician',      group: 'Electrical',  label: 'Electrician (general)',           icon: '⚡',
      defaultPhrase: 'Recommend a qualified electrician evaluate and repair as needed.' },
    { id: 'electrical-panel', group: 'Electrical',  label: 'Electrical panel upgrade',        icon: '🔌',
      defaultPhrase: 'Recommend a qualified electrician evaluate the electrical panel for upgrade or replacement.' },
    { id: 'gfci-outlet',      group: 'Electrical',  label: 'GFCI / outlet repair',            icon: '🔋',
      defaultPhrase: 'Recommend a qualified electrician install or repair GFCI protection per current code.' },
    { id: 'low-voltage',      group: 'Electrical',  label: 'Low-voltage / data wiring',       icon: '📡',
      defaultPhrase: 'Recommend a qualified low-voltage technician evaluate and repair as needed.' },

    // ─── Plumbing (5) ──────────────────────────────────────────────
    { id: 'plumber',          group: 'Plumbing',    label: 'Plumber (general)',               icon: '🔧',
      defaultPhrase: 'Recommend a qualified plumber evaluate and repair as needed.' },
    { id: 'water-heater',     group: 'Plumbing',    label: 'Water heater service',            icon: '♨️',
      defaultPhrase: 'Recommend a qualified plumber service or replace the water heater.' },
    { id: 'sewer-scope',      group: 'Plumbing',    label: 'Sewer scope inspection',          icon: '🚽',
      defaultPhrase: 'Recommend a sewer-scope inspection by a qualified plumber prior to closing.' },
    { id: 'septic',           group: 'Plumbing',    label: 'Septic system service',           icon: '🪣',
      defaultPhrase: 'Recommend a licensed septic service evaluate the system.' },
    { id: 'well',             group: 'Plumbing',    label: 'Well / pump service',             icon: '💦',
      defaultPhrase: 'Recommend a qualified well-service contractor evaluate the system.' },

    // ─── HVAC (4) ──────────────────────────────────────────────────
    { id: 'hvac',             group: 'HVAC',        label: 'HVAC technician',                 icon: '❄️',
      defaultPhrase: 'Recommend a qualified HVAC technician service the system.' },
    { id: 'duct-cleaning',    group: 'HVAC',        label: 'Duct cleaning',                   icon: '🌀',
      defaultPhrase: 'Recommend a duct-cleaning specialist evaluate and clean as needed.' },
    { id: 'fireplace',        group: 'HVAC',        label: 'Fireplace / chimney sweep',       icon: '🧹',
      defaultPhrase: 'Recommend a certified chimney sweep inspect and clean the fireplace and flue.' },
    { id: 'water-treatment',  group: 'HVAC',        label: 'Water treatment',                 icon: '🚰',
      defaultPhrase: 'Recommend a water-treatment specialist evaluate the system.' },

    // ─── Structural (4) ────────────────────────────────────────────
    { id: 'structural',       group: 'Structural',  label: 'Structural engineer',             icon: '🏗️',
      defaultPhrase: 'Recommend a licensed structural engineer evaluate the area for further analysis.' },
    { id: 'foundation',       group: 'Structural',  label: 'Foundation contractor',           icon: '🧱',
      defaultPhrase: 'Recommend a qualified foundation contractor evaluate and repair as needed.' },
    { id: 'mason',            group: 'Structural',  label: 'Mason / brick contractor',        icon: '🪨',
      defaultPhrase: 'Recommend a qualified mason evaluate and repair the masonry as needed.' },
    { id: 'concrete',         group: 'Structural',  label: 'Concrete contractor',             icon: '🧊',
      defaultPhrase: 'Recommend a qualified concrete contractor evaluate and repair as needed.' },

    // ─── Exterior (5) ──────────────────────────────────────────────
    { id: 'siding',           group: 'Exterior',    label: 'Siding contractor',               icon: '🏚️',
      defaultPhrase: 'Recommend a qualified siding contractor evaluate and repair as needed.' },
    { id: 'painter',          group: 'Exterior',    label: 'Painter',                         icon: '🎨',
      defaultPhrase: 'Recommend a qualified painter address the affected areas.' },
    { id: 'window-door',      group: 'Exterior',    label: 'Window / door specialist',        icon: '🪟',
      defaultPhrase: 'Recommend a qualified window or door specialist evaluate and repair as needed.' },
    { id: 'driveway',         group: 'Exterior',    label: 'Driveway / paving',               icon: '🛣️',
      defaultPhrase: 'Recommend a qualified paving contractor evaluate and repair the driveway.' },
    { id: 'fence-deck',       group: 'Exterior',    label: 'Fence / deck contractor',         icon: '🪵',
      defaultPhrase: 'Recommend a qualified deck or fence contractor evaluate and repair as needed.' },

    // ─── Interior (5) ──────────────────────────────────────────────
    { id: 'drywall',          group: 'Interior',    label: 'Drywall / plaster repair',        icon: '🧰',
      defaultPhrase: 'Recommend a qualified drywall contractor repair the affected areas.' },
    { id: 'flooring',         group: 'Interior',    label: 'Flooring contractor',             icon: '🪑',
      defaultPhrase: 'Recommend a qualified flooring contractor evaluate and replace as needed.' },
    { id: 'cabinet',          group: 'Interior',    label: 'Cabinet / countertop',            icon: '🧱',
      defaultPhrase: 'Recommend a qualified cabinet contractor evaluate and repair as needed.' },
    { id: 'insulation',       group: 'Interior',    label: 'Insulation contractor',           icon: '🧣',
      defaultPhrase: 'Recommend a qualified insulation contractor evaluate the building envelope.' },
    { id: 'tile',             group: 'Interior',    label: 'Tile / stone setter',             icon: '🟫',
      defaultPhrase: 'Recommend a qualified tile setter evaluate and repair as needed.' },

    // ─── Foundation (3) ────────────────────────────────────────────
    { id: 'waterproofing',    group: 'Foundation',  label: 'Waterproofing specialist',        icon: '🌊',
      defaultPhrase: 'Recommend a waterproofing specialist evaluate the affected area.' },
    { id: 'drainage',         group: 'Foundation',  label: 'Drainage contractor',             icon: '🚿',
      defaultPhrase: 'Recommend a qualified drainage contractor evaluate site drainage.' },
    { id: 'crawlspace',       group: 'Foundation',  label: 'Crawlspace / encapsulation',      icon: '🧪',
      defaultPhrase: 'Recommend a crawlspace specialist evaluate and address moisture or vapor concerns.' },

    // ─── Health / Safety (5) ───────────────────────────────────────
    { id: 'pest-control',     group: 'Health & Safety', label: 'Pest control',                icon: '🐜',
      defaultPhrase: 'Recommend a licensed pest-control professional evaluate and treat as needed.' },
    { id: 'mold',             group: 'Health & Safety', label: 'Mold remediation',            icon: '🧫',
      defaultPhrase: 'Recommend a qualified mold remediation specialist evaluate the area.' },
    { id: 'radon',            group: 'Health & Safety', label: 'Radon mitigation',            icon: '☢️',
      defaultPhrase: 'Recommend a certified radon mitigation specialist evaluate the property.' },
    { id: 'asbestos',         group: 'Health & Safety', label: 'Asbestos abatement',          icon: '⚠️',
      defaultPhrase: 'Recommend a licensed asbestos abatement professional evaluate suspect materials.' },
    { id: 'lead-paint',       group: 'Health & Safety', label: 'Lead paint specialist',       icon: '🎨',
      defaultPhrase: 'Recommend a lead-paint specialist evaluate and abate as needed.' },

    // ─── Specialty (6) ─────────────────────────────────────────────
    { id: 'appliance',        group: 'Specialty',   label: 'Appliance technician',            icon: '🔌',
      defaultPhrase: 'Recommend a qualified appliance technician service the affected unit.' },
    { id: 'pool-spa',         group: 'Specialty',   label: 'Pool / spa specialist',           icon: '🏊',
      defaultPhrase: 'Recommend a qualified pool / spa specialist evaluate and service as needed.' },
    { id: 'solar',            group: 'Specialty',   label: 'Solar installer',                 icon: '☀️',
      defaultPhrase: 'Recommend a qualified solar installer evaluate and service the system.' },
    { id: 'fire-safety',      group: 'Specialty',   label: 'Fire-protection specialist',      icon: '🧯',
      defaultPhrase: 'Recommend a fire-protection specialist evaluate the system.' },
    { id: 'security',         group: 'Specialty',   label: 'Security / alarm system',         icon: '🛡️',
      defaultPhrase: 'Recommend a security-system specialist evaluate the system.' },
    { id: 'tree-service',     group: 'Specialty',   label: 'Arborist / tree service',         icon: '🌳',
      defaultPhrase: 'Recommend a certified arborist evaluate trees adjacent to the structure.' },

    // ─── General (4) ───────────────────────────────────────────────
    { id: 'general-contractor', group: 'General',   label: 'General contractor',              icon: '👷',
      defaultPhrase: 'Recommend a qualified general contractor evaluate and repair as needed.' },
    { id: 'handyman',         group: 'General',     label: 'Handyman',                        icon: '🪛',
      defaultPhrase: 'Recommend a qualified handyman repair the noted items.' },
    { id: 'engineer',         group: 'General',     label: 'Engineer (other discipline)',     icon: '📐',
      defaultPhrase: 'Recommend a licensed engineer in the appropriate discipline evaluate the area.' },
    { id: 'specialist',       group: 'General',     label: 'Other licensed specialist',       icon: '🧑‍🔧',
      defaultPhrase: 'Recommend a qualified licensed specialist evaluate the area.' },
    { id: 'locksmith',        group: 'General',     label: 'Locksmith',                       icon: '🔐',
      defaultPhrase: 'Recommend a qualified locksmith evaluate and service the locks.' },
    { id: 'landscape',        group: 'General',     label: 'Landscape contractor',            icon: '🌿',
      defaultPhrase: 'Recommend a qualified landscape contractor address grading or vegetation concerns.' },
];

/** Set of all valid IDs — used by the Zod enum and by the report renderer. */
export const RECOMMENDATION_CATEGORY_IDS = RECOMMENDATION_CATEGORIES.map(c => c.id) as [string, ...string[]];

/** Look up a single category by id. Returns undefined for unknown slugs. */
export function getRecommendationCategory(id: string | null | undefined): RecommendationCategory | undefined {
    if (!id) return undefined;
    return RECOMMENDATION_CATEGORIES.find(c => c.id === id);
}

/** Get the published-report phrase for a slug (empty string when absent). */
export function getRecommendationPhrase(id: string | null | undefined): string {
    return getRecommendationCategory(id)?.defaultPhrase ?? '';
}
