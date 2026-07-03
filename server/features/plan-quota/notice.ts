import { FREE_TIER_CAPS } from './policy';

/**
 * Free-tier usage quotas (2026-07), Task 8 — pure threshold detector for the
 * inspection-creation notice email. Given the lifetime `inspections` count
 * just read after a successful create/clone/wizard call, returns which
 * notice (if any) should fire:
 *   - `4` -> the tenant just used their 4th inspection ("one free
 *     inspection left" warning).
 *   - `5` -> the tenant just hit the cap (existing inspections stay usable;
 *     new ones require a subscription).
 *   - `null` -> no notice at this count (below 4, or past 5 — the cap
 *     itself blocks further creates, so this count is never revisited).
 *
 * The threshold is derived from `FREE_TIER_CAPS.inspections` (not
 * hardcoded) so the two stay coupled to one source of truth.
 */
export function noticeFor(count: number): 4 | 5 | null {
    const cap = FREE_TIER_CAPS.inspections;
    if (count === cap) return 5;
    if (count === cap - 1) return 4;
    return null;
}
