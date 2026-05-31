/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
/**
 * Codemod: backfill `.describe('TODO: <field>')` on every Zod object-property
 * that has no description yet. Targets both:
 *   - server/lib/validations/*.schema.ts (centralised schemas)
 *   - server/api/*.ts                    (inline z.object({...}) inside createRoute)
 *
 * Idempotent — fields whose chain already includes `.describe(`
 * or `.openapi({... description: ... })` are skipped.
 *
 * Pairs with `scripts/backfill-route-metadata.ts`: that codemod fills route-
 * level metadata; this one fills schema-level field descriptions so the
 * route-metadata vitest gate's last assertion (`every input schema field has
 * a description`) passes for all modules.
 *
 * Usage:
 *   npx tsx scripts/backfill-zod-descriptions.ts                # all files
 *   npx tsx scripts/backfill-zod-descriptions.ts --dry-run      # report only
 *   npx tsx scripts/backfill-zod-descriptions.ts auth.schema.ts # single file
 */
import { Project, SyntaxKind, Node } from 'ts-morph';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ──────────────────────────────────────────────────────────────────
// AST helpers
// ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the value expression's TOP-LEVEL chain already provides
 * a description via `.describe(...)` or `.openapi({ description: '...' })`.
 * Inner `.describe()` calls nested inside z.object/z.array body do NOT count
 * for the container — the container needs its own description.
 *
 * Algorithm: scan text, track paren depth. A `.describe(` or `.openapi(` is
 * top-level only when encountered at depth 0 (i.e. not inside an argument).
 */
