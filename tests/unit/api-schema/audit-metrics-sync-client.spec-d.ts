import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { Hono } from 'hono';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { AuditApi } from '../../../server/api/audit';
import type { InspectionSyncApi } from '../../../server/api/inspection-sync';
import type { MetricsApi } from '../../../server/api/metrics';
import type { EntityAuditResponseSchema } from '../../../server/lib/validations/audit.schema';
import type { MetricsApiResponseSchema, MetricsQuerySchema } from '../../../server/lib/validations/metrics.schema';
import type { InspectorSignatureSchema } from '../../../server/lib/validations/sync.schema';

type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;

// Compile-time only. Each of these routers is derived from its own route config tuple; the paths are the ones the
// chained routers served (read from the declarations the chains produced), the shapes come from the zod schemas.
describe('AuditApi client', () => {
    type Client = ReturnType<typeof hc<AuditApi>>;

    it('serves exactly the path the chained router served', () => {
        expectTypeOf<keyof SchemaOf<AuditApi>>().toEqualTypeOf<'/entity/:entityId'>();
    });

    it('types the trail read from its declared schema', () => {
        type Trail = InferResponseType<Client['entity'][':entityId']['$get'], 200>;
        expectTypeOf<Trail>().toEqualTypeOf<z.output<typeof EntityAuditResponseSchema>>();
        // @ts-expect-error the trail is read only
        type NoPost = Client['entity'][':entityId']['$post'];
        expectTypeOf<NoPost>().toBeAny();
    });
});

describe('MetricsApi client', () => {
    type Client = ReturnType<typeof hc<MetricsApi>>;

    it('serves exactly the path the chained router served', () => {
        expectTypeOf<keyof SchemaOf<MetricsApi>>().toEqualTypeOf<'/'>();
    });

    it('types the aggregates from their declared schemas', () => {
        type Query = InferRequestType<Client['index']['$get']>;
        expectTypeOf<Query['query']>().toEqualTypeOf<z.input<typeof MetricsQuerySchema>>();
        type Metrics = InferResponseType<Client['index']['$get'], 200>;
        expectTypeOf<Metrics>().toEqualTypeOf<z.output<typeof MetricsApiResponseSchema>>();
    });
});

describe('InspectionSyncApi client', () => {
    type Client = ReturnType<typeof hc<InspectionSyncApi>>;

    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<InspectionSyncApi>>().toEqualTypeOf<
            '/:id/inspector-signature' | '/:id/items/:itemId/photos/:photoIndex' | '/:id/template/upgrade'
        >();
    });

    it('types the routes from their declared schemas', () => {
        type Sign = InferRequestType<Client[':id']['inspector-signature']['$post']>;
        expectTypeOf<Sign['json']>().toEqualTypeOf<z.input<typeof InspectorSignatureSchema>>();
        expectTypeOf<Client[':id']['template']['upgrade']>().toHaveProperty('$post');
        expectTypeOf<keyof InferRequestType<Client[':id']['items'][':itemId']['photos'][':photoIndex']['$delete']>['param']>().toEqualTypeOf<
            'id' | 'itemId' | 'photoIndex'
        >();
        // @ts-expect-error the template upgrade is POST only
        type NoGet = Client[':id']['template']['upgrade']['$get'];
        expectTypeOf<NoGet>().toBeAny();
    });
});
