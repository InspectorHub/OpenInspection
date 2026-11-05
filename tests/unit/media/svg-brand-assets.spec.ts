/**
 * An SVG is a document. Brand assets (logos, credential badges) are served from the application origin, so a stored SVG opened
 * directly must not be able to run script there. Two layers are pinned: an SVG with active content is refused at upload (logo and badge),
 * and every brand asset is served with a sandbox policy and no content sniffing, which also covers anything stored before the rule.
 */
import { describe, it, expect } from 'vitest';
import { svgHasActiveContent, svgBytesAreSafe, svgUploadRefusal, BRAND_ASSET_SAFETY_HEADERS } from '../../../server/lib/media/svg-safety';
import { serveBrandAssetObject } from '../../../server/lib/media/serve-brand-asset';
import { BrandingService } from '../../../server/services/branding.service';
import { CredentialService } from '../../../server/services/credential.service';

const PLAIN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#336699"/><text x="1" y="8">Logo</text></svg>';
const WITH_SCRIPT = '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/auth/me")</script></svg>';
const WITH_HANDLER = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>';
const WITH_FOREIGN = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>';
const WITH_LINK = '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>';

const file = (text: string, type = 'image/svg+xml') => new File([text], 'logo.svg', { type });

function bucket(contentType: string, body = PLAIN) {
    const puts: Array<{ key: string; type: string | undefined }> = [];
    const r2 = {
        get: async () => ({ body: new Response(body).body, httpMetadata: { contentType }, httpEtag: '"e1"' }),
        put: async (key: string, _body: unknown, opts?: { httpMetadata?: { contentType?: string } }) => { puts.push({ key, type: opts?.httpMetadata?.contentType }); },
        delete: async () => undefined,
    } as unknown as R2Bucket;
    return { r2, puts };
}

