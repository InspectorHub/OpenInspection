/**
 * Member names that the public-projection detector does not accept as a "field pick" (a property copied under its own name).
 *
 * A pick is a field list only when the field is a scalar. These names tend to hold a row, a list of rows, or a JSON column, so copying
 * one whole is the thing the gate exists to stop. Three sources, unioned:
 *  - CONTAINER_NAMES: names written by hand;
 *  - CONTAINER_SUFFIX: any name ending in one of the words that mark a collection or a document;
 *  - JSON_COLUMN_NAMES: every drizzle column declared with `{ mode: 'json' }` in server/lib/db/schema, read with the TypeScript AST, so a
 *    new JSON column is covered without anyone editing this file.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const CONTAINER_NAMES = new Set([
    'items', 'rows', 'row', 'list', 'data', 'results', 'result', 'settings', 'config', 'payload', 'record', 'records', 'request', 'requests',
    'inspection', 'inspections', 'contact', 'contacts', 'invoice', 'invoices', 'metadata', 'attachments', 'photos', 'sections', 'entries',
    'logs', 'children', 'template', 'templates', 'body', 'value', 'values', 'rest',
    'lines', 'units', 'notes', 'tabs', 'signoffs', 'images', 'media', 'credentials', 'agreements', 'people', 'participants', 'messages',
    'notices', 'tags', 'fields', 'answers', 'findings', 'slots',
]);

export const CONTAINER_SUFFIX = /(Row|Rows|Data|List|Items|Policy|Prefs|Json|Config|Settings|Photos|Sections|Entries|Logs|Report|Profile|Review|Signoffs|Tables|Units|Lines|Images|Media|Messages|Notices|People|Participants|Credentials|Agreements)$/;

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'lib', 'db', 'schema');

function* schemaFiles(dir) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) yield* schemaFiles(path);
        else if (name.endsWith('.ts')) yield path;
    }
}

/** True when the node holds an object literal with `mode: 'json'`. */
function declaresJsonMode(node) {
    let found = false;
    const visit = (n) => {
        if (found) return;
        if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && n.name.text === 'mode'
            && ts.isStringLiteralLike(n.initializer) && n.initializer.text === 'json') found = true;
        else ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
}

/** The property names of every column declared `{ mode: 'json' }` in the given source text. */
export function jsonColumnNamesIn(src, path = 'schema.ts') {
    const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true);
    const names = new Set();
    const visit = (n) => {
        if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && declaresJsonMode(n.initializer)) names.add(n.name.text);
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return names;
}

/** Every JSON column name in server/lib/db/schema, by property name. */
export function loadJsonColumnNames(dir = SCHEMA_DIR) {
    const names = new Set();
    for (const file of schemaFiles(dir)) for (const name of jsonColumnNamesIn(readFileSync(file, 'utf8'), file)) names.add(name);
    return names;
}

export const JSON_COLUMN_NAMES = loadJsonColumnNames();

/** True when a member of this name is not accepted as a pick. */
export function isContainerName(name) {
    return CONTAINER_NAMES.has(name) || JSON_COLUMN_NAMES.has(name) || CONTAINER_SUFFIX.test(name);
}
