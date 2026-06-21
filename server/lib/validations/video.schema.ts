import { z } from 'zod';

/**
 * Validation schema for the Settings → Integrations → Video section.
 * Only used by the settings-integrations route action; the backend
 * persists videoMode via PATCH /api/admin/tenant-config and
 * streamCustomerSubdomain via POST /api/admin/config (integrationConfig RMW).
 *
 * When videoMode is 'stream', streamCustomerSubdomain must be a non-empty
 * string that looks like a hostname (no protocol, no trailing slash).
 */
export const SaveVideoSchema = z.discriminatedUnion('videoMode', [
    z.object({
        videoMode: z.literal('r2'),
        streamCustomerSubdomain: z.string().optional(),
    }),
    z.object({
        videoMode: z.literal('stream'),
        streamCustomerSubdomain: z
            .string()
            .min(1, 'Stream customer subdomain is required when Stream mode is enabled.')
            .regex(
                /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
                'Must be a valid hostname (e.g. customer.cloudflarestream.com).',
            ),
    }),
]);

export type SaveVideoInput = z.infer<typeof SaveVideoSchema>;
