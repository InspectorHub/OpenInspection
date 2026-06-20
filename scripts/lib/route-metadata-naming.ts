/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import {
    FILE_TAG,
    FILE_ENTITY_OVERRIDE,
    KNOWN_VERBS,
    TIER_PATTERNS,
    PRIMARY_ELIGIBLE_FILES,
    PUBLIC_AUTH_FILES,
    AGENT_FILES,
    ADMIN_FILES,
    VALID_TAGS,
    EXCLUDED_FILES,
} from './route-metadata-config';

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

export function toPascal(s: string): string {
    return s.replace(/(^|-|_|\s)([a-z])/g, (_, _sep, c) => c.toUpperCase()).replace(/[-_\s]/g, '');
}
export function toCamel(s: string): string {
    const p = toPascal(s);
    return p.charAt(0).toLowerCase() + p.slice(1);
}
export function singularize(s: string): string {
    if (s.endsWith('ies')) return s.slice(0, -3) + 'y';
    if (s.endsWith('ses')) return s.slice(0, -2);
    if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
    return s;
}

export function fileEntity(fileBase: string): string {
    if (FILE_ENTITY_OVERRIDE[fileBase]) return FILE_ENTITY_OVERRIDE[fileBase];
    const stem = fileBase.replace(/\.ts$/, '');
    return toPascal(singularize(stem));
}

export function pathSegments(p: string): string[] {
    return p.split('/').filter(s => s && !s.startsWith('{') && !s.startsWith(':'));
}

export function lastNonParam(p: string): string | null {
    const segs = pathSegments(p);
    return segs.length ? segs[segs.length - 1] : null;
}

export function isCollectionRoot(p: string): boolean {
    // path like '/' or '/{id}' (no extra segment beyond the param)
    const segs = p.split('/').filter(Boolean);
    return segs.length === 0 || (segs.length === 1 && segs[0].startsWith('{'));
}

export function deriveOperationId(method: string, routePath: string, fileBase: string): string {
    const entity = fileEntity(fileBase);
    const entitySingular = entity;
    const entityPlural = entity.endsWith('y') ? entity.slice(0, -1) + 'ies' : entity + 's';

    const last = lastNonParam(routePath);
    const M = method.toLowerCase();

    // Whether path ends with {param}/ — distinguishes single-entity vs collection
    const endsWithParam = /\{[^}]+\}\/?$/.test(routePath);

    // Verb-named action takes precedence (e.g. POST /api/foo/{id}/clone)
    if (last && KNOWN_VERBS.has(last)) {
        return toCamel(last) + entitySingular;
    }

    // Collection endpoint (path is empty/'/'/just '{id}'-ish)
    if (isCollectionRoot(routePath)) {
        if (M === 'get')    return endsWithParam ? 'get' + entitySingular : 'list' + entityPlural;
        if (M === 'post')   return 'create' + entitySingular;
        if (M === 'put')    return 'replace' + entitySingular;
        if (M === 'patch')  return 'patch'  + entitySingular;
        if (M === 'delete') return 'delete' + entitySingular;
    }

    // Sub-resource path. For collection (no trailing param) → plural last segment + 'list' verb.
    // For single (trailing param)  → singular last segment + 'get' verb.
    const segs = pathSegments(routePath);
    let subParts: string;
    if (endsWithParam || M === 'put' || M === 'patch' || M === 'delete') {
        // Treat last seg as singular for these methods
        const head = segs.slice(0, -1).map(toPascal).join('');
        const tail = segs.length > 0 ? toPascal(singularize(segs[segs.length - 1])) : '';
        subParts = head + tail;
    } else {
        subParts = segs.map(toPascal).join('');
    }
    if (M === 'get')    return (endsWithParam ? 'get' : 'list') + entitySingular + subParts;
    if (M === 'post')   return 'create' + entitySingular + subParts;
    if (M === 'put')    return 'update' + entitySingular + subParts;
    if (M === 'patch')  return 'patch'  + entitySingular + subParts;
    if (M === 'delete') return 'delete' + entitySingular + subParts;
    return M + entitySingular + subParts;
}

