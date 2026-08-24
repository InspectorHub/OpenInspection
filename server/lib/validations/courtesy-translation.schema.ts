/**
 * The wire shape of a courtesy translation, and the one locale offered.
 *
 * A schema module rather than an inline object, for the reason every schema
 * lives here: a response shape defined inside a route handler is a shape no
 * other surface can reuse, and the PDF template and the web report render the
 * same payload.
 */
import { z } from '@hono/zod-openapi';
import { SUPPORTED_CONTACT_LOCALES } from '../i18n/contact-locale';
import { createApiResponseSchema } from './shared.schema';
import { ReportDataResponseSchema } from './inspection.schema';

/**
 * The locale a report is offered in.
 *
 * ONE, deliberately: no third locale until the second has a paying customer.
 * Derived from the contact-locale set rather than written out, so the language
 * a report can be translated into is the same language the product can address
 * a recipient in — two lists would let one drift into offering a language
 * nothing else can speak.
 */
export const COURTESY_TRANSLATION_LOCALE: string =
    SUPPORTED_CONTACT_LOCALES.find((l) => l !== 'en') ?? 'es-419';

/**
 * Not exported: it is composed into `PublicReportResponseSchema` below, which
 * is the module's surface. An exported name nobody imports is surface to keep
 * in sync for no reason.
 */
const CourtesyTranslationPayloadSchema = z.object({
    locale: z.string().describe('BCP-47 tag of the language the segments are in.'),
    segments: z.array(z.string()).describe('Translated text, aligned index-for-index with `paths`.'),
    paths: z.array(z.string()).describe('Report payload paths the segments belong to, e.g. sections.3.items.2.notes. Emitted so a renderer never has to re-derive them — a second implementation of the segmenter would drift from the first.'),
    notice: z.object({
        locale: z.string().describe('The language the notice text below is in.'),
        title: z.string(),
        text: z.string(),
        authoritative: z.boolean().describe('True when this wording IS the record in `locale` — the English original, or a reviewed per-language constant. Never true of a machine translation.'),
        version: z.number().describe('The English notice version this translation was produced under.'),
    }),
    generatedAt: z.number().describe('Epoch ms.'),
}).describe('A courtesy translation of an inspection report. The English report is the inspection record; this is provided to assist understanding.');

/**
 * The public report response: the English payload, plus the translation or null.
 *
 * A SIBLING of `data`, never a field inside it. The span register's totality
 * property is defined over `getReportData`'s payload, and decorating that
 * payload at the route would make the register describe something that is no
 * longer the whole object — weakening the one test that stops a new field
 * becoming translatable by being forgotten. It is also simply true: a
 * translation is ABOUT the report rather than part of it, which is the same
 * distinction the notice itself draws.
 */
export const PublicReportResponseSchema =
    createApiResponseSchema(ReportDataResponseSchema).extend({
        courtesyTranslation: CourtesyTranslationPayloadSchema.nullable()
            .describe('A courtesy translation of this report, or null. Null covers both "there is none" and "there is one that no longer describes this document" - a reader has nothing to do with the difference. The English report is the inspection record either way.'),
    });