describe('svgHasActiveContent', () => {
    it('flags script, event attributes, foreign objects and javascript links, and passes a plain drawing', () => {
        for (const bad of [WITH_SCRIPT, WITH_HANDLER, WITH_FOREIGN, WITH_LINK, '<svg><iframe src="x"/></svg>', '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>']) {
            expect(svgHasActiveContent(bad), bad).toBe(true);
        }
        expect(svgHasActiveContent(PLAIN)).toBe(false);
        // Control: words that merely contain "on" are not event attributes.
        expect(svgHasActiveContent('<svg><text>Condition = good</text></svg>')).toBe(false);
    });
});

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const BYPASSES: Record<string, string> = {
    'prefixed script': `<svg ${NS} xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg>`,
    'prefixed foreignObject': `<svg ${NS} xmlns:x="http://www.w3.org/2000/svg"><x:foreignObject><div/></x:foreignObject></svg>`,
    'decimal reference hides javascript:': `<svg ${NS}><a href="&#106;avascript:alert(1)"><rect width="1" height="1"/></a></svg>`,
    'hex reference hides javascript:': `<svg ${NS}><a xlink:href="&#x6A;avascript:alert(1)"><rect width="1" height="1"/></a></svg>`,
    'reference with a tab hides javascript:': `<svg ${NS}><a href="java&#9;script:alert(1)"><rect width="1" height="1"/></a></svg>`,
    'animate sets an href': `<svg ${NS}><a href="#x"><animate attributeName="href" values="javascript:alert(1)"/></a></svg>`,
    'set element': `<svg ${NS}><set attributeName="onmouseover" to="alert(1)"/></svg>`,
    'data: href': `<svg ${NS}><use href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>`,
    'external use': `<svg ${NS}><use href="https://evil.example/x.svg#a"/></svg>`,
    'relative external use': `<svg ${NS}><use href="other.svg#a"/></svg>`,
    'css import in a style element': `<svg ${NS}><style>@import url(https://evil.example/a.css);</style></svg>`,
    'css import hidden by an escape': `<svg ${NS}><style>@${String.fromCharCode(92)}69mport "x";</style></svg>`,
    'external url() in a style element': `<svg ${NS}><style>rect{fill:url(https://evil.example/p)}</style><rect width="1" height="1"/></svg>`,
    'external url() in a presentation attribute': `<svg ${NS}><rect width="1" height="1" fill="url(https://evil.example/p)"/></svg>`,
    'external url() in a style attribute': `<svg ${NS}><rect width="1" height="1" style="fill:url(//evil.example/p)"/></svg>`,
    'event attribute with a prefix': `<svg ${NS}><rect width="1" height="1" x:onclick="alert(1)"/></svg>`,
    'unquoted event attribute': `<svg ${NS}><rect width="1" height="1" onclick=alert(1) /></svg>`,
    'image element': `<svg ${NS}><image href="https://evil.example/a.png"/></svg>`,
    'image with a nested svg data uri': `<svg ${NS}><image href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>`,
    'image with a text data uri': `<svg ${NS}><image href="data:text/html;base64,PHNjcmlwdD4="/></svg>`,
    'image with another data type': `<svg ${NS}><image href="data:application/javascript;base64,YWxlcnQoMSk="/></svg>`,
    'image with a non-base64 data uri': `<svg ${NS}><image href="data:image/png,%89PNG"/></svg>`,
    'image with invalid base64': `<svg ${NS}><image href="data:image/png;base64,iVBOR!!!="/></svg>`,
    'image with base64 of the wrong length': `<svg ${NS}><image href="data:image/png;base64,iVBOR"/></svg>`,
    'image with an http link': `<svg ${NS}><image href="http://evil.example/a.png"/></svg>`,
    'image with a relative link': `<svg ${NS}><image xlink:href="a.png"/></svg>`,
    'image with an event attribute': `<svg ${NS}><image href="data:image/png;base64,iVBORw0K" onload="alert(1)"/></svg>`,
    'image with an entity-hidden nested svg': `<svg ${NS}><image href="data:image/&#115;vg+xml;base64,PHN2Zy8+"/></svg>`,
    'image with an oversize data uri': `<svg ${NS}><image href="data:image/png;base64,${'A'.repeat(1024 * 1024 + 4)}"/></svg>`,
    'a non-image element with a data uri': `<svg ${NS}><use href="data:image/png;base64,iVBORw0K"/></svg>`,
    'comment opener inside an attribute value (tokenizer differential)': `<svg ${NS}><rect title="<!--"/><script>alert(1)</script><rect title="-->"/></svg>`,
    'raw less-than inside an attribute value': `<svg ${NS}><rect title="a<b"/></svg>`,
    'upper-case script': `<svg ${NS}><SCRIPT>alert(1)</SCRIPT></svg>`,
    'mixed-case script': `<svg ${NS}><ScRiPt>alert(1)</ScRiPt></svg>`,
    'comment that never ends': `<svg ${NS}><!-- <rect/></svg>`,
    'unterminated css comment': `<svg ${NS}><style>/* rect{}</style></svg>`,
    'css import after a child element inside style': `<svg ${NS}><style><g/>@import url(http://evil.example/x.css);</style></svg>`,
    'external url after a child element inside style': `<svg ${NS}><style><g/>rect{fill:url(http://evil.example/x)}</style></svg>`,
    'css import after an empty child pair inside style': `<svg ${NS}><style><title></title>@import "http://evil.example/x.css";</style></svg>`,
    'close tag that does not match the style opener': `<svg ${NS}><g><style></g>@import "http://evil";</style></svg>`,
    'mismatched close tags of other elements': `<svg ${NS}><g><rect></g></rect></svg>`,
    'close tag with nothing open': `<svg ${NS}></g></svg>`,
    'a child element inside style, however harmless': `<svg ${NS}><style><title/>rect{fill:#000}</style></svg>`,
    'doctype': '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://evil.example/x.dtd"><svg xmlns="http://www.w3.org/2000/svg"/>',
    'cdata': `<svg ${NS}><![CDATA[<script>alert(1)</script>]]></svg>`,
    'stylesheet instruction': `<?xml-stylesheet href="https://evil.example/a.css"?><svg ${NS}/>`,
    'undefined entity': `<svg ${NS}><text>&xxe;</text></svg>`,
    'root is not svg': '<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>',
};

