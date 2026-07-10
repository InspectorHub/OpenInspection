import { useState, useCallback } from 'react';

export function useDragReorder(opts: { ids: string[]; onReorder: (fromId: string, toId: string) => void }) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const dragProps = useCallback((id: string) => ({
    draggable: true as const,
    'data-dragging': draggingId === id,
    onDragStart: (e: React.DragEvent) => {
      setDraggingId(id);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const from = draggingId;
      setDraggingId(null);
      if (from && from !== id) opts.onReorder(from, id);
    },
  }), [draggingId, opts]);

  return { dragProps, draggingId };
}
