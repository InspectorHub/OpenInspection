import { QBOServiceBase } from './qbo/api-base';
import { withConnection } from './qbo/connection';
import { withBootstrap } from './qbo/bootstrap';
import { withCustomerSync } from './qbo/customer-sync';
import { withWebhook } from './qbo/webhook';
import { withCdc } from './qbo/cdc';

export type { QBOConnectionStatus } from './qbo/api-base';

// QBOService composes the QBO integration domains over the shared api-base
// (OAuth token auto-refresh + encrypted-token handling + apiCall/retry/log).
// withWebhook and withCdc each layer the shared invoice-sync surface
// (apply/upsert/void/payment/credit-memo). Public surface, class name, and
// constructor injection are unchanged.
export class QBOService extends withCdc(
    withWebhook(
        withCustomerSync(
            withBootstrap(
                withConnection(QBOServiceBase),
            ),
        ),
    ),
) {}