describe('svgHasActiveContent: bypasses', () => {
    it.each(Object.entries(BYPASSES))('refuses %s', (_name, svg) => {
        expect(svgHasActiveContent(svg)).toBe(true);
    });

    it('passes a logo with an embedded raster picture, in every allowed type, and with the entity-encoded form of the same value', () => {
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        for (const type of ['png', 'jpeg', 'jpg', 'gif', 'webp']) {
            expect(svgHasActiveContent(`<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><image width="1" height="1" xlink:href="data:image/${type};base64,${png}"/></svg>`), type).toBe(false);
        }
        expect(svgHasActiveContent(`<svg ${NS}><image href="data:image/png;base64,${png.replace('/', '&#47;')}"/></svg>`)).toBe(false);
        expect(svgHasActiveContent(`<svg ${NS}><image href="#logo"/></svg>`)).toBe(false);
    });

    it('passes a real-world logo: editor metadata, gradients, internal links, internal url(), plain styles, references in text', () => {
        const logo = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with an editor -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" viewBox="0 0 120 40" width="120" height="40">
  <title>Acme &amp; Sons Inspections</title>
  <metadata><rdf:RDF><dc:format>image/svg+xml</dc:format></rdf:RDF></metadata>
  <sodipodi:namedview pagecolor="#ffffff" inkscape:zoom="2"/>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#336699"/><stop offset="1" stop-color="#99ccff"/></linearGradient>
    <clipPath id="c"><rect width="120" height="40"/></clipPath>
    <style>.t{font:700 14px sans-serif;fill:#223}</style>
  </defs>
  <g clip-path="url(#c)"><rect width="120" height="40" rx="6" fill="url(#g)" style="stroke:#fff;stroke-width:1"/>
    <path d="M10 30 L30 10 L50 30 Z" fill="#fff"/><use xlink:href="#icon" href="#icon"/>
    <text class="t" x="58" y="25">Acme &#38; Co &#x2122;</text></g>
</svg>`;
        expect(svgHasActiveContent(logo)).toBe(false);
        expect(svgBytesAreSafe(new TextEncoder().encode(logo))).toBe(true);
    });
});

describe('svgHasActiveContent: cost grows with the size of the text, not with its square', () => {
    /** Median of several runs after a warm-up, so one slow sample (a collection pause, a busy machine) decides nothing. */
    const median = (run: () => unknown, runs = 7): number => {
        run();
        const times: number[] = [];
        for (let i = 0; i < runs; i++) {
            const start = performance.now();
            run();
            times.push(performance.now() - start);
        }
        return times.sort((a, b) => a - b)[Math.floor(runs / 2)]!;
    };
    const open = `<svg ${NS}>`;

    it('refuses unterminated attributes, an unterminated comment and a flood of attributes quickly', () => {
        const hostile: Record<string, string> = {
            'unterminated attribute values': `${open}${'<rect a="'.repeat(11_000)}`,
            'unterminated comments': `${open}${'<!--'.repeat(25_000)}`,
            'unterminated css comments': `${open}<style>${'/*'.repeat(50_000)}</style></svg>`,
            'unclosed url references': `${open}<rect style="${'url('.repeat(25_000)}"/></svg>`,
            'a flood of attributes with no end': `${open}<rect${' a="1"'.repeat(20_000)}`,
            'many open tags': `${open}${'<g>'.repeat(30_000)}`,
        };
        for (const [name, svg] of Object.entries(hostile)) {
            const elapsed = median(() => expect(svgHasActiveContent(svg), name).toBe(true), 5);
            expect(elapsed, `${name}: ${elapsed.toFixed(1)} ms`).toBeLessThan(500);
        }
    });

    it('refuses text over the overall cap before reading it, and still takes the 1 MB raster allowance', () => {
        expect(svgHasActiveContent(`${open}<g>${'x'.repeat(1_600_000)}</g></svg>`)).toBe(true);
        const picture = 'A'.repeat(1024 * 1024);
        expect(svgHasActiveContent(`${open}<image href="data:image/png;base64,${picture}"/></svg>`)).toBe(false);
    });

    it.each([
        ['valid attributes', (n: number) => `${open}<rect${' a="1"'.repeat(n)}/></svg>`],
        ['valid nested elements', (n: number) => `${open}${'<g>'.repeat(n)}${'</g>'.repeat(n)}</svg>`],
        ['text and entities', (n: number) => `${open}<text>${'a&amp;b '.repeat(n)}</text></svg>`],
        ['comments', (n: number) => `${open}${'<!-- c -->'.repeat(n)}</svg>`],
        ['internal url references', (n: number) => `${open}<rect style="${'fill:url(#a);'.repeat(n)}"/></svg>`],
    ])('a valid file of %s takes about twice as long at twice the size, not four times', (_name, build) => {
        const small = median(() => svgHasActiveContent(build(20_000)));
        const large = median(() => svgHasActiveContent(build(40_000)));
        // Linear work gives a ratio near 2; quadratic work gives near 4. The margin is wide and the floor keeps timer noise out of the ratio.
        expect(large / Math.max(small, 1), `${small.toFixed(1)} ms -> ${large.toFixed(1)} ms`).toBeLessThan(3.4);
    });
});

describe('svgBytesAreSafe: encoding', () => {
    const bytes = (...parts: number[]) => new Uint8Array(parts);
    const ascii = (text: string) => new TextEncoder().encode(text);

    it('refuses bytes that are not well-formed UTF-8, a byte-order mark and a non-UTF-8 declaration', () => {
        expect(svgBytesAreSafe(ascii(PLAIN))).toBe(true);
        expect(svgBytesAreSafe(bytes(...ascii('<svg xmlns="http://www.w3.org/2000/svg"><text>'), 0xff, 0xfe, ...ascii('</text></svg>')))).toBe(false);
        expect(svgBytesAreSafe(bytes(0xef, 0xbb, 0xbf, ...ascii(PLAIN)))).toBe(false);
        expect(svgBytesAreSafe(ascii(`<?xml version="1.0" encoding="UTF-16"?>${PLAIN}`))).toBe(false);
        expect(svgBytesAreSafe(ascii(`<?xml version="1.0" encoding="utf-8"?>${PLAIN}`))).toBe(true);
        // UTF-16 text read as UTF-8 is valid but full of NULs; it is refused rather than read as markup.
        const utf16 = new Uint8Array(PLAIN.length * 2);
        for (let i = 0; i < PLAIN.length; i += 1) utf16[i * 2] = PLAIN.charCodeAt(i);
        expect(svgBytesAreSafe(utf16)).toBe(false);
    });
});

describe('svgHasActiveContent: elements and their styles', () => {
    it('passes a logo with an ordinary style block, nested groups and matching close tags', () => {
        const logo = `<svg ${NS} viewBox="0 0 40 40"><defs><style>.a{fill:#336699}.b{stroke:url(#grad);stroke-width:2}</style><linearGradient id="grad"><stop offset="0" stop-color="#fff"/></linearGradient></defs><g class="a"><g><rect class="b" width="10" height="10"/><text x="1" y="9">Logo</text></g></g><style>/* tail */ text{font:700 8px sans-serif}</style></svg>`;
        expect(svgHasActiveContent(logo)).toBe(false);
    });
});

describe('a refused DOCTYPE says what to do', () => {
    it('tells the person to remove the line or re-save as plain SVG, and keeps the generic message for other refusals', async () => {
        const withDoctype = `<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${PLAIN}`;
        const { r2, puts } = bucket('image/svg+xml');
        const svc = new BrandingService({} as D1Database, undefined, r2);
        await expect(svc.uploadLogo('tenant-1', file(withDoctype))).rejects.toThrow(/DOCTYPE.*Remove that line.*plain SVG.*SVGO/);
        await expect(svc.uploadLogo('tenant-1', file(WITH_SCRIPT))).rejects.toThrow(/script or other active content/);
        expect(svgUploadRefusal(new TextEncoder().encode(PLAIN))).toBeNull();
        expect(svgUploadRefusal(new TextEncoder().encode(withDoctype))).toMatch(/DOCTYPE/);
        expect(puts).toEqual([]);
    });
});

describe('uploads', () => {
    it('refuses an SVG logo with active content and stores a plain one', async () => {
        const { r2, puts } = bucket('image/svg+xml');
        const svc = new BrandingService({} as D1Database, undefined, r2);
        for (const bad of [WITH_SCRIPT, WITH_HANDLER, WITH_FOREIGN, WITH_LINK]) {
            await expect(svc.uploadLogo('tenant-1', file(bad))).rejects.toThrow(/active content/);
        }
        expect(puts).toEqual([]);
        // Control: a PNG-typed upload is not read as text and a plain SVG passes the check (it then needs the database, which this stub lacks).
        await expect(svc.uploadLogo('tenant-1', file(PLAIN))).rejects.not.toThrow(/active content/);
        expect(puts).toHaveLength(1);
    });

    it('refuses an SVG badge with active content before it removes the badge already stored', async () => {
        const deletes: string[] = [];
        const { r2 } = bucket('image/svg+xml');
        (r2 as unknown as { delete: (k: string) => Promise<void> }).delete = async (k) => { deletes.push(k); };
        const row = { id: 'cred-1', tenantId: 'tenant-1', userId: 'user-1', imageR2Key: 'tenant-1/credentials/old.svg' };
        const db = { select: () => ({ from: () => ({ where: () => ({ get: async () => row }) }) }) };
        const svc = new CredentialService({} as D1Database, r2);
        (svc as unknown as { getDrizzle: () => unknown }).getDrizzle = () => db;
        await expect(svc.uploadImage('tenant-1', 'user-1', 'cred-1', file(WITH_SCRIPT))).rejects.toThrow(/active content/);
        expect(deletes).toEqual([]);
    });
});

describe('serving', () => {
    it('serves every brand asset with a sandbox policy and no sniffing, SVG or not', async () => {
        for (const type of ['image/svg+xml', 'image/png']) {
            const { r2 } = bucket(type, type === 'image/svg+xml' ? WITH_SCRIPT : 'png-bytes');
            const res = await serveBrandAssetObject(r2, {}, 'tenant-1/branding/logo-abc.svg', undefined);
            expect(res, type).not.toBeNull();
            for (const [name, value] of Object.entries(BRAND_ASSET_SAFETY_HEADERS)) expect(res!.headers.get(name), `${type} ${name}`).toBe(value);
            expect(res!.headers.get('content-security-policy')).toContain('sandbox');
            expect(res!.headers.get('content-security-policy')).toContain("default-src 'none'");
            expect(res!.headers.get('x-content-type-options')).toBe('nosniff');
            expect(res!.headers.get('content-type')).toBe(type);
        }
    });

    it('keeps the safety headers on the downscaled variant a stub IMAGES binding returns', async () => {
        const { r2 } = bucket('image/png', 'png-bytes');
        const images = {
            input: () => ({
                transform: () => ({
                    output: async () => ({ response: () => new Response('webp-bytes', { headers: { 'Content-Type': 'image/webp' } }) }),
                }),
            }),
        };
        const res = await serveBrandAssetObject(r2, { IMAGES: images }, 'tenant-1/credentials/badge.png', 'reportCover');
        expect(res).not.toBeNull();
        expect(await res!.text()).toBe('webp-bytes');
        for (const [name, value] of Object.entries(BRAND_ASSET_SAFETY_HEADERS)) expect(res!.headers.get(name), name).toBe(value);
        expect(res!.headers.get('cache-control')).toContain('immutable');
    });
});

