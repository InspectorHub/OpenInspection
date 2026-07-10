import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { useDragReorder } from '~/components/editor-shared/useDragReorder';

function dragEvent(): any {
  return { preventDefault() {}, dataTransfer: { setData() {}, getData: () => '', effectAllowed: '', dropEffect: '' } };
}

test('drop calls onReorder(fromId, toId)', () => {
  const onReorder = vi.fn();
  const { result } = renderHook(() => useDragReorder({ ids: ['a', 'b', 'c'], onReorder }));
  act(() => result.current.dragProps('a').onDragStart(dragEvent()));
  act(() => result.current.dragProps('c').onDrop(dragEvent()));
  expect(onReorder).toHaveBeenCalledWith('a', 'c');
});

test('dropping onto self does not call onReorder', () => {
  const onReorder = vi.fn();
  const { result } = renderHook(() => useDragReorder({ ids: ['a', 'b'], onReorder }));
  act(() => result.current.dragProps('a').onDragStart(dragEvent()));
  act(() => result.current.dragProps('a').onDrop(dragEvent()));
  expect(onReorder).not.toHaveBeenCalled();
});
