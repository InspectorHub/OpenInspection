import { z } from '@hono/zod-openapi';
import { createApiResponseSchema, passwordSchema } from './shared.schema';

/**
 * Validation schema for the login request body.
 */
export const LoginSchema = z.object({
    email: z.string().email('Invalid email address').openapi({
        example: 'admin@example.com',
        description: 'User email address'
    }),
    password: z.string().min(1, 'Password is required').openapi({
        example: 'p@ssword123',
        description: 'User password'
    }),
});

/**
 * Validation schema for the login response.
 */
export const AuthResponseSchema = createApiResponseSchema(
    z.object({
        redirect: z.string().openapi({ example: '/dashboard' }),
    })
);

/**
 * Validation schema for the change-password request body.
 */
export const ChangePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required').openapi({
        example: 'oldpassword'
    }),
    newPassword: passwordSchema.openapi({ example: 'NewPassword1!' }),
});

/**
 * Validation schema for the join-team request body.
 */
export const JoinTeamSchema = z.object({
    token: z.string().uuid('Invalid invitation token').openapi({
        example: '550e8400-e29b-41d4-a716-446655440000'
    }),
    password: passwordSchema.openapi({ example: 'NewPassword1!' }),
});

/**
 * Validation schema for the reset-password request body.
 */
export const ResetPasswordSchema = z.object({
    token: z.string().uuid('Invalid reset token').openapi({
        example: '550e8400-e29b-41d4-a716-446655440000'
    }),
    newPassword: passwordSchema.openapi({ example: 'NewPassword1!' }),
});

/**
 * Validation schema for the forgot-password request body.
 */
export const ForgotPasswordSchema = z.object({
    email: z.string().email('Invalid email address').openapi({
        example: 'admin@example.com'
    }),
});

/**
 * Validation schema for the system initialization (Zero-Setup).
 */
export const SetupSchema = z.object({
    companyName: z.string().min(2, 'Company name is required').openapi({
        example: 'Acme Inspections'
    }),
    email: z.string().email('Invalid email address').openapi({
        example: 'admin@example.com'
    }),
    password: passwordSchema.openapi({ example: 'P@ssword123' }),
    verificationCode: z.string().min(6).optional().openapi({
        example: '123456'
    }),
});
