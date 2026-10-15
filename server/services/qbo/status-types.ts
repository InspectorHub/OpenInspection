/**
 * The shapes the settings page reads about a QuickBooks connection. Split from
 * `api-base.ts` (re-exported there, so imports are unchanged) to keep the
 * service base under the file-size limit; there is no behaviour in this file.
 */

/** One invoice where QuickBooks and our ledger disagree, with BOTH figures. */
export interface QBOPaymentDiscrepancy {
    id: string;
    invoiceId: string;
    currency: string;
    ledgerCents: number;
    qboCents: number;
}

/**
 * One open row a human has to look at, as the settings page needs to read it.
 *
 * This replaced a bare `openErrors: number`. A count is not a report: every
 * defect this integration has produced ends up here, and for the whole life of
 * the feature the page rendered the number and the sentence "check the sync
 * error log for details" — pointing at a log that does not exist. Six failures
 * and one count are indistinguishable from one failure and a bad guess.
 *
 * `errorCode` travels with the row rather than being flattened into prose
 * because the kinds are not interchangeable: a failed push may be worth
 * retrying, a `VOIDED_IN_QBO` flag is an acknowledgement, and rendering both as
 * "error" is how the void flag would have gone unnoticed the same way.
 */
export interface QBOSyncErrorSummary {
    id: string;
    /** 'invoice' | 'refund' | 'contact' — what the row is about. */
    oiType: string;
    /**
     * The OI entity id. NOT always a real id: the bootstrap probe writes the
     * sentinel 'bootstrap', so a consumer that links this somewhere must
     * tolerate a miss rather than render a dead link.
     */
    oiId: string;
    /**
     * The contact's name when `oiType` is 'contact' and that contact still exists
     * in this company (an archived one still resolves); null for every other row
     * and for a contact that has been deleted.
     */
    contactName: string | null;
    /** `SYNC_ERROR`, `QBO_VOIDED_IN_QBO`, … — decides how the row reads. */
    errorCode: string;
    /** Whatever the failure actually said. Never a status code on its own. */
    message: string;
    /** How many times this same row has been re-detected. */
    retries: number;
    /** Epoch SECONDS, matching every other instant on this object. */
    lastSeenAt: number;
}

/** Where one QuickBooks setting comes from. Never carries the setting itself. */
export type QBOCredentialOrigin = 'env' | 'tenant' | 'missing';

/** The origin of each setting the connection depends on. */
export interface QBOCredentialSource {
    clientId: QBOCredentialOrigin;
    clientSecret: QBOCredentialOrigin;
    webhookToken: QBOCredentialOrigin;
    environment: QBOCredentialOrigin;
}

/**
 * What the service can say about a connection from its own tables and its own
 * configuration. `QBOConnectionStatus` below adds the one thing it cannot:
 * where each credential came from, which only the request that merged them
 * knows.
 */
export interface QBOConnectionState {
    realmId: string;
    companyName: string | null;
    lastSyncAt: number | null;
    syncEnabled: boolean;
    /**
     * Every open row that is not a payment discrepancy — failed pushes and
     * acknowledgements alike. Discrepancies are split out below because they
     * carry two figures and are not a failure of anything.
     */
    openErrors: QBOSyncErrorSummary[];
    paymentDiscrepancies: QBOPaymentDiscrepancy[];
    /**
     * Payments taken before an invoice existed. They are deliberately NOT sent
     * to QuickBooks — see the settings copy — so the count is disclosed rather
     * than the cash quietly under-reported. A count and not an amount: these
     * rows predate the invoice that carries the currency, and inventing one
     * would be a worse lie than saying less.
     */
    heldDepositCount: number;
    refreshTokenExpiresAt: number;
    /** Epoch seconds the connection row was first written. */
    connectedAt: number;
    /**
     * Which Intuit host this deployment calls, or null when `QBO_ENV` is unset
     * or not one of the two valid values. Never defaulted: an unset host is a
     * connection that cannot make a call, and a guessed badge would hide that.
     */
    environment: 'sandbox' | 'production' | null;
    /** Contacts matched to a QuickBooks customer. */
    mappedCustomers: number;
    /** Invoices that have a QuickBooks twin. */
    mappedInvoices: number;
}

/** The `/status` payload: the connection state plus where each credential comes from. */
export interface QBOConnectionStatus extends QBOConnectionState {
    credentialSource: QBOCredentialSource;
}
