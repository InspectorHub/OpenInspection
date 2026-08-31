/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

import type { ItemChoice } from '../../../server/types/template-schema';

export type PropertyType = 'single-family' | 'multi-unit' | 'commercial';

export interface SectionApplicability {
  propertyTypes?: PropertyType[];
  commercialSubtypes?: string[];
}

export const PROPERTY_TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: 'single-family', label: 'Single-family' },
  { value: 'multi-unit',    label: 'Multi-unit' },
  { value: 'commercial',    label: 'Commercial' },
];

export interface CannedComment {
  id: string;
  title: string;
  comment: string;
  default?: boolean;
  category?: string;
  location?: string;
  photos?: string[];
  /** Optional shortcode typed in the editor to fill this comment (≤ 12 chars). */
  abbrev?: string;
}

interface ItemOptions {
  min?: number | null;
  max?: number | null;
  unit?: string;
  step?: number | null;
  placeholder?: string;
  maxLength?: number | null;
  choices?: string[];
  minPhotos?: number | null;
}

interface Attribute {
  id: string;
  name: string;
  type: string;
  /** Bare string = value and label are the same word; the pair carries an
   *  authority form's printed wording beside the token that gets stored. The
   *  editor passes `attributes` through untouched (see
   *  `serializeItemForSave`), so this only has to be wide enough not to
   *  narrow a statutory template on a round trip through the author's screen —
   *  a `string[]` here would have made saving one strip every label. */
  choices?: ItemChoice[];
  unit?: string;
  required?: boolean;
  isSafety?: boolean;
  isDefect?: boolean;
}

export interface TemplateItem {
  id: string;
  label: string;
  type: string;
  description?: string;
  icon?: string;
  required?: boolean;
  isSafety?: boolean;
  /** Prose remedy. No defaultEstimateMin / defaultEstimateMax beside it — the
   *  template write schema rejects a repair price (see
   *  `server/types/template-schema.ts`). */
  defaultRecommendation?: string;
  ratingOptions?: string[];
  tabs?: {
    information: CannedComment[];
    limitations: CannedComment[];
    defects: CannedComment[];
  };
  options?: ItemOptions;
  attributes?: Attribute[];
  source?: { platform: string; externalId: string } | null;
  /** The item this one nests under, within the same section. Null = top level. */
  parentId?: string | null;
  /** Author-written display number, printed beside the label. Distinct from the
   *  outline number the item list derives from the tree.
   *
   *  It was absent here, and absent from the editor's save serializer, while
   *  being present on the authority type, in the Zod base fields, in ITEM_KEYS
   *  and in the report projection — so authoring one and saving lost it, with
   *  nothing anywhere saying so. `lint:item-key-parity` exists because of this
   *  key, not because of `parentId`. */
  number?: string;
}

export interface TemplateSection {
  id: string;
  title: string;
  identifier?: string;
  icon?: string;
  disclaimerText?: string;
  alwaysPageBreak?: boolean;
  items: TemplateItem[];
  source?: { platform: string; externalId: string } | null;
  defaultScope?: 'common' | 'unit';
  applicableTo?: SectionApplicability;
}

export interface RatingLevel {
  id: string;
  label: string;
  abbreviation?: string;
  color?: string;
  severity?: string;
  isDefect?: boolean;
  pausesAdvance?: boolean;
  default?: boolean;
  description?: string;
}

export interface RatingSystem {
  name?: string;
  defaultLevelId?: string;
  levels: RatingLevel[];
  source?: unknown;
}

export interface TemplateSchema {
  schemaVersion: number;
  sections: TemplateSection[];
  ratingSystem?: RatingSystem;
  propertyType?: PropertyType;
  commercialSubtype?: string;
}

/* ------------------------------------------------------------------ */
/*  Rating presets                                                     */
/* ------------------------------------------------------------------ */

export const RATING_PRESETS: { name: string; levels: RatingLevel[] }[] = [
  { name: "Standard 3-Level", levels: [
    { id: "S", label: "Satisfactory", abbreviation: "S", color: "#22c55e", severity: "good", isDefect: false, default: true, description: "Item is functioning as intended." },
    { id: "M", label: "Monitor", abbreviation: "M", color: "#f59e0b", severity: "marginal", isDefect: false, default: false, description: "Functional but warrants periodic re-inspection." },
    { id: "D", label: "Defect", abbreviation: "D", color: "#ef4444", severity: "significant", isDefect: true, default: false, description: "Broken or unsafe; recommend repair." },
  ]},
  { name: "Standard 5-Level", levels: [
    { id: "S", label: "Satisfactory", abbreviation: "Sat", color: "#22c55e", severity: "good", isDefect: false, default: true, description: "Item is functioning as intended." },
    { id: "M", label: "Monitor", abbreviation: "Mon", color: "#f59e0b", severity: "marginal", isDefect: false, default: false, description: "Functional but shows wear." },
    { id: "D", label: "Defect", abbreviation: "D", color: "#ef4444", severity: "significant", isDefect: true, default: false, description: "Broken or unsafe." },
    { id: "NI", label: "Not Inspected", abbreviation: "NI", color: "#9ca3af", severity: "minor", isDefect: false, default: false, description: "Could not be inspected." },
    { id: "NP", label: "Not Present", abbreviation: "NP", color: "#6b7280", severity: "minor", isDefect: false, default: false, description: "Not present at this property." },
  ]},
  { name: "TREC", levels: [
    { id: "I", label: "Inspected", abbreviation: "I", color: "#22c55e", severity: "good", isDefect: false, default: true, description: "Meets Texas Standards of Practice." },
    { id: "D", label: "Deficient", abbreviation: "D", color: "#ef4444", severity: "significant", isDefect: true, default: false, description: "Deficiencies warrant repair." },
    { id: "NI", label: "Not Inspected", abbreviation: "NI", color: "#9ca3af", severity: "minor", isDefect: false, default: false, description: "Not inspected per Standards." },
    { id: "NP", label: "Not Present", abbreviation: "NP", color: "#6b7280", severity: "minor", isDefect: false, default: false, description: "Not present." },
    { id: "INR", label: "In Need of Repair", abbreviation: "INR", color: "#f97316", severity: "significant", isDefect: true, default: false, description: "Requires repair." },
  ]},
];

export const ITEM_TYPES = ["rich", "boolean", "text", "textarea", "number", "select", "multi_select", "date", "photo_only"] as const;
