import { vi } from 'vitest';
import { reorderItemBySwap } from './reorder-by-swap';

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

test('dragging forward calls moveItem(dir=1) once per step', () => {
  const moveItem = vi.fn();
  reorderItemBySwap(items, 'a', 'c', 'sec1', moveItem);
  expect(moveItem).toHaveBeenCalledTimes(2);
  expect(moveItem).toHaveBeenNthCalledWith(1, 'sec1', 'a', 1);
  expect(moveItem).toHaveBeenNthCalledWith(2, 'sec1', 'a', 1);
});

test('dragging backward calls moveItem(dir=-1) once per step', () => {
  const moveItem = vi.fn();
  reorderItemBySwap(items, 'd', 'b', 'sec1', moveItem);
  expect(moveItem).toHaveBeenCalledTimes(2);
  expect(moveItem).toHaveBeenNthCalledWith(1, 'sec1', 'd', -1);
});

test('dropping onto self is a no-op', () => {
  const moveItem = vi.fn();
  reorderItemBySwap(items, 'b', 'b', 'sec1', moveItem);
  expect(moveItem).not.toHaveBeenCalled();
});

test('unknown ids are a no-op', () => {
  const moveItem = vi.fn();
  reorderItemBySwap(items, 'a', 'zzz', 'sec1', moveItem);
  expect(moveItem).not.toHaveBeenCalled();
});
