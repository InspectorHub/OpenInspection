// server/lib/pca-reliance-text.ts

/**
 * Commercial PCA Phase M — seeded reliance / point-in-time / site-specific
 * disclaimer text (ASTM §4.2.1–4.2.4). Defaults the Phase S §2.5 (User Reliance)
 * and Limitations regions so the legal boilerplate is never missing; the
 * inspector may edit it. Plain text (textarea, no RTE — project decision).
 */
export const RELIANCE_TEMPLATES = {
  userReliance:
    'This Property Condition Report has been prepared for the exclusive use and ' +
    'reliance of the named User and its designated representatives in connection ' +
    'with the identified transaction. No other party may rely on this report ' +
    'without the prior written authorization of the Consultant.',
  pointInTime:
    'The observations and opinions in this report describe the condition of the ' +
    'subject property as of the date of the site visit. Property conditions may ' +
    'change after that date; the Consultant assumes no obligation to update the ' +
    'report to reflect events or conditions arising after the site visit.',
  siteSpecific:
    'This report is specific to the subject property and the scope of work agreed ' +
    'with the User. It is not a comprehensive engineering study, code-compliance ' +
    'survey, or warranty of the property, and it should be read together with the ' +
    'Limitations & Exceptions stated herein.',
} as const;
