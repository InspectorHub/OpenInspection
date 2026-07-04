import { describe, it, expect } from 'vitest';
import { BrandingService } from '../../../server/services/branding.service';

describe('BrandingService.resolveReportTheme', () => {
    const svc = new BrandingService({} as never, {} as never);
    it('per-report override wins', () => {
        expect(svc.resolveReportTheme({ reportThemeOverride: 'classic' } as never, { reportTheme: 'modern' } as never)).toBe('classic');
    });
    it('falls back to tenant default', () => {
        expect(svc.resolveReportTheme({ reportThemeOverride: null } as never, { reportTheme: 'minimal' } as never)).toBe('minimal');
    });
    it('falls back to modern when both null', () => {
        expect(svc.resolveReportTheme({ reportThemeOverride: null } as never, {} as never)).toBe('modern');
    });
});
