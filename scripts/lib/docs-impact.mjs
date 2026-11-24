import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

function globRegex(glob) {
    let out = '^';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            i++;
            if (glob[i + 1] === '/') { i++; out += '(?:.*/)?'; }
            else out += '.*';
        } else if (c === '*') out += '[^/]*';
        else if ('\\^$+?.()|{}[]'.includes(c)) out += `\\${c}`;
        else out += c;
    }
    return new RegExp(`${out}$`);
}

export function matchesGlob(file, glob) {
    return globRegex(glob.replaceAll('\\', '/')).test(file.replaceAll('\\', '/'));
}

export function docsImpact(changedFiles, rules) {
    const changed = new Set(changedFiles.map((file) => file.replaceAll('\\', '/')));
    return matchedImpactRules(changedFiles, rules)
        .filter((rule) => !rule.docs.some((doc) => changed.has(doc)))
        .map((rule) => ({ rule, missingDocs: rule.docs }));
}

export function matchedImpactRules(changedFiles, rules) {
    const changed = new Set(changedFiles.map((file) => file.replaceAll('\\', '/')));
    return rules.filter((rule) => [...changed].some((file) => rule.code.some((glob) => matchesGlob(file, glob))));
}

export function validateNaReason(reason) {
    const normalized = reason.trim().toLowerCase().replace(/[.!?]+$/g, '').trim();
    return normalized.length >= 12 && !new Set(['n/a', 'none', 'no', 'tbd', 'to be determined', 'skip', '-']).has(normalized);
}

export function parseDocsTrailer(message, changedFiles = null) {
    const rows = [...message.matchAll(/^Docs:\s*(.*?)\s*$/gm)];
    if (rows.length !== 1) return null;
    const value = rows[0][1].trim();
    const na = value.match(/^n\/a\s*[—–-]\s*(.+)$/i);
    if (na) return validateNaReason(na[1]) ? { kind: 'na', reason: na[1].trim() } : null;
    if (/^n\/a$/i.test(value)) return null;
    const paths = value.split(',').map((part) => part.trim()).filter(Boolean);
    if (!paths.length || paths.some((path) => !/^docs\/[\w./-]+\.md$/.test(path))) return null;
    if (changedFiles && paths.some((path) => !changedFiles.includes(path))) return null;
    return { kind: 'updated', paths };
}

export function validateMap(rules, trackedFiles, exists = existsSync) {
    const errors = [];
    const sourceFiles = trackedFiles.filter((file) => /\.(?:ts|tsx|js|jsx|mjs|css|html|sql|json|jsonc)$/.test(file) || /^\.githooks\/[^/]+$/.test(file));
    rules.forEach((rule, index) => {
        if (!Array.isArray(rule.code) || rule.code.length === 0) errors.push(`rule ${index + 1}: code globs are required`);
        if (!Array.isArray(rule.docs) || rule.docs.length === 0) errors.push(`rule ${index + 1}: docs paths are required`);
        for (const glob of rule.code ?? []) {
            const matches = sourceFiles.filter((file) => matchesGlob(file, glob));
            if (!matches.length) errors.push(`rule ${index + 1}: code glob matches zero tracked source files: ${glob}`);
            if (sourceFiles.length && matches.length / sourceFiles.length > 0.3) errors.push(`rule ${index + 1}: code glob is too broad (${matches.length}/${sourceFiles.length}): ${glob}`);
        }
        for (const doc of rule.docs ?? []) {
            if (!doc.startsWith('docs/') || !exists(resolve(process.cwd(), doc))) errors.push(`rule ${index + 1}: docs path does not exist: ${doc}`);
        }
    });
    return errors;
}

export function checkChangedCommit(changedFiles, message, rules) {
    const matched = matchedImpactRules(changedFiles, rules);
    if (!matched.length) return [];
    const trailer = parseDocsTrailer(message, changedFiles);
    if (!trailer) return ['mapped source changes require a valid Docs: trailer'];
    if (trailer.kind === 'updated') {
        const uncovered = matched.filter((rule) => !trailer.paths.some((path) => rule.docs.includes(path)));
        if (uncovered.length) return ['Docs: must name at least one updated path for each affected rule'];
    }
    return [];
}

export function runDocsImpact({ root = process.cwd(), changedFiles, message, rules }) {
    const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    const errors = validateMap(rules, tracked, (file) => existsSync(resolve(root, file)));
    const matchedRules = matchedImpactRules(changedFiles, rules);
    const summary = `docs-impact: rules-matched=${matchedRules.length} commits-checked=1`;
    if (errors.length) return { errors, summary };
    if (!matchedRules.length) return { errors: [], summary };
    errors.push(...checkChangedCommit(changedFiles, message, rules));
    return { errors, summary };
}

export function loadImpactMap(file) {
    return JSON.parse(readFileSync(file, 'utf8'));
}
