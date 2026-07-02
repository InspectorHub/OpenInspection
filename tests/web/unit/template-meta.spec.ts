import { describe, it, expect } from 'vitest';
import {
  serializeTemplateMeta,
  normalizeApplicability,
  toggleInArray,
  serializeSectionMeta,
} from '~/lib/editor/template-meta';

describe('serializeTemplateMeta', () => {
  it('emits propertyType + subtype for commercial', () => {
    expect(serializeTemplateMeta('commercial', 'office')).toEqual({ propertyType: 'commercial', commercialSubtype: 'office' });
  });
  it('drops subtype for non-commercial', () => {
    expect(serializeTemplateMeta('single-family', 'office')).toEqual({ propertyType: 'single-family' });
  });
  it('emits nothing when unspecified', () => {
    expect(serializeTemplateMeta(undefined, undefined)).toEqual({});
  });
});

describe('normalizeApplicability', () => {
  it('returns undefined when nothing constrains the section', () => {
    expect(normalizeApplicability({ propertyTypes: [], commercialSubtypes: [] })).toBeUndefined();
    expect(normalizeApplicability(undefined)).toBeUndefined();
  });
  it('keeps only non-empty arrays', () => {
    expect(normalizeApplicability({ propertyTypes: ['commercial'], commercialSubtypes: [] }))
      .toEqual({ propertyTypes: ['commercial'] });
  });
});

describe('toggleInArray', () => {
  it('adds when on', () => { expect(toggleInArray(['a'], 'b', true).sort()).toEqual(['a', 'b']); });
  it('removes when off', () => { expect(toggleInArray(['a', 'b'], 'b', false)).toEqual(['a']); });
  it('is idempotent on add', () => { expect(toggleInArray(['a'], 'a', true)).toEqual(['a']); });
});

describe('serializeSectionMeta', () => {
  it('emits defaultScope + normalized applicableTo', () => {
    expect(serializeSectionMeta({ defaultScope: 'unit', applicableTo: { propertyTypes: ['commercial'], commercialSubtypes: [] } }))
      .toEqual({ defaultScope: 'unit', applicableTo: { propertyTypes: ['commercial'] } });
  });
  it('emits nothing for a bare section', () => {
    expect(serializeSectionMeta({})).toEqual({});
  });
});
