import { Errors } from '../errors';
import type { DeploymentProfile } from '../deployment-profile';

/**
 * The vendors this deployment can read without a person, listed for the refusal
 * message. A refusal that does not say what WOULD work sends the operator back
 * to the same file.
 *
 * Module-private: it exists to be spoken, not read. A second caller wanting the
 * list would want it for a different purpose, and the sentence it belongs to
 * would then have two authors.
 */
const SUPPORTED_SOURCES = ['a Spectora template export (JSON)', 'a spreadsheet saved as CSV or Excel'];

/**
 * Whether a file nothing here can read may be kept for a person to convert.
 *
 * Both refusals happen BEFORE anything is stored, which is the whole rule:
 * keeping a third party's personal data that we could do nothing with has no
 * reason behind it, and "we might add an adapter later" is not one.
 *
 * Two sentences rather than one, because the operator's next action differs. On
 * a deployment with no support path there is nobody to hand it to and the only
 * way forward is a different file; where there is one, the missing piece is the
 * operator's own agreement, which they can give and try again.
 */
export function assertConversionByPersonAvailable(
    profile: DeploymentProfile,
    staffAccessAuthorized: boolean,
): void {
    if (!profile.hasAssistedMigration) {
        throw Errors.UnprocessableEntity(
            `Nothing here can read that file, so it has not been kept. This import accepts ${SUPPORTED_SOURCES.join(', or ')}.`,
        );
    }
    if (!staffAccessAuthorized) {
        throw Errors.UnprocessableEntity(
            'Nothing here can read that file. It can be converted by a person, which needs your '
            + 'agreement for somebody to open it — the file has not been kept in the meantime. '
            + `This import otherwise accepts ${SUPPORTED_SOURCES.join(', or ')}.`,
        );
    }
}
