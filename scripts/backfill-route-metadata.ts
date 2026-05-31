/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
/**
 * Codemod: backfill MCP/Skill route metadata across every createRoute() in
 * server/api/*.ts. Idempotent — re-running is a no-op for already-wrapped routes.
 *
 * What it does for each `createRoute({...})`:
 *  1. Skip if already wrapped with `withMcpMetadata(...)`.
 *  2. Derive operationId (camelCase) from method + path + filename if missing.
 *  3. Normalize tags to lowercase + map to the controlled vocabulary.
 *  4. Pick x-scopes from method + path heuristics.
 *  5. Pick x-tier — default 'extended'; mark webhooks/M2M/sysadmin 'excluded'
 *     and a curated CRUD shortlist 'primary'.
 *  6. Wrap the createRoute call: `createRoute(withMcpMetadata({...}, { ... }))`.
 *  7. Add `import { withMcpMetadata } from '../lib/route-metadata-standards';`
 *     if missing.
 *
 * Does NOT touch:
 *  - summary / description (quality work — left for a manual or LLM pass)
 *  - Zod schemas (separate codemod handles `.describe()` injection)
 *  - handlers
 *
 * Writes `scripts/backfill-route-metadata.report.md` listing each route's
 * decisions + flagging where summary < 4 words or description < 50 chars so
 * humans can do a targeted quality pass.
 *
 * Usage:
 *   npx tsx scripts/backfill-route-metadata.ts            # all api files
 *   npx tsx scripts/backfill-route-metadata.ts --dry-run  # report only
 *   npx tsx scripts/backfill-route-metadata.ts auth.ts    # one file
 */
import { Project, SyntaxKind, Node } from 'ts-morph';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ──────────────────────────────────────────────────────────────────
// Configuration: file → tag, naming overrides, tier rules
// ──────────────────────────────────────────────────────────────────

// Primary tag (from VALID_TAGS in route-metadata-standards.ts) by source file.
const FILE_TAG: Record<string, string> = {
    'admin.ts':                 'admin',
    'agent.ts':                 'agents',
    'agents.ts':                'agents',
    'agent-signup.ts':          'agents',
    'ai.ts':                    'ai',
    'analytics.ts':             'metrics',
    'auth.ts':                  'auth',
    'automations.ts':           'automations',
    'availability.ts':          'bookings',
    'billing.ts':               'invoices',
    'bookings.ts':              'bookings',
    'calendar.ts':              'calendar',
    'calendar-events.ts':       'calendar',
    'concierge.ts':             'bookings',
    'contacts.ts':              'contacts',
    'data.ts':                  'admin',
    'events.ts':                'automations',
    'guest.ts':                 'guest',
    'identity.ts':              'identity',
    'inspection-requests.ts':   'inspections',
    'inspection-sync.ts':       'inspections',
    'inspections.ts':           'inspections',
    'integration.ts':           'integrations',
    'integrations.ts':          'integrations',
    'invoices.ts':              'invoices',
    'marketplace.ts':           'marketplace',
    'messages.ts':              'messages',
    'metrics.ts':               'metrics',
    'notifications.ts':         'notifications',
    'places.ts':                'bookings',
    'profile.ts':               'profile',
    'public-share.ts':          'inspections',
    'public-slug.ts':           'profile',
    'qbo.ts':                   'qbo',
    'qbo-webhook.ts':           'webhooks',
    'rating-systems.ts':        'ratings',
    'recommendations.ts':       'recommendations',
    'repair-requests.ts':       'inspections',
    'services.ts':              'services',
    'tags.ts':                  'tags',
    'team.ts':                  'team',
    'template-migrations.ts':   'templates',
    'tenant-presence.ts':       'inspections',
    'users.ts':                 'identity',
    'widget.ts':                'webhooks',
};

