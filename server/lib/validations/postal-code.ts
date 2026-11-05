/**
 * A postal code as a request states it: trimmed, and a placeholder read as no postal code.
 *
 * A value with fewer than two letters or digits ("-", " ", "--", "0") is not a postal code anyone could know, and storing one would
 * give a later reader something that looks like a value. It is turned into null rather than refused: the field is cosmetic, and a write
 * queued on a device before this rule existed must still apply. The audit export's knowledge check applies it again at compare time,
 * on the stored side and the supplied side, for values stored before this rule existed. An absent key stays absent and null stays null.
 */
export function postalOrNull(value: string | null | undefined): string | null | undefined {
    if (value == null) return value;
    const trimmed = value.trim();
    return (trimmed.match(/[\p{L}\p{N}]/gu) ?? []).length < 2 ? null : trimmed;
}
