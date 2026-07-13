/**
 * Regression guard for the commercial subtype-preset persist path (design
 * 2026-07-13). The PATCH /inspections/:id/property-facts route MUST validate
 * against PropertyFactsWriteSchema (which carries the `metadata` envelope), not
 * the strict PropertyFactsSchema — the original bug was that the strict schema
 * silently stripped every non-dedicated commercial field before it reached the
 * service. This asserts the wired route body schema still accepts metadata.
 */
import { describe, it, expect } from 'vitest';
import { updatePropertyFactsRoute } from '../../../server/api/inspections/results';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bodySchema = (updatePropertyFactsRoute as any).request.body.content['application/json'].schema;

describe('updatePropertyFactsRoute request body', () => {
  it('accepts a metadata envelope (route wired to PropertyFactsWriteSchema)', () => {
    const r = bodySchema.safeParse({ yearBuilt: 1998, metadata: { nra: 42000, sprinklered: 'Full' } });
    expect(r.success).toBe(true);
  });

  it('still rejects a non-primitive metadata value', () => {
    const r = bodySchema.safeParse({ metadata: { nested: { a: 1 } } });
    expect(r.success).toBe(false);
  });
});
