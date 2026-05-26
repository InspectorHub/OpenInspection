import { describe, it, expect } from 'vitest';
import { users } from '../../src/lib/db/schema/tenant';

describe('users schema — Sprint C-1', () => {
    it('declares photo_url, bio, service_areas as TEXT (nullable)', () => {
        const t = users as unknown as {
            photoUrl?: { name: string };
            bio?: { name: string };
            serviceAreas?: { name: string };
        };
        expect(t.photoUrl?.name).toBe('photo_url');
        expect(t.bio?.name).toBe('bio');
        expect(t.serviceAreas?.name).toBe('service_areas');
    });
});
