import { z } from 'zod';

/**
 * Body of the signed audit export request. Exactly one of `email` and `postalCode` has to carry a value; the route reads both when both
 * are present. Personal data travels in the body, never in the URL. `turnstileToken` is the bot challenge token, required where the
 * deployment enforces the challenge.
 */
export const VerifyExportBodySchema = z.object({
    email: z.string().trim().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).or(z.literal('')).optional().describe('An email address recorded for a signer of this envelope, or the client email of the request.'),
    postalCode: z.string().max(20).optional().describe('The postal code of the inspected property.'),
    turnstileToken: z.string().max(2048).optional().describe('Token from the bot challenge shown on the verifier page.'),
});

