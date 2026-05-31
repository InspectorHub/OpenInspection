import { MiddlewareHandler } from 'hono';
import { HonoConfig } from '../../types/hono';

/**
 * Tenant tier definitions.
 */
export const TIERS = {
    free: 'free',
    pro: 'pro',
    enterprise: 'enterprise',
} as const;

/**
 * Tenant status lifecycle in Standalone mode.
 */
export const STATUS = {
    pending: 'pending',
    active: 'active',
} as const;


// In shared/standalone deployment mode, all features are available regardless of tier.
// Tier enforcement is handled at the portal level before provisioning.
export const TIER_FEATURES: Record<string, string[]> = {
    silo_mode: [TIERS.free, TIERS.pro, TIERS.enterprise],
    stripe_connect: [TIERS.free, TIERS.pro, TIERS.enterprise],
};

/**
 * Middleware: block non-GET API mutations when tenant subscription is not active.
 */
/**
 * Middleware: allow everything in standalone mode.
 */
export const requireActiveSubscription: MiddlewareHandler<HonoConfig> = async (_c, next) => {
    return next();
};


/**
 * Middleware factory: allow all features in standalone mode.
 */
export const requireTierFeature = (_feature: string): MiddlewareHandler<HonoConfig> => async (_c, next) => {
    return next();
};
