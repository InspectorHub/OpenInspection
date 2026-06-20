import { EmailBaseService } from './email/base';
import { TransactionalEmailMixin } from './email/transactional';
import { AgentEmailMixin } from './email/agent';
import { ConciergeEmailMixin } from './email/concierge';
import { AgreementEmailMixin } from './email/agreement';
import { InspectionEmailMixin } from './email/inspection';

/**
 * Service to handle transactional email delivery using Resend.
 * Centralizes all email logic and formatting across the application.
 *
 * Structurally split (behavior-preserving) into a core transport base
 * (`email/base.ts` — constructor DI, `sendEmail()`, signature gate, the shared
 * `renderWithSignature` boilerplate, `icsAttachment`) plus five domain mixins:
 *   - transactional  (password reset, invitation, invoice request, message notify)
 *   - agent          (agent invite/share-link, referral/report/invoice-paid notices)
 *   - concierge      (client confirm, inspector review, agent confirmed/cancelled)
 *   - agreement      (agreement request, signed confirmation, evidence pack)
 *   - inspection     (report ready, report PDF, booking confirmation)
 *
 * The mixins are composed here so `EmailService` keeps its exact public surface
 * (class name, constructor signature, all method names) and every existing
 * `services.email.X(...)` call site + `new EmailService(...)` test stays unchanged.
 */
export class EmailService extends InspectionEmailMixin(
    AgreementEmailMixin(
        ConciergeEmailMixin(
            AgentEmailMixin(
                TransactionalEmailMixin(EmailBaseService),
            ),
        ),
    ),
) {}
