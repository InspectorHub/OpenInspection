import { drizzle } from 'drizzle-orm/d1';
import type { ScopedDB } from '../../lib/db/scoped';
import type { ImagesBinding } from '../../lib/media/strip-exif';

/**
 * Shared base for every inspection sub-service. Holds the injected runtime
 * deps (D1 / R2 / ScopedDB / KV / Images) that the former monolithic
 * InspectionService carried as constructor parameter-properties, plus the
 * `getDrizzle()` helper every method used. The facade constructs each
 * sub-service from the same deps so positional construction stays identical.
 *
 * Deps are `protected` (were `private` on the monolith) so sub-services can
 * read them exactly as the original method bodies did (`this.db`, `this.r2`,
 * `this.sdb`, `this.kv`, `this.images`).
 */
export class InspectionSubService {
    constructor(
        protected db: D1Database,
        protected r2?: R2Bucket,
        protected sdb?: ScopedDB,
        protected kv?: KVNamespace,
        protected images?: ImagesBinding,
    ) {}

    protected getDrizzle() {
        return drizzle(this.db);
    }
}
