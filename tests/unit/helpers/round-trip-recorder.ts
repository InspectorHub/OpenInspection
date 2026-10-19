/**
 * Counts what a request costs on a real D1: not statements, ROUND TRIPS.
 *
 * Every statement a Worker sends to D1 is a network round trip. Statements
 * issued together (Promise.all, or one `batch()`) overlap, so what a request
 * waits for is the length of its longest chain of dependent statements, not
 * their number. Three figures come out of one wrapped binding:
 *
 *   statements   every statement executed (a batch counts each of its members)
 *   roundTrips   calls to D1 (a batch is ONE call)
 *   waves        sequential depth: a call that starts while no other call is
 *                in flight begins a new wave. Two awaited statements in a row
 *                are two waves; two issued with Promise.all are one.
 *
 * Every call also sleeps `latencyMs` before touching the database, so waves
 * show up as wall time: elapsed / latencyMs approximates the number of
 * sequential round trips, which is what production pays at roughly 60-150 ms
 * each. With no sleep a Promise.all would still look parallel here, but only by
 * accident of microtask ordering; the sleep makes the overlap real.
 */
export interface RoundTripLog {
    statements: number;
    roundTrips: number;
    waves: number;
    sql: string[];
}

export interface RecordingBinding {
    binding: D1Database;
    log: RoundTripLog;
    reset: () => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function recordRoundTrips(db: D1Database, latencyMs = 5): RecordingBinding {
    const log: RoundTripLog = { statements: 0, roundTrips: 0, waves: 0, sql: [] };
    let inFlight = 0;

    async function call<T>(statements: string[], run: () => Promise<T>): Promise<T> {
        if (inFlight === 0) log.waves++;
        inFlight++;
        log.roundTrips++;
        log.statements += statements.length;
        log.sql.push(...statements.map((sql) => `[wave ${log.waves}] ${sql}`));
        try {
            if (latencyMs > 0) await sleep(latencyMs);
            return await run();
        } finally {
            inFlight--;
        }
    }

    function wrapStatement(stmt: D1PreparedStatement, sql: string): D1PreparedStatement {
        return new Proxy(stmt, {
            get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver) as unknown;
                if (prop === 'bind' && typeof value === 'function') {
                    return (...args: unknown[]) => wrapStatement((value as (...a: unknown[]) => D1PreparedStatement).apply(target, args), sql);
                }
                if ((prop === 'run' || prop === 'all' || prop === 'first' || prop === 'raw') && typeof value === 'function') {
                    return (...args: unknown[]) => call([sql], () => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args));
                }
                return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
            },
        });
    }

    const binding = new Proxy(db, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver) as unknown;
            if (prop === 'prepare' && typeof value === 'function') {
                return (sql: string) => wrapStatement((value as (s: string) => D1PreparedStatement).call(target, sql), sql);
            }
            if (prop === 'batch' && typeof value === 'function') {
                return (statements: Array<{ __sql?: string }>) =>
                    call(statements.map(() => '<batch member>'), () => (value as (s: unknown[]) => Promise<unknown>).call(target, statements));
            }
            return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
    }) as D1Database;

    return {
        binding,
        log,
        reset: () => { log.statements = 0; log.roundTrips = 0; log.waves = 0; log.sql.length = 0; inFlight = 0; },
    };
}
