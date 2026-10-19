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
 *   waves        CAUSAL depth: a call's depth is 1 + the deepest call that had
 *                FINISHED before it started. Two awaited statements in a row are
 *                depth 2; two issued with Promise.all are depth 1; a serial chain
 *                nested inside a Promise.all still counts its full length, which
 *                a "starts while nothing is in flight" rule would hide.
 * * Every call also sleeps `latencyMs` before touching the database, so waves
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
    /** Change the per-call delay (0 measures the request's own cost). */
    setLatency: (ms: number) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function recordRoundTrips(db: D1Database, initialLatencyMs = 5): RecordingBinding {
    let latencyMs = initialLatencyMs;
    const log: RoundTripLog = { statements: 0, roundTrips: 0, waves: 0, sql: [] };
    // Deepest depth among calls that have finished; a call starting now sits one below it.
    let finishedDepth = 0;

    async function call<T>(statements: string[], run: () => Promise<T>): Promise<T> {
        const depth = finishedDepth + 1;
        log.roundTrips++;
        log.statements += statements.length;
        log.sql.push(...statements.map((sql) => `[wave ${depth}] ${sql}`));
        log.waves = Math.max(log.waves, depth);
        try {
            if (latencyMs > 0) await sleep(latencyMs);
            return await run();
        } finally {
            finishedDepth = Math.max(finishedDepth, depth);
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
        setLatency: (ms: number) => { latencyMs = ms; },
        reset: () => { log.statements = 0; log.roundTrips = 0; log.waves = 0; log.sql.length = 0; finishedDepth = 0; },
    };
}

/**
 * Wall time of one request, against its own cost.
 *
 * The request is timed first with no delay per D1 call (`base`: what the code itself costs on this
 * machine, median of three) and then with `latencyMs` per call (`ms`). The bound that follows from a
 * budget of N sequential round trips is `ms <= base + (N + 1) * latencyMs`: one call of headroom
 * for timer granularity, so each extra serial read beyond the budget costs a full latency and is
 * caught on a slow machine as well as a fast one.
 */
export async function measureWall(
    rec: RecordingBinding,
    latencyMs: number,
    call: () => Promise<unknown>,
): Promise<{ base: number; ms: number }> {
    rec.setLatency(0);
    const bases: number[] = [];
    for (let i = 0; i < 3; i++) {
        const start = performance.now();
        await call();
        bases.push(performance.now() - start);
    }
    bases.sort((a, b) => a - b);
    rec.setLatency(latencyMs);
    rec.reset();
    const start = performance.now();
    await call();
    return { base: bases[1]!, ms: performance.now() - start };
}

export const wallWithinBudget = (m: { base: number; ms: number }, budget: number, latencyMs: number) =>
    m.ms <= m.base + (budget + 1) * latencyMs;
