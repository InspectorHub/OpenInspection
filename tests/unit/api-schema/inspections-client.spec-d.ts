import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { Hono } from 'hono';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { InspectionsApi } from '../../../server/api/inspections';
import type { ResultsBatchResponseSchema, ResultsBatchSchema, CreateReinspectionSchema } from '../../../server/lib/validations/inspection.schema';
import type {
    AddInspectionServiceSchema,
    InspectionServiceResponseSchema,
} from '../../../server/lib/validations/service.schema';
import type { SuccessResponseSchema } from '../../../server/lib/validations/shared.schema';

type Client = ReturnType<typeof hc<InspectionsApi>>;
type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;
// hc adds $url and $path helpers next to the methods; they are not routes. Routes at the root path sit under 'index'.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

/**
 * Every path the inspections router served when it was one chain of `.route('/', child)` calls, read from the
 * declaration the chain produced before the conversion (126 distinct paths).
 */
type ChainPaths =
    | '/'
    | '/:id'
    | '/:id/agent-token'
    | '/:id/agreement'
    | '/:id/agreement-requests'
    | '/:id/cancel'
    | '/:id/cancellation-quote'
    | '/:id/clone'
    | '/:id/collab/followup'
    | '/:id/collab/import'
    | '/:id/collab/restore'
    | '/:id/collab/restructure'
    | '/:id/collab/snapshots'
    | '/:id/collab/snapshots/:seq'
    | '/:id/collab/ticket'
    | '/:id/collab/ws'
    | '/:id/communication'
    | '/:id/complete'
    | '/:id/compliance'
    | '/:id/compliance/doc-review/:documentKey'
    | '/:id/compliance/doc-review/seed'
    | '/:id/compliance/psq'
    | '/:id/compliance/psq/status'
    | '/:id/compliance/signoff'
    | '/:id/compliance/signoff/:role'
    | '/:id/concierge/approve'
    | '/:id/confirm'
    | '/:id/cost-export.csv'
    | '/:id/cost-export.xlsx'
    | '/:id/cost-items'
    | '/:id/cost-items/:itemId'
    | '/:id/cover'
    | '/:id/export/:exportId'
    | '/:id/export/:exportId/download'
    | '/:id/export/word'
    | '/:id/hub'
    | '/:id/items/:itemId/photos/:photoIndex/annotation'
    | '/:id/items/:itemId/photos/:photoIndex/crop'
    | '/:id/items/:itemId/photos/:photoIndex/detach'
    | '/:id/items/:itemId/photos/:photoIndex/move'
    | '/:id/items/:itemId/photos/:photoIndex/revert'
    | '/:id/items/:itemId/photos/reorder'
    | '/:id/media'
    | '/:id/media/:mediaId/annotations'
    | '/:id/media/attach'
    | '/:id/media/pool/:poolId'
    | '/:id/media/upload'
    | '/:id/media/upload-url'
    | '/:id/media/video/:streamUid'
    | '/:id/media/video/create-upload'
    | '/:id/media/video/finalize'
    | '/:id/media/video/poster'
    | '/:id/pay-splits'
    | '/:id/pay-splits/:splitId'
    | '/:id/pay-splits/:splitId/corrections'
    | '/:id/pay-splits/refresh'
    | '/:id/pay-splits/refresh-preview'
    | '/:id/pca-narrative'
    | '/:id/pdf'
    | '/:id/pdf/refresh'
    | '/:id/people'
    | '/:id/people/:personId'
    | '/:id/people/:personId/make-primary'
    | '/:id/people/:personId/reset-access'
    | '/:id/photo'
    | '/:id/preflight'
    | '/:id/presence/ws'
    | '/:id/property-facts'
    | '/:id/property-facts/autofill'
    | '/:id/publish'
    | '/:id/publish-readiness'
    | '/:id/recipients'
    | '/:id/recommendations'
    | '/:id/reinspect'
    | '/:id/reinspect-candidates'
    | '/:id/relock-report'
    | '/:id/repair-list'
    | '/:id/repair-requests'
    | '/:id/report'
    | '/:id/report-data'
    | '/:id/report-link-expiry'
    | '/:id/report-translation'
    | '/:id/reports/:reportId'
    | '/:id/reports/:reportId/narrative'
    | '/:id/results'
    | '/:id/results/batch'
    | '/:id/return'
    | '/:id/schedule'
    | '/:id/send-report-pdf'
    | '/:id/send-sms'
    | '/:id/services'
    | '/:id/services/:lineId'
    | '/:id/share-agent'
    | '/:id/statutory-details'
    | '/:id/statutory-form'
    | '/:id/statutory-form.pdf'
    | '/:id/statutory-form/coverage'
    | '/:id/statutory-form/instances'
    | '/:id/statutory-form/preview.pdf'
    | '/:id/submit'
    | '/:id/switch-rating-system'
    | '/:id/template-snapshot'
    | '/:id/uncancel'
    | '/:id/unit-mode'
    | '/:id/unit-progress'
    | '/:id/units'
    | '/:id/units/:unitId'
    | '/:id/units/:unitId/duplicate'
    | '/:id/units/:unitId/move'
    | '/:id/units/bulk'
    | '/:id/unlock-report'
    | '/:id/unpublish'
    | '/:id/upload'
    | '/:id/versions'
    | '/:id/versions/:n'
    | '/:id/versions/:n/diff'
    | '/bulk'
    | '/counts'
    | '/dashboard'
    | '/inspectors'
    | '/schedule-conflicts'
    | '/templates'
    | '/templates/:id'
    | '/templates/count'
    | '/templates/duplicates'
    | '/wizard';