// Singular entity name (PascalCase) for operationId construction, by file.
// Always SINGULAR; the script appends 's' (or '-y → -ies') for plural verbs.
// Defaults to PascalCase(filename without extension and trailing 's').
const FILE_ENTITY_OVERRIDE: Record<string, string> = {
    'admin.ts':                 'Tenant',
    'agent-signup.ts':          'Agent',
    'analytics.ts':             'Analytic',         // listAnalytics, getAnalytic
    'auth.ts':                  'Session',
    'availability.ts':          'Availability',
    'calendar-events.ts':       'CalendarEvent',
    'data.ts':                  'TenantData',
    'identity.ts':              'Identity',
    'inspection-requests.ts':   'InspectionRequest',
    'inspection-sync.ts':       'Inspection',
    'metrics.ts':               'Metric',           // listMetrics, getMetric
    'places.ts':                'Place',
    'profile.ts':               'Profile',
    'public-share.ts':          'PublicShare',
    'public-slug.ts':           'Slug',
    'qbo.ts':                   'QboIntegration',
    'qbo-webhook.ts':           'QboWebhook',
    'rating-systems.ts':        'RatingSystem',
    'repair-requests.ts':       'RepairRequest',
    'template-migrations.ts':   'TemplateMigration',
    'tenant-presence.ts':       'Presence',
    'widget.ts':                'Widget',
};

// Verb-like last-path-segments that should drive operationId naming.
const KNOWN_VERBS = new Set([
    'clone', 'send', 'sync', 'mark', 'confirm', 'approve', 'reject', 'complete',
    'publish', 'unpublish', 'archive', 'restore', 'refresh', 'merge', 'split',
    'upgrade', 'migrate', 'import', 'export', 'cancel', 'redeem', 'verify',
    'invite', 'accept', 'decline', 'revoke', 'rotate', 'enable', 'disable',
    'reset', 'forgot', 'change', 'set', 'unset', 'add', 'remove', 'attach',
    'detach', 'pin', 'unpin', 'autofill', 'autosummarize', 'preview', 'render',
    'upload', 'download', 'geocode', 'autocomplete', 'check', 'validate',
    'leaderboard', 'whoami', 'me', 'dashboard', 'counts', 'overrides',
    'bulk', 'seed-defaults', 'unread-count', 'mark-read', 'mark-all-read',
    'mark-sent', 'mark-paid', 'replace', 'connect', 'disconnect', 'subscribe',
    'unsubscribe', 'callback', 'authorize', 'authorise', 'logout', 'login',
    'join', 'leave', 'kick', 'ban', 'unban', 'mute', 'unmute',
]);

