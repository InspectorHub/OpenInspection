import { AutomationService } from './services/automation.service';
import { logger } from './lib/logger';

export interface ScheduledEnv {
    DB: D1Database;
    RESEND_API_KEY?: string;
    SENDER_EMAIL?: string;
    APP_NAME?: string;
    APP_BASE_URL?: string;
}

export async function scheduled(
    _event: ScheduledEvent,
    env: ScheduledEnv,
    _ctx: ExecutionContext,
): Promise<void> {
    if (!env.RESEND_API_KEY) {
        logger.info('scheduled: RESEND_API_KEY not set, skipping');
        return;
    }
    const svc = new AutomationService(env.DB);
    await svc.flush(
        env.RESEND_API_KEY,
        env.SENDER_EMAIL || '',
        env.APP_NAME || 'OpenInspection',
        env.APP_BASE_URL || '',
    );
}
