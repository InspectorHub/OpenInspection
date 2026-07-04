import { describe, it, expect } from 'vitest';
import { SetSlugRequestSchema } from '../../../server/lib/validations/profile.schema';
import publicSlugRoutes from '../../../server/api/public-slug';
import profileRoutes from '../../../server/api/profile';

describe('API contract — slug', () => {
    it('Set slug request schema validates lowercase + length', () => {
        expect(SetSlugRequestSchema.safeParse({ slug: 'john' }).success).toBe(true);
        expect(SetSlugRequestSchema.safeParse({ slug: 'JOHN' }).success).toBe(false);
        expect(SetSlugRequestSchema.safeParse({ slug: 'ab' }).success).toBe(false);
    });

    it('Public availability route module exports an OpenAPIHono app', () => {
        expect(publicSlugRoutes).toBeDefined();
        // OpenAPIHono apps expose `request` and `route` methods.
        expect(typeof (publicSlugRoutes as { request: unknown }).request).toBe('function');
    });

    it('Profile slug route module exports an OpenAPIHono app', () => {
        expect(profileRoutes).toBeDefined();
        expect(typeof (profileRoutes as { request: unknown }).request).toBe('function');
    });
});
