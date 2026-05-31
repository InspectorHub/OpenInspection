import { describe, it, expect } from 'vitest';
import {
    DEFECT_TRADES, DEFECT_DEADLINES, DEFECT_TIMEFRAMES,
    isDefectTrade, isDefectDeadline, isDefectTimeframe,
    DEFECT_TRADE_LABELS, DEFECT_DEADLINE_LABELS, DEFECT_TIMEFRAME_LABELS,
} from '../../server/types/defect-fields';

describe('defect-fields vocabularies', () => {
    it('exports 20 trades, 6 deadlines, 6 timeframes', () => {
        expect(DEFECT_TRADES).toHaveLength(20);
        expect(DEFECT_DEADLINES).toHaveLength(6);
        expect(DEFECT_TIMEFRAMES).toHaveLength(6);
    });

    it('label map has an entry for every vocabulary id', () => {
        for (const id of DEFECT_TRADES) expect(DEFECT_TRADE_LABELS[id]).toBeDefined();
        for (const id of DEFECT_DEADLINES) expect(DEFECT_DEADLINE_LABELS[id]).toBeDefined();
        for (const id of DEFECT_TIMEFRAMES) expect(DEFECT_TIMEFRAME_LABELS[id]).toBeDefined();
    });

    it('type-guards accept valid ids and reject unknown', () => {
        expect(isDefectTrade('licensed-plumber')).toBe(true);
        expect(isDefectTrade('nonsense')).toBe(false);
        expect(isDefectDeadline('immediate')).toBe(true);
        expect(isDefectDeadline('asap')).toBe(false);
        expect(isDefectTimeframe('3-5-years')).toBe(true);
        expect(isDefectTimeframe('eventually')).toBe(false);
    });
});
