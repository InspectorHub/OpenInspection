/**
 * Detector for lint:hidden-focusable. Rules over JSX elements' className:
 *
 *  hover-only-reveal    opacity-0 revealed by a hover:/group-hover: variant of any opacity-N (N > 0),
 *                       under any variant prefixes (lg:, md:group-hover:, [@media(hover:hover)]:,
 *                       group-hover/row:), with no focus reveal: a keyboard user tabs onto a
 *                       control they cannot see. The focus reveal is focus-within: /
 *                       group-focus-within: (anywhere), a group-focus: / peer-focus: variant, or
 *                       focus: / focus-visible: on an element that is itself focusable
 *                       (button, a, input, select, textarea, summary, Link, href, tabIndex).
 *  hover-only-touch     the same reveal on an element that is, or contains, a button / link
 *                       with no [@media(hover:none)]:opacity-100: a phone never hovers.
 *  parked-not-inert     (-)translate-x|y-full or translate-x|y-[100%], under any non-interactive
 *                       variant (sm:, max-md:, data-[state=closed]:), parking a panel off-screen
 *                       without `inert` on the same element: its controls stay in the tab order.
 *                       `inert={false}` / `{undefined}` / `{null}` is not inert.
 *
 * A class string held in a same-file `const NAME = "..."` (or template literal) and used as
 * className={NAME} or inside cn(NAME, ...) is resolved. Bounds: a class string imported from another
 * file, kept in an object map or built by concatenation is invisible to this gate.
 *
 * Exception: a comment `hidden-focusable-allow: <reason>` inside the tag or just above it; it
 * exempts exactly the next opening tag and needs a real reason (see jsx-scan.mjs hasAllowMarker).
 */
import { analyze, elementBody, findOpeningTags, hasAllowMarker } from './jsx-scan.mjs';

