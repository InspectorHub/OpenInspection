import { describe, it, expect } from 'vitest';
import { sanitizeDefectStates } from '../../server/services/inspection.service';

/**
 * Integration-flavored: we exercise the JSON-shape merge directly. A
 * full patchItem test needs Miniflare + D1 fixtures; this verifies the
 * pure merge logic that the service-side branch implements.
 */
function applyDefectFieldsMerge(
    data: Record<string, any>,
    itemId: string,
    value: { cannedId: string; location?: string | null; trade?: string | null; deadline?: string | null; timeframe?: string | null },
) {
    const entry = data[itemId] ?? (data[itemId] = {});
    entry.tabs = entry.tabs ?? {};
    entry.tabs.defects = entry.tabs.defects ?? [];
    let row = entry.tabs.defects.find((d: any) => d.cannedId === value.cannedId);
    if (!row) {
        row = { cannedId: value.cannedId, included: true };
        entry.tabs.defects.push(row);
    }
    if ('location' in value)  row.location  = value.location;
    if ('trade' in value)     row.trade     = value.trade;
    if ('deadline' in value)  row.deadline  = value.deadline;
    if ('timeframe' in value) row.timeframe = value.timeframe;
    sanitizeDefectStates(data);
    return data;
}

describe('defectFields merge into tabs.defects[]', () => {
    it('creates a defect row on first write', () => {
        const data: Record<string, any> = {};
        applyDefectFieldsMerge(data, 'item1', {
            cannedId: 'rd1', trade: 'licensed-plumber', location: 'Master bath',
        });
        expect(data.item1.tabs.defects).toHaveLength(1);
        expect(data.item1.tabs.defects[0]).toMatchObject({
            cannedId: 'rd1', included: true, trade: 'licensed-plumber', location: 'Master bath',
        });
    });

    it('updates existing row in place (does not duplicate)', () => {
        const data: Record<string, any> = {
            item1: { tabs: { defects: [{ cannedId: 'rd1', included: true, trade: 'licensed-plumber' }] } },
        };
        applyDefectFieldsMerge(data, 'item1', { cannedId: 'rd1', deadline: 'before-closing' });
        expect(data.item1.tabs.defects).toHaveLength(1);
        expect(data.item1.tabs.defects[0]).toMatchObject({
            trade: 'licensed-plumber',
            deadline: 'before-closing',
        });
    });

    it('drops unknown enum from incoming patch (sanitizer integration)', () => {
        const data: Record<string, any> = {};
        applyDefectFieldsMerge(data, 'item1', { cannedId: 'rd1', trade: 'plumber-nonsense' as any });
        expect(data.item1.tabs.defects[0].trade).toBeNull();
    });
});
