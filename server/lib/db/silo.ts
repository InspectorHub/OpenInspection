/**
 * D1HttpDatabase ??implements the Cloudflare D1Database binding interface over
 * the Cloudflare D1 REST API. Allows Drizzle ORM to query a dynamically-selected
 * D1 database (silo mode) without a static wrangler binding.
 *
 * API reference: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
 */

const D1_API = 'https://api.cloudflare.com/client/v4/accounts';

interface D1HttpResult<T = Record<string, unknown>> {
    results: T[];
    success: boolean;
    meta: Record<string, unknown>;
}

class D1HttpPreparedStatement {
    constructor(
        private readonly accountId: string,
        private readonly apiToken: string,
        private readonly dbId: string,
        private readonly sql: string,
        private readonly bindings: unknown[] = [],
    ) {}

    bind(...values: unknown[]): D1HttpPreparedStatement {
        return new D1HttpPreparedStatement(this.accountId, this.apiToken, this.dbId, this.sql, values);
    }

    private async execute<T = Record<string, unknown>>(): Promise<D1HttpResult<T>> {
        const url = `${D1_API}/${this.accountId}/d1/database/${this.dbId}/query`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sql: this.sql, params: this.bindings }),
        });
        const data = await res.json() as { success: boolean; errors?: { message: string }[]; result: D1HttpResult<T>[] };
        if (!data.success) {
            throw new Error(`D1 HTTP API error: ${data.errors?.[0]?.message ?? JSON.stringify(data.errors)}`);
        }
        return data.result[0];
    }

    async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
        const result = await this.execute<T>();
        if (!result.results.length) return null;
        if (colName !== undefined) return (result.results[0] as Record<string, unknown>)[colName] as T;
        return result.results[0];
    }

    async run(): Promise<D1Result> {
        const result = await this.execute();
        return { results: result.results, success: true, meta: result.meta as D1Meta & Record<string, unknown> };
    }

    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const result = await this.execute<T>();
        return { results: result.results, success: true, meta: result.meta as D1Meta & Record<string, unknown> };
    }

    async raw<T extends unknown[] = unknown[]>(): Promise<T[]> {
        const result = await this.execute();
        return result.results.map(r => Object.values(r as object)) as T[];
    }
}

export class D1HttpDatabase {
    constructor(
        private readonly accountId: string,
        private readonly apiToken: string,
        private readonly dbId: string,
    ) {}

    prepare(sql: string): D1PreparedStatement {
        return new D1HttpPreparedStatement(this.accountId, this.apiToken, this.dbId, sql) as unknown as D1PreparedStatement;
    }

    async dump(): Promise<ArrayBuffer> {
        throw new Error('dump() is not supported in silo HTTP mode');
    }

    async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
        return Promise.all(statements.map(s => (s as unknown as D1HttpPreparedStatement).all<T>()));
    }

    async exec(query: string): Promise<D1ExecResult> {
        const result = await this.prepare(query).run();
        const meta = result.meta as D1Meta & Record<string, unknown>;
        return { count: (meta?.changes as number) ?? 0, duration: (meta?.duration as number) ?? 0 };
    }

    withSession(_consistencyOrBookmark?: string): this {
        return this;
    }
}

/**
 * Provision a new silo D1 database via the Cloudflare API.
 * Returns the new database ID.
 */
export async function provisionSiloDatabase(
    accountId: string,
    apiToken: string,
    name: string,
): Promise<string> {
    const url = `${D1_API}/${accountId}/d1/database`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
    });
    const data = await res.json() as { success: boolean; errors?: { message: string }[]; result: { uuid: string } };
    if (!data.success) {
        throw new Error(`Failed to create silo DB: ${data.errors?.[0]?.message ?? JSON.stringify(data.errors)}`);
    }
    return data.result.uuid as string;
}

/**
 * Execute a SQL statement on a silo DB via the HTTP API.
 * Used during provisioning to run schema migrations.
 */
export async function execSiloSql(
    accountId: string,
    apiToken: string,
    dbId: string,
    sql: string,
): Promise<void> {
    const db = new D1HttpDatabase(accountId, apiToken, dbId);
    // Split on semicolons and execute each statement individually
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
        await db.exec(stmt);
    }
}