const FOCUSABLE_TAGS = new Set(['button', 'Button', 'a', 'Link', 'NavLink', 'IconButton', 'input', 'select', 'textarea', 'summary']);
const INTERACTIVE_BODY = /<(?:button|Button|a|Link|NavLink|IconButton|input|select|textarea)[\s/>]|\bonClick\s*=/;
const TOUCH_REVEAL = /hover:none[^\s"']*opacity-100/;
const INERT_OFF = /^\{\s*(?:false|undefined|null)\s*\}$/;
const NOT_PARKING = /^(?:hover|group-hover|peer-hover|focus|focus-visible|focus-within|group-focus|active)$/;

/** Split a class token on `:` outside [...] brackets: 'md:[@media(hover:hover)]:x' -> variants + base. */
function splitToken(token) {
    const parts = [];
    let depth = 0;
    let cur = '';
    for (const ch of token) {
        if (ch === '[') depth += 1;
        else if (ch === ']') depth -= 1;
        if (ch === ':' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    return { variants: parts, base: cur.replace(/^!/, '') };
}

function tokensOf(value) {
    return value
        .split(/[${}"'`,?|&;]+|\s+/)
        .filter(Boolean)
        .map(splitToken);
}

const variantName = (v) => v.replace(/^!/, '').replace(/\/[\w-]+$/, '');
const isOpacityShown = (base) => /^opacity-(?:[1-9]\d*|\[(?!0?\.?0*\]).+\])$/.test(base);
const isHoverVariant = (v) => ['hover', 'group-hover', 'peer-hover'].includes(variantName(v));
const isFocusWithinVariant = (v) => /^(?:group-|peer-)?focus-within$/.test(variantName(v)) || /^has-\[[^\]]*focus[^\]]*\]$/.test(v);
const isGroupFocusVariant = (v) => /^(?:group|peer)-focus(?:-visible)?$/.test(variantName(v));
const isSelfFocusVariant = (v) => ['focus', 'focus-visible'].includes(variantName(v));
const isParked = ({ variants, base }) => /^-?translate-[xy]-(?:full|\[-?100%\])$/.test(base)
    && !variants.some((v) => NOT_PARKING.test(variantName(v)));

/** Same-file `const NAME = "..."` / template-literal class strings: name -> raw text. */
function collectConsts(a) {
    const consts = new Map();
    const re = /(?:^|[^$.\w])const\s+([A-Za-z_$][$\w]*)\s*(?::[^=;]+)?=\s*(?=["'`])/g;
    for (const m of a.text.matchAll(re)) {
        const at = m.index + m[0].length;
        let end = at + 1;
        if (a.text[at] === '`') {
            let depth = 0;
            for (; end < a.text.length; end += 1) {
                const ch = a.text[end];
                if (ch === '\\') { end += 1; continue; }
                if (depth === 0 && ch === '`') break;
                if (ch === '$' && a.text[end + 1] === '{') { depth += 1; end += 1; } else if (depth > 0 && ch === '}') depth -= 1;
            }
        } else {
            while (end < a.text.length && a.str[end]) end += 1;
            end -= 1;
        }
        consts.set(m[1], a.src.slice(at + 1, end));
    }
    return consts;
}

/** The className value with the text of every same-file const it names appended (two levels deep). */
function expandConsts(value, consts) {
    let out = value;
    for (let depth = 0; depth < 2; depth += 1) {
        let added = '';
        for (const m of out.matchAll(/(?<![.$\w])[A-Za-z_$][$\w]*/g)) if (consts.has(m[0])) added += ` ${consts.get(m[0])}`;
        if (!added) break;
        out += added;
    }
    return out;
}

const isFocusable = (tag) => FOCUSABLE_TAGS.has(tag.name)
    || tag.attrs.some((x) => x.name === 'href')
    || tag.attrs.some((x) => (x.name === 'tabIndex' || x.name === 'tabindex') && x.value?.replace(/[{}\s]/g, '') !== '-1');

/** { sites, violations } for one file's source. */
export function detectHiddenFocusable(src) {
    const a = analyze(src);
    const tags = findOpeningTags(a, /./);
    const consts = collectConsts(a);
    const violations = [];
    let sites = 0;
    for (const tag of tags) {
        const cls = tag.attrs.find((x) => x.name === 'className');
        if (!cls?.value) continue;
        const classText = expandConsts(cls.value, consts);
        const tokens = tokensOf(classText);
        const allowed = hasAllowMarker(a, 'hidden-focusable-allow', tag);
        const hidden = tokens.some((t) => t.base === 'opacity-0'
            && !t.variants.some((v) => isHoverVariant(v) || isSelfFocusVariant(v) || isFocusWithinVariant(v)));
        const hoverReveal = tokens.some((t) => isOpacityShown(t.base) && t.variants.some(isHoverVariant));
        if (hidden && hoverReveal) {
            sites += 1;
            if (!allowed) {
                const focusable = isFocusable(tag);
                const focusReveal = tokens.some((t) => isOpacityShown(t.base) && t.variants.some((v) => isFocusWithinVariant(v)
                    || isGroupFocusVariant(v) || (focusable && isSelfFocusVariant(v))));
                if (!focusReveal) {
                    violations.push({
                        line: tag.line,
                        rule: 'hover-only-reveal',
                        message: `<${tag.name}> is opacity-0 and revealed only by hover; add focus-within:opacity-100 (or focus-visible: on the focusable element itself)`,
                    });
                }
                const interactive = ['button', 'Button', 'a', 'Link', 'NavLink'].includes(tag.name)
                    || tag.attrs.some((x) => x.name === 'onClick' || x.name === 'href')
                    || INTERACTIVE_BODY.test(elementBody(a, tag));
                if (interactive && !TOUCH_REVEAL.test(classText)) {
                    violations.push({
                        line: tag.line,
                        rule: 'hover-only-touch',
                        message: `<${tag.name}> holds a control revealed only by hover; add [@media(hover:none)]:opacity-100 for touch`,
                    });
                }
            }
        }
        if (tokens.some(isParked)) {
            sites += 1;
            const inert = tag.attrs.some((x) => (x.name === 'inert' && !(x.value && INERT_OFF.test(x.value.trim())))
                || (x.name === '...' && /\binert\b/.test(x.value ?? '')));
            if (!allowed && !inert) {
                violations.push({
                    line: tag.line,
                    rule: 'parked-not-inert',
                    message: `<${tag.name}> parks a panel off-screen (translate-*-full) without inert; see app/components/MobileBottomDrawer.tsx`,
                });
            }
        }
    }
    return { sites, violations };
}
