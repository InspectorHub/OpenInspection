/**
 * A small JSX-aware scanner shared by the busy-controls and hidden-focusable gates.
 *
 * It is not a parser. It does the things a line regex cannot: blank comments (so a
 * commented-out `<button>` is not a site), know which characters sit inside a string,
 * regex literal or template-literal text (so a `>` or `{` in a class string cannot end or
 * unbalance a tag), read a whole opening tag across lines with nested braces, and find the
 * comments an exception marker may live in. Offsets are preserved: `text` is the same
 * length as the source.
 *
 * What it handles on purpose:
 *  - a quoted JSX attribute value may span lines (`className="a\n b"`); a JS string
 *    anywhere else ends at the newline, so one stray quote cannot swallow the file;
 *  - `//` directly after a URL scheme (`http://x`) is not a comment;
 *  - a regex literal after `= ( , : [ ! & | ? { ;` or `return` is skipped as a unit, so a quote
 *    inside it cannot open a string;
 *  - a TSX generic argument list on a tag (`<Select<Option> value={v} />`).
 *
 * Bounds that remain (heuristics, pinned by tests/unit/tooling/jsx-scan.spec.ts):
 *  - JSX TEXT is not tracked. A `//` in text that does not follow a URL scheme, or a `"`
 *    / a `'` that does not follow a letter, still starts a comment / string that runs to the end
 *    of the line and can hide a tag on the same line;
 *  - a regex literal is recognised only by the character before it; `a => /re/` and a regex
 *    at the start of a statement are not, and prose such as `, / x /` in JSX text can look like one;
 *  - a multi-line attribute string is recognised by `name=` plus an open `<Tag` earlier in
 *    the same tag; anything fancier falls back to ending at the newline;
 *  - class strings built in another file, or in an object map, are invisible to the gates.
 */

/** Matches an identifier-ish attribute name followed by `=`, at the end of the text before a quote. */
const ATTR_EQ_RE = /[A-Za-z_][\w:.-]*\s*=\s*$/;
/** Characters after which a `/` starts a regex literal rather than dividing or closing a tag. */
const REGEX_PREV = '=(,:[!&|?{;';
const REGEX_PREV_WORD = /(?:^|[^\w$.])(?:return|typeof|case|else|do|void|delete|in|of)$/;
/** What may sit between an exception marker and the tag it applies to. */
const MARKER_GAP_RE = /^(?:[\s{}()?:&|!,;]|=>|\breturn\b)*$/;

/**
 * Comments blanked to spaces (newlines kept); `str[i]` is 1 for string / regex / template-text characters;
 * `comments` lists every real comment so an exception marker can be tied to one.
 */
