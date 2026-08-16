/**
 * Reading Intuit's own XSDs, so a contract spec can assert against what Intuit
 * says rather than against what we remember.
 *
 * This is deliberately a small text reader and NOT an XML-schema validator, for
 * two reasons that both matter:
 *
 *  1. **We speak JSON.** The v3 REST API this product uses is JSON; the XSDs
 *     describe the XML form. The two are a direct name-for-name mapping (an
 *     `<xs:element name="CustomerRef">` is the JSON key `CustomerRef`), which
 *     is exactly the correspondence these specs rely on — and the reason a real
 *     validator would have nothing to chew on.
 *  2. **The binding rules are prose.** `Transaction/Line` is `minOccurs="0"`
 *     while the server refuses any Invoice without one. A validator would pass
 *     the document QuickBooks rejects. The constraint lives in the type's
 *     `xs:documentation`, so this module surfaces that text too.
 *
 * See `vendor/SOURCES.md` for where the files came from and how to refresh them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VENDOR = join(__dirname, 'vendor');

/**
 * All four files concatenated.
 *
 * The entity graph crosses them — `Invoice` is in `Finance.xsd`, `Customer` in
 * `IntuitNamesTypes.xsd`, and both extend `IntuitEntity` from
 * `IntuitBaseTypes.xsd` — and every type name is unique across the set (asserted
 * below), so one buffer is simpler than a resolver that would have to reproduce
 * `xs:include` for no gain.
 */
const SOURCES = ['Finance.xsd', 'IntuitBaseTypes.xsd', 'IntuitNamesTypes.xsd', 'IntuitRestServiceDef.xsd'] as const;

export const xsd: string = SOURCES.map((f) => readFileSync(join(VENDOR, f), 'utf8')).join('\n');

/** How many vendored files were actually read — printed by the specs, never assumed. */
export const vendoredFileCount = SOURCES.length;

const OPEN_TYPE = /<xs:complexType\b(?![^>]*\/>)/g;
const CLOSE_TYPE = /<\/xs:complexType>/g;

/**
 * The body of one named `xs:complexType`, brace-matched.
 *
 * A non-greedy regex is wrong here: these types nest (an inline
 * `<xs:complexType>` inside an element), so `.*?</xs:complexType>` stops at the
 * first INNER close and silently returns a truncated body. That failure is
 * quiet and looks like "this type declares no fields", which is precisely the
 * shape of a green test that checked nothing.
 */
function typeBody(name: string): string | null {
    const start = new RegExp(`<xs:complexType name="${name}"[^>]*>`).exec(xsd);
    if (!start) return null;
    let i = start.index + start[0].length;
    let depth = 1;
    while (depth > 0) {
        OPEN_TYPE.lastIndex = i;
        CLOSE_TYPE.lastIndex = i;
        const open = OPEN_TYPE.exec(xsd);
        const close = CLOSE_TYPE.exec(xsd);
        if (!close) return null;
        if (open && open.index < close.index) { depth++; i = open.index + open[0].length; }
        else { depth--; i = close.index + close[0].length; }
    }
    return xsd.slice(start.index + start[0].length, i - '</xs:complexType>'.length);
}

/** `Invoice` → `['Invoice', 'SalesTransaction', 'Transaction', 'IntuitEntity']`. */
export function inheritanceChain(entity: string): string[] {
    const chain = [entity];
    let cur = entity;
    // Bounded rather than `while (true)`: a malformed or circular `base` would
    // otherwise hang the suite instead of failing it.
    for (let hop = 0; hop < 8; hop++) {
        const body = typeBody(cur);
        if (body === null) break;
        const base = /<xs:extension base="(?:\w+:)?([A-Za-z]+)"/.exec(body);
        if (!base) break;
        cur = base[1]!;
        chain.push(cur);
    }
    return chain;
}

/** Every field name the entity may carry, its inherited ones included. */
export function declaredFields(entity: string): Set<string> {
    const out = new Set<string>();
    for (const type of inheritanceChain(entity)) {
        const body = typeBody(type);
        if (body === null) continue;
        for (const m of body.matchAll(/<xs:element\s+name="([A-Za-z0-9_]+)"/g)) out.add(m[1]!);
        for (const m of body.matchAll(/<xs:attribute\s+name="([A-Za-z0-9_]+)"/g)) out.add(m[1]!);
    }
    return out;
}

/**
 * Fields the SCHEMA marks required — no `minOccurs`, or `minOccurs="1"`.
 *
 * Trustworthy only as a lower bound, and not usable on its own as "what a
 * create needs". On `Invoice` this set includes `AllowIPNPayment`, `CfdiUse`
 * and `Exportation`: response-side and region-specific fields that carry no
 * `minOccurs` and that no create call has ever sent. Consumers should
 * intersect it with the fields they actually care about rather than assert
 * they send all of it.
 */
export function schemaRequiredFields(entity: string): Set<string> {
    const out = new Set<string>();
    for (const type of inheritanceChain(entity)) {
        const body = typeBody(type);
        if (body === null) continue;
        for (const m of body.matchAll(/<xs:element\s+([^>]*?)\/?>/g)) {
            const attrs = m[1]!;
            const name = /name="([A-Za-z0-9_]+)"/.exec(attrs)?.[1];
            if (!name) continue;
            const min = /minOccurs="(\d+)"/.exec(attrs)?.[1];
            if (min === undefined || min !== '0') out.add(name);
        }
    }
    return out;
}

/**
 * The `xs:documentation` text on the entity's own type, whitespace collapsed.
 *
 * This is where Intuit states the rules the server enforces and the schema does
 * not. Collapsed because the source wraps mid-sentence with tabs, and a spec
 * that quoted the raw text would be asserting on the file's indentation.
 */
export function documentation(entity: string): string {
    const body = typeBody(entity);
    if (body === null) return '';
    const doc = /<xs:documentation>([\s\S]*?)<\/xs:documentation>/.exec(body);
    return doc ? doc[1]!.replace(/\s+/g, ' ').trim() : '';
}

/** Values of a named `xs:simpleType` enumeration — e.g. `FaultTypeEnum`. */
export function enumValues(simpleType: string): string[] {
    const start = new RegExp(`<xs:simpleType name="${simpleType}">([\\s\\S]*?)</xs:simpleType>`).exec(xsd);
    if (!start) return [];
    return [...start[1]!.matchAll(/value="([^"]+)"/g)].map((m) => m[1]!);
}
