/**
 * Reads the declaration of a schema that a route module imports, for the public-projection detector (see `isPassthroughImport` in
 * public-projection-detect.mjs). Only relative imports are followed; anything else (a package, a path alias) is reported as unreadable and the
 * detector then takes the schema at its word, as it did before this reader existed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import ts from 'typescript';

const FILE_PREFIX = 'file:';

/** The repo-relative file a module reference names: `file:<path>` (a file this reader returned earlier) or a relative specifier from `fromFile`. */
function resolveModule(root, fromFile, ref) {
    if (ref.startsWith(FILE_PREFIX)) return ref.slice(FILE_PREFIX.length);
    if (!ref.startsWith('./') && !ref.startsWith('../')) return null;
    const base = normalize(join(dirname(fromFile), ref)).split(String.fromCharCode(92)).join('/');
    for (const candidate of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(join(root, candidate))) return candidate;
    return null;
}

/** The initializer text of a top-level `const <name>` of a source file, or null; and the module a same-named import comes from. */
function findDeclaration(sf, name) {
    let init = null;
    let importedFrom = null;
    for (const st of sf.statements) {
        if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) init = d.initializer.getText(sf);
        } else if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
            for (const el of st.importClause.namedBindings.elements) if (el.name.text === name) importedFrom = st.moduleSpecifier.text;
        }
    }
    return { init, importedFrom };
}

/**
 * A reader for the imports of one route module. `readImport(moduleRef, name)` answers `{ init, module }` for the const `name` declared in the
 * module (following a plain re-import a few steps), or null when the module cannot be found or does not declare it.
 */
export function makeImportReader(root, routeFile) {
    return function readImport(moduleRef, name) {
        let file = resolveModule(root, routeFile, moduleRef);
        let wanted = name;
        for (let hop = 0; hop < 3 && file !== null; hop += 1) {
            let src;
            try { src = readFileSync(join(root, file), 'utf8'); } catch { return null; }
            const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
            const { init, importedFrom } = findDeclaration(sf, wanted);
            if (init !== null) return { init, module: `${FILE_PREFIX}${file}` };
            if (importedFrom === null) return null;
            file = resolveModule(root, file, importedFrom);
        }
        return null;
    };
}

/** A schema declared to pass unknown keys through at its top level. */
const PASSTHROUGH_SCHEMA = /\.passthrough\(|\.loose\(|z\.looseObject\(/;

/**
 * True when a schema imported from another module is declared there as one that passes unknown keys through (`.passthrough()`, `.loose()`,
 * `z.looseObject(...)`): a `.parse(...)` of it returns the row as it came. Only that top-level shape counts, not a `z.unknown()` field inside
 * it, which is one opaque value and not a whole row. A schema built from another (`B.extend(...)`, `.openapi(...)`) is followed through its
 * leading name inside the module that declares it, a few steps. When the module cannot be read the schema is taken at its word, as before.
 */
export function isPassthroughImport(name, decl) {
    const from = decl.imports.get(name);
    if (from === undefined || decl.readImport === undefined) return false;
    const seen = new Set();
    let module = from;
    let current = name;
    for (let step = 0; step < 4; step += 1) {
        const key = `${module}::${current}`;
        if (seen.has(key)) return false;
        seen.add(key);
        const text = decl.readImport(module, current);
        if (text === null) return false;
        if (PASSTHROUGH_SCHEMA.test(text.init)) return true;
        const lead = /^\s*([A-Za-z_$][\w$]*)\s*\./.exec(text.init);
        if (lead === null || !lead[1].endsWith('Schema')) return false;
        // The leading name is declared in the module just read, or imported into it; the reader answers for either.
        module = text.module;
        current = lead[1];
    }
    return false;
}
