import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { Hono } from 'hono';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { TagsApi } from '../../../server/api/tags';
import type {
    CreateTagSchema,
    TagDeleteResponseSchema,
    TagListResponseSchema,
    TagSingleResponseSchema,
    UpdateTagSchema,
} from '../../../server/lib/validations/tag.schema';

type Client = ReturnType<typeof hc<TagsApi>>;
type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;
// hc adds $url and $path helpers next to the methods; they are not routes. Routes at the root path sit under 'index'.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

// Compile-time only. `TagsApi` (the tag library, mounted at /api/tags) is derived from `tagsRouteConfigs`; a route left
// out of the list, or one that moves a path, fails here. The item-link router in the same file is still a chain.
describe('TagsApi client', () => {
    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<TagsApi>>().toEqualTypeOf<'/' | '/:id' | '/:id/inspections'>();
        expectTypeOf<Keys<Client>>().toEqualTypeOf<'index' | ':id'>();
        expectTypeOf<Keys<Client['index']>>().toEqualTypeOf<'$get' | '$post'>();
        expectTypeOf<Keys<Client[':id']>>().toEqualTypeOf<'$put' | '$delete' | 'inspections'>();
    });

    it('types the routes from their declared schemas', () => {
        type Create = InferRequestType<Client['index']['$post']>;
        expectTypeOf<Create['json']>().toEqualTypeOf<z.input<typeof CreateTagSchema>>();
        type Created = InferResponseType<Client['index']['$post'], 200>;
        expectTypeOf<Created>().toEqualTypeOf<z.output<typeof TagSingleResponseSchema>>();
        type List = InferResponseType<Client['index']['$get'], 200>;
        expectTypeOf<List>().toEqualTypeOf<z.output<typeof TagListResponseSchema>>();
        type Update = InferRequestType<Client[':id']['$put']>;
        expectTypeOf<Update['json']>().toEqualTypeOf<z.input<typeof UpdateTagSchema>>();
        expectTypeOf<keyof Update['param']>().toEqualTypeOf<'id'>();
        type Deleted = InferResponseType<Client[':id']['$delete'], 200>;
        expectTypeOf<Deleted>().toEqualTypeOf<z.output<typeof TagDeleteResponseSchema>>();
        expectTypeOf<Client[':id']['inspections']>().toHaveProperty('$get');
    });

    it('does not expose methods or paths that nothing registered', () => {
        // @ts-expect-error no such path
        type Missing = Client['colours'];
        expectTypeOf<Missing>().toBeAny();
        // @ts-expect-error a tag is replaced or removed, never read on its own
        type NoGet = Client[':id']['$get'];
        expectTypeOf<NoGet>().toBeAny();
        // @ts-expect-error the item links live on the inspection router, not here
        type NoItems = Client[':id']['items'];
        expectTypeOf<NoItems>().toBeAny();
    });
});
