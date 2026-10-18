import { describe, it, expect, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
    isForeignKeyViolation, foreignKeyKind, isUserFacingPath, foreignKeyResponse,
} from '../../../server/lib/db/foreign-key-violation';
import { logger } from '../../../server/lib/logger';

/** A drizzle-shaped wrapper: its own message carries the SQL and the parameters; the driver error is its cause. */
function wrapped(sql: string, params: string, rootMessage = 'D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT') {
    const e = new Error(`Failed query: ${sql}\nparams: ${params}`, { cause: new Error(rootMessage) });
    (e as unknown as { query: string }).query = sql;
    return e;
}

afterEach(() => vi.restoreAllMocks());

describe('isForeignKeyViolation reads the root cause only', () => {
    it('recognises the driver error itself, behind the D1 prefix, and by code', () => {
        expect(isForeignKeyViolation(new Error('FOREIGN KEY constraint failed'))).toBe(true);
        expect(isForeignKeyViolation(new Error('D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT'))).toBe(true);
        expect(isForeignKeyViolation(Object.assign(new Error('x'), { code: 'SQLITE_CONSTRAINT_FOREIGNKEY' }))).toBe(true);
    });
    it('recognises it under a drizzle wrapper at any depth', () => {
        expect(isForeignKeyViolation(wrapped('insert into x', '1'))).toBe(true);
        expect(isForeignKeyViolation(new Error('outer', { cause: wrapped('insert into x', '1') }))).toBe(true);
    });
    it('is not fooled by the phrase appearing in a wrapper, a parameter or a different failure (controls)', () => {
        expect(isForeignKeyViolation(wrapped('insert into notes', 'FOREIGN KEY constraint failed', 'D1_ERROR: UNIQUE constraint failed: notes.id'))).toBe(false);
        expect(isForeignKeyViolation(new Error('Failed query: insert ... params: FOREIGN KEY constraint failed'))).toBe(false);
        expect(isForeignKeyViolation(new Error('UNIQUE constraint failed: contacts.email'))).toBe(false);
        expect(isForeignKeyViolation('FOREIGN KEY constraint failed')).toBe(false);
        expect(isForeignKeyViolation(undefined)).toBe(false);
    });
});

describe('foreignKeyKind separates a missing parent from a child that blocks a delete', () => {
    it('the statement decides', () => {
        expect(foreignKeyKind(wrapped('insert into "inspections" (...) values (?)', '1'), 'POST')).toBe('missing_reference');
        expect(foreignKeyKind(wrapped('update "inspections" set "inspector_id" = ?', '1'), 'PATCH')).toBe('missing_reference');
        expect(foreignKeyKind(wrapped('delete from "users" where "id" = ?', '1'), 'DELETE')).toBe('in_use');
    });
    it('falls back to the method when the driver error carries no statement', () => {
        expect(foreignKeyKind(new Error('FOREIGN KEY constraint failed'), 'DELETE')).toBe('in_use');
        expect(foreignKeyKind(new Error('FOREIGN KEY constraint failed'), 'POST')).toBe('missing_reference');
    });
});

describe('foreignKeyResponse', () => {
    const appThrowing = (err: unknown) => {
        const app = new Hono();
        app.onError((e, c) => foreignKeyResponse(c, e) ?? c.json({ fallthrough: true }, 500));
        app.all('/*', () => { throw err; });
        return app;
    };
    const call = async (method: string, path: string, err: unknown) => {
        const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const res = await appThrowing(err).request(path, { method });
        return { res, body: await res.json() as Record<string, unknown>, error };
    };

    it('a missing parent answers 400 and logs at error level with the cause and the constraint text, never the URL query', async () => {
        const { res, body, error } = await call('POST', '/api/inspections?secret=abc', wrapped('insert into "inspections" ...', 'a@b.test'));
        expect(res.status).toBe(400);
        expect(JSON.stringify(body)).toContain('does not exist');
        expect(error).toHaveBeenCalledTimes(1);
        const [message, data, cause] = error.mock.calls[0] as [string, Record<string, unknown>, Error];
        expect(message).toContain('Foreign key');
        expect(data).toMatchObject({ method: 'POST', url: '/api/inspections', kind: 'missing_reference' });
        expect(String(data.constraint)).toContain('FOREIGN KEY constraint failed');
        expect(JSON.stringify(data)).not.toContain('secret=abc');
        expect(cause).toBeInstanceOf(Error);
    });

    it('a blocked delete answers 409 in words about the record being in use', async () => {
        const { res, body } = await call('DELETE', '/api/team/members/u1', wrapped('delete from "users" where "id" = ?', 'u1'));
        expect(res.status).toBe(409);
        const message = (body.error as { message: string }).message;
        expect(message).toContain('still in use');
        expect(message).not.toContain('does not exist');
    });

    it.each(['/webhooks/stripe', '/webhooks/stripe/acme', '/m2m/agreements/render', '/api/platform/tenants', '/api/integrations/qbo/sync'])(
        'leaves %s alone, so its caller still sees a 5xx and retries', async (path) => {
            const { res, body, error } = await call('POST', path, wrapped('insert into x', '1'));
            expect(res.status).toBe(500);
            expect(body).toEqual({ fallthrough: true });
            expect(error).not.toHaveBeenCalled();
        },
    );

    it('control: a user-facing path that merely starts with a similar word is still mapped', async () => {
        expect(isUserFacingPath('/api/platformer')).toBe(true);
        expect(isUserFacingPath('/api/platform')).toBe(false);
        expect(isUserFacingPath('/webhooks')).toBe(false);
        expect((await call('POST', '/api/contacts', wrapped('insert into x', '1'))).res.status).toBe(400);
    });

    it('anything that is not a foreign key failure falls through to the normal 500', async () => {
        const { res } = await call('POST', '/api/contacts', new Error('boom'));
        expect(res.status).toBe(500);
    });
});
