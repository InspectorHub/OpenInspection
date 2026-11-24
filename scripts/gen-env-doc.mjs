#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { configurationScope, missingEnvironmentNames, renderEnvironmentDoc } from './lib/environment-doc.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'docs/reference/environment-variables.md');

function parseJsonc(source) {
    let result = '';
    let quote = false;
    let line = false;
    let block = false;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        const next = source[i + 1];
        if (line) { if (c === '\n') { line = false; result += c; } else result += ' '; continue; }
        if (block) { if (c === '*' && next === '/') { block = false; result += '  '; i++; } else result += c === '\n' ? '\n' : ' '; continue; }
        if (quote) { result += c; if (c === '\\') { result += next ?? ''; i++; } else if (c === '"') quote = false; continue; }
        if (c === '"') { quote = true; result += c; continue; }
        if (c === '/' && next === '/') { line = true; result += '  '; i++; continue; }
        if (c === '/' && next === '*') { block = true; result += '  '; i++; continue; }
        result += c;
    }
    return result.replace(/,\s*([}\]])/g, '$1');
}

function interfaceProperties(entryFile, wantedName) {
    const cache = new Map();
    function load(file) {
        const absolute = resolve(ROOT, file);
        if (cache.has(absolute)) return cache.get(absolute);
        const source = ts.createSourceFile(absolute, readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
        const imports = new Map();
        const interfaces = new Map();
        for (const node of source.statements) {
            if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
                const modulePath = node.moduleSpecifier.text;
                const target = resolve(dirname(absolute), `${modulePath}.ts`);
                for (const specifier of node.importClause.namedBindings.elements) imports.set(specifier.name.text, target);
            }
            if (ts.isInterfaceDeclaration(node)) interfaces.set(node.name.text, node);
        }
        const loaded = { absolute, imports, interfaces };
        cache.set(absolute, loaded);
        return loaded;
    }
    const props = new Map();
    function visit(file, name) {
        const parsed = load(file);
        const node = parsed.interfaces.get(name);
        if (!node) throw new Error(`Environment interface ${name} was not found in ${file}`);
        for (const clause of node.heritageClauses ?? []) {
            for (const base of clause.types) {
                const baseName = base.expression.getText().split('.').at(-1);
                const imported = parsed.imports.get(baseName);
                if (!imported) throw new Error(`Cannot resolve environment base interface ${baseName} from ${file}`);
                const relative = `${imported.slice(ROOT.length + 1).replaceAll('\\', '/')}`;
                visit(relative, baseName);
            }
        }
        for (const member of node.members) {
            if (!ts.isPropertySignature(member) || !member.name) continue;
            const property = member.name.getText().replace(/^['"]|['"]$/g, '');
            const tags = ts.getJSDocTags(member).map((tag) => tag.tagName.text);
            props.set(property, {
                name: property,
                optional: Boolean(member.questionToken),
                tenantConfigured: tags.includes('tenant-configured'),
                splitIntegration: tags.includes('tenant-deployment-split'),
            });
        }
    }
    visit(entryFile, wantedName);
    return [...props.values()];
}

function declaredStringSet(entryFile, variableName, { fromNewSet = false } = {}) {
    const absolute = resolve(ROOT, entryFile);
    const source = ts.createSourceFile(absolute, readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = source.statements
        .filter(ts.isVariableStatement)
        .flatMap((statement) => statement.declarationList.declarations)
        .find((item) => ts.isIdentifier(item.name) && item.name.text === variableName);
    let initializer = declaration?.initializer;
    while (initializer && (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer) || ts.isParenthesizedExpression(initializer))) {
        initializer = initializer.expression;
    }
    if (fromNewSet && initializer && ts.isNewExpression(initializer)) {
        initializer = initializer.arguments?.[0];
        while (initializer && (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer) || ts.isParenthesizedExpression(initializer))) {
            initializer = initializer.expression;
        }
    }
    if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
        throw new Error(`Could not read ${variableName} from ${entryFile}`);
    }
    return new Set(initializer.elements
        .filter(ts.isStringLiteral)
        .map((element) => element.text));
}

const configPath = join(ROOT, 'wrangler.jsonc');
const config = JSON.parse(parseJsonc(readFileSync(configPath, 'utf8')));
const secretKeys = declaredStringSet('server/lib/secrets-catalog.ts', 'INTEGRATION_SECRET_KEYS');
const tenantOwnedKeys = declaredStringSet('server/lib/middleware/integration-secrets.ts', 'TENANT_OWNED_KEYS', { fromNewSet: true });
const properties = interfaceProperties('server/types/hono.ts', 'AppEnv').map((property) => ({
    ...property,
    scope: configurationScope({
        vars: config.vars?.[property.name] !== undefined,
        tenantConfigured: property.tenantConfigured,
        tenantOwned: tenantOwnedKeys.has(property.name),
        integrationSecret: secretKeys.has(property.name),
        splitIntegration: property.splitIntegration,
    }),
}));
const output = renderEnvironmentDoc({ vars: config.vars ?? {}, properties });
const check = process.argv.includes('--check');

if (check) {
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== output) {
        console.error('[env-doc] docs/reference/environment-variables.md is out of date. Run `npm run docs:env`.');
        const missing = missingEnvironmentNames(current, output);
        if (missing.length) console.error(`[env-doc] missing declared environment names: ${missing.join(', ')}`);
        console.log('[env-doc] generated documents checked=1');
        process.exit(1);
    }
    console.log('[env-doc] generated documents checked=1; environment names match the declarations.');
} else {
    writeFileSync(OUTPUT, output, 'utf8');
    console.log(`[env-doc] wrote docs/reference/environment-variables.md (${properties.length} typed environment properties).`);
}
