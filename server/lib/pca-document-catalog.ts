// server/lib/pca-document-catalog.ts

/**
 * Commercial PCA Phase M — ASTM E2018 §8.6 owner/user document-review catalog.
 * Seeded into document_review_items per inspection. Items not provided are
 * stated as limitations in the report, never silently dropped. Includes the
 * real-PCA sub-items Zoning Compliance ("legally conforming") and Previous
 * Reports reviewed (spec §5).
 */
export const DOCUMENT_REVIEW_CATALOG = [
  { documentKey: 'certificate_of_occupancy', label: 'Certificate of Occupancy', sortOrder: 10 },
  { documentKey: 'code_fire_violations',     label: 'Building code / fire-safety violation records', sortOrder: 20 },
  { documentKey: 'prior_pcrs',               label: 'Prior Property Condition Reports', sortOrder: 30 },
  { documentKey: 'drawings_specs',           label: 'Construction drawings & specifications', sortOrder: 40 },
  { documentKey: 'rent_roll',                label: 'Rent roll / occupancy schedule', sortOrder: 50 },
  { documentKey: 'ada_fha_evaluations',      label: 'ADA / FHA accessibility evaluations', sortOrder: 60 },
  { documentKey: 'system_age_records',       label: 'Major-system age / installation records', sortOrder: 70 },
  { documentKey: 'historical_repair_costs',  label: 'Historical repair & replacement costs', sortOrder: 80 },
  { documentKey: 'warranties',               label: 'Equipment & roof warranties', sortOrder: 90 },
  { documentKey: 'appraisals',               label: 'Appraisals', sortOrder: 100 },
  { documentKey: 'maintenance_records',      label: 'Preventive-maintenance records', sortOrder: 110 },
  { documentKey: 'service_contracts',        label: 'Service / maintenance contracts', sortOrder: 120 },
  { documentKey: 'environmental_reports',    label: 'Environmental reports (Phase I/II ESA)', sortOrder: 130 },
  { documentKey: 'capital_improvement_plan', label: 'Capital improvement / replacement plan', sortOrder: 140 },
  { documentKey: 'utility_bills',            label: 'Utility bills / consumption history', sortOrder: 150 },
  { documentKey: 'zoning_compliance',        label: 'Zoning compliance ("legally conforming")', sortOrder: 160 },
  { documentKey: 'previous_reports',         label: 'Previous reports reviewed', sortOrder: 170 },
] as const;

export type DocumentCatalogEntry = (typeof DOCUMENT_REVIEW_CATALOG)[number];
