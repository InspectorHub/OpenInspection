// tests/web/unit/documents-section.spec.ts
import { describe, it, expect } from 'vitest';
import {
  formatSize, isAcceptedDocument, groupByCategory, CATEGORY_LABELS,
} from '~/components/DocumentsSection';

describe('DocumentsSection helpers', () => {
  it('formats size', () => {
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
  it('accept filter mirrors the server allowlist incl CAD-by-extension', () => {
    expect(isAcceptedDocument({ name: 'a.pdf', type: 'application/pdf', size: 1000 })).toBe(true);
    expect(isAcceptedDocument({ name: 'floor.dwg', type: 'application/octet-stream', size: 1000 })).toBe(true);
    expect(isAcceptedDocument({ name: 'x.exe', type: 'application/x-msdownload', size: 1000 })).toBe(false);
    expect(isAcceptedDocument({ name: 'big.pdf', type: 'application/pdf', size: 101 * 1024 * 1024 })).toBe(false);
  });
  it('groups by category with stable label coverage', () => {
    const groups = groupByCategory([
      { id: '1', filename: 'a.pdf', category: 'prior_reports', sizeBytes: 1, createdAt: 1, uploadedByKind: 'client', uploadedByName: null, visibility: 'client_visible', label: null },
      { id: '2', filename: 'b.pdf', category: 'prior_reports', sizeBytes: 1, createdAt: 1, uploadedByKind: 'client', uploadedByName: null, visibility: 'client_visible', label: null },
      { id: '3', filename: 'c.dwg', category: 'plans_drawings', sizeBytes: 1, createdAt: 1, uploadedByKind: 'inspector', uploadedByName: 'Bob', visibility: 'client_visible', label: null },
    ]);
    expect(groups.find((g) => g.category === 'prior_reports')!.items.length).toBe(2);
    expect(Object.keys(CATEGORY_LABELS)).toContain('environmental');
  });
});
