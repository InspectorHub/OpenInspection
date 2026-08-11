import { z } from '@hono/zod-openapi';
import { PropertyTypeEnum } from './template.schema';

/**
 * Three browse axes, not one `category` (#293). They are independent: a Texas
 * inspector looks for the TREC form, a new-build buyer looks for a
 * new-construction template, and neither of those is a property type. The
 * legacy single column could only ever describe one of the three, which is why
 * the catalogue had rows filed under a jurisdiction that no property-type
 * filter could reach.
 *
 * `propertyType` reuses the template validator's enum because a catalogue
 * template exists to become a local `templates` row; a second vocabulary here
 * could not survive the import.
 *
 * `jurisdiction` and `inspectionKind` are bounded free text rather than enums
 * on purpose: today they hold one value each ('trec', 'new_construction'), and
 * an enum built from a sample of one is a guess wearing a type. Give them
 * length bounds and revisit when a third value exists.
 */
export const MarketplaceBrowseQuerySchema = z.object({
    search:         z.string().optional().describe('Free-text search over catalogue entry names'),
    kind:           z.enum(['comments', 'templates']).optional().describe('Filter the catalogue to one kind of importable content'),
    propertyType:   PropertyTypeEnum.optional().describe('Filter templates by the property type they are written for'),
    jurisdiction:   z.string().min(1).max(64).optional().describe("Filter by a jurisdiction's form standard, e.g. trec"),
    inspectionKind: z.string().min(1).max(64).optional().describe('Filter by inspection kind, e.g. new_construction'),
});

export type MarketplaceBrowseQuery = z.infer<typeof MarketplaceBrowseQuerySchema>;