export function analyze(src) {
    const n = src.length;
    const text = src.split('');
    const str = new Uint8Array(n);
    const comments = [];
    const stack = [];
    const blank = (a, b) => {
        for (let k = a; k < b; k += 1) if (text[k] !== '\n' && text[k] !== '\r') text[k] = ' ';
    };
    let lastOpen = -1;
    // True when offset `at` is inside an opening tag that started at `lastOpen` and has not ended.
    const insideTag = (at) => {
        if (lastOpen < 0) return false;
        let braces = 0;
        let angles = 0;
        let k = lastOpen + 1;
        while (k < at && /[\w.]/.test(text[k])) k += 1;
        for (; k < at; k += 1) {
            if (str[k]) continue;
            const ch = text[k];
            if (ch === '{') braces += 1;
            else if (ch === '}') braces -= 1;
            else if (braces <= 0 && ch === ';') return false;
            else if (braces <= 0 && ch === '<') angles += 1;
            else if (braces <= 0 && ch === '>' && text[k - 1] !== '=') {
                if (angles > 0) angles -= 1;
                else return false;
            }
        }
        return true;
    };
    const prevSignificant = (at) => {
        let k = at - 1;
        while (k >= 0 && /\s/.test(text[k])) k -= 1;
        return k;
    };
    let i = 0;
    while (i < n) {
        const top = stack[stack.length - 1];
        const c = src[i];
        if (top && top.t === 'T') {
            if (c === '\\') { str[i] = 1; if (i + 1 < n) str[i + 1] = 1; i += 2; continue; }
            if (c === '`') { str[i] = 1; stack.pop(); i += 1; continue; }
            if (c === '$' && src[i + 1] === '{') { stack.push({ t: 'B', d: 0 }); i += 2; continue; }
            str[i] = 1;
            i += 1;
            continue;
        }
        if (c === '/' && src[i + 1] === '/') {
            // `http://x` in JSX text or a string-free expression is a URL, not a comment.
            if (src[i - 1] === ':' && /[A-Za-z]/.test(src[i - 2] ?? '')) { i += 2; continue; }
            let j = i;
            while (j < n && src[j] !== '\n') j += 1;
            comments.push({ start: i, end: j, bodyStart: i + 2, bodyEnd: j });
            blank(i, j);
            i = j;
            continue;
        }
        if (c === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            const stop = end < 0 ? n : end + 2;
            comments.push({ start: i, end: stop, bodyStart: i + 2, bodyEnd: end < 0 ? n : end });
            blank(i, stop);
            i = stop;
            continue;
        }
        if (c === '/' && !/[\s>=]/.test(src[i + 1] ?? ' ')) {
            const p = prevSignificant(i);
            const word = text.slice(Math.max(0, p - 9), p + 1).join('');
            if (p >= 0 && (REGEX_PREV.includes(text[p]) || REGEX_PREV_WORD.test(word))) {
                let j = i + 1;
                let inClass = false;
                while (j < n && src[j] !== '\n') {
                    const ch = src[j];
                    if (ch === '\\') { j += 2; continue; }
                    if (ch === '[') inClass = true;
                    else if (ch === ']') inClass = false;
                    else if (ch === '/' && !inClass) break;
                    j += 1;
                }
                if (src[j] === '/' && j > i + 1) {
                    let stop = j + 1;
                    while (stop < n && /[a-z]/.test(src[stop])) stop += 1;
                    for (let k = i; k < stop; k += 1) str[k] = 1;
                    i = stop;
                    continue;
                }
            }
        }
        // An apostrophe right after a letter is JSX prose ("won't"), not a string opener.
        const prose = c === "'" && /[A-Za-z0-9]/.test(src[i - 1] ?? '');
        if (!prose && (c === '"' || c === "'")) {
            let stop = -1;
            // A quoted JSX attribute value may contain newlines; a JS string may not.
            if (ATTR_EQ_RE.test(text.slice(Math.max(0, i - 80), i).join('')) && insideTag(i)) {
                const close = src.indexOf(c, i + 1);
                // A value that would swallow another tag is an unterminated quote, not a long value.
                if (close > 0 && !/<[A-Za-z/]/.test(src.slice(i, close))) stop = close + 1;
            }
            if (stop < 0) {
                let j = i + 1;
                while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
                stop = src[j] === c ? j + 1 : Math.min(j, n);
            }
            for (let k = i; k < stop; k += 1) str[k] = 1;
            i = stop;
            continue;
        }
        if (c === '`') { str[i] = 1; stack.push({ t: 'T' }); i += 1; continue; }
        if (c === '<' && /[A-Za-z]/.test(src[i + 1] ?? '')) lastOpen = i;
        if (top && top.t === 'B') {
            if (c === '{') top.d += 1;
            else if (c === '}') {
                if (top.d === 0) stack.pop();
                else top.d -= 1;
            }
        }
        i += 1;
    }
    return { text: text.join(''), str, src, comments };
}

/** 1-based line of an offset. */
export function lineOf(src, off) {
    let line = 1;
    for (let k = 0; k < off && k < src.length; k += 1) if (src[k] === '\n') line += 1;
    return line;
}

/** Balanced `{...}` starting at `i` (text[i] === '{'); returns the index of the closing brace. */
function matchBrace(a, i) {
    let d = 0;
    for (let k = i; k < a.text.length; k += 1) {
        if (a.str[k]) continue;
        if (a.text[k] === '{') d += 1;
        else if (a.text[k] === '}') { d -= 1; if (d === 0) return k; }
    }
    return -1;
}

