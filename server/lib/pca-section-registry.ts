/**
 * Commercial PCA Phase S — the canonical ordered report section registry.
 *
 * This is the SINGLE source of section ids / levels / titles / order for the
 * PCA report. Sections render from it (gated by tier + content presence).
 * Phase O does NOT build its own list — it projects a TOC (page numbers) over
 * this registry, so the registry must exist before O. Server-only: never
 * import this into `app/` (the report layer consumes the re-declared types in
 * report/types.ts across the server/app boundary).
 *
 * Order follows real-PCA convention (ASTM §11.1 does not fix a format): the
 * §7.3 / §11.10 Limiting Conditions are pulled UP FRONT to §2.3, and there is
 * no standalone Methodology chapter (it folds into §2.2 Scope of Work).
 */
export type PcaSectionTier = 'light' | 'full';

export interface PcaSectionEntry {
  /** Stable id. Dotted ids are subsections (e.g. `summary.deviations`). */
  id: string;
  /** Heading depth. 0 = front-matter block; 1 = numbered chapter; 2 = subsection. */
  level: number;
  title: string;
  /** Tiers this section renders in. `light` omits PCA-only front matter. */
  tiers: PcaSectionTier[];
}

const FULL: PcaSectionTier[] = ['full'];
const BOTH: PcaSectionTier[] = ['light', 'full'];

export const PCA_SECTION_REGISTRY: readonly PcaSectionEntry[] = [
  { id: 'cover', level: 0, title: 'Cover', tiers: BOTH },
  { id: 'transmittal-letter', level: 0, title: 'Transmittal Letter', tiers: FULL },
  { id: 'systems-summary', level: 0, title: 'Systems Summary', tiers: FULL },
  { id: 'pca-summary', level: 0, title: 'PCA Summary', tiers: BOTH },
  { id: 'toc', level: 0, title: 'Table of Contents', tiers: BOTH },

  { id: 'summary', level: 1, title: 'Summary', tiers: BOTH },
  { id: 'summary.general-description', level: 2, title: 'General Description', tiers: BOTH },
  { id: 'summary.physical-condition', level: 2, title: 'General Physical Condition', tiers: BOTH },
  { id: 'summary.opinion-of-cost', level: 2, title: 'Opinion of Cost', tiers: BOTH },
  { id: 'summary.deviations', level: 2, title: 'Deviations from the Guide', tiers: BOTH },
  { id: 'summary.recommendations', level: 2, title: 'Recommendations', tiers: BOTH },

  { id: 'introduction', level: 1, title: 'Introduction', tiers: BOTH },
  { id: 'introduction.purpose', level: 2, title: 'Purpose', tiers: BOTH },
  { id: 'introduction.scope-of-work', level: 2, title: 'Scope of Work', tiers: BOTH },
  { id: 'introduction.limitations-exceptions', level: 2, title: 'Limitations & Exceptions', tiers: BOTH },
  { id: 'introduction.reconnaissance', level: 2, title: 'General Property Reconnaissance', tiers: BOTH },
  { id: 'introduction.user-reliance', level: 2, title: 'User Reliance', tiers: BOTH },

  { id: 'property-description', level: 1, title: 'General Property Description', tiers: BOTH },
  { id: 'document-review', level: 1, title: 'Document Review & Interviews', tiers: BOTH },
  { id: 'site', level: 1, title: 'Site', tiers: BOTH },
  { id: 'structural-envelope', level: 1, title: 'Structural Frame & Building Envelope', tiers: BOTH },
  { id: 'mep', level: 1, title: 'Mechanical, Electrical & Plumbing', tiers: BOTH },
  { id: 'interior', level: 1, title: 'Interior Elements', tiers: BOTH },
  { id: 'life-safety', level: 1, title: 'Life Safety / Fire Protection', tiers: BOTH },
  { id: 'additional-considerations', level: 1, title: 'Additional Considerations', tiers: BOTH },
];

/**
 * Render-order gate (Phase T consumes this). Returns the registry filtered to
 * the entries that render in `tier`. The `light` tier drops the PCA-only
 * Transmittal Letter + Systems Summary front matter.
 */
export function gatedSectionRegistry(tier: PcaSectionTier): PcaSectionEntry[] {
  return PCA_SECTION_REGISTRY.filter((e) => e.tiers.includes(tier));
}
