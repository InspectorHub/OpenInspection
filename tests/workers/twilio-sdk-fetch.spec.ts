// tests/workers/twilio-sdk-fetch.spec.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import twilio from 'twilio';
import { createFetchHttpClient } from '../../server/lib/messaging/twilio-http-client';

describe('twilio-node v6 workerd smoke (fetch httpClient)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('imports + constructs a Twilio client inside workerd without throwing', () => {
    expect(() => {
      const client = new twilio.Twilio('ACsmoke', 'smoketoken', {
        httpClient: createFetchHttpClient() as never,
      });
      expect(client.messaging.v1.services).toBeDefined();
    }).not.toThrow();
  });

  it('routes a real resource call through the injected fetch httpClient', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({ sid: 'MGsmoke0000000000000000000000000000', account_sid: 'ACsmoke', friendly_name: 'smoke-test' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    }));

    const client = new twilio.Twilio('ACsmoke', 'smoketoken', {
      httpClient: createFetchHttpClient() as never,
    });
    const service = await client.messaging.v1.services.create({ friendlyName: 'smoke-test' });

    // (1) the SDK parsed the canned response into a resource instance
    expect(service.sid).toBe('MGsmoke0000000000000000000000000000');
    expect(service.friendlyName).toBe('smoke-test');
    // (2) the SDK drove our injected fetch with the right shape
    expect(captured).toBeDefined();
    expect(captured!.url).toContain('https://messaging.twilio.com/v1/Services');
    expect(String(captured!.init.method).toUpperCase()).toBe('POST'); // method arrives lowercase
    const auth = (captured!.init.headers as Record<string, string>).Authorization;
    expect(auth).toBe('Basic ' + btoa('ACsmoke:smoketoken'));
    expect(String(captured!.init.body)).toContain('FriendlyName=smoke-test');
  });
});