export function deriveTags(existing: string[] | null, fileBase: string): string[] {
    const primary = FILE_TAG[fileBase] || 'inspections';
    const out: string[] = [primary];
    for (const t of existing ?? []) {
        const lower = t.toLowerCase();
        if (lower === primary) continue;
        if (VALID_TAGS.has(lower)) out.push(lower);
    }
    return out;
}

export function splitCamel(s: string): string[] {
    return s.replace(/([A-Z])/g, ' $1').trim().split(/\s+/);
}

/** Build a sentence-case 4-12-word summary from operationId. */
export function placeholderSummary(operationId: string): string {
    const words = splitCamel(operationId).map(w => w.toLowerCase());
    if (words.length === 0) return 'Endpoint without operation id';
    words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
    // Clamp to 12 words by truncating
    let result = words.slice(0, 12);
    if (result.length < 4) {
        result = [...result, 'for', 'current', 'tenant'].slice(0, Math.max(4, result.length + 3));
        // Re-clamp in case we over-padded
        result = result.slice(0, 12);
    }
    return result.join(' ');
}

/** Build a ≥ 50-char description placeholder from existing data + operation context. */
export function placeholderDescription(
    existing: string, operationId: string, method: string, routePath: string, tag: string
): string {
    const base = existing && existing.trim().length > 0 ? existing.trim() : '';
    const ctx = `(${method.toUpperCase()} ${routePath}, ${tag} domain)`;
    const suffix = ' TODO: replace with a real description sourced from the handler.';
    if (base && (base + ' ' + ctx).length >= 50) {
        return base.endsWith('.') ? `${base} ${ctx}.` : `${base}. ${ctx}.`;
    }
    if (base) return `${base}. ${ctx}.${suffix}`.trim();
    return `Auto-generated placeholder for ${operationId} ${ctx}.${suffix}`.trim();
}

export function deriveScopes(method: string, routePath: string, fileBase: string): string[] {
    const M = method.toLowerCase();
    if (PUBLIC_AUTH_FILES.has(fileBase)) return [];
    if (fileBase === 'public-share.ts' || fileBase === 'public-slug.ts'
        || fileBase === 'repair-requests.ts' || fileBase === 'guest.ts'
        || fileBase === 'widget.ts' || fileBase === 'qbo-webhook.ts'
        || fileBase === 'concierge.ts') return [];
    if (routePath.startsWith('/sysadmin') || routePath.includes('/sysadmin/')) return ['admin'];
    if (ADMIN_FILES.has(fileBase)) return ['admin'];
    if (AGENT_FILES.has(fileBase)) return ['agent'];
    if (fileBase === 'integration.ts') return [];  // M2M
    return M === 'get' ? ['read'] : ['write'];
}

export function deriveTier(
    method: string, routePath: string, operationId: string, fileBase: string
): 'primary' | 'extended' | 'excluded' {
    if (EXCLUDED_FILES.has(fileBase)) return 'excluded';
    for (const { rx, tier } of TIER_PATTERNS) if (rx.test(routePath) || rx.test(operationId)) return tier;
    if (fileBase === 'admin.ts') return 'extended';
    if (PRIMARY_ELIGIBLE_FILES.has(fileBase)) {
        const M = method.toLowerCase();
        // CRUD on collection root
        if (isCollectionRoot(routePath)) {
            if (['get', 'post', 'patch', 'delete'].includes(M)) return 'primary';
        }
        // GET on single — getInspection / getBooking — keep primary
        const segs = routePath.split('/').filter(Boolean);
        if (M === 'get' && segs.length === 1 && segs[0].startsWith('{')) return 'primary';
    }
    return 'extended';
}
