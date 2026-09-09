import { Errors } from '../../errors';
import { describeVendorMismatch } from './registry';
import type { VendorId } from '../bundle';
import type { IntakeIntent } from './registry';
import type { IntakeSource } from './source';

/**
 * When a wrongly-declared vendor is worth correcting, and what to say.
 *
 * `describeVendorMismatch` answers what a file looks like. This answers whether
 * saying so helps — a separate question, and the reason the intake route used
 * to answer every unmatched file the same way.
 *
 * WHY THE DISTINCTION IS NOT COSMETIC. The alternative is the assisted path,
 * which needs an owner's decision, puts a third party's file in front of a
 * person, and does not exist at all on a deployment with no support path. Being
 * sent down it because a picker was answered wrongly is expensive for everybody.
 * `describeVendorMismatch`'s own header says as much: "one offers a correction,
 * the other offers the assisted path, and conflating them sends people down the
 * wrong one." It was built and tested and then called by nothing, so the route
 * conflated them for as long as it existed.
 *
 * ⚠️ ONLY FOR A FILE WITH SOMETHING IN IT. Measured: three whitespace bytes
 * named `blank.tpz` "look like" `csv_generic`, because the generic reader is the
 * catch-all and any text is a CSV to it. Telling somebody their blank file looks
 * like a generic CSV is not a correction, it is a tautology; that file has
 * nothing to read and belongs on the assisted path, which is where it already
 * went.
 *
 * That check asks whether the correction is worth saying. It is NOT the retired
 * rule that trimmed decoded text to decide whether a file was empty — the one
 * that made a single space read as an empty upload — and it decides nothing
 * about whether the bytes are stored.
 */
export async function parkUnlessMisdeclared<T>(
    intent: IntakeIntent,
    declared: VendorId,
    source: IntakeSource,
    /** What to do with a file nothing can read: the assisted path. */
    park: () => Promise<T>,
): Promise<T> {
    const correction = source.text().trim().length > 0
        ? await describeVendorMismatch(intent, declared, source)
        : null;
    if (correction?.looksLike) {
        throw Errors.UnprocessableEntity(
            `This file does not read as ${correction.declared}. It looks like ${correction.looksLike} — `
            + 'choose that and upload it again.',
        );
    }
    return park();
}
