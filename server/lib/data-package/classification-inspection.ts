/**
 * Classification, family 2 of 3: inspections, reports, e-sign and evidence,
 * media and client-facing access.
 */
import {
    ratingSystems, templates, inspections, inspectionResults, agreements, inspectionInspectors, comments,
    agreementRequests, agreementSigners, inspectionEvents, inspectionRequests, inspectionMediaPool,
    orphanedMedia, tags, inspectionItemTagLinks, conciergeConfirmTokens, commentUsage, defectCategories,
    costItems, reports, inspectorCredentials, inspectionAccessTokens, reportViews, inspectionPeople,
    inspectionUnits, reportVersions, reportPdfs, reportExports, reportTranslations, reportSignoff,
    repairRequests, repairRequestItems, psqResponses, esignAuditLogs, signingKeys, clientUploads,
    videoUploads, videoUploadParts, documentReviewItems, inspectionMessages, inspectionServices,
    inspectionTypes, eventTypes,
} from '../db/schema';
import {
    archiveTable, exportTable, outTable, partialTable, withholdTable,
    type ClassifiedTable, type ColumnRule,
} from './classification-types';

const I: ColumnRule = 'include';
const OWNED = 'Business data the tenant authored or owns.';
const HISTORY = 'Historical record. Travels verbatim and is imported as a read-only archive, never as live records.';

