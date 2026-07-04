import { describe, it, expect } from 'vitest';
import { contentDisposition, sanitizeFilename } from '../../../server/lib/content-disposition';

describe('contentDisposition RFC 5987', () => {
  it('keeps an ascii fallback and adds an encoded filename* for the original name', () => {
    const v = contentDisposition('2019 Roof Report.pdf', true);
    expect(v).toContain('attachment');
    expect(v).toContain('filename="2019 Roof Report.pdf"');
    expect(v).toContain("filename*=UTF-8''2019%20Roof%20Report.pdf");
  });
  it('percent-encodes non-ascii and RFC5987-reserved chars in filename*', () => {
    const v = contentDisposition('屋顶 report(1).pdf', true);
    expect(v).toContain("filename*=UTF-8''");
    expect(v).toContain('%28'); // ( encoded
    expect(v).toContain('%29'); // ) encoded
    expect(v).not.toMatch(/filename\*=UTF-8''[^;]*[()]/); // no raw parens in filename*
  });
  it('inline disposition for non-download', () => {
    expect(contentDisposition('a.png', false)).toMatch(/^inline;/);
  });
  it('sanitizeFilename still strips header-breaking chars for the fallback', () => {
    expect(sanitizeFilename('a"b\\c\r\n.pdf')).toBe('abc.pdf');
  });
});
