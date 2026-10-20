// Registers the API app loader for every workers spec, as `workers/app.ts` does in
// production. This pool's entry is `test-worker.ts`, which never runs the
// production entry, so without this `getApiApp()` would throw in any spec that
// reaches the MCP bridge or the offline import replay through the real app.
// The import stays lazy: nothing evaluates `server/index` until a caller asks.
import { registerApiAppLoader } from '../../server/lib/api-app';

registerApiAppLoader(() => import('../../server/index').then((m) => m.app));
