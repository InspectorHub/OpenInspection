/**
 * The offline data package format, shared by the server that imports a package
 * and any client that writes one. Pure data and schemas: this package must not
 * import from `server/` or `app/`, and depends only on `zod`.
 */
export * from './src/limits';
export * from './src/manifest';
