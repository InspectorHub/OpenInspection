import { escapeHtml, type Constructor } from './base';

/**
 * The four messages an import run sends. Mixed into EmailService — see
 * `email.service.ts`.
 *
 * They live on the email surface rather than in the intake service because
 * that is where every other registry-rendered send lives: the service knows
 * WHO and WHEN, this knows what an email is.
 *
 * A file of its own rather than four more methods on `transactional.ts`,
 * which was already within fifty lines of the size gate. The seam is the
 * same one every other mixin here uses: one file per family of messages.
 *
 * Each outcome has its own method and its own trigger. One method with a mode
 * argument would let a caller render "ready to review" and mean "could not be
 * converted" — and since the notification class recorded at the boundary comes
 * from the trigger, the wrong one would also file the message under the wrong
 * name.
 */
export function MigrationIntakeEmailMixin<TBase extends Constructor>(Base: TBase) {
    return class MigrationIntakeEmail extends Base {
        /** Acknowledged within two working days, so silence becomes findable. */
        async sendMigrationImportReceived(to: string[], importLink: string) {
            const fallbackBody = `<p>Somebody is looking at the file you uploaded. We will come back to you within ten working days.</p>
             <p><a href="${importLink}">View this import</a></p>`;
            const rendered = this.renderOr('migration-import-received', { importLink }, {
                subject: 'We have your import file', html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendRendered(rendered, to);
        }

        async sendMigrationImportReady(to: string[], importLink: string) {
            const fallbackBody = `<p>We have converted the file you sent. Nothing has been added to your workspace yet — open the import to see what it will add, then apply it.</p>
             <p><a href="${importLink}">Review this import</a></p>`;
            const rendered = this.renderOr('migration-import-ready', { importLink }, {
                subject: 'Your import is ready to review', html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendRendered(rendered, to);
        }

        /**
         * The refusal, carrying the sentence whoever looked at the file wrote.
         *
         * Escaped in the fallback body because that reason is free text typed
         * by a person, and a template that is not tenant-editable is still not
         * a reason to interpolate raw.
         */
        async sendMigrationImportDeclined(to: string[], declineReason: string) {
            const fallbackBody = `<p>We could not convert the file you sent.</p><p>${escapeHtml(declineReason)}</p>
             <p>Your file has not been kept. If you can export in another format, upload it and we will look again.</p>`;
            const rendered = this.renderOr('migration-import-declined', { declineReason }, {
                subject: 'We could not convert your import file', html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendRendered(rendered, to);
        }

        async sendMigrationImportExpiring(to: string[], vars: { importLink: string; expiresOn: string }) {
            const fallbackBody = `<p>The file you uploaded, and everything prepared from it, will be deleted on ${escapeHtml(vars.expiresOn)}.</p>
             <p><a href="${vars.importLink}">Open this import</a></p>`;
            const rendered = this.renderOr('migration-import-expiring', vars, {
                subject: 'An import you started is about to be cleared', html: fallbackBody,
            });
            if (!rendered.enabled) return;
            await this.sendRendered(rendered, to);
        }
    };
}
