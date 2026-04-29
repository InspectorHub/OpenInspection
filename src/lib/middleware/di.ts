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
import { ContactService } from '../../services/contact.service';
import { InvoiceService } from '../../services/invoice.service';
import { ServiceService } from '../../services/service.service';
import { AutomationService } from '../../services/automation.service';

import { StandaloneProvider } from '../integration/standalone';
import { PortalProvider } from '../integration/portal';

/**
 * Middleware that injects a lazy-loaded service registry into the Hono context.
 * When env vars for email/AI are absent, falls back to AES-GCM-decrypted DB secrets.
 */
export async function diMiddleware(c: Context<HonoConfig>, next: Next) {
    // Pre-load DB secrets only when env vars are absent and tenant is known.
    // Env vars always take priority over DB-stored config.
    let dbSecrets: { resendApiKey?: string; senderEmail?: string; geminiApiKey?: string } = {};
    const tenantId = c.get('tenantId');
    if (tenantId && (!c.env.RESEND_API_KEY || !c.env.GEMINI_API_KEY)) {
        try {
            const bSvc = new BrandingService(c.env.DB, c.env.TENANT_CACHE);
            dbSecrets = await bSvc.getDecryptedSecrets(tenantId, c.env.JWT_SECRET);
        } catch {
            // Secrets not yet configured — proceed without them
        }
    }

    const services = {} as AppServices;

    c.set('services', new Proxy(services, {
        get(target, prop: keyof AppServices) {
            if (target[prop]) return target[prop];

            switch (prop) {
                case 'admin':
                    {
                        const provider = c.env.PORTAL_API_URL
                            ? new PortalProvider(c.env.DB, c.env.TENANT_CACHE)
                            : new StandaloneProvider(c.env.DB, c.env.TENANT_CACHE);
                        target.admin = new AdminService(c.env.DB, provider);
                    }
                    break;
                case 'ai':
                    target.ai = new AIService(c.env.DB, c.env.GEMINI_API_KEY || dbSecrets.geminiApiKey || '');
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
                    target.email = new EmailService(
                        c.env.RESEND_API_KEY || dbSecrets.resendApiKey || '',
                        c.env.SENDER_EMAIL || dbSecrets.senderEmail || '',
                        c.env.APP_NAME || 'OpenInspection'
                    );
                    break;
                case 'inspection':
                    target.inspection = new InspectionService(c.env.DB, c.env.PHOTOS, c.get('sdb'), c.env.TENANT_CACHE);
                    break;
                case 'team':
                    target.team = new TeamService(c.env.DB, ...(c.env.APP_MODE ? [{ APP_MODE: c.env.APP_MODE }] : []));
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
                case 'contact':
                    target.contact = new ContactService(c.env.DB);
                    break;
                case 'invoice':
                    target.invoice = new InvoiceService(c.env.DB);
                    break;
                case 'service':
                    target.service = new ServiceService(c.env.DB);
                    break;
                case 'automation':
                    target.automation = new AutomationService(c.env.DB);
                    break;
            }
            return target[prop];
        }
    }));

    await next();
}
