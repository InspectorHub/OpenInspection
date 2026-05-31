import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        ignores: ['dist/**', 'dist-check/**', 'build/**', '.react-router/**', 'node_modules/**', '.wrangler/**', 'eslint.config.js', 'public/**', 'tests/**', 'scripts/**'],
    },
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parserOptions: {
                project: ['./tsconfig.json', './tsconfig.api.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
            // Round 5 lesson — Alpine v3 only auto-removes x-cloak from the x-data root.
            // x-cloak on a NESTED element combined with the
            // [x-cloak]{display:none!important} rule in main-layout permanently hides
            // the element even when x-show=true. Two prod bugs landed because of this:
            //   - 17a75d7 (marketplace preview modal)
            //   - a753af5 (login 2fa form)
            // Rule: x-cloak ONLY on the outermost x-data element. For nested
            // hide-on-load, use style="display:none" + x-show.
            'no-restricted-syntax': ['warn', {
                selector: "JSXAttribute[name.name='x-cloak']",
                message: 'Avoid x-cloak on nested JSX elements — Alpine does not auto-remove it, so [x-cloak]{display:none} stays sticky. Use style="display:none" + x-show, or place x-cloak only on the outermost x-data element. See main-layout.tsx comment.',
            }],
        },
    },
    {
        // Dead-routes cleanup (2026-05-30) — guard against re-introducing raw
        // /api/* string-literal fetches and the now-deleted apiFetch helper in
        // route files. The 17 retained apiFetch dead-route sites were all migrated
        // to the typed createApi(context, { token }) client; this keeps it that way.
        // Scoped to routes/** so browser-side component fetches aren't false-flagged.
        files: ['app/routes/**/*.ts', 'app/routes/**/*.tsx'],
        rules: {
            'no-restricted-syntax': ['warn',
                {
                    selector: "JSXAttribute[name.name='x-cloak']",
                    message: 'Avoid x-cloak on nested JSX elements — Alpine does not auto-remove it, so [x-cloak]{display:none} stays sticky. Use style="display:none" + x-show, or place x-cloak only on the outermost x-data element. See main-layout.tsx comment.',
                },
                {
                    selector: "CallExpression[callee.name='fetch'][arguments.0.type='Literal'][arguments.0.value=/^\\u002Fapi\\u002F/]",
                    message: 'Do not call fetch("/api/...") with a string literal. Use createApi(context) from ~/lib/api-client.server for typed access.',
                },
                {
                    selector: "CallExpression[callee.name='apiFetch']",
                    message: 'apiFetch was removed. Use createApi(context, { token }) from ~/lib/api-client.server.',
                },
            ],
        },
    }
);
