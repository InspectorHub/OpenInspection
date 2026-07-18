import { z } from '@hono/zod-openapi';

const PAGE_SIZES = [12, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 50;

/**
 * Shared pagination query parameter schema. Pages are 1-indexed; pageSize is
 * restricted to a small enum so a query injection can't ask for unbounded rows.
 */
export const paginationQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1).describe('1-indexed page number for paginated results'),
    pageSize: z.coerce.number().int()
        .refine((n) => (PAGE_SIZES as readonly number[]).includes(n), {
            message: `pageSize must be one of ${PAGE_SIZES.join(', ')}`,
        })
        .default(DEFAULT_PAGE_SIZE)
        .describe(`Number of results per page (one of ${PAGE_SIZES.join(', ')})`),
});

export const PaginatedMetaSchema = z.object({
    total:      z.number().int().min(0),
    page:       z.number().int().min(1),
    pageSize:   z.number().int().min(1),
    totalPages: z.number().int().min(1),
});

export type PaginatedMeta = z.infer<typeof PaginatedMetaSchema>;

export function buildMeta(input: { total: number; page: number; pageSize: number }): PaginatedMeta {
    const totalPages = Math.max(1, Math.ceil(input.total / input.pageSize));
    return { ...input, totalPages };
}
