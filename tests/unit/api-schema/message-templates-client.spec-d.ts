import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { MessageTemplatesApi } from '../../../server/api/message-templates';
import type {
    CreateMessageTemplateSchema,
    MessageTemplateListResponseSchema,
    MessageTemplateSchema,
    PreviewMessageTemplateSchema,
    UpdateMessageTemplateSchema,
} from '../../../server/lib/validations/message-template.schema';

type Client = ReturnType<typeof hc<MessageTemplatesApi>>;

// Compile-time only (run by `npm run test:types`). Expected shapes come from the zod schemas the
// routes declare, so a route missing from `messageTemplateRouteConfigs`, or an input/output that
// stops following its schema, fails here.
describe('MessageTemplatesApi client (derived from the route configs)', () => {
    it('exposes every route as a client method', () => {
        expectTypeOf<Client['index']>().toHaveProperty('$get');
        expectTypeOf<Client['index']>().toHaveProperty('$post');
        expectTypeOf<Client[':id']>().toHaveProperty('$patch');
        expectTypeOf<Client[':id']>().toHaveProperty('$delete');
        expectTypeOf<Client[':id']['duplicate']>().toHaveProperty('$post');
        expectTypeOf<Client['preview']>().toHaveProperty('$post');
        expectTypeOf<Client['test-send']>().toHaveProperty('$post');
    });

    it('types request bodies from the declared request schemas', () => {
        expectTypeOf<InferRequestType<Client['index']['$post']>['json']>().toEqualTypeOf<z.input<typeof CreateMessageTemplateSchema>>();
        expectTypeOf<InferRequestType<Client[':id']['$patch']>['json']>().toEqualTypeOf<z.input<typeof UpdateMessageTemplateSchema>>();
        expectTypeOf<InferRequestType<Client['preview']['$post']>['json']>().toEqualTypeOf<z.input<typeof PreviewMessageTemplateSchema>>();
    });

    it('types responses from the declared response schemas', () => {
        type List = InferResponseType<Client['index']['$get'], 200>;
        type Created = InferResponseType<Client['index']['$post'], 201>;
        expectTypeOf<List>().toEqualTypeOf<z.output<typeof MessageTemplateListResponseSchema>>();
        expectTypeOf<Created['data']>().toEqualTypeOf<z.output<typeof MessageTemplateSchema>>();
    });
});
