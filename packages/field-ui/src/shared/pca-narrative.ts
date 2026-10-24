// server/lib/pca-narrative.ts

/**
 * Commercial PCA Phase S — editable narrative blocks for the report.
 *
 * Stored as the `pca_narrative` JSON column on `inspections`. Each block is a
 * free-prose region (textarea, NO RTE per the project notes=textarea rule)
 * seeded with ASTM-appropriate default copy so a fresh report is presentable
 * with zero editing. `userReliance` + `deviations` are STRUCTURED (Phase M /
 * the deviations store), not free prose, so they are not keys here.
 *
 * Pre-launch: the first-cut 5-block shape is RESET, not migrated — the resolver
 * just ignores unknown/old keys and falls back to seed.
 */
export interface PcaNarrative {
  transmittalLetter: string;
  summaryGeneralDescription: string;
  summaryPhysicalCondition: string;
  summaryRecommendations: string;
  purpose: string;
  scopeOfWork: string; // methodology folds in here (no separate chapter)
  limitationsExceptions: string;
  reconnaissance: string;
  additionalConsiderations: string;
}

export const PCA_NARRATIVE_SEED: PcaNarrative = {
  transmittalLetter:
    'This Property Condition Report has been prepared at your request and in accordance with the agreed scope of work. The accompanying report presents our observations, opinions of cost, and recommendations based on a walk-through survey of the subject property.',
  summaryGeneralDescription:
    'The subject property consists of the improvements identified in the General Property Description. This summary states the property facts, the consultant and user, their relationship, the transaction, the purpose of this assessment, and the date of the site visit.',
  summaryPhysicalCondition:
    'In our opinion, the property is in generally average condition for its age and use, with the material physical deficiencies and recommended actions noted in the body of this report.',
  summaryRecommendations:
    'We recommend addressing the material physical deficiencies identified herein. Where specialist evaluation is warranted, follow-up assessments are referenced in the appendices.',
  purpose:
    'The purpose of this assessment is to observe and document the physical condition of the property in support of the user’s position in the contemplated transaction.',
  scopeOfWork:
    'The scope of work comprised a walk-through survey of the readily accessible areas of the improvements, review of available documents, and interviews where practicable. The methods used are described in this section; no destructive or invasive testing was performed.',
  limitationsExceptions:
    'This assessment was limited to readily accessible areas observed at the time of the site visit. Concealed conditions, components not in service, and areas not made available were not evaluated. The observations represent the conditions existing on the date of the survey only.',
  reconnaissance:
    'A general reconnaissance of the property and its immediate surroundings was performed to observe site conditions, access, and the relationship of the improvements to adjacent uses.',
  additionalConsiderations:
    'The following considerations are outside the baseline scope of this assessment and are provided for the user’s information only: natural hazards, mold, and accessibility (ADA) are not assessed unless a separate add-on scope was engaged.',
};

const KEYS = Object.keys(PCA_NARRATIVE_SEED) as (keyof PcaNarrative)[];

/**
 * Overlay stored non-empty blocks onto the seed. Empty/whitespace/missing keys
 * fall back to seed; unknown (old-shape) keys are ignored. Never throws.
 */
export function resolvePcaNarrative(raw: unknown): PcaNarrative {
  const stored = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...PCA_NARRATIVE_SEED };
  for (const key of KEYS) {
    const v = stored[key];
    if (typeof v === 'string' && v.trim().length > 0) out[key] = v;
  }
  return out;
}
