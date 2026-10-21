import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { Hono } from 'hono';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { InspectorMessagesApi, MessagesApi } from '../../../server/api/messages';

type Client = ReturnType<typeof hc<MessagesApi>>;
type SchemaOf<A> = A extends Hono<infer _E, infer S, infer _B> ? S : never;
// hc adds $url and $path helpers next to the methods; they are not routes.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

/** Every path the messages router served when it was one chain, read from the declaration that chain produced. */
type ChainPaths = '/threads' | '/threads/:contactId' | '/unread-count';

// Compile-time only. `MessagesApi` is derived from `messageRouteParts`: the unread-count route, then the company inbox
// thread router mounted at the root. A mount or route left out of the list, or one that moves a path, fails here.
describe('MessagesApi client', () => {
    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<MessagesApi>>().toEqualTypeOf<ChainPaths>();
    });

    it('has the same top-level segments, so a dropped mount shows up', () => {
        expectTypeOf<Keys<Client>>().toEqualTypeOf<'threads' | 'unread-count'>();
        expectTypeOf<Keys<Client['threads']>>().toEqualTypeOf<'$get' | ':contactId'>();
        expectTypeOf<Keys<Client['threads'][':contactId']>>().toEqualTypeOf<'$get' | '$post'>();
    });

    it('types the own route from its declared schema', () => {
        type Unread = InferResponseType<Client['unread-count']['$get'], 200>;
        expectTypeOf<Unread['data']['count']>().toEqualTypeOf<number>();
    });

    it('types the mounted thread routes from their declared schemas', () => {
        type Send = InferRequestType<Client['threads'][':contactId']['$post']>;
        expectTypeOf<Send['json']>().toEqualTypeOf<{ body: string; inspectionId?: string | undefined }>();
        expectTypeOf<keyof Send['param']>().toEqualTypeOf<'contactId'>();
        type List = InferResponseType<Client['threads']['$get'], 200>;
        expectTypeOf<List['data'][number]['contactId']>().toEqualTypeOf<string>();
        expectTypeOf<List['data'][number]['contactName']>().toEqualTypeOf<string | null>();
    });

    it('does not expose methods or paths that nothing registered', () => {
        // @ts-expect-error no such path
        type Missing = Client['drafts'];
        expectTypeOf<Missing>().toBeAny();
        // @ts-expect-error the badge count is read only
        type NoPost = Client['unread-count']['$post'];
        expectTypeOf<NoPost>().toBeAny();
        // @ts-expect-error a thread is posted into, never deleted whole
        type NoDelete = Client['threads'][':contactId']['$delete'];
        expectTypeOf<NoDelete>().toBeAny();
    });
});

type InspectorClient = ReturnType<typeof hc<InspectorMessagesApi>>;

// The inspector router (mounted at /api/inspections) is derived from `inspectorMessageRouteConfigs`. Its path keys were read
// from the declaration the chained router produced before it was converted.
describe('InspectorMessagesApi client', () => {
    it('serves exactly the paths the chained router served', () => {
        expectTypeOf<keyof SchemaOf<InspectorMessagesApi>>().toEqualTypeOf<
            | '/:inspectionId/messages'
            | '/:inspectionId/messages/upload'
            | '/:inspectionId/messages/attachments/:attachmentId'
        >();
        expectTypeOf<Keys<InspectorClient>>().toEqualTypeOf<':inspectionId'>();
        expectTypeOf<Keys<InspectorClient[':inspectionId']['messages']>>().toEqualTypeOf<'$get' | '$post' | 'upload' | 'attachments'>();
        expectTypeOf<Keys<InspectorClient[':inspectionId']['messages']['upload']>>().toEqualTypeOf<'$post'>();
        expectTypeOf<Keys<InspectorClient[':inspectionId']['messages']['attachments'][':attachmentId']>>().toEqualTypeOf<'$get'>();
    });

    it('types the routes from their declared schemas', () => {
        type Send = InferRequestType<InspectorClient[':inspectionId']['messages']['$post']>;
        expectTypeOf<keyof Send['param']>().toEqualTypeOf<'inspectionId'>();
        expectTypeOf<Send['json']['body']>().toEqualTypeOf<string>();
        expectTypeOf<Send['json']['contactId']>().toEqualTypeOf<string | undefined>();
        type Sent = InferResponseType<InspectorClient[':inspectionId']['messages']['$post'], 201>;
        expectTypeOf<Sent['success']>().toEqualTypeOf<boolean>();
        type Uploaded = InferResponseType<InspectorClient[':inspectionId']['messages']['upload']['$post'], 200>;
        expectTypeOf<Uploaded['data']['key']>().toEqualTypeOf<string>();
        type Download = InferRequestType<InspectorClient[':inspectionId']['messages']['attachments'][':attachmentId']['$get']>;
        expectTypeOf<keyof Download['param']>().toEqualTypeOf<'inspectionId' | 'attachmentId'>();
    });

    it('does not expose methods or paths that nothing registered', () => {
        // @ts-expect-error a thread is listed and posted into, never replaced
        type NoPut = InspectorClient[':inspectionId']['messages']['$put'];
        expectTypeOf<NoPut>().toBeAny();
        // @ts-expect-error an attachment is downloaded, never posted
        type NoPost = InspectorClient[':inspectionId']['messages']['attachments'][':attachmentId']['$post'];
        expectTypeOf<NoPost>().toBeAny();
    });
});
