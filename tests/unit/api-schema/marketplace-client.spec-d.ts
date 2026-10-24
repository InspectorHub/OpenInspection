import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { Hono } from 'hono';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { MarketplaceApi } from '../../../server/api/marketplace';
import type { ImportHistoryQuerySchema } from '../../../server/lib/validations/import-history.schema';
import type { LibraryReplaceBodySchema, LibraryReplacePreviewSchema } from '../../../server/lib/validations/library-replace.schema';

type Client = ReturnType<typeof hc<MarketplaceApi>>;
type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;
// hc adds $url and $path helpers next to the methods; they are not routes. Routes at the root path sit under 'index'.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

// Compile-time only (run by `npm run test:types`). `MarketplaceApi` (mounted at /api/templates/marketplace) is derived
// from `marketplaceRouteParts`: the nine routes defined in marketplace/route-defs.ts, then the sub-router mount that
// carries the statutory-update impact and uninstall routes. A route left out of the list, a mount left out, or one that
// moves a path, fails here. The path keys were read from the declaration the chained router produced before the conversion.
describe('MarketplaceApi client', () => {
    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<MarketplaceApi>>().toEqualTypeOf<
            | '/'
            | '/:id/import'
            | '/:id/statutory-update/impact'
            | '/:id/uninstall'
            | '/:id/update'
            | '/imports/history'
            | '/libraries'
            | '/libraries/:id/import'
            | '/libraries/:id/update'
            | '/libraries/:libraryId/imports/replace'
            | '/libraries/:libraryId/imports/replace/preview'
        >();
        expectTypeOf<Keys<Client>>().toEqualTypeOf<'index' | ':id' | 'imports' | 'libraries'>();
        expectTypeOf<Keys<Client['index']>>().toEqualTypeOf<'$get'>();
        expectTypeOf<Keys<Client[':id']>>().toEqualTypeOf<'import' | 'update' | 'statutory-update' | 'uninstall'>();
        expectTypeOf<Keys<Client['libraries']>>().toEqualTypeOf<'$get' | ':id' | ':libraryId'>();
        expectTypeOf<Keys<Client['libraries'][':libraryId']['imports']['replace']>>().toEqualTypeOf<'$post' | 'preview'>();
    });

    it('types the routes of the parent from their declared schemas', () => {
        type History = InferRequestType<Client['imports']['history']['$get']>;
        expectTypeOf<History['query']>().toEqualTypeOf<z.input<typeof ImportHistoryQuerySchema>>();
        type Listed = InferResponseType<Client['imports']['history']['$get'], 200>;
        expectTypeOf<Listed['data']['hasMore']>().toEqualTypeOf<boolean>();
        type Replace = InferRequestType<Client['libraries'][':libraryId']['imports']['replace']['$post']>;
        expectTypeOf<Replace['json']>().toEqualTypeOf<z.input<typeof LibraryReplaceBodySchema>>();
        expectTypeOf<keyof Replace['param']>().toEqualTypeOf<'libraryId'>();
        type Replaced = InferResponseType<Client['libraries'][':libraryId']['imports']['replace']['$post'], 200>;
        expectTypeOf<Replaced['data']['mode']>().toEqualTypeOf<'replace'>();
        type Preview = InferResponseType<Client['libraries'][':libraryId']['imports']['replace']['preview']['$get'], 200>;
        expectTypeOf<Preview['data']>().toEqualTypeOf<z.output<typeof LibraryReplacePreviewSchema>>();
        type Imported = InferResponseType<Client[':id']['import']['$post'], 201>;
        expectTypeOf<Imported['data']['localTemplateId']>().toEqualTypeOf<string | null>();
        type Updated = InferResponseType<Client[':id']['update']['$post'], 200>;
        expectTypeOf<keyof Updated['data']>().toEqualTypeOf<'newLocalId' | 'newName' | 'fromSemver' | 'toSemver'>();
    });

    it('types the routes of the mounted sub-routers from their declared schemas', () => {
        type Uninstall = InferRequestType<Client[':id']['uninstall']['$post']>;
        expectTypeOf<keyof Uninstall['param']>().toEqualTypeOf<'id'>();
        type Uninstalled = InferResponseType<Client[':id']['uninstall']['$post'], 200>;
        expectTypeOf<Uninstalled['data']['kind']>().toEqualTypeOf<'comments' | 'templates' | 'statutory'>();
        expectTypeOf<Uninstalled['data']['rowsAffected']>().toEqualTypeOf<number>();
        type Impact = InferResponseType<Client[':id']['statutory-update']['impact']['$get'], 200>;
        expectTypeOf<keyof Impact['data']>().toEqualTypeOf<'total' | 'producible' | 'blocked' | 'fromRevision' | 'toRevision'>();
        expectTypeOf<Impact['data']['fromRevision']>().toEqualTypeOf<string | null>();
    });

    it('does not expose methods or paths that nothing registered', () => {
        // @ts-expect-error no such path
        type Missing = Client['templates'];
        expectTypeOf<Missing>().toBeAny();
        // @ts-expect-error the catalogue is read, never written, at its root
        type NoPost = Client['index']['$post'];
        expectTypeOf<NoPost>().toBeAny();
        // @ts-expect-error uninstall is POST only
        type NoGet = Client[':id']['uninstall']['$get'];
        expectTypeOf<NoGet>().toBeAny();
        // @ts-expect-error the replace preview only reads
        type NoPreviewPost = Client['libraries'][':libraryId']['imports']['replace']['preview']['$post'];
        expectTypeOf<NoPreviewPost>().toBeAny();
    });
});
