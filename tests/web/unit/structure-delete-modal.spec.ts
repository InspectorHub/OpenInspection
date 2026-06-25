import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { StructureDeleteModal } from '~/components/editor/StructureDeleteModal';

/**
 * StructureDeleteModal (D8) — confirms the impact of deleting a section
 * before the destructive op fires. NEVER uses window.confirm.
 */

const BASE_IMPACT = { items: 3, ratings: 2, notes: 1, photos: 4 };

function render(open: boolean, title = 'Roof', impact = BASE_IMPACT): string {
  return renderToStaticMarkup(
    createElement(StructureDeleteModal, {
      open,
      title,
      impact,
      onConfirm: () => {},
      onCancel: () => {},
    })
  );
}

describe('StructureDeleteModal — open state', () => {
  it('renders the section title', () => {
    const html = render(true, 'Electrical');
    expect(html).toContain('Electrical');
  });

  it('shows the item count', () => {
    const html = render(true);
    expect(html).toContain('3 items');
  });

  it('shows the rating count', () => {
    const html = render(true);
    expect(html).toContain('2 ratings');
  });

  it('shows a Confirm control', () => {
    const html = render(true);
    // Confirm button should be present (danger action)
    expect(html.toLowerCase()).toContain('delete');
  });

  it('shows a Cancel control', () => {
    const html = render(true);
    expect(html.toLowerCase()).toContain('cancel');
  });

  it('handles zero-impact gracefully', () => {
    const html = render(true, 'Empty Section', { items: 0, ratings: 0, notes: 0, photos: 0 });
    expect(html).toContain('Empty Section');
    expect(html).toContain('0 items');
  });
});

describe('StructureDeleteModal — closed state', () => {
  it('renders nothing when open is false', () => {
    const html = render(false);
    expect(html).toBe('');
  });
});
