/**
 * A small JSX-aware scanner shared by the busy-controls and hidden-focusable gates.
 *
 * It is not a parser. It does the three things a line regex cannot: blank comments
 * (so a commented-out `<button>` is not a site), know which characters sit inside a
 * string or template-literal text (so a `>` or `{` in a class string cannot end or
 * unbalance a tag), and read a whole opening tag across lines with nested braces.
 * Offsets are preserved: `text` is the same length as the source.
 */

/** Comments blanked to spaces (newlines kept); `str[i]` is 1 for string / template-text characters. */
export function analyze(src) {
    const n = src.length;
    const text = src.split('');
    const str = new Uint8Array(n);
    const stack = [];
    const blank = (a, b) => {
        for (let k = a; k < b; k += 1) if (text[k] !== '\n' && text[k] !== '\r') text[k] = ' ';
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
            let j = i;
            while (j < n && src[j] !== '\n') j += 1;
            blank(i, j);
            i = j;
            continue;
        }
        if (c === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            const stop = end < 0 ? n : end + 2;
            blank(i, stop);
            i = stop;
            continue;
        }
        // An apostrophe right after a letter is JSX prose ("won't"), not a string opener.
        const prose = c === "'" && /[A-Za-z0-9]/.test(src[i - 1] ?? '');
        if (!prose && (c === '"' || c === "'")) {
            let j = i + 1;
            while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
            const stop = src[j] === c ? j + 1 : Math.min(j, n);
            for (let k = i; k < stop; k += 1) str[k] = 1;
            i = stop;
            continue;
        }
        if (c === '`') { str[i] = 1; stack.push({ t: 'T' }); i += 1; continue; }
        if (top && top.t === 'B') {
            if (c === '{') top.d += 1;
            else if (c === '}') {
                if (top.d === 0) stack.pop();
                else top.d -= 1;
            }
        }
        i += 1;
    }
    return { text: text.join(''), str, src };
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

/** Every opening tag whose name matches `nameRe` (tested against the bare tag name). */
export function findOpeningTags(a, nameRe) {
    const out = [];
    const re = /<([A-Za-z][\w.]*)(?=[\s/>])/g;
    for (const m of a.text.matchAll(re)) {
        if (a.str[m.index] || !nameRe.test(m[1])) continue;
        const nameEnd = m.index + m[0].length;
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
    const re = new RegExp(`<(/?)${esc}(?=[\\s/>])`, 'g');
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

/** True when `<marker>: <reason>` sits in a comment on the tag's lines or the two lines above. */
export function hasAllowMarker(src, marker, tag) {
    const lines = src.split('\n');
    const re = new RegExp(`${marker}:\\s*\\S`);
    for (let l = Math.max(1, tag.line - 2); l <= tag.endLine; l += 1) if (re.test(lines[l - 1] ?? '')) return true;
    return false;
}
