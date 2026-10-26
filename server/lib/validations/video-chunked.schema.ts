import { z } from 'zod';

/** Open (or resume) a chunked video upload: the size of the whole file, which fixes how many parts it has. */
export const OpenChunkedVideoUploadSchema = z.object({
    totalBytes: z.number().int().min(1),
});
