import { Context, Next } from 'hono';
import { HonoConfig, AppServices } from '../../types/hono';
import { AdminService } from '../../services/admin.service';
import { AIService } from '../../services/ai.service';
import { AuthService } from '../../services/auth.service';
import { BookingService } from '../../services/booking.service';
import { BrandingService } from '../../services/branding.service';
import { EmailService } from '../../services/email.service';
import { InspectionService } from '../../services/inspection.service';
import { TeamService } from '../../services/team.service';
import { TemplateService } from '../../services/template.service';
import { AgreementService } from '../../services/agreement.service';
import { AvailabilityService } from '../../services/booking.service';

import { StandaloneProvider } from '../integration/standalone';
import { PortalProvider } from '../integration/portal';

/**
 * Middleware that injects a lazy-loaded service registry into the Hono context.
 */
export async function diMiddleware(c: Context<HonoConfig>, next: Next) {
    const services = {} as AppServices;

    // Use a Proxy to implement lazy loading
    c.set('services', new Proxy(services, {
        get(target, prop: keyof AppServices) {
            // Already instantiated?
            if (target[prop]) return target[prop];

            // Instantiate on demand
            switch (prop) {
                case 'admin':
                    {
                        // Select provider based on environment configuration
                        const provider = c.env.PORTAL_API_URL 
                            ? new PortalProvider(c.env.DB, c.env.TENANT_CACHE)
                            : new StandaloneProvider(c.env.DB, c.env.TENANT_CACHE);
                            
                        target.admin = new AdminService(c.env.DB, provider);
                    }
                    break;
                case 'ai':
                    target.ai = new AIService(c.env.DB, c.env.GEMINI_API_KEY);
                    break;
                case 'auth':
                    target.auth = new AuthService(c.env.DB, c.env.TENANT_CACHE);
                    break;
                case 'booking':
                    target.booking = new BookingService(c.env.DB);
                    break;
                case 'branding':
                    target.branding = new BrandingService(c.env.DB, c.env.TENANT_CACHE);
                    break;
                case 'email':
                    target.email = new EmailService(c.env.RESEND_API_KEY, c.env.SENDER_EMAIL, c.env.APP_NAME);
                    break;
                case 'inspection':
                    target.inspection = new InspectionService(c.env.DB, c.env.PHOTOS, c.get('sdb'));
                    break;
                case 'team':
                    target.team = new TeamService(c.env.DB, c.env);
                    break;
                case 'template':
                    target.template = new TemplateService(c.env.DB);
                    break;
                case 'agreement':
                    target.agreement = new AgreementService(c.env.DB);
                    break;
                case 'availability':
                    target.availability = new AvailabilityService(c.env.DB);
                    break;
            }
            return target[prop];
        }
    }));

    await next();
}
