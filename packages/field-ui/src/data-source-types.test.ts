import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SessionInfo } from './data-source';
import type { AutoAdvanceMode, CommercialPresets, PcaNarrative, PropertyMetaField, TemplateSnapshot } from './data-source-types';
import type { PropertyMetaField as SharedPropertyMetaField, METADATA_PRESETS } from './shared/commercial-subtypes';
import type { PcaNarrative as SharedPcaNarrative } from './shared/pca-narrative';
import type { AutoAdvanceMode as SharedAutoAdvanceMode } from './shared/rating-levels';
import type { Snapshot } from './shared/structure-ops';

describe('FieldDataSource contract types', () => {
  it('are the same types the shared editor logic uses, so they cannot drift', () => {
    expectTypeOf<TemplateSnapshot>().toEqualTypeOf<Snapshot>();
    expectTypeOf<PropertyMetaField>().toEqualTypeOf<SharedPropertyMetaField>();
    expectTypeOf<PcaNarrative>().toEqualTypeOf<SharedPcaNarrative>();
    expectTypeOf<AutoAdvanceMode>().toEqualTypeOf<SharedAutoAdvanceMode>();
    expectTypeOf<CommercialPresets>().toEqualTypeOf<typeof METADATA_PRESETS>();
    expect(true).toBe(true);
  });

  it('pins the video backend to the two values the session-context contract can answer', () => {
    expectTypeOf<SessionInfo['videoProvider']>().toEqualTypeOf<'r2' | 'stream'>();
    expect(true).toBe(true);
  });
});
