/**
 * Insert many rows in as few D1 round-trips as possible: multi-row INSERTs
 * chunked to stay under D1's 100-bound-parameter-per-statement limit, all sent
 * in a single db.batch(). No-op for an empty array. This turns hundreds of
 * sequential awaited inserts (slow, and a long window during which a closed
 * setup tab leaves partial data) into one batched round-trip per table.
 */
export async function batchInsert(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    d: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any,
    rows: Record<string, unknown>[],
): Promise<void> {
    if (rows.length === 0) return;

    // Drivers without batch support (e.g. unit-test mocks): sequential inserts.
    if (typeof d.batch !== 'function') {
        for (const row of rows) await d.insert(table).values(row).run();
        return;
    }

    const colsPerRow = Object.keys(rows[0]!).length || 1;
    const maxRowsPerStmt = Math.max(1, Math.floor(100 / colsPerRow));
    const stmts = [];
    for (let i = 0; i < rows.length; i += maxRowsPerStmt) {
        stmts.push(d.insert(table).values(rows.slice(i, i + maxRowsPerStmt)));
    }
    // d.batch wants a non-empty tuple; stmts is guaranteed non-empty here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await d.batch(stmts as [any, ...any[]]);
}
