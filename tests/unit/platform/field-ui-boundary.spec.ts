import { describe, it, expect } from 'vitest';
// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import { findBoundaryViolations } from '../../../scripts/check-field-ui-boundary.mjs';

const at = (file: string, source: string) => ({ file: `packages/field-ui/${file}`, source });

describe('field-ui boundary', () => {
  it('flags forbidden imports', () => {
    const v = findBoundaryViolations([
      at('src/a.ts', "import { useFetcher } from 'react-router';"),
      at('src/b.ts', "import x from '../../../server/lib/x';"),
      at('src/c.ts', "import { createApi } from '~/lib/api-client.server';"),
      at('src/d.ts', "import { m } from '../i18n/messages';"),
    ]);
    expect(v.map((x: { file: string }) => x.file)).toEqual([
      'packages/field-ui/src/a.ts',
      'packages/field-ui/src/b.ts',
      'packages/field-ui/src/c.ts',
    ]);
  });

  it('allows the shared-ui alias, the package itself and third-party peers', () => {
    const v = findBoundaryViolations([
      at('src/ok1.ts', "import { Button } from '@core/shared-ui';"),
      at('src/ok2.tsx', "import * as Y from 'yjs';\nimport { useState } from 'react';"),
      at('src/ok3.ts', "import type { FieldDataSource } from '@core/field-ui';"),
      at('src/ok4.ts', "import { x } from './sibling';\nimport { y } from '../hooks/y';"),
      at('src/ok5.ts', "export { z } from './z';"),
    ]);
    expect(v).toEqual([]);
  });

  it('flags each forbidden family on its own', () => {
    const reason = (source: string) => findBoundaryViolations([at('src/x.ts', source)]).map((x: { specifier: string }) => x.specifier);
    expect(reason("import a from 'react-router';")).toEqual(['react-router']);
    expect(reason("import a from 'react-router/dom';")).toEqual(['react-router/dom']);
    expect(reason("import a from '@react-router/dev';")).toEqual(['@react-router/dev']);
    expect(reason("import a from '~/components/x';")).toEqual(['~/components/x']);
    expect(reason("import a from './db.server';")).toEqual(['./db.server']);
    expect(reason("import a from 'cloudflare:workers';")).toEqual(['cloudflare:workers']);
    expect(reason("import a from '../../shared-ui/src/index';")).toEqual(['../../shared-ui/src/index']);
  });

  it('sees side-effect, re-export, dynamic, require and multi-line forms', () => {
    const reason = (source: string) => findBoundaryViolations([at('src/x.ts', source)]).map((x: { specifier: string }) => x.specifier);
    expect(reason("import 'react-router';")).toEqual(['react-router']);
    expect(reason("export * from '~/lib/x';")).toEqual(['~/lib/x']);
    expect(reason("const m = await import('cloudflare:workers');")).toEqual(['cloudflare:workers']);
    expect(reason("const m = require('../../../server/x');")).toEqual(['../../../server/x']);
    expect(reason("import {\n  a,\n  b,\n} from '~/lib/multi';")).toEqual(['~/lib/multi']);
  });

  it('does not read comments or prose as imports', () => {
    const v = findBoundaryViolations([
      at('src/c1.ts', "// import x from 'react-router';\n/* import y from '~/lib/y'; */\n/**\n * import z from 'cloudflare:workers';\n */\nexport const ok = 1;"),
      at('src/c2.ts', "export const note = \"do not import from 'react-router'\";"),
    ]);
    expect(v).toEqual([]);
  });

  it('reports one violation per offending specifier with the reason', () => {
    const v = findBoundaryViolations([
      at('src/two.ts', "import a from 'react-router';\nimport b from '~/lib/b';\nimport c from 'yjs';"),
    ]);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ file: 'packages/field-ui/src/two.ts', specifier: 'react-router' });
    expect(typeof v[0].reason).toBe('string');
  });
});
