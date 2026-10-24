/**
 * The marketplace routes that live outside `marketplace.ts`, mounted as one.
 *
 * They exist as separate files because that one was at the 400-line ceiling —
 * which is also why they are aggregated here rather than mounted individually:
 * a parent at its cap cannot afford a line per sub-router, and paying
 * one would make the ceiling decide where routes live by attrition.
 *
 * Each sub-router keeps its own file and its own reasoning; this one only
 * assembles them, and nothing else belongs in it.
 */
import { createApiRouter } from '../../lib/openapi-router';
import { mounted } from '../../lib/api-schema';
import statutoryUpdateRoutes, { statutoryUpdateRouteConfigs } from './statutory-update';
import marketplaceUninstallRoutes, { marketplaceUninstallRouteConfigs } from './uninstall';

const app = createApiRouter();
app.route('/', statutoryUpdateRoutes);
app.route('/', marketplaceUninstallRoutes);

/** Registration order, mounts included. Drives the typed client; a test pins it to what `app` really registered. */
export const marketplaceSubRouteParts = [
    mounted('/', statutoryUpdateRoutes, statutoryUpdateRouteConfigs),
    mounted('/', marketplaceUninstallRoutes, marketplaceUninstallRouteConfigs),
] as const;

export default app;
