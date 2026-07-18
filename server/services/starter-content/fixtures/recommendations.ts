/**
 * Recommendation fixtures — re-export of the canonical seed list at
 * `server/data/recommendation-seeds.ts` (80 entries across 9 categories).
 *
 * Keeping the constant in one place ensures the in-product
 * `POST /api/recommendations/seed` (RecommendationService.bulkSeed) and
 * the trial-onboarding starter-content flow share the same data.
 */

export { RECOMMENDATION_SEEDS as RECOMMENDATIONS } from '../../../data/recommendation-seeds';
