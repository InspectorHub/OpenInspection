import { describe, it, expectTypeOf } from 'vitest';
import type { z } from '@hono/zod-openapi';
import type {
    InspectionHubSchema,
    HubInvoiceCoreSchema,
} from '../../../server/lib/validations/inspection/read';
import type { InspectionPublishService } from '../../../server/services/inspection/inspection-publish.service';
import type { InspectionService } from '../../../server/services/inspection.service';
import type { CommunicationCounts } from '../../../server/lib/communication-counts';

/**
 * The `/api/inspections/:id/hub` payload is produced by a three-step pipeline,
 * and each step owns a different type:
 *
 *   1. the service returns the payload MINUS `invoice.payUrl`;
 *   2. the route adds `payUrl` (it needs the portal-access token issuer, which
 *      the aggregate query deliberately does not depend on) and then redacts
 *      every `*Cents` key for a caller without the financial capability;
 *   3. `InspectionHubSchema` describes what actually goes on the wire.
 *
 * Nothing at runtime enforces the join between those steps: the route spreads
 * `{ ...data }`, and hono zod-openapi validates REQUESTS but not responses. So
 * a field the service returns and the schema declares can be missing from the
 * service's DECLARED type and every runtime test still passes — which is
 * exactly how `communication.rulesActive` came to be returned, consumed by the
 * hub page, described in the OpenAPI contract, and absent from the type the
 * facade derives.
 *
 * These are type-only assertions on purpose. The runtime values are already
 * correct; the declarations are what drift, and a declaration is invisible to
 * `vitest run`. This file is typechecked by `vitest.typecheck.config.ts`
 * (`npm run test:types`).
 */
type ServiceHub = NonNullable<Awaited<ReturnType<InspectionPublishService['getInspectionHub']>>>;
type FacadeHub = NonNullable<Awaited<ReturnType<InspectionService['getInspectionHub']>>>;
type WireHub = z.infer<typeof InspectionHubSchema>;
type HubInvoiceCore = z.infer<typeof HubInvoiceCoreSchema>;

describe('hub communication counts: one shape, three declarations', () => {
    it('the service declares exactly what communicationCounts() returns', () => {
        expectTypeOf<ServiceHub['communication']>().toEqualTypeOf<CommunicationCounts>();
    });

    it('the facade inherits it (it derives, it must not re-declare)', () => {
        expectTypeOf<FacadeHub['communication']>().toEqualTypeOf<CommunicationCounts>();
    });

    it('the wire schema describes the same counts', () => {
        expectTypeOf<WireHub['communication']>().toEqualTypeOf<CommunicationCounts>();
    });
});

describe('hub invoice: the route is what adds payUrl', () => {
    it('the service returns the core invoice, with no pay link', () => {
        expectTypeOf<ServiceHub['invoice']>().toEqualTypeOf<HubInvoiceCore | null>();
    });

    /**
     * The negative half matters more than the positive one: if the core schema
     * ever grows `payUrl`, the compiler stops being able to tell "the service
     * forgot it" from "the route already added it", and the split has bought
     * nothing.
     */
    it('the core shape has no payUrl of its own', () => {
        expectTypeOf<HubInvoiceCore>().not.toHaveProperty('payUrl');
    });

    it('the wire shape has one', () => {
        expectTypeOf<NonNullable<WireHub['invoice']>>().toHaveProperty('payUrl');
    });

    /**
     * Money is `.optional()` on the wire and required off the service on
     * purpose — `redactMoney` DROPS every `*Cents` key for a caller without the
     * financial capability, so the wire type must admit their absence while the
     * service always computes them. This is not drift; asserting it keeps a
     * future reader from "fixing" it in either direction.
     */
    it('money is optional on the wire because the route may redact it', () => {
        expectTypeOf<NonNullable<WireHub['invoice']>['amountCents']>().toEqualTypeOf<number | undefined>();
    });
});