// Compile-time only (run by `npm run test:types`). `InspectionsApi` is derived from `inspectionsRouteParts`: the
// sub-routers written as statements are listed with their route configs (`mounted`), the ones still written as
// chains with `legacyMounted` (their schema is read from their own type). A mount left out of the list, or one
// that moves a path, fails here.
describe('InspectionsApi client', () => {
    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<InspectionsApi>>().toEqualTypeOf<ChainPaths>();
    });

    it('has the same top-level segments, so a dropped sub-router shows up', () => {
        expectTypeOf<Keys<Client>>().toEqualTypeOf<
            'index' | ':id' | 'bulk' | 'counts' | 'dashboard' | 'inspectors' | 'schedule-conflicts' | 'templates' | 'wizard'
        >();
        expectTypeOf<Client[':id']>().toHaveProperty('$get');
        expectTypeOf<Client[':id']>().toHaveProperty('$patch');
        expectTypeOf<Client[':id']>().toHaveProperty('$delete');
        expectTypeOf<Keys<Client['templates']>>().toEqualTypeOf<
            '$get' | '$post' | ':id' | 'count' | 'duplicates'
        >();
    });

    it('exposes a route of a converted sub-router, typed from its declared schemas', () => {
        expectTypeOf<Client[':id']['services']>().toHaveProperty('$post');
        expectTypeOf<Client[':id']['services'][':lineId']>().toHaveProperty('$patch');
        expectTypeOf<Client[':id']['services'][':lineId']>().toHaveProperty('$delete');
        type Add = InferRequestType<Client[':id']['services']['$post']>;
        expectTypeOf<Add['json']>().toEqualTypeOf<z.input<typeof AddInspectionServiceSchema>>();
        expectTypeOf<keyof Add['param']>().toEqualTypeOf<'id'>();
        type Added = InferResponseType<Client[':id']['services']['$post'], 201>;
        expectTypeOf<Added>().toEqualTypeOf<z.output<typeof InspectionServiceResponseSchema>>();
        type Batch = InferRequestType<Client[':id']['results']['batch']['$post']>;
        expectTypeOf<Batch['json']>().toEqualTypeOf<z.input<typeof ResultsBatchSchema>>();
        type Batched = InferResponseType<Client[':id']['results']['batch']['$post'], 200>;
        expectTypeOf<Batched>().toEqualTypeOf<z.output<typeof ResultsBatchResponseSchema>>();
    });

    it('exposes the routes of the publish, media studio and report delivery sub-routers, now listed with their route configs', () => {
        type Reinspect = InferRequestType<Client[':id']['reinspect']['$post']>;
        expectTypeOf<Reinspect['json']>().toEqualTypeOf<z.input<typeof CreateReinspectionSchema>>();
        type Completed = InferResponseType<Client[':id']['complete']['$post'], 200>;
        expectTypeOf<Completed>().toEqualTypeOf<z.output<typeof SuccessResponseSchema>>();
        expectTypeOf<Client[':id']['publish']>().toHaveProperty('$post');
        // The confirm route is defined in publish-routes.ts and the agent routes in report-delivery-routes.ts.
        expectTypeOf<Client[':id']['confirm']>().toHaveProperty('$post');
        expectTypeOf<Client[':id']['agent-token']>().toHaveProperty('$post');
        expectTypeOf<Client[':id']['share-agent']>().toHaveProperty('$post');
        expectTypeOf<Client[':id']['media']['video']['create-upload']>().toHaveProperty('$post');
        expectTypeOf<Client[':id']['cover']>().toHaveProperty('$post');
        expectTypeOf<Client[':id']['report-data']>().toHaveProperty('$get');
    });

    it('exposes a route of a sub-router that is still a chain, typed from its own schema', () => {
        // collab (and core, agreements, agreement-sign) cannot list their routes: they hold native handlers.
        expectTypeOf<Client[':id']['collab']['ws']>().toHaveProperty('$get');
        // The retired HTML report route is a native handler too, so it is its own router, mounted with legacyMounted.
        expectTypeOf<Client[':id']['report']>().toHaveProperty('$get');
    });

    it('does not expose methods or paths that nothing registered', () => {
        // @ts-expect-error no such path
        type Missing = Client['refunds'];
        expectTypeOf<Missing>().toBeAny();
        // @ts-expect-error complete is POST only
        type NoGet = Client[':id']['complete']['$get'];
        expectTypeOf<NoGet>().toBeAny();
        // @ts-expect-error a service line is repriced or removed, never read on its own
        type NoLineGet = Client[':id']['services'][':lineId']['$get'];
        expectTypeOf<NoLineGet>().toBeAny();
    });
});
