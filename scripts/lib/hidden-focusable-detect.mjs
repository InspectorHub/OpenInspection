/**
 * Detector for lint:hidden-focusable. Rules over JSX elements' className:
 *
 *  hover-only-reveal    opacity-0 revealed by hover:/group-hover: opacity-100 with no
 *                       focus-within / focus-visible / focus variant: a keyboard user tabs
 *                       onto a control they cannot see.
 *  hover-only-touch     the same reveal on an element that is, or contains, a button / link
 *                       with no [@media(hover:none)]:opacity-100: a phone never hovers.
 *  parked-not-inert     translate-y-full / (-)translate-x-full parking a panel off-screen
 *                       without `inert` on the same element: its controls stay in the tab order.
 *
 * Exception: a comment `hidden-focusable-allow: <reason>` on the tag's lines or the two above.
 */
import { analyze, elementBody, findOpeningTags, hasAllowMarker } from './jsx-scan.mjs';

const REVEAL = /^(?:group-hover(?:\/[\w-]+)?|hover):opacity-100$/;
const FOCUS_REVEAL = /^(?:[\w/-]*focus[\w/-]*|has-\[[^\]]*focus[^\]]*\]):opacity-100$/;
const TOUCH_REVEAL = /hover:none[^\s"']*opacity-100/;
const PARKED = /^(?:(?:sm|md|lg|xl|2xl):)?-?translate-[xy]-full$/;
const INTERACTIVE_BODY = /<(?:button|Button|a|Link|NavLink|IconButton|input|select|textarea)[\s/>]|\bonClick\s*=/;

function tokensOf(value) {
    return value
        .split(/[\s"'`,(){}?|&$]+/)
        .filter(Boolean)
        .map((t) => t.replace(/^!/, ''));
}

/** { sites, violations } for one file's source. */
export function detectHiddenFocusable(src) {
    const a = analyze(src);
    const tags = findOpeningTags(a, /./);
    const violations = [];
    let sites = 0;
    for (const tag of tags) {
        const cls = tag.attrs.find((x) => x.name === 'className');
        if (!cls?.value) continue;
        const tokens = tokensOf(cls.value);
        const allowed = hasAllowMarker(src, 'hidden-focusable-allow', tag);
        if (tokens.includes('opacity-0') && tokens.some((t) => REVEAL.test(t))) {
            sites += 1;
            if (!allowed) {
                if (!tokens.some((t) => FOCUS_REVEAL.test(t))) {
                    violations.push({
                        line: tag.line,
                        rule: 'hover-only-reveal',
                        message: `<${tag.name}> is opacity-0 and revealed only by hover; add focus-within:opacity-100 (or focus-visible:)`,
                    });
                }
                const interactive = ['button', 'Button', 'a', 'Link', 'NavLink'].includes(tag.name)
                    || tag.attrs.some((x) => x.name === 'onClick' || x.name === 'href')
                    || INTERACTIVE_BODY.test(elementBody(a, tag));
                if (interactive && !TOUCH_REVEAL.test(cls.value)) {
                    violations.push({
                        line: tag.line,
                        rule: 'hover-only-touch',
                        message: `<${tag.name}> holds a control revealed only by hover; add [@media(hover:none)]:opacity-100 for touch`,
                    });
                }
            }
        }
        if (tokens.some((t) => PARKED.test(t))) {
            sites += 1;
            const inert = tag.attrs.some((x) => x.name === 'inert' || (x.name === '...' && /\binert\b/.test(x.value ?? '')));
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
