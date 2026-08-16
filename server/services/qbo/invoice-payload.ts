/**
 * Rendering one of our invoices as a QuickBooks Invoice document.
 *
 * Pure, and apart from the push for that reason: everything here is a decision
 * about SHAPE — which fields QuickBooks requires, how cents become dollars,
 * what an unitemised invoice looks like on their side — and none of it needs a
 * database, a token or a clock. Reading it should not mean reading a retry loop.
 */

/** One billable line as this product stores it. */
export interface BillableLine {
    description: string;
    amountCents: number;
    quantity?: number;
}

/**
 * What to bill, given what the invoice carries.
 *
 * An invoice with a total and no itemisation is ordinary here and impossible in
 * QuickBooks: `Line` is required, and an empty array is refused outright with
 * `Required parameter Line is missing in the request` (fault 2020). The
 * dashboard's own "New invoice" dialog collects an inspection, a name and an
 * amount — no line-item editor at all — so every invoice raised through it was
 * refused, behind the same bare `QBO 400` that hid the missing CustomerRef.
 *
 * The total is what we are owed, so a single line carrying it is a faithful
 * rendering rather than an invention. The wording matches the identical
 * fallback the request-payment path already applies when an inspection has no
 * priced services (`api/invoices.ts`).
 */
export function billableLines(lineItems: BillableLine[], amountCents: number): BillableLine[] {
    return lineItems.length > 0
        ? lineItems
        : [{ description: 'Inspection services', amountCents }];
}

/**
 * The `Line` array QuickBooks wants.
 *
 * Amounts are dollars on their side and integer cents on ours; this is one of
 * the two places the conversion happens (the other is the inbound direction in
 * `inbound-reconcile.ts`). `UnitPrice` divides by quantity because QuickBooks
 * multiplies them back out and would otherwise disagree with `Amount`.
 */
export function toQboLines(billable: BillableLine[], defaultItemId: string) {
    return billable.map((item) => {
        const qty = item.quantity ?? 1;
        return {
            DetailType: 'SalesItemLineDetail',
            Amount:     item.amountCents / 100,
            SalesItemLineDetail: {
                ItemRef:   { value: defaultItemId, name: item.description.slice(0, 100) },
                UnitPrice: item.amountCents / 100 / qty,
                Qty:       qty,
            },
        };
    });
}

/**
 * The document body, minus `Id`/`SyncToken` — those belong to the update path,
 * which is the only thing that knows whether a twin already exists.
 */
export function buildInvoicePayload(args: {
    docNumber: string;
    txnDate: string;
    dueDate: string;
    lines: ReturnType<typeof toQboLines>;
    qboCustomerId: string;
    /** Our invoice's own status, not QuickBooks'. */
    status: string;
}): Record<string, unknown> {
    return {
        DocNumber:   args.docNumber,
        TxnDate:     args.txnDate,
        DueDate:     args.dueDate,
        Line:        args.lines,
        EmailStatus: args.status === 'sent' ? 'EmailSent' : 'NotSet',
        // Required on an Invoice — QuickBooks refuses the whole document
        // without it, which is why the caller refuses to reach this function
        // until it has one rather than sending a body it knows will bounce.
        CustomerRef: { value: args.qboCustomerId },
    };
}
