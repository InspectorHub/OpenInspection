/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import { SyntaxKind, Node } from 'ts-morph';
import type { RouteAction } from './route-metadata-types';
import {
    deriveOperationId,
    deriveTags,
    deriveScopes,
    deriveTier,
    placeholderSummary,
    placeholderDescription,
} from './route-metadata-naming';

// ──────────────────────────────────────────────────────────────────
// AST helpers
// ──────────────────────────────────────────────────────────────────

export function getStringProp(obj: any, key: string): string | null {
    const prop = obj.getProperty(key);
    if (!prop || !Node.isPropertyAssignment(prop)) return null;
    const init = prop.getInitializer();
    if (!init) return null;
    if (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) {
        return init.getLiteralValue();
    }
    return null;
}

export function getArrayProp(obj: any, key: string): string[] | null {
    const prop = obj.getProperty(key);
    if (!prop || !Node.isPropertyAssignment(prop)) return null;
    const init = prop.getInitializer();
    if (!init || !Node.isArrayLiteralExpression(init)) return null;
    return init.getElements().map(el => {
        if (Node.isStringLiteral(el) || Node.isNoSubstitutionTemplateLiteral(el)) return el.getLiteralValue();
        return '';
    }).filter(Boolean);
}

export function setStringPropAlways(obj: any, key: string, value: string): void {
    const existing = obj.getProperty(key);
    if (existing) existing.replaceWithText(`${key}: ${JSON.stringify(value)}`);
    else obj.addPropertyAssignment({ name: key, initializer: JSON.stringify(value) });
}

export function setArrayPropAlways(obj: any, key: string, values: string[]): void {
    const arrText = `[${values.map(v => JSON.stringify(v)).join(', ')}]`;
    const existing = obj.getProperty(key);
    if (existing) existing.replaceWithText(`${key}: ${arrText}`);
    else obj.addPropertyAssignment({ name: key, initializer: arrText });
}

// ──────────────────────────────────────────────────────────────────
// Main per-file processing
// ──────────────────────────────────────────────────────────────────

export function processFile(sourceFile: any, fileBase: string, dryRun: boolean): RouteAction[] {
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

export function ensureWithMcpMetadataImport(sourceFile: any): void {
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
