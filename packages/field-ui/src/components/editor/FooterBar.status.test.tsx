// @vitest-environment happy-dom
/** The footer's sync pill names the presence state, including a host that cannot say who the viewer is. */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { FooterBar } from './FooterBar';
import { FieldDataSourceProvider } from '../../context';
import { createEmptyEditorData, createFakeDataSource } from '../../testing/fake-data-source';

afterEach(cleanup);

function pill(status: 'connecting' | 'connected' | 'reconnecting' | 'unavailable'): string {
  const ds = createFakeDataSource({ data: createEmptyEditorData() });
  const { container } = render(
    <FieldDataSourceProvider dataSource={ds}>
      <FooterBar status={status} />
    </FieldDataSourceProvider>,
  );
  return container.textContent ?? '';
}

describe('FooterBar presence status', () => {
  it('says presence is unavailable, not "Connecting…", when the host has no identity for the viewer', () => {
    const text = pill('unavailable');
    expect(text).toContain('Presence unavailable');
    expect(text).not.toContain('Connecting');
  });
  it('still says Connecting… / Connected / Reconnecting… for the other states', () => {
    expect(pill('connecting')).toContain('Connecting');
    cleanup();
    expect(pill('connected')).toContain('Connected');
    cleanup();
    expect(pill('reconnecting')).toContain('Reconnecting');
  });
});
