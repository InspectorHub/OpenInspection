import { describe, it, expect } from 'vitest';
import { mapRatingSystemLevels } from '../../../server/lib/map-rating-levels';

/**
 * B-18 root cause #2 — mapRatingSystemLevels translated rating_systems
 * levels for the editor/report but silently DROPPED `pausesAdvance` (and
 * `hotkey`), so the seeds' "Defect/Monitor pause for notes" intent never
 * reached the client and the editor auto-advanced unconditionally.
 */
describe('mapRatingSystemLevels', () => {
  const seedLevels = [
    { abbr: 'Sat', label: 'Satisfactory', color: '#10b981', bucket: 'satisfactory', hotkey: '1', pausesAdvance: false, order: 0 },
    { abbr: 'D', label: 'Defect', color: '#ef4444', bucket: 'defect', hotkey: '3', pausesAdvance: true, order: 2 },
  ];

  it('passes pausesAdvance through to the client shape', () => {
    const mapped = mapRatingSystemLevels(seedLevels);
    const defect = mapped.find((l) => l.label === 'Defect');
    expect(defect?.pausesAdvance).toBe(true);
    const sat = mapped.find((l) => l.label === 'Satisfactory');
    expect(sat?.pausesAdvance).toBe(false);
  });

  it('keeps the legacy mapping intact (id/abbreviation/severity/isDefect)', () => {
    const mapped = mapRatingSystemLevels(seedLevels);
    const defect = mapped.find((l) => l.label === 'Defect')!;
    expect(defect.id).toBe('Defect');
    expect(defect.abbreviation).toBe('D');
    expect(defect.severity).toBe('significant');
    expect(defect.isDefect).toBe(true);
  });
});