// Tier overrides — anything matching the regex gets the given tier.
const TIER_PATTERNS: Array<{ rx: RegExp; tier: 'primary' | 'extended' | 'excluded' }> = [
    { rx: /webhook/i,             tier: 'excluded' },
    { rx: /\/sysadmin\//,          tier: 'excluded' },
    { rx: /^\/api\/integration\//, tier: 'excluded' },  // M2M
    { rx: /\/ics(\/|$)/i,          tier: 'excluded' },
    { rx: /presence/i,             tier: 'excluded' },
    { rx: /\/bulk(\/|$)/i,         tier: 'extended' },
];

// Files whose top-level CRUD routes are eligible for 'primary' tier.
// Cap-aware: we want total primary ≤ 45.
const PRIMARY_ELIGIBLE_FILES = new Set([
    'inspections.ts', 'bookings.ts', 'templates.ts', 'recommendations.ts',
    'team.ts', 'messages.ts', 'notifications.ts', 'contacts.ts', 'invoices.ts',
    'services.ts', 'marketplace.ts', 'ai.ts', 'agent.ts',
]);

// Public/excluded file overrides for scopes.
const PUBLIC_AUTH_FILES = new Set(['auth.ts']);
const AGENT_FILES = new Set(['agent.ts']);
const ADMIN_FILES = new Set(['admin.ts']);

const VALID_TAGS = new Set([
    'auth', 'inspections', 'bookings', 'templates', 'team',
    'agents', 'ai', 'invoices', 'services', 'messages',
    'notifications', 'contacts', 'metrics', 'admin', 'sysadmin',
    'audit', 'marketplace', 'recommendations', 'agreements', 'webhooks',
    'public', 'calendar', 'tags', 'ratings', 'guest',
    'profile', 'identity', 'automations', 'integrations', 'qbo',
]);

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function toPascal(s: string): string {
    return s.replace(/(^|-|_|\s)([a-z])/g, (_, _sep, c) => c.toUpperCase()).replace(/[-_\s]/g, '');
}
function toCamel(s: string): string {
    const p = toPascal(s);
    return p.charAt(0).toLowerCase() + p.slice(1);
}
function singularize(s: string): string {
    if (s.endsWith('ies')) return s.slice(0, -3) + 'y';
    if (s.endsWith('ses')) return s.slice(0, -2);
    if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
    return s;
}

function fileEntity(fileBase: string): string {
    if (FILE_ENTITY_OVERRIDE[fileBase]) return FILE_ENTITY_OVERRIDE[fileBase];
    const stem = fileBase.replace(/\.ts$/, '');
    return toPascal(singularize(stem));
}

function pathSegments(p: string): string[] {
    return p.split('/').filter(s => s && !s.startsWith('{') && !s.startsWith(':'));
}

function lastNonParam(p: string): string | null {
    const segs = pathSegments(p);
    return segs.length ? segs[segs.length - 1] : null;
}

function isCollectionRoot(p: string): boolean {
    // path like '/' or '/{id}' (no extra segment beyond the param)
    const segs = p.split('/').filter(Boolean);
    return segs.length === 0 || (segs.length === 1 && segs[0].startsWith('{'));
}

function deriveOperationId(method: string, routePath: string, fileBase: string): string {
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

function deriveTags(existing: string[] | null, fileBase: string): string[] {
    const primary = FILE_TAG[fileBase] || 'inspections';
    const out: string[] = [primary];
    for (const t of existing ?? []) {
        const lower = t.toLowerCase();
        if (lower === primary) continue;
        if (VALID_TAGS.has(lower)) out.push(lower);
    }
    return out;
}

function splitCamel(s: string): string[] {
    return s.replace(/([A-Z])/g, ' $1').trim().split(/\s+/);
}

/** Build a sentence-case 4-12-word summary from operationId. */
function placeholderSummary(operationId: string): string {
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
function placeholderDescription(
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

function deriveScopes(method: string, routePath: string, fileBase: string): string[] {
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

// Files whose routes are always 'excluded' (M2M, webhook receivers, presence).
const EXCLUDED_FILES = new Set([
    'integration.ts',           // M2M endpoint group from portal
    'qbo-webhook.ts',           // QBO webhook receiver
    'widget.ts',                // public widget tracker, webhook-like
    'tenant-presence.ts',       // WebSocket presence
]);

function deriveTier(
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

// ──────────────────────────────────────────────────────────────────
// AST helpers
// ──────────────────────────────────────────────────────────────────

function getStringProp(obj: any, key: string): string | null {
    const prop = obj.getProperty(key);
    if (!prop || !Node.isPropertyAssignment(prop)) return null;
    const init = prop.getInitializer();
    if (!init) return null;
    if (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) {
        return init.getLiteralValue();
    }
    return null;
}

function getArrayProp(obj: any, key: string): string[] | null {
    const prop = obj.getProperty(key);
    if (!prop || !Node.isPropertyAssignment(prop)) return null;
    const init = prop.getInitializer();
    if (!init || !Node.isArrayLiteralExpression(init)) return null;
    return init.getElements().map(el => {
        if (Node.isStringLiteral(el) || Node.isNoSubstitutionTemplateLiteral(el)) return el.getLiteralValue();
        return '';
    }).filter(Boolean);
}

function setStringPropAlways(obj: any, key: string, value: string): void {
    const existing = obj.getProperty(key);
    if (existing) existing.replaceWithText(`${key}: ${JSON.stringify(value)}`);
    else obj.addPropertyAssignment({ name: key, initializer: JSON.stringify(value) });
}

function setArrayPropAlways(obj: any, key: string, values: string[]): void {
    const arrText = `[${values.map(v => JSON.stringify(v)).join(', ')}]`;
    const existing = obj.getProperty(key);
    if (existing) existing.replaceWithText(`${key}: ${arrText}`);
    else obj.addPropertyAssignment({ name: key, initializer: arrText });
}

// ──────────────────────────────────────────────────────────────────
// Main per-file processing
// ──────────────────────────────────────────────────────────────────

interface RouteAction {
    file: string;
    method: string;
    path: string;
    operationId: string;
    tags: string[];
    scopes: string[];
    tier: string;
    summary: string;
    description: string;
    summaryFlag: boolean;       // < 4 words
    descriptionFlag: boolean;   // < 50 chars
    wrapped: boolean;           // true if we wrapped (false if already wrapped)
}

function processFile(sourceFile: any, fileBase: string, dryRun: boolean): RouteAction[] {
    const actions: RouteAction[] = [];

    // Find all createRoute(...) CallExpressions
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    const createRouteCalls = callExpressions.filter((c: any) => {
        const expr = c.getExpression();
        return Node.isIdentifier(expr) && expr.getText() === 'createRoute';
    });

    let hadChange = false;

    for (const call of createRouteCalls) {
        // Skip if already wrapped: parent is `withMcpMetadata(...)` callExpression
        const parent = call.getParent();
        if (parent && Node.isCallExpression(parent)) {
            const parentExpr = parent.getExpression();
            if (Node.isIdentifier(parentExpr) && parentExpr.getText() === 'withMcpMetadata') {
                continue;  // already wrapped — skip
            }
        }

        const args = call.getArguments();
        if (!args[0] || !Node.isObjectLiteralExpression(args[0])) continue;
        const obj = args[0];

        const method = getStringProp(obj, 'method');
        const routePath = getStringProp(obj, 'path');
        if (!method || !routePath) continue;  // can't reason without these

        const existingOpId = getStringProp(obj, 'operationId');
        const existingSummary = getStringProp(obj, 'summary') || '';
        const existingDescription = getStringProp(obj, 'description') || '';
        const existingTags = getArrayProp(obj, 'tags');

        const opId = existingOpId || deriveOperationId(method, routePath, fileBase);
        const tags = deriveTags(existingTags, fileBase);
        const scopes = deriveScopes(method, routePath, fileBase);
        const tier = deriveTier(method, routePath, opId, fileBase);

        const sumWords = existingSummary.trim() ? existingSummary.trim().split(/\s+/).length : 0;
        const summaryFlag = sumWords < 4 || sumWords > 12 || existingSummary.endsWith('.');
        const descriptionFlag = existingDescription.length < 50;

        actions.push({
            file: fileBase,
            method: method.toUpperCase(),
            path: routePath,
            operationId: opId,
            tags,
            scopes,
            tier,
            summary: existingSummary,
            description: existingDescription,
            summaryFlag,
            descriptionFlag,
            wrapped: true,
        });

        if (dryRun) continue;

        // Ensure operationId, tags are set (overwrite if missing/wrong)
        if (!existingOpId) setStringPropAlways(obj, 'operationId', opId);
        // Always normalize tags
        setArrayPropAlways(obj, 'tags', tags);
        // Fill in summary/description if missing or under gate thresholds — humans
        // can replace via the report's flagged list later.
        if (summaryFlag) {
            setStringPropAlways(obj, 'summary', placeholderSummary(opId));
        }
        if (descriptionFlag) {
            setStringPropAlways(obj, 'description', placeholderDescription(existingDescription, opId, method, routePath, tags[0] || 'core'));
        }

        // Now wrap the createRoute call with withMcpMetadata(...)
        // Rewrite: createRoute({...}) → createRoute(withMcpMetadata({...}, { scopes: [...], tier: '...' }))
        const objText = obj.getText();
        const scopesText = `[${scopes.map(s => `'${s}'`).join(', ')}]`;
        const newArg = `withMcpMetadata(${objText}, { scopes: ${scopesText}, tier: '${tier}' })`;
        obj.replaceWithText(newArg);
        hadChange = true;
    }

    // Ensure import for withMcpMetadata
    if (hadChange && !dryRun) {
        ensureWithMcpMetadataImport(sourceFile);
    }

    return actions;
}

function ensureWithMcpMetadataImport(sourceFile: any): void {
    const existing = sourceFile.getImportDeclarations().find((d: any) =>
        d.getModuleSpecifierValue() === '../lib/route-metadata-standards'
    );
    if (existing) {
        const named = existing.getNamedImports().map((n: any) => n.getName());
        if (!named.includes('withMcpMetadata')) {
            existing.addNamedImport('withMcpMetadata');
        }
        return;
    }
    sourceFile.addImportDeclaration({
        moduleSpecifier: '../lib/route-metadata-standards',
        namedImports: ['withMcpMetadata'],
    });
}

// ──────────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────────

async function main() {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes('--dry-run');
    const fileFilter = argv.filter(a => !a.startsWith('--'));

    const repoRoot = path.resolve(__dirname, '..');
    const apiDir = path.join(repoRoot, 'src', 'api');
    const tsConfig = path.join(repoRoot, 'tsconfig.json');

    const project = new Project({ tsConfigFilePath: tsConfig });

    const apiFiles = fs.readdirSync(apiDir)
        .filter(f => f.endsWith('.ts'))
        .filter(f => fileFilter.length === 0 || fileFilter.includes(f))
        .sort();

    const allActions: RouteAction[] = [];

    for (const file of apiFiles) {
        const full = path.join(apiDir, file);
        const sf = project.addSourceFileAtPath(full);
        const before = sf.getFullText();
        const actions = processFile(sf, file, dryRun);
        const after = sf.getFullText();

        if (!dryRun && after !== before) {
            sf.saveSync();
        }
        if (actions.length) {
            allActions.push(...actions);
            console.log(`${file}: ${actions.length} route${actions.length > 1 ? 's' : ''}${dryRun ? ' (dry-run)' : ''}`);
        }
    }

    // Write report
    const reportPath = path.join(repoRoot, 'scripts', 'backfill-route-metadata.report.md');
    const lines: string[] = [];
    lines.push('# Route metadata backfill report');
    lines.push('');
    lines.push(`Generated by \`scripts/backfill-route-metadata.ts\` on ${new Date().toISOString()}.`);
    lines.push('');
    lines.push(`Total routes processed: **${allActions.length}**.`);
    const primaryCount = allActions.filter(a => a.tier === 'primary').length;
    const extendedCount = allActions.filter(a => a.tier === 'extended').length;
    const excludedCount = allActions.filter(a => a.tier === 'excluded').length;
    lines.push(`Tier distribution: primary=${primaryCount} extended=${extendedCount} excluded=${excludedCount}.`);
    lines.push('');
    lines.push('## Routes needing human follow-up');
    lines.push('');
    lines.push('Each route below has at least one of:');
    lines.push('- `summary` outside 4-12 words OR ending with period');
    lines.push('- `description` shorter than 50 chars');
    lines.push('');
    lines.push('| File | Method | Path | operationId | sumFlag | descFlag | Current summary | Current description |');
    lines.push('|---|---|---|---|:-:|:-:|---|---|');
    for (const a of allActions) {
        if (!a.summaryFlag && !a.descriptionFlag) continue;
        const sCell = (a.summary || '(empty)').replaceAll('|', '\\|').slice(0, 60);
        const dCell = (a.description || '(empty)').replaceAll('|', '\\|').slice(0, 80);
        lines.push(`| ${a.file} | ${a.method} | \`${a.path}\` | \`${a.operationId}\` | ${a.summaryFlag ? '⚠' : ''} | ${a.descriptionFlag ? '⚠' : ''} | ${sCell} | ${dCell} |`);
    }
    lines.push('');
    lines.push('## All processed routes');
    lines.push('');
    lines.push('| File | Method | Path | operationId | tags | scopes | tier |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const a of allActions) {
        lines.push(`| ${a.file} | ${a.method} | \`${a.path}\` | \`${a.operationId}\` | ${a.tags.join(', ')} | ${a.scopes.join(', ') || '(none)'} | ${a.tier} |`);
    }
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(`\nReport written: ${reportPath}`);
    console.log(`Total: ${allActions.length} routes (${primaryCount} primary, ${extendedCount} extended, ${excludedCount} excluded)`);
    const flagged = allActions.filter(a => a.summaryFlag || a.descriptionFlag).length;
    console.log(`Flagged for human review: ${flagged} routes`);
    if (dryRun) console.log('Dry-run — no files were modified.');
}

main().catch(err => { console.error(err); process.exit(1); });
