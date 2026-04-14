/**
 * Global environment bindings for the Cloudflare Worker.
 * Defines the expected resources from wrangler.toml.
 */
export interface AppEnv {
    // Infrastructure
    DB: D1Database;
    TENANT_CACHE: KVNamespace;
    PHOTOS: R2Bucket;
    
    // Security & Auth
    JWT_SECRET: string;
    TURNSTILE_SITE_KEY: string;
    TURNSTILE_SECRET_KEY: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    GEMINI_API_KEY: string;
    
    // Communication
    RESEND_API_KEY: string;
    SENDER_EMAIL: string;
    
    // System Defaults
    APP_NAME: string;
    PRIMARY_COLOR: string;
    APP_BASE_URL: string;
    GA_MEASUREMENT_ID: string;

    // Optional Configuration
    SINGLE_TENANT_ID?: string;
    BILLING_URL?: string;
    CF_ACCOUNT_ID?: string;
    CF_API_TOKEN?: string;
    APP_MODE?: 'standalone';
    SETUP_CODE?: string;
    INTEGRATION_SECRET?: string;
}

import { AdminService } from '../services/admin.service';
import { AIService } from '../services/ai.service';
import { AuthService } from '../services/auth.service';
import { BookingService, AvailabilityService } from '../services/booking.service';
import { BrandingService } from '../services/branding.service';
import { EmailService } from '../services/email.service';
import { InspectionService } from '../services/inspection.service';
import { TeamService } from '../services/team.service';
import { TemplateService } from '../services/template.service';
import { AgreementService } from '../services/agreement.service';
import { AuthVariables } from './auth';

/**
 * Registry of all available services.
 * This allows for lazy-loading and better testability.
 */
export interface AppServices {
    admin: AdminService;
    auth: AuthService;
    booking: BookingService;
    branding: BrandingService;
    email: EmailService;
    inspection: InspectionService;
    team: TeamService;
    template: TemplateService;
    agreement: AgreementService;
    availability: AvailabilityService;
    ai: AIService;
}

/**
 * Global variables injected into the Hono context via middlewares.
 */
export type AppVariables = AuthVariables & {
    services: AppServices;
};

/**
 * Helper type for Hono Generic definitions.
 */
export type HonoConfig = {
    Bindings: AppEnv;
    Variables: AppVariables;
};
