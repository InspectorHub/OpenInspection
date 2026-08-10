/**
 * Read the `photoNo` that `assignPhotoNumbers` stamps onto a section tree.
 *
 * WHY A HELPER AND NOT A CAST. `assignPhotoNumbers`
 * (`server/lib/report-photos.ts`) returns `SectionLike[]`, and `SectionLike`'s
 * photos are `ReportPhotoLike`, which has no `photoNo`. The stamped type
 * (`ReportPhotoLike & { photoNo: number }`) exists inside the function and is
 * widened away at the return boundary — so the fact the specs assert on is not
 * expressible through the published signature. Casting the array to
 * `Array<{ photoNo: number }>` does not compile either (neither direction
 * overlaps: the target is missing `key`/`url`, the source is missing
 * `photoNo`).
 *
 * Spreading into a fresh object gets an implicit index signature, which reads
 * the stamp with no assertion of any kind. `unknown` is the honest return: the
 * caller compares it, it never flows anywhere typed.
 *
 * ⚠️ If the source signature is ever tightened to return the stamped type, this
 * helper becomes dead weight — delete it and index the property directly.
 */
export function stampedPhotoNo(photo: object): unknown {
    const record: Record<string, unknown> = { ...photo };
    return record.photoNo;
}
