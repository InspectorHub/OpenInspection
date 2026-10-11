import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../server/lib/logger';

afterEach(() => vi.restoreAllMocks());

/**
 * Cloudflare Workers Logs takes its native `level` from the console method.
 * The logger wrote every level through console.info, so an ERROR looked like an
 * info line to anything that filters on the native level, alert rules included.
 */
describe('logger console routing', () => {
  it('writes each level through the matching console method', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('still emits one parsable JSON line carrying the level and message', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logger.error('boom', { a: 1 });
    const line = JSON.parse(String(error.mock.calls[0]![0])) as Record<string, unknown>;
    expect(line).toMatchObject({ level: 'ERROR', message: 'boom', data: { a: 1 } });
  });

  it('alert() is an ERROR line whose message starts with an [alert:<code>] marker', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logger.alert('email-quota-exceeded', 'daily quota used up', { status: 429 });
    const line = JSON.parse(String(error.mock.calls[0]![0])) as Record<string, unknown>;
    expect(line.level).toBe('ERROR');
    expect(String(line.message).startsWith('[alert:email-quota-exceeded] ')).toBe(true);
    expect(line.message).toContain('daily quota used up');
  });
});
