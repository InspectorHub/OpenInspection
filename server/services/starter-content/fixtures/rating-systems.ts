/**
 * Rating-system fixtures — re-export of the canonical seed list at
 * `server/data/rating-system-seeds.ts` (four ship-with-product systems).
 *
 * Keeping the constant in one place ensures the in-product
 * `RatingSystemService.seedDefaults` and the trial-onboarding
 * starter-content flow share the same data.
 */

export { RATING_SYSTEM_SEEDS as RATING_SYSTEMS } from '../../../data/rating-system-seeds';
