import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PhotoAppendix } from './PhotoAppendix';
import type { AppendixPhoto } from './types';

const photos: AppendixPhoto[] = [
  { photoNo: 1, key: 'a', url: '/p/a', caption: 'Cracked tile', sectionId: 's1', sectionTitle: 'Roof', itemId: 'i1', itemLabel: 'Covering' },
  { photoNo: 2, key: 'b', url: '/p/b', caption: null, sectionId: 's1', sectionTitle: 'Roof', itemId: 'i1', itemLabel: 'Covering' },
];

describe('PhotoAppendix', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<PhotoAppendix photos={[]} isPrint={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Photo N. labels, captions, and anchor ids', () => {
    const { getByText, container } = render(<PhotoAppendix photos={photos} isPrint={false} />);
    expect(getByText('Photo 1.')).toBeTruthy();
    expect(getByText('Photo 2.')).toBeTruthy();
    expect(getByText('Cracked tile')).toBeTruthy();
    expect(container.querySelector('#photo-1')).toBeTruthy();
    expect(container.querySelector('#photo-2')).toBeTruthy();
  });

  it('falls back to "section — item" caption when caption is null', () => {
    const { getByText } = render(<PhotoAppendix photos={photos} isPrint={false} />);
    expect(getByText('Roof — Covering')).toBeTruthy();
  });

  it('uses the lean print thumbnail width when printing', () => {
    const { container } = render(<PhotoAppendix photos={photos} isPrint={true} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toContain('w=480');
  });
});
