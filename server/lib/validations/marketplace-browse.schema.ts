import { z } from '@hono/zod-openapi';
import { PropertyTypeEnum } from './template.schema';
import { MARKETPLACE_KINDS } from '../marketplace-kinds';

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
    // Derived from the column's own enum, never retyped. Typed here it read
    // ['comments', 'templates'], which offered a kind no row carries and hid
    // every 'statutory' row from the filter -- the service accepted all three
    // the whole time, so nothing anywhere went red.
    kind:           z.enum(MARKETPLACE_KINDS).optional().describe('Filter the catalogue to one kind of importable content'),
    propertyType:   PropertyTypeEnum.optional().describe('Filter templates by the property type they are written for'),
    jurisdiction:   z.string().min(1).max(64).optional().describe("Filter by a jurisdiction's form standard, e.g. trec"),
    inspectionKind: z.string().min(1).max(64).optional().describe('Filter by inspection kind, e.g. new_construction'),
});