/** Attributes of one opening tag, top level only: { name, value } (value is raw text or null; spreads are name '...'). */
function parseAttrs(a, from, to) {
    const attrs = [];
    let i = from;
    const ws = /\s/;
    while (i < to) {
        const c = a.text[i];
        if (ws.test(c) || c === '/') { i += 1; continue; }
        if (c === '{') {
            const close = matchBrace(a, i);
            if (close < 0) break;
            const inner = a.text.slice(i + 1, close).trim();
            attrs.push({ name: inner.startsWith('...') ? '...' : '{}', value: inner.replace(/^\.\.\./, ''), at: i });
            i = close + 1;
            continue;
        }
        const m = /^[A-Za-z_:][\w:.-]*/.exec(a.text.slice(i, to));
        if (!m) { i += 1; continue; }
        const name = m[0];
        const at = i;
        i += name.length;
        let j = i;
        while (j < to && ws.test(a.text[j])) j += 1;
        if (a.text[j] !== '=') { attrs.push({ name, value: null, at }); continue; }
        j += 1;
        while (j < to && ws.test(a.text[j])) j += 1;
        if (a.text[j] === '{') {
            const close = matchBrace(a, j);
            if (close < 0) break;
            attrs.push({ name, value: a.src.slice(j, close + 1), at });
            i = close + 1;
        } else if (a.str[j]) {
            let k = j;
            while (k < to && a.str[k]) k += 1;
            attrs.push({ name, value: a.src.slice(j, k), at });
            i = k;
        } else {
            attrs.push({ name, value: null, at });
        }
    }
    return attrs;
}

/** Index just past a balanced `<...>` generic argument list starting at `i` (text[i] === '<'), or -1. */
function skipGenerics(a, i) {
    let d = 0;
    for (let k = i; k < a.text.length; k += 1) {
        if (a.str[k]) continue;
        const ch = a.text[k];
        if (ch === '<') d += 1;
        else if (ch === '>' && a.text[k - 1] !== '=') { d -= 1; if (d === 0) return k + 1; }
        else if (ch === ';') return -1;
    }
    return -1;
}

/** Every opening tag whose name matches `nameRe` (tested against the bare tag name). */
export function findOpeningTags(a, nameRe) {
    const out = [];
    const re = /<([A-Za-z][\w.]*)(?=[\s/>]|<)/g;
    for (const m of a.text.matchAll(re)) {
        if (a.str[m.index] || !nameRe.test(m[1])) continue;
        let nameEnd = m.index + m[0].length;
        if (a.text[nameEnd] === '<') {
            const past = skipGenerics(a, nameEnd);
            if (past < 0) continue;
            nameEnd = past;
        }
        let d = 0;
        let end = -1;
        for (let k = nameEnd; k < a.text.length; k += 1) {
            if (a.str[k]) continue;
            const ch = a.text[k];
            if (ch === '{') d += 1;
            else if (ch === '}') d -= 1;
            else if (ch === '>' && d === 0) { end = k; break; }
        }
        if (end < 0) continue;
        out.push({
            name: m[1],
            start: m.index,
            end,
            selfClosing: a.text[end - 1] === '/',
            attrs: parseAttrs(a, nameEnd, end),
            line: lineOf(a.src, m.index),
            endLine: lineOf(a.src, end),
        });
    }
    return out;
}

/** The source between an element's opening tag and its matching close tag ('' when self-closing). */
export function elementBody(a, tag) {
    if (tag.selfClosing) return '';
    const esc = tag.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const same = findOpeningTags(a, new RegExp(`^${esc}$`));
    const re = new RegExp(`<(/?)${esc}(?=[\\s/>]|<)`, 'g');
    re.lastIndex = tag.end;
    let depth = 1;
    for (let m = re.exec(a.text); m; m = re.exec(a.text)) {
        if (a.str[m.index]) continue;
        if (m[1]) depth -= 1;
        else {
            const sub = same.find((t) => t.start === m.index);
            if (!sub || !sub.selfClosing) depth += 1;
        }
        if (depth === 0) return a.src.slice(tag.end, m.index);
    }
    return a.src.slice(tag.end);
}

/**
 * True when `<marker>: <reason>` sits in a real comment (`//`, block or `{/* *\/}`) that is inside the
 * tag, or ends no more than two lines above it with only whitespace / brackets between. A marker
 * applies to exactly the NEXT opening tag after it. The reason must contain a word character
 * outside the comment terminator, and marker text inside a string or attribute never counts.
 * Takes the `analyze()` result (not the raw source) so it can tell comments from strings.
 */
export function hasAllowMarker(a, marker, tag) {
    const re = new RegExp(`${marker}:([\\s\\S]*)`);
    for (const c of a.comments) {
        const m = re.exec(a.src.slice(c.bodyStart, c.bodyEnd));
        if (!m || !/\w/.test(m[1])) continue;
        if (c.start >= tag.start && c.end <= tag.end) return true;
        if (c.end > tag.start) continue;
        const near = tag.line - lineOf(a.src, c.end) <= 2;
        if (near && MARKER_GAP_RE.test(a.text.slice(c.end, tag.start))) return true;
    }
    return false;
}
