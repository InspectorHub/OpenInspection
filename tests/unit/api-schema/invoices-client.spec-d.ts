import { describe, it, expectTypeOf } from 'vitest';
import { hc } from 'hono/client';
import type { InferRequestType, InferResponseType } from 'hono/client';
import type { z } from '@hono/zod-openapi';
import type { InvoicesApi } from '../../../server/api/invoices';
import type {
    CorrectPaymentSchema,
    CreateInvoiceSchema,
    InvoiceResponseSchema,
    MarkInvoicePaidSchema,
    PaymentLedgerRowSchema,
    RecordOfflinePaymentSchema,
    RequestPaymentResponseSchema,
    RequestPaymentSchema,
} from '../../../server/lib/validations/invoice.schema';

type Client = ReturnType<typeof hc<InvoicesApi>>;
// hc adds $url and $path helpers next to the methods; they are not routes. Routes at the root path sit under 'index'.
type Keys<T> = Exclude<keyof T, '$url' | '$path'>;

// Compile-time only (run by `npm run test:types`). `InvoicesApi` is derived from `invoiceRouteParts`: one child router
// (the payment ledger, mounted at the root and registered first) followed by the router's own routes. A mount left
// out of the list, or a route left out of it, fails here. Expected shapes come from the zod schemas.
describe('InvoicesApi client (payment ledger mounted at the root, plus own routes)', () => {
    it('has exactly the path segments of the own routes and the mount, so a dropped mount shows up', () => {
        expectTypeOf<Keys<Client>>().toEqualTypeOf<'index' | ':id' | 'request-payment'>();
        expectTypeOf<Keys<Client[':id']>>().toEqualTypeOf<'$delete' | 'payments' | 'mark-sent' | 'mark-paid'>();
    });

    it('exposes the own routes', () => {
        expectTypeOf<Client['index']>().toHaveProperty('$get');
        expectTypeOf<Client['index']>().toHaveProperty('$post');
        expectTypeOf<Client[':id']>().toHaveProperty('$delete');
        expectTypeOf<Client[':id']['mark-sent']>().toHaveProperty('$post');
        expectTypeOf<Client[':id']['mark-paid']>().toHaveProperty('$post');
        expectTypeOf<Client['request-payment']>().toHaveProperty('$post');
    });

    it('exposes the mounted payment ledger', () => {
        expectTypeOf<Client[':id']['payments']>().toHaveProperty('$post');
        expectTypeOf<Client[':id']['payments']>().toHaveProperty('$get');
        expectTypeOf<Client[':id']['payments'][':paymentId']['corrections']>().toHaveProperty('$post');
    });

    it('does not expose methods or paths that nothing registered', () => {
        // @ts-expect-error no such path
        type Missing = Client['refunds'];
        expectTypeOf<Missing>().toBeAny();
        // @ts-expect-error request-payment is POST only
        type NoGet = Client['request-payment']['$get'];
        expectTypeOf<NoGet>().toBeAny();
        // @ts-expect-error the ledger is append-only: a payment row has no DELETE
        type NoDelete = Client[':id']['payments']['$delete'];
        expectTypeOf<NoDelete>().toBeAny();
        expectTypeOf<Client[':id']>().not.toHaveProperty('$get');
    });

    it('types the own routes from their declared schemas', () => {
        type Create = InferRequestType<Client['index']['$post']>;
        expectTypeOf<Create['json']>().toEqualTypeOf<z.input<typeof CreateInvoiceSchema>>();
        type Created = InferResponseType<Client['index']['$post'], 201>;
        expectTypeOf<Created['data']['invoice']>().toEqualTypeOf<z.output<typeof InvoiceResponseSchema>>();
        type List = InferResponseType<Client['index']['$get'], 200>;
        expectTypeOf<List['data']>().toEqualTypeOf<z.output<typeof InvoiceResponseSchema>[]>();
        type Paid = InferRequestType<Client[':id']['mark-paid']['$post']>;
        expectTypeOf<Paid['json']>().toEqualTypeOf<z.input<typeof MarkInvoicePaidSchema>>();
        type Request = InferRequestType<Client['request-payment']['$post']>;
        expectTypeOf<Request['json']>().toEqualTypeOf<z.input<typeof RequestPaymentSchema>>();
        type Requested = InferResponseType<Client['request-payment']['$post'], 200>;
        expectTypeOf<Requested>().toEqualTypeOf<z.output<typeof RequestPaymentResponseSchema>>();
    });

    it('types the mounted payment ledger from its own schemas', () => {
        type Record = InferRequestType<Client[':id']['payments']['$post']>;
        expectTypeOf<Record['json']>().toEqualTypeOf<z.input<typeof RecordOfflinePaymentSchema>>();
        type Recorded = InferResponseType<Client[':id']['payments']['$post'], 201>;
        expectTypeOf<Recorded['data']>().toEqualTypeOf<z.output<typeof PaymentLedgerRowSchema>>();
        type Ledger = InferResponseType<Client[':id']['payments']['$get'], 200>;
        expectTypeOf<Ledger['data']>().toEqualTypeOf<z.output<typeof PaymentLedgerRowSchema>[]>();
        type Correct = InferRequestType<Client[':id']['payments'][':paymentId']['corrections']['$post']>;
        expectTypeOf<Correct['json']>().toEqualTypeOf<z.input<typeof CorrectPaymentSchema>>();
        expectTypeOf<keyof Correct['param']>().toEqualTypeOf<'id' | 'paymentId'>();
    });
});
