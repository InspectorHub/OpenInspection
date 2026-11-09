// Loaded by the api-shared vitest project only (vitest.api.config.ts), once per spec file.
//
// api-shared runs with `isolate: false`: the spec files one worker handles share a module registry,
// so state a file leaves in a module is seen by the next file. The static rules in
// scripts/lib/unit-isolation.mjs keep out every spec that mocks, stubs or writes globals; what is
// left is product modules whose own state is real but is cleared by an exported function. This file
// calls each of them after every file. `setupProblems` (lint:unit-isolation) fails when a module
// listed in RESET_BY_SHARED_SETUP stops being reset here.
import { afterAll, vi } from 'vitest';
import { resetServiceAccountTokenCache } from '../../server/lib/ai/credentials/google-service-account';
import { resetCspReportSampling } from '../../server/lib/csp-report';
import { resetTouchLastActiveDebounce } from '../../server/lib/middleware/touch-last-active';

afterAll(() => {
    resetServiceAccountTokenCache();
    resetCspReportSampling();
    resetTouchLastActiveDebounce();
    // A spec that forgot to close a harness would otherwise leave its fetch double and its spy on the usage
    // meter for the next file. restoreAllMocks only restores spies made with vi.spyOn; it does not touch
    // vi.fn() doubles, so a mock a helper built at import time keeps working.
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
