// Barrel for the admin-domain Zod schemas. The schemas are grouped by concern
// under ./admin/ (settings / compliance / agreement / m2m / onboarding); this
// file re-exports them so all `from '.../admin.schema'` import sites stay
// unchanged. `CommentSchema` and its sibling comment schemas are an
// inspection-domain concern and live in ./comment.schema; they are re-exported
// here for back-compat with existing admin.schema importers.
export * from './admin/settings';
export * from './admin/compliance';
export * from './admin/agreement';
export * from './admin/m2m';
export * from './admin/onboarding';
export * from './comment.schema';