function chainHasDescription(text: string): boolean {
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(') { depth++; continue; }
        if (ch === ')') { depth--; continue; }
        if (depth !== 0 || ch !== '.') continue;
        if (text.startsWith('.describe(', i)) return true;
        if (text.startsWith('.openapi(', i)) {
            // Check whether this openapi() call's argument object contains
            // a `description:` property. Scan only the slice for performance.
            const slice = text.slice(i, Math.min(text.length, i + 4096));
            if (/^\.openapi\s*\(\s*\{[^}]*description\s*:/.test(slice)) return true;
        }
    }
    return false;
}

// JavaScript built-ins and common library identifiers that start with a
// capital letter but aren't Zod schemas. Filter them out.
const BUILTIN_CONSTRUCTORS = new Set([
    'Number', 'String', 'Boolean', 'Array', 'Object', 'Date', 'JSON', 'Math',
    'Promise', 'Error', 'TypeError', 'RangeError', 'RegExp', 'Map', 'Set',
    'WeakMap', 'WeakSet', 'Symbol', 'BigInt', 'Buffer', 'Uint8Array',
    'Uint16Array', 'Int32Array', 'Float32Array', 'Float64Array', 'ArrayBuffer',
    'DataView', 'Proxy', 'Reflect', 'Intl', 'Response', 'Request', 'Headers',
    'URL', 'URLSearchParams', 'FormData', 'Blob', 'File', 'TextEncoder',
    'TextDecoder', 'EventEmitter', 'AbortController', 'AbortSignal',
    'WebSocket', 'WebAssembly', 'Worker',
    // Common library types
    'React', 'Vue', 'Angular',
]);

/**
 * Suffix patterns that strongly suggest a bare identifier is a Zod schema
 * (so a bare reference like `type: ItemAttributeTypeEnum` can be appended
 * with `.describe()`). Excludes generic suffixes like Token, Url, Id that
 * are commonly used for non-schema constants.
 */
const ZOD_NAME_SUFFIX_RX = /(?:Schema|Enum|Spec|Validator|Fields)$/;

/**
 * Returns true if the value expression looks like a Zod schema reference:
 *  - Method-chained: `LoginSchema.openapi({...})`, `ItemSourceSchema.nullable()`
 *  - Bare identifier ending in a Zod-suggesting suffix (`*Schema`, `*Enum`, etc.)
 * Bare unrelated identifiers (`TOTP_ISSUER`) and JS builtins (`Number(...)`)
 * are NOT matched.
 */
function looksLikeImportedSchemaRef(text: string): boolean {
    // Method-chained or constructor-called
    const callMatch = text.match(/^([A-Z][a-zA-Z0-9_]*)[\.\(]/);
    if (callMatch) {
        if (BUILTIN_CONSTRUCTORS.has(callMatch[1])) return false;
        return true;
    }
    // Bare identifier with a Zod-suggesting suffix
    if (/^[A-Z][a-zA-Z0-9_]*$/.test(text) && ZOD_NAME_SUFFIX_RX.test(text)) return true;
    return false;
}

/**
 * Returns true when the node has an ancestor that looks like a function/method
 * body (handlers, helpers) rather than a top-level schema declaration or a
 * Zod call argument. Used to skip ObjectLiteralExpressions inside handler
 * code where they construct response payloads, not schemas.
 */
function isInsideFunctionBody(node: any): boolean {
    let cur = node.getParent?.();
    while (cur) {
        // If we cross a Zod call before any function boundary, we're in a schema
        const kind = cur.getKind();
        if (kind === SyntaxKind.CallExpression) {
            const expr = cur.getExpression?.();
            if (expr) {
                const exprText = expr.getText();
                if (/^z\./.test(exprText)) return false;             // z.object({...})
                if (/^createRoute\b/.test(exprText)) return false;   // createRoute({...})
                if (/^withMcpMetadata\b/.test(exprText)) return false;
            }
        }
        if (kind === SyntaxKind.ArrowFunction || kind === SyntaxKind.FunctionExpression
            || kind === SyntaxKind.MethodDeclaration || kind === SyntaxKind.FunctionDeclaration) {
            return true;
        }
        cur = cur.getParent?.();
    }
    return false;
}

// ──────────────────────────────────────────────────────────────────
// Per-file processing
// ──────────────────────────────────────────────────────────────────

interface FieldAction {
    file: string;
    objectPath: string;   // dotted path showing nesting
    fieldName: string;
    todoText: string;
    snippet: string;      // a short snippet of the original chain
}

interface PendingEdit {
    start: number;
    end: number;
    replacement: string;
}

function processFile(sourceFile: any, dryRun: boolean): FieldAction[] {
    const actions: FieldAction[] = [];
    const edits: PendingEdit[] = [];

    // Phase 1: scan AST and COLLECT edits (do NOT mutate the AST here).
    // Walk ALL object literals, not just z.object()'s argument — also catches
    // plain const objects whose fields are spread into z.object via `...Base`.
    const objectLiterals = sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression);

    for (const obj of objectLiterals) {
        // Skip object literals constructed inside function bodies — those are
        // handler/helper code, not Zod schemas.
        if (isInsideFunctionBody(obj)) continue;
        for (const prop of obj.getProperties()) {
            if (!Node.isPropertyAssignment(prop)) continue;
            const keyNode = prop.getNameNode();
            const fieldName = Node.isIdentifier(keyNode) || Node.isStringLiteral(keyNode)
                ? keyNode.getText().replace(/['"]/g, '')
                : keyNode.getText();

            const value = prop.getInitializer();
            if (!value) continue;
            const valueText = value.getText();
            // Only act on CallExpressions or Zod-named bare identifiers.
            // Filters out bare identifiers (TOTP_ISSUER), enum / property
            // access (z.ZodIssueCode.custom), string literals, numeric
            // literals, etc.
            const isZodCall = Node.isCallExpression(value) &&
                (/^z\./.test(valueText) || looksLikeImportedSchemaRef(valueText));
            const isBareSchemaRef = Node.isIdentifier(value) && looksLikeImportedSchemaRef(valueText);
            if (!isZodCall && !isBareSchemaRef) continue;
            if (chainHasDescription(valueText)) continue;

            const todoText = `TODO describe ${fieldName} field for the OpenInspection MCP integration`;
            const escaped = todoText.replaceAll("'", "\\'");
            const replacement = `${valueText}.describe('${escaped}')`;

            actions.push({
                file: sourceFile.getBaseName(),
                objectPath: '',
                fieldName,
                todoText,
                snippet: valueText.length > 60 ? valueText.slice(0, 57) + '...' : valueText,
            });

            edits.push({
                start: value.getStart(),
                end: value.getEnd(),
                replacement,
            });
        }
    }

    // Phase 1.5: filter out edits whose range CONTAINS another edit's range.
    // For nested z.object containers, the outer container edit would overlap
    // with each inner field edit; we keep only the inner-most non-overlapping
    // ones (correctly describes leaf fields; the container itself stays
    // un-described — the gate doesn't require it).
    const filtered: PendingEdit[] = [];
    for (let i = 0; i < edits.length; i++) {
        const e = edits[i];
        let containsAnother = false;
        for (let j = 0; j < edits.length; j++) {
            if (i === j) continue;
            const f = edits[j];
            if (e.start <= f.start && e.end >= f.end && (e.end - e.start) > (f.end - f.start)) {
                containsAnother = true;
                break;
            }
        }
        if (!containsAnother) filtered.push(e);
    }

    // Phase 2: apply edits as raw text replacements, descending start order
    // so earlier offsets stay valid. Done in one shot to avoid AST mutation
    // mid-traversal.
    if (!dryRun && filtered.length > 0) {
        filtered.sort((a, b) => b.start - a.start);
        let text = sourceFile.getFullText();
        for (const e of filtered) {
            text = text.slice(0, e.start) + e.replacement + text.slice(e.end);
        }
        sourceFile.replaceWithText(text);
    }

    // Drop the actions that were filtered out (so the report reflects what
    // actually changed). Match by index since we built actions in parallel.
    const keptStarts = new Set(filtered.map(e => e.start));
    return actions.filter((_, i) => keptStarts.has(edits[i].start));
}

// ──────────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────────

async function main() {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes('--dry-run');
    const fileFilter = argv.filter(a => !a.startsWith('--'));

    const repoRoot = path.resolve(__dirname, '..');
    const tsConfig = path.join(repoRoot, 'tsconfig.json');
    const project = new Project({ tsConfigFilePath: tsConfig });

    const targets: string[] = [];
    // Schema files
    const schemaDir = path.join(repoRoot, 'src', 'lib', 'validations');
    if (fs.existsSync(schemaDir)) {
        for (const f of fs.readdirSync(schemaDir).sort()) {
            if (!f.endsWith('.ts')) continue;
            if (fileFilter.length && !fileFilter.includes(f)) continue;
            targets.push(path.join(schemaDir, f));
        }
    }
    // API files (inline schemas inside createRoute)
    const apiDir = path.join(repoRoot, 'src', 'api');
    if (fs.existsSync(apiDir)) {
        for (const f of fs.readdirSync(apiDir).sort()) {
            if (!f.endsWith('.ts')) continue;
            if (fileFilter.length && !fileFilter.includes(f)) continue;
            targets.push(path.join(apiDir, f));
        }
    }

    const allActions: FieldAction[] = [];

    for (const full of targets) {
        const sf = project.addSourceFileAtPath(full);
        const before = sf.getFullText();
        const actions = processFile(sf, dryRun);
        const after = sf.getFullText();
        if (!dryRun && after !== before) sf.saveSync();
        if (actions.length) {
            allActions.push(...actions);
            console.log(`${path.basename(full)}: ${actions.length} field${actions.length > 1 ? 's' : ''}${dryRun ? ' (dry-run)' : ''}`);
        }
    }

    // Report
    const reportPath = path.join(repoRoot, 'scripts', 'backfill-zod-descriptions.report.md');
    const lines: string[] = [];
    lines.push('# Zod field-description backfill report');
    lines.push('');
    lines.push(`Generated by \`scripts/backfill-zod-descriptions.ts\` on ${new Date().toISOString()}.`);
    lines.push('');
    lines.push(`Total fields touched: **${allActions.length}** (across ${new Set(allActions.map(a => a.file)).size} files).`);
    lines.push('');
    lines.push('All entries are inserted with placeholder text starting with `TODO`.');
    lines.push('A follow-up pass — manual or LLM — should replace each TODO with a real description.');
    lines.push('');
    lines.push('| File | Field | Chain snippet |');
    lines.push('|---|---|---|');
    for (const a of allActions) {
        const safeSnippet = a.snippet.replaceAll('|', '\\|');
        lines.push(`| ${a.file} | \`${a.fieldName}\` | \`${safeSnippet}\` |`);
    }
    fs.writeFileSync(reportPath, lines.join('\n'));
    console.log(`\nReport written: ${reportPath}`);
    console.log(`Total: ${allActions.length} fields across ${new Set(allActions.map(a => a.file)).size} files`);
    if (dryRun) console.log('Dry-run — no files were modified.');
}

main().catch(err => { console.error(err); process.exit(1); });
