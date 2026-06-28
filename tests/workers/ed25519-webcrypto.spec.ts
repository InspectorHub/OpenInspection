import { describe, it, expect } from 'vitest';

/**
 * WH-1 Task 1 — de-risk: prove the workerd runtime's WebCrypto can verify an
 * Ed25519 signature over the Telnyx `${timestamp}|${rawBody}` payload shape.
 * If this passes, the Telnyx inbound verifier can use crypto.subtle directly
 * (no third-party Ed25519 dependency). If crypto.subtle lacks 'Ed25519', this
 * test fails and WH-1 falls back to a vetted pure-TS verify.
 */
describe('Ed25519 verify in workerd (WH-1 de-risk)', () => {
  it('verifies a signature over `${ts}|${body}` with crypto.subtle', async () => {
    const keyPair = (await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;

    const ts = '1782523987';
    const body = JSON.stringify({ data: { event_type: 'message.received', payload: { from: { phone_number: '+15551230000' }, text: 'STOP' } } });
    const signed = new TextEncoder().encode(`${ts}|${body}`);

    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, signed);

    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, keyPair.publicKey, sig, signed);
    expect(ok).toBe(true);

    // Tampered body must fail.
    const tampered = new TextEncoder().encode(`${ts}|${body}X`);
    const bad = await crypto.subtle.verify({ name: 'Ed25519' }, keyPair.publicKey, sig, tampered);
    expect(bad).toBe(false);
  });

  it('imports a raw 32-byte Ed25519 public key (the Telnyx key wire format)', async () => {
    const keyPair = (await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;

    // Telnyx hands you a base64 public key; we import it as 'raw' (32 bytes).
    const raw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    expect(raw.byteLength).toBe(32);

    const imported = await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );

    const data = new TextEncoder().encode('1782523987|{}');
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, data);
    expect(await crypto.subtle.verify({ name: 'Ed25519' }, imported, sig, data)).toBe(true);
  });
});
