import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { Hono } from 'hono';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { ClientDocumentsApi, InspectorDocumentsApi } from '../../../server/api/client-documents';
import type { ClientMessagesApi } from '../../../server/api/messages';

type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;
// hc adds $url and $path helpers next to the methods; they are not routes.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;
type ClientDocs = ReturnType<typeof hc<ClientDocumentsApi>>;
type InspectorDocs = ReturnType<typeof hc<InspectorDocumentsApi>>;
type ClientMessages = ReturnType<typeof hc<ClientMessagesApi>>;

// Compile-time only (run by `npm run test:types`). These three routers were plain `Hono` instances and had no typed
// keys at all; the keys below are new. Upload and download stay plain handlers and are not in the client.
describe('client portal typed clients', () => {
    it('ClientDocumentsApi serves the list and the delete', () => {
        expectTypeOf<keyof SchemaOf<ClientDocumentsApi>>().toEqualTypeOf<'/inspections/:id/documents' | '/inspections/:id/documents/:docId'>();
        expectTypeOf<Keys<ClientDocs['inspections'][':id']['documents']>>().toEqualTypeOf<'$get' | ':docId'>();
        expectTypeOf<Keys<ClientDocs['inspections'][':id']['documents'][':docId']>>().toEqualTypeOf<'$delete'>();
        expectTypeOf<keyof InferRequestType<ClientDocs['inspections'][':id']['documents'][':docId']['$delete']>['param']>().toEqualTypeOf<'id' | 'docId'>();
        expectTypeOf<InferResponseType<ClientDocs['inspections'][':id']['documents'][':docId']['$delete'], 200>>().toEqualTypeOf<{ data: { ok: true } }>();
        expectTypeOf<InferResponseType<ClientDocs['inspections'][':id']['documents']['$get'], 401>>().toEqualTypeOf<{ error: string }>();
    });

    it('InspectorDocumentsApi serves the list and the delete', () => {
        expectTypeOf<keyof SchemaOf<InspectorDocumentsApi>>().toEqualTypeOf<'/:id/documents' | '/:id/documents/:docId'>();
        expectTypeOf<Keys<InspectorDocs[':id']['documents']>>().toEqualTypeOf<'$get' | ':docId'>();
        expectTypeOf<Keys<InspectorDocs[':id']['documents'][':docId']>>().toEqualTypeOf<'$delete'>();
        type Listed = InferResponseType<InspectorDocs[':id']['documents']['$get'], 200>;
        expectTypeOf<Listed['data'][number]['uploadedByRef']>().toEqualTypeOf<string>();
    });

    it('ClientMessagesApi serves the list and the send', () => {
        expectTypeOf<keyof SchemaOf<ClientMessagesApi>>().toEqualTypeOf<'/inspections/:id/messages'>();
        expectTypeOf<Keys<ClientMessages['inspections'][':id']['messages']>>().toEqualTypeOf<'$get' | '$post'>();
        expectTypeOf<InferResponseType<ClientMessages['inspections'][':id']['messages']['$post'], 403>>().toEqualTypeOf<{ error: string }>();
    });

    it('does not expose the native routes', () => {
        // @ts-expect-error the upload is a plain handler, not in the typed client
        type NoPut = ClientDocs['inspections'][':id']['documents']['$put'];
        expectTypeOf<NoPut>().toBeAny();
    });
});
