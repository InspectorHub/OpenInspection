// @vitest-environment happy-dom
/** One person open in two tabs (or on two connections) is one avatar, and React is not given two children with one key. */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { FooterBar } from './FooterBar';
import { FieldDataSourceProvider } from '../../context';
import { createEmptyEditorData, createFakeDataSource } from '../../testing/fake-data-source';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function avatars(roster: Array<{ userId: string; name: string }>) {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const ds = createFakeDataSource({ data: createEmptyEditorData() });
  const { container } = render(
    <FieldDataSourceProvider dataSource={ds}>
      <FooterBar status="connected" roster={roster} />
    </FieldDataSourceProvider>,
  );
  const sameKey = errors.mock.calls.filter((c) => String(c[0]).includes('same key'));
  return { titles: Array.from(container.querySelectorAll('[title]')).map((e) => e.getAttribute('title')).filter((t) => t === 'Ada' || t === 'Bo'), sameKey };
}

describe('FooterBar presence roster', () => {
  it('shows one avatar for a person listed twice and raises no duplicate-key warning', () => {
    const out = avatars([{ userId: 'u1', name: 'Ada' }, { userId: 'u1', name: 'Ada' }, { userId: 'u2', name: 'Bo' }]);
    expect(out.titles).toEqual(['Ada', 'Bo']);
    expect(out.sameKey).toEqual([]);
  });

  it('CONTROL - two different people are two avatars', () => {
    expect(avatars([{ userId: 'u1', name: 'Ada' }, { userId: 'u2', name: 'Bo' }]).titles).toEqual(['Ada', 'Bo']);
  });
});
