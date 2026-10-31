import { describe, it, expect } from 'vitest';
import { looksLikeHeif } from './sniffHeif';
import { sniffPhotoType } from '../../shared/media-sniff';

/** `ftyp` box header: size, 'ftyp', major brand, minor version, then the compatible brands. */
function ftyp(major: string, compatible: string[] = []): Blob {
  const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  const size = 16 + compatible.length * 4;
  const bytes = [0, 0, 0, size, ...text('ftyp'), ...text(major), 0, 0, 0, 0, ...compatible.flatMap(text)];
  return new Blob([new Uint8Array(bytes)]);
}

describe('looksLikeHeif', () => {
  it.each(['heic', 'heix', 'mif1', 'msf1', 'hevc'])('recognises the %s major brand', async (brand) => {
    expect(await looksLikeHeif(ftyp(brand))).toBe(true);
  });

  it('reads the compatible brands when the major brand is unknown', async () => {
    expect(await looksLikeHeif(ftyp('isom', ['iso2', 'heic']))).toBe(true);
  });

  it('CONTROL - an unknown major brand with unrelated compatible brands is not HEIF', async () => {
    expect(await looksLikeHeif(ftyp('isom', ['iso2', 'mp41']))).toBe(false);
  });

  it('rejects an AVIF file (the browser decodes those natively)', async () => {
    expect(await looksLikeHeif(ftyp('avif', ['mif1']))).toBe(false);
    expect(await looksLikeHeif(ftyp('avis'))).toBe(false);
  });

  it('rejects jpeg, png and webp bytes', async () => {
    expect(await looksLikeHeif(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])]))).toBe(false);
    expect(await looksLikeHeif(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])]))).toBe(false);
    expect(await looksLikeHeif(new Blob(['RIFF\0\0\0\0WEBPVP8 ']))).toBe(false);
  });

  it('rejects a blob shorter than 12 bytes', async () => {
    expect(await looksLikeHeif(ftyp('heic').slice(0, 11))).toBe(false);
  });
});

describe('looksLikeHeif agrees with the shared photo sniffer', () => {
  // Two separate implementations of one rule (the browser decode step here, the admission and server check in
  // shared/media-sniff.ts). This pins them together on well-formed headers so one cannot drift from the other.
  const cases: Array<[string, string, string[]]> = [
    ['heic major', 'heic', []], ['heix major', 'heix', []], ['heim major', 'heim', []], ['heis major', 'heis', []],
    ['hevc major', 'hevc', []], ['hevx major', 'hevx', []], ['hevm major', 'hevm', []], ['hevs major', 'hevs', []],
    ['mif1 major', 'mif1', []], ['msf1 major', 'msf1', []],
    ['heic compatible', 'isom', ['iso2', 'heic']], ['mp4 only', 'isom', ['iso2', 'mp41']],
    ['avif with mif1 compatible', 'avif', ['mif1']], ['avis with msf1 compatible', 'avis', ['msf1']],
    ['quicktime', 'qt  ', []],
  ];
  it.each(cases)('%s', async (_name, major, compatible) => {
    const blob = ftyp(major, compatible);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(await looksLikeHeif(blob)).toBe(sniffPhotoType(bytes) === 'image/heic');
  });

  it('CONTROL - the comparison sees both answers: a heic header is true on both sides, an mp4 one false on both', async () => {
    expect(await looksLikeHeif(ftyp('heic'))).toBe(true);
    expect(sniffPhotoType(new Uint8Array(await ftyp('heic').arrayBuffer()))).toBe('image/heic');
    expect(await looksLikeHeif(ftyp('isom', ['mp41']))).toBe(false);
    expect(sniffPhotoType(new Uint8Array(await ftyp('isom', ['mp41']).arrayBuffer()))).toBeNull();
  });
});
