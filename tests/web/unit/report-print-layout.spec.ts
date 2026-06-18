import { describe, it, expect } from 'vitest';
import {
  PRINT_CARD_CLASS,
  PRINT_FIGURE_CLASS,
  PRINT_SECTION_HEADING_CLASS,
  DEFECT_PHOTO_GRID_CLASS,
  ITEM_PHOTO_GRID_CLASS,
  printThumbWidth,
} from '../../../app/routes/public/report-card-stack';
import { resolvePdfSettings } from '../../../server/lib/pdf-settings';

describe('print break protection classes', () => {
  it('cards + figures avoid breaking inside', () => {
    expect(PRINT_CARD_CLASS).toContain('print:break-inside-avoid');
    expect(PRINT_FIGURE_CLASS).toContain('print:break-inside-avoid');
  });
  it('section headings avoid orphaning from their content', () => {
    expect(PRINT_SECTION_HEADING_CLASS).toContain('print:break-after-avoid');
  });
});

describe('print-dense photo grid', () => {
  it('photo grids collapse to 3 columns in print', () => {
    expect(DEFECT_PHOTO_GRID_CLASS).toContain('print:grid-cols-3');
    expect(ITEM_PHOTO_GRID_CLASS).toContain('print:grid-cols-3');
  });
  it('print uses a smaller thumbnail width than screen', () => {
    expect(printThumbWidth(true)).toBeLessThan(printThumbWidth(false));
  });
});

describe('resolvePdfSettings', () => {
  const allOnNoAddress = {
    showFooter: true,
    showPageNumbers: true,
    showLicense: true,
    companyAddress: null,
  };

  it('defaults everything ON with no address for null config', () => {
    expect(resolvePdfSettings(null)).toEqual(allOnNoAddress);
  });

  it('defaults everything ON with no address for an empty config', () => {
    expect(resolvePdfSettings({})).toEqual(allOnNoAddress);
  });

  it('respects partial overrides and the rest fall back to defaults', () => {
    expect(resolvePdfSettings({ pdfShowFooter: false, companyAddress: 'X' })).toEqual({
      showFooter: false,
      showPageNumbers: true,
      showLicense: true,
      companyAddress: 'X',
    });
  });
});
