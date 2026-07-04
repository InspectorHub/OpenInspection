import { describe, it, expect } from 'vitest';
import { interpolate, escapeHtml } from '../../../server/lib/email-templates/interpolate';

describe('escapeHtml', () => {
  it('escapes the 5 HTML-sensitive chars', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
});

describe('interpolate', () => {
  const vars = ['address', 'reportUrl'];

  it('escapes literal text the author typed', () => {
    expect(interpolate('Hello <b>world</b>', {}, vars)).toBe('Hello &lt;b&gt;world&lt;/b&gt;');
  });

  it('substitutes a declared variable, HTML-escaping its value', () => {
    expect(interpolate('At {{address}}', { address: '12 Elm <st>' }, vars))
      .toBe('At 12 Elm &lt;st&gt;');
  });

  it('leaves an undeclared token as escaped literal (no substitution, no throw)', () => {
    expect(interpolate('Hi {{secret}}', { secret: 'x' }, vars))
      .toBe('Hi {{secret}}');
  });

  it('renders an empty string for a declared-but-missing value', () => {
    expect(interpolate('At {{address}}.', {}, vars)).toBe('At .');
  });

  it('cannot inject HTML via a variable value (XSS attempt)', () => {
    expect(interpolate('{{reportUrl}}', { reportUrl: '"><script>alert(1)</script>' }, vars))
      .toBe('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('handles repeated and adjacent tokens', () => {
    expect(interpolate('{{address}}-{{address}}', { address: 'A' }, vars)).toBe('A-A');
  });

  it('coerces non-string values to string then escapes', () => {
    expect(interpolate('n={{address}}', { address: 5 as unknown as string }, vars)).toBe('n=5');
  });
});
