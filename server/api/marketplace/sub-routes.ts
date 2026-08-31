/**
 * The marketplace routes that live outside `marketplace.ts`, mounted as one.
 *
 * They exist as separate files because that one is AT the 400-line ceiling —
 * which is also why they are aggregated here rather than mounted individually:
 * a parent already at its cap cannot afford a line per sub-router, and paying
 * one would make the ceiling decide where routes live by attrition.
 *
 * Each sub-router keeps its own file and its own reasoning; this one only
 * assembles them, and nothing else belongs in it.
 */
import { createApiRouter } from '../../lib/openapi-router';
import statutoryUpdateRoutes from './statutory-update';
import marketplaceUninstallRoutes from './uninstall';

const marketplaceSubRoutes = createApiRouter()
    .route('/', statutoryUpdateRoutes)
    .route('/', marketplaceUninstallRoutes);

export default marketplaceSubRoutes;
