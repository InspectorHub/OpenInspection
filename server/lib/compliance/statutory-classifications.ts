/**
 * Statutory classifications — the legal readings, kept apart from the manifest.
 *
 * Split out of `erasure-out-of-scope.ts` because both compliance files had
 * reached their line ceiling with zero headroom, and because the separation is
 * the right one anyway rather than an arithmetic convenience.
 *
 * ── Why these are not fields on `ErasureRule` ───────────────────────────────
 * `ErasureRule.category` carries an explicit instruction NOT to be cited
 * downstream as a legal determination. `statutory_basis` and `basis_kind` ARE
 * legal determinations, sourced to a review ruling. One row carrying both is
 * exactly the confusion review removed from the action and category labels;
 * reintroducing it one field lower would be the same error at a smaller scale.
 *
 * The vocabulary is snake_case, matching the jurisdiction registry rather than
 * the manifest's camelCase, so the two axes cannot be read as one.
 *
 * ── The state that matters is "not judged yet" ──────────────────────────────
 * `review_status` distinguishes a review ruling from an engineering reading
 * from an entry nobody has assessed. A `not_assessed` entry may carry NO basis
 * and NO basis_kind: a half-filled classification is the one that reads as a
 * decision. `classification-basis.spec.ts` checks the census in, prints it every
 * run, and NAMES the non-ruled entries rather than counting them.
 */

/**
 * A US-statutory classification of ONE column: the statute read, the kind of
 * answer it produced, and what would make it stop holding. Deliberately NOT a
 * field on `ErasureRule` — `category` there is OUR governance label, which its
 * own doc comment forbids citing as a legal determination, while these entries
 * ARE a reading of the law, sourced to a review ruling.
 *  - `basis_kind` — `statutory_exclusion` (the definition excludes what we hold;
 *    review, CA-10) · `architecture_dependent` (only our own code keeps us out
 *    of it — `exif_data`, same statute) · `conditional` (turns on a named axis).
 *  - `review_status` — WHO judged it: `counsel_ruled` carries a ruling id, every
 *    other state carries `open_question` and NO statutory classification, so a
 *    half-filled entry cannot read as a decided one.
 *  - `erasure_coverage` — the governing manifest rule, or `gap` where consumer
 *    erasure has none; a gap is not "never deleted", which `reached_by` says.
 *    The spec below counts each state and each gap out loud, either way.
 */
export interface StatutoryClassification {
    table: string; column: string;
    statutory_basis?: string;
    basis_kind?: 'statutory_exclusion' | 'architecture_dependent' | 'conditional';
    /** CA-11 vocabulary: the only conditional axis review has ruled on so far. */
    spi_classification?: 'conditional_by_direction';
    reason: string; tripwire?: string;
    review_status: 'counsel_ruled' | 'engineering_provisional' | 'not_assessed';
    ruling?: string; open_question?: string;
    erasure_coverage: string; reached_by: string;
}

/** @gateConsumed asserted by `tests/unit/privacy/classification-basis.spec.ts`. */
export const STATUTORY_CLASSIFICATIONS: StatutoryClassification[] = [
    // CA-10 lands on the safer side, and the reason is the DEFINITION rather
    // than the fact that we happen not to read a phone GPS today. The manifest
    // rules pre-date these entries; CA-10 adds the reading and the trip-wire.
    {
        table: 'inspections', column: 'address_lat', review_status: 'counsel_ruled', ruling: 'CA-10',
        statutory_basis: 'Cal. Civ. Code §1798.140(w)', basis_kind: 'statutory_exclusion', erasure_coverage: 'inspections.address_lat',
        reason: 'A typed street address geocoded through the places API is personal information and geolocation data, but it is not statutory precise geolocation: §1798.140(w) reaches only data derived from a device, and a coordinate does not become device-derived because an API returned it',
        tripwire: 'Device-derived location must never be treated as equivalent to address geocoding. If any writer ever stores a coordinate a device produced — field capture of where the inspector stood, or EXIF GPS persisted off a photo — that is a different fact pattern and this classification must be re-run rather than inherited',
        reached_by: 'retained under Art. 17(3)(e) by its manifest rule, enforcement still pending; destroyed by the tenant purge and by the inspection-delete cascade',
    },
    {
        table: 'inspections', column: 'address_lng', review_status: 'counsel_ruled', ruling: 'CA-10',
        statutory_basis: 'Cal. Civ. Code §1798.140(w)', basis_kind: 'statutory_exclusion', erasure_coverage: 'inspections.address_lng',
        reason: 'The other half of the same coordinate, on the same reading: geocoded from a typed address, therefore not data derived from a device within §1798.140(w)',
        tripwire: 'Device-derived location must never be treated as equivalent to address geocoding; a device-produced longitude changes the fact pattern exactly as a latitude would',
        reached_by: 'retained under Art. 17(3)(e) by its manifest rule, enforcement still pending; destroyed by the tenant purge and by the inspection-delete cascade',
    },
    // CA-11: review refused the one-word form because it hides the half of the
    // answer that does not hold, so the direction is the record.
    {
        table: 'inspection_messages', column: 'body', review_status: 'counsel_ruled', ruling: 'CA-11',
        statutory_basis: 'Cal. Civ. Code §1798.140(ae)(1)(E)', basis_kind: 'conditional', spi_classification: 'conditional_by_direction',
        reason: 'The exclusion turns on the statutory intended-recipient test, so the answer is directional: a homebuyer message addressed to the inspector is outside the SPI category because the inspection company IS the intended recipient, while an inspector message addressed to the homebuyer is not, and the exclusion may not be applied to it automatically',
        tripwire: 'Any feature that treats a thread as one classified object — a bulk SPI report, a retention rule keyed on the table, an export that flattens inspector and client rows together — loses the direction and with it the answer',
        erasure_coverage: 'gap',
        reached_by: 'nothing in consumer erasure: the table has no manifest rule, and the subject export does not assemble messages either. It IS destroyed by the tenant purge (reached through the tenantId-derived scoped-table set) and by the inspection-delete cascade',
    },
    // The counter-case CA-10 set aside, and the reason the trip-wire above is
    // not hypothetical: this column is already TYPED for a device coordinate.
    {
        table: 'inspection_media_pool', column: 'exif_data', review_status: 'engineering_provisional',
        statutory_basis: 'Cal. Civ. Code §1798.140(w)', basis_kind: 'architecture_dependent', erasure_coverage: 'gap',
        reason: 'The declared JSON shape anticipates a gps coordinate; the one writer of the column persists only takenAt, and the strip-on-ingest re-encode drops camera metadata from the bytes. So no device-derived coordinate is stored today — but that is bought by two code facts rather than by §1798.140(w), which would reach a phone GPS fix if one were ever written here',
        tripwire: 'The moment a writer persists a gps member, or any capture path records a coordinate a device produced, this column becomes the fact pattern CA-10 set aside and needs a ruling of its own',
        open_question: 'review has not ruled on this column. Two facts to put to them: the strip-on-ingest re-encode fails OPEN when the images binding is absent, so a stored object can retain camera metadata the column does not; and takenAt is supplied by the client rather than read server-side',
        reached_by: 'nothing in consumer erasure: neither a manifest rule nor an out-of-scope declaration, and the PII heuristic never matched the column name. It IS destroyed by the tenant purge and by the inspection-delete cascade',
    },
];