export const INSPECTION_FAMILY: readonly ClassifiedTable[] = [
    exportTable(inspections, 'direct', 'Core record. Imported rows are stamped as imported so they do not count as newly created inspections.'),
    exportTable(inspectionResults, 'direct', OWNED),
    exportTable(templates, 'direct', 'Authored templates. Stored JSON is exported exactly as stored, in whatever encoding the row holds.'),
    exportTable(ratingSystems, 'direct', OWNED),
    exportTable(agreements, 'direct', OWNED),
    exportTable(inspectionInspectors, 'direct', OWNED),
    exportTable(comments, 'direct', 'Business data the tenant authored. library_id and import_hash point at marketplace libraries of the source; the importer keeps the text and leaves them as dangling soft references (no lookup may assume they resolve).'),
    exportTable(commentUsage, 'direct', OWNED),
    exportTable(inspectionRequests, 'direct', OWNED),
    exportTable(inspectionPeople, 'direct', OWNED),
    exportTable(inspectionUnits, 'direct', OWNED),
    exportTable(inspectionServices, 'direct', 'Price snapshots per inspection; part of the money authority chain.'),
    exportTable(inspectionTypes, 'direct', OWNED),
    exportTable(eventTypes, 'direct', OWNED),
    exportTable(tags, 'direct', OWNED),
    exportTable(inspectionItemTagLinks, 'direct', OWNED),
    exportTable(defectCategories, 'direct', OWNED),
    exportTable(costItems, 'direct', OWNED),
    exportTable(inspectorCredentials, 'direct', 'Licence and credential records of inspectors; the image bytes travel with the media.'),
    exportTable(inspectionMessages, 'direct', 'Conversation history; attachments travel with the media.'),
    exportTable(inspectionMediaPool, 'direct', 'Media metadata; the bytes are in object storage and travel as media. stream_uid is a video-service handle of the source and is reset to NULL; provider is reset to the stored-object backend.', {
        reset: {
            streamUid: 'Handle in the source video service; meaningless on the target, set to NULL.',
            provider: 'Set to the stored-object backend, since the bytes travel as objects.',
        },
    }),
    exportTable(clientUploads, 'direct', 'Documents clients uploaded to an inspection; the bytes travel as media.'),
    exportTable(videoUploads, 'direct', 'Video metadata; the bytes travel as media where they live in object storage. In-progress rows are left out.', {
        rowFilter: 'Only rows whose state is completed travel; open, completing, aborted and failed uploads are left out.',
    }),
    exportTable(documentReviewItems, 'direct', OWNED),
    exportTable(reports, 'direct', OWNED),
    exportTable(reportSignoff, 'direct', OWNED),
    exportTable(reportTranslations, 'direct', 'Courtesy translations keyed to the English they were made from.'),
    exportTable(reportVersions, 'direct',
        'Published report snapshots (version history). The verification token is a bearer-style verifier that the published document already exposes; it is kept verbatim.', {
            publicColumns: { verificationToken: 'Bearer-style token the published document itself already exposes; kept so printed QR codes stay verifiable on the source. Unique index: the importer regenerates or skips on conflict.' },
        }),
    archiveTable(reportPdfs, 'direct',
        'Rendered PDF per published version. Rendering needs a browser binding the target may lack and the output depends on the renderer version at publish time, so the stored copy is kept as the record; retention deletes it only after the tenant\'s configured window.'),
    outTable(reportExports, 'direct', 'Derived word-processor exports with expiring objects; regenerated on demand.'),
    exportTable(repairRequests, 'direct', OWNED, {
        reset: {
            createdByRef: 'Holds an email address or user id, and on old rows created by an agent possibly a raw legacy share token (a live credential). Rewrite rule: when created_by_kind is agent and the value is neither an email, nor a hyphenated uuid, nor already prefixed legacy-share:, replace it with legacy-share:<sha256 of the value>.',
            shareToken: 'Public share credential, NOT NULL and unique: the importer generates a new unique token for every row.',
        },
    }),
    exportTable(repairRequestItems, 'direct', OWNED),
    exportTable(psqResponses, 'direct', OWNED, {
        reset: { shareToken: 'Public share credential: the importer generates a new unique token for every row.' },
    }),
    archiveTable(inspectionEvents, 'direct', HISTORY),
    archiveTable(reportViews, 'direct', 'View analytics. The access-token reference cannot be dropped: the column is NOT NULL and part of the unique scope index with tenant and inspection, so every row gets its own placeholder.', {
        reset: { accessTokenId: 'References a client access token that does not travel; the importer writes imported:<row id>, unique per row, so view records stay separate.' },
    }),
    archiveTable(agreementRequests, 'direct',
        'Signed or sent agreement envelopes. A pending or unsigned envelope is never revived: its link is dead because tokens do not travel.', {
            withhold: {
                tokenHash: 'Signing-link credential; never travels.',
                lastError: 'Decline reason text, deliberately kept out of tenant exports by the schema; the most conservative reading is to withhold it.',
            },
            publicColumns: { verificationToken: 'Bearer-style verifier the sealed document already exposes; kept for printed QR codes. Unique index: the importer regenerates or skips on conflict.' },
        }),
    archiveTable(agreementSigners, 'direct', 'Signer records of agreement envelopes; the signing links are dead because tokens do not travel.', {
        withhold: {
            tokenHash: 'Signing-link credential; never travels.',
            tokenEnc: 'Encrypted signing-link credential; never travels.',
        },
    }),
    archiveTable(esignAuditLogs, 'direct', 'E-sign hash chain. Travels byte for byte in original row order; never recomputed, re-signed or relinked.'),
    partialTable(signingKeys, 'direct', 'Public half only, imported as a retired key. private_key_enc and private_key_iv are NOT NULL but withheld: the importer writes an undecryptable placeholder, and every signing path must reject a retired key, so an imported key can never sign. The private half is encrypted under an instance secret that does not move.', {
        id: I, tenantId: { reset: 'Evidence keeps its own fingerprint; the importer writes the target tenant id.' },
        publicKey: I,
        privateKeyEnc: { withhold: 'Private signing key, encrypted under an instance secret; never travels.' },
        privateKeyIv: { withhold: 'Initialisation vector of the private key; never travels.' },
        fingerprint: I, algorithm: I, createdAt: I,
        retiredAt: { reset: 'Set to import time on every row: a source row with no retirement is the source active key and must not collide with, or become, the signer of the target.' },
    }),
    withholdTable(inspectionAccessTokens, 'direct', 'Client portal access tokens; the target issues fresh links.'),
    withholdTable(conciergeConfirmTokens, 'direct', 'Single-use confirmation tokens.'),
    outTable(orphanedMedia, 'direct', 'Cleanup queue for unreferenced objects; regenerated by the sweep.'),
    outTable(videoUploadParts, 'direct', 'In-flight multipart upload state.'),
];
