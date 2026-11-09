import { derivativeMediaId } from '../r2-keys';

/**
 * Is `key` a baked derivative (`{mediaId}.annotated|cropped[.rev]`) of one of `knownMediaIds`, inside `folder` (the
 * inspection's own photo folder), whose object exists? Used to accept a just-baked file as a report cover before the
 * results row (written late under collaborative editing) names it. Fails closed: no bucket, a name outside the
 * derivative family, a photo the inspection does not have, a missing object, or storage that cannot answer all refuse.
 */
export async function isExistingDerivative(
    bucket: Pick<R2Bucket, 'head'> | undefined,
    folder: string,
    key: string,
    knownMediaIds: ReadonlySet<string>,
): Promise<boolean> {
    if (!bucket || !key.startsWith(folder)) return false;
    const mediaId = derivativeMediaId(key.slice(folder.length));
    if (!mediaId || !knownMediaIds.has(mediaId)) return false;
    try {
        return (await bucket.head(key)) !== null;
    } catch {
        return false;
    }
}
