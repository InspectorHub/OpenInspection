import { z } from '@hono/zod-openapi';
import { createApiResponseSchema, passwordSchema } from './shared.schema';

/**
 * Validation schema for the login request body.
 */
export const LoginSchema = z.object({
    email: z.string().email('Invalid email address').openapi({
        example: 'admin@example.com',
        description: 'Email address associated with the user account.',
    }),
    password: z.string().min(1, 'Password is required').openapi({
        example: 'p@ssword123',
        description: 'Account password as supplied at registration or last reset.',
    }),
});

/**
 * Validation schema for the login response.
 */
export const AuthResponseSchema = createApiResponseSchema(
    z.object({
        redirect: z.string().openapi({ example: '/dashboard' }).describe('TODO describe redirect field for the OpenInspection MCP integration'),
    })
);

/**
 * Validation schema for the change-password request body.
 */
export const ChangePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required').openapi({
        example: 'oldpassword',
        description: 'The user\'s current account password — must match before the change is accepted.',
    }),
    newPassword: passwordSchema.openapi({
        example: 'NewPassword1!',
        description: 'New password to set — min 8 chars, must include uppercase, digit, and special character.',
    }),
});

/**
 * Validation schema for the join-team request body.
 */
export const JoinTeamSchema = z.object({
    token: z.string().uuid('Invalid invitation token').openapi({
        example: '550e8400-e29b-41d4-a716-446655440000',
        description: 'One-time invitation token from the team-invite email; valid until the invite expires or is consumed.',
    }),
    password: passwordSchema.openapi({
        example: 'NewPassword1!',
        description: 'Password to set for the newly created account — min 8 chars with uppercase, digit, and special character.',
    }),
    name: z.string().min(1).max(120).optional().openapi({
        example: 'Jamie Rivera',
        description: 'Display name the joining member types on the accept form. Optional; stored on the new user when present.',
    }),
});

/**
 * Validation schema for the reset-password request body.
 */
export const ResetPasswordSchema = z.object({
    token: z.string().uuid('Invalid reset token').openapi({
        example: '550e8400-e29b-41d4-a716-446655440000',
        description: 'One-time password-reset token from the forgot-password email; valid for a short window.',
    }),
    newPassword: passwordSchema.openapi({
        example: 'NewPassword1!',
        description: 'New password to set — min 8 chars with uppercase, digit, and special character.',
    }),
});

/**
 * Validation schema for the forgot-password request body.
 */
export const ForgotPasswordSchema = z.object({
    email: z.string().email('Invalid email address').openapi({
        example: 'admin@example.com',
        description: 'Email address of the account that should receive a password-reset link.',
    }),
});

/**
 * Spec 4A — TOTP 2FA schemas. Recovery codes have 8 chars + dash; we accept the same
 * 6-digit input for both TOTP and recovery code (recovery codes are 4-4 alphabetic).
 */
export const TotpVerifySchema = z.object({
    code: z.string().min(6).max(20).openapi({
        example: '123456',
        description: 'Six-digit TOTP code from the authenticator app, or an 8-char recovery code.',
    }),
});

export const TotpDisableSchema = z.object({
    password: z.string().min(1).openapi({
        example: 'currentPassword',
        description: 'Current account password — required to disable 2FA as a sensitivity check.',
    }),
    code: z.string().min(6).max(20).openapi({
        example: '123456',
        description: 'Current TOTP code or recovery code, proving possession of the second factor.',
    }),
});

export const TotpRegenerateSchema = TotpDisableSchema;

export const TotpLoginSchema = z.object({
    challengeToken: z.string().min(10).openapi({
        example: 'eyJhbGciOiJI...',
        description: 'Short-lived 2FA challenge JWT issued by /login when the account has TOTP enabled.',
    }),
    code: z.string().min(6).max(20).openapi({
        example: '123456',
        description: 'Six-digit TOTP code from the authenticator app, or an 8-char recovery code.',
    }),
});

export const TotpSetupResponseSchema = createApiResponseSchema(z.object({
    secret: z.string().openapi({ example: 'JBSWY3DPEHPK3PXP' }).describe('TODO describe secret field for the OpenInspection MCP integration'),
    qrCodeDataUri: z.string().openapi({ example: 'data:image/png;base64,...' }).describe('TODO describe qrCodeDataUri field for the OpenInspection MCP integration'),
    recoveryCodes: z.array(z.string()).openapi({ example: ['ABCD-EFGH'] }).describe('TODO describe recoveryCodes field for the OpenInspection MCP integration'),
}));

export const Login2faResponseSchema = createApiResponseSchema(z.union([
    z.object({ redirect: z.string().describe('TODO describe redirect field for the OpenInspection MCP integration') }),
    z.object({ requires2fa: z.literal(true).describe('TODO describe requires2fa field for the OpenInspection MCP integration'), challengeToken: z.string().describe('TODO describe challengeToken field for the OpenInspection MCP integration') }),
]));

/**
 * Validation schema for the system initialization (Zero-Setup).
 */
export const SetupSchema = z.object({
    companyName: z.string().min(2, 'Company name is required').openapi({
        example: 'Acme Inspections',
        description: 'Inspection company name — shown on reports and booking pages as the tenant brand.',
    }),
    // Display name for the first inspector. REQUIRED so /book/<slug> and
    // /inspector/<slug> never need to fall back to email or company name.
    adminName: z.string().min(2, 'Your name is required').max(120).openapi({
        example: 'Mike Reynolds',
        description: 'Display name for the first inspector account — used on report headers and booking pages.',
    }),
    email: z.string().email('Invalid email address').openapi({
        example: 'admin@example.com',
        description: 'Email address for the initial admin account; also used for login and password-reset.',
    }),
    password: passwordSchema.openapi({
        example: 'P@ssword123',
        description: 'Initial admin password — min 8 chars with uppercase, digit, and special character.',
    }),
    verificationCode: z.string().min(6).optional().openapi({
        example: '123456',
        description: 'Optional 6-digit verification code from environment or KV; required when set by the operator.',
    }),
});
