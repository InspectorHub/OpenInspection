import { describe, it, expect } from 'vitest';
import { EmailService } from '../../../server/services/email.service';
import { AppError } from '../../../server/lib/errors';

describe('EmailService.sendEmail — fail closed on empty From', () => {
  it('throws a clear error when a key is present but the From address is empty', async () => {
    const svc = new EmailService('a_real_key', '', 'Acme');
    await expect(svc.sendEmail(['to@x.com'], 'sub', '<p>x</p>')).rejects.toBeInstanceOf(AppError);
  });
  it('still silently skips when there is no Resend key (unchanged dev/test behaviour)', async () => {
    const svc = new EmailService('', 'from@x.com', 'Acme');
    await expect(svc.sendEmail(['to@x.com'], 'sub', '<p>x</p>')).resolves.toEqual({ delivered: false });
  });
});
