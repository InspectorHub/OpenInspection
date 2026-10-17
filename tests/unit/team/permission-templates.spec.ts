/**
 * Permission templates: the built-in ones, how a template resolves to the sparse
 * diff an invite or member row stores, and how the Team page works out which
 * template a person currently matches. Pure functions; no database.
 */
import { describe, it, expect } from 'vitest';
import { ROLES } from '../../../server/lib/auth/roles';
import { TOGGLEABLE, getCapabilities } from '../../../server/lib/auth/capabilities';
import {
    SYSTEM_TEMPLATES, TEMPLATE_ROLES, resolveTemplate, matchTemplate, systemMatchables, companyMatchables,
    toCompanyTemplate, resolveCompanyTemplate, layerOverrides, diffAgainstRole,
} from '../../../server/lib/auth/permission-templates';

describe('system templates', () => {
    it('every template has a unique key, a role a person can hold, and only known capability keys', () => {
        const keys = new Set<string>();
        for (const t of SYSTEM_TEMPLATES) {
            expect(keys.has(t.key)).toBe(false);
            keys.add(t.key);
            expect(ROLES).toContain(t.baseRole);
            expect(t.baseRole).not.toBe('owner');
            expect(t.baseRole).not.toBe('agent');
            expect(TEMPLATE_ROLES).toContain(t.baseRole);
            for (const k of Object.keys(t.overrides)) expect(TOGGLEABLE as readonly string[]).toContain(k);
        }
    });

    it('no two templates resolve to the same role and capabilities, so a match is unambiguous', () => {
        const seen = new Map<string, string>();
        for (const t of SYSTEM_TEMPLATES) {
            const caps = getCapabilities(t.baseRole, t.overrides);
            const sig = `${t.baseRole}:${TOGGLEABLE.map((c) => (caps[c] ? 1 : 0)).join('')}`;
            expect(seen.get(sig), `${t.key} duplicates ${seen.get(sig)}`).toBeUndefined();
            seen.set(sig, t.key);
        }
    });
});

describe('resolveTemplate', () => {
    it('stamps a sparse diff: a template equal to its role default stamps nothing', () => {
        expect(resolveTemplate('inspector_standard')).toEqual({ role: 'inspector', permissionOverrides: null });
        expect(resolveTemplate('manager_standard')).toEqual({ role: 'manager', permissionOverrides: null });
    });

    it('stamps only the switches that differ from the role', () => {
        const trainee = resolveTemplate('inspector_trainee');
        expect(trainee.role).toBe('inspector');
        expect(trainee.permissionOverrides).toEqual({
            publish: false, templateCreate: false, templateEdit: false, templateImport: false, deleteInspection: false,
        });
        // Restating a default (an inspector already cannot schedule for others) is dropped, not stored.
        expect(resolveTemplate('inspector_assistant').permissionOverrides).not.toHaveProperty('scheduleOthers');
        expect(resolveTemplate('inspector_assistant').permissionOverrides).toMatchObject({ deleteInspection: false });
    });

    it('an unknown key throws', () => {
        expect(() => resolveTemplate('nope')).toThrow(/Unknown/);
    });

    it('a pinned capability in a template is dropped, not stored', () => {
        expect(diffAgainstRole('staff', { publish: true })).toBeNull();
        expect(diffAgainstRole('staff', { publish: true, companyFinance: true })).toEqual({ companyFinance: true });
    });
});

describe('layerOverrides (role defaults, then the template, then the explicit switches)', () => {
    it('explicit switches win over the template', () => {
        const t = resolveTemplate('inspector_trainee').permissionOverrides;
        const out = layerOverrides('inspector', t, { publish: true });
        expect(out).not.toHaveProperty('publish');
        expect(out).toMatchObject({ deleteInspection: false });
    });
    it('with no template and no switches nothing is stored', () => {
        expect(layerOverrides('inspector', null, undefined)).toBeNull();
    });
});

describe('matchTemplate', () => {
    const all = systemMatchables();

    it('finds the exact match', () => {
        const trainee = resolveTemplate('inspector_trainee').permissionOverrides;
        expect(matchTemplate('inspector', trainee, all)?.ref).toBe('inspector_trainee');
        expect(matchTemplate('inspector', null, all)?.ref).toBe('inspector_standard');
    });

    it('does not count which inspections a person sees: it is chosen beside the template', () => {
        const trainee = resolveTemplate('inspector_trainee').permissionOverrides ?? {};
        expect(matchTemplate('inspector', { ...trainee, viewAllInspections: false }, all)?.ref).toBe('inspector_trainee');
        expect(matchTemplate('inspector', { viewAllInspections: false }, all)?.ref).toBe('inspector_standard');
        // Control: any other difference still breaks the match, restricted or not.
        expect(matchTemplate('inspector', { ...trainee, viewAllInspections: false, companyFinance: true }, all)).toBeNull();
    });

    it('is null when one extra switch is changed, and when the role differs', () => {
        const trainee = resolveTemplate('inspector_trainee').permissionOverrides ?? {};
        expect(matchTemplate('inspector', { ...trainee, scheduleOthers: true }, all)).toBeNull();
        expect(matchTemplate('staff', { deleteInspection: true }, all)).toBeNull();
        // The same switches on a different role are a different person.
        expect(matchTemplate('manager', resolveTemplate('inspector_trainee').permissionOverrides, all)).toBeNull();
    });

    it('matches on resolved capabilities, so a stored override that restates a default still matches', () => {
        expect(matchTemplate('inspector', { scheduleOthers: false }, all)?.ref).toBe('inspector_standard');
    });

    it('prefers a company template over an identical system one', () => {
        const company = toCompanyTemplate({ id: 'c1', name: 'Our inspector', baseRole: 'inspector', overrides: {} });
        expect(company).not.toBeNull();
        const found = matchTemplate('inspector', null, [...all, ...companyMatchables([company!])]);
        expect(found).toMatchObject({ ref: 'c1', system: false, name: 'Our inspector' });
    });
});

describe('company template rows', () => {
    it('a key from a newer version is ignored, not fatal', () => {
        const t = toCompanyTemplate({ id: 'c1', name: 'X', baseRole: 'inspector', overrides: { publish: false, someFutureSwitch: true } });
        expect(t?.overrides).toEqual({ publish: false });
        expect(resolveCompanyTemplate(t!).permissionOverrides).toEqual({ publish: false });
    });

    it('a stored JSON string is read the same as an object', () => {
        const t = toCompanyTemplate({ id: 'c1', name: 'X', baseRole: 'staff', overrides: '{"companyFinance":true}' });
        expect(t?.overrides).toEqual({ companyFinance: true });
    });

    it('a base role that is no longer allowed yields null so the list can skip it', () => {
        expect(toCompanyTemplate({ id: 'c1', name: 'X', baseRole: 'owner', overrides: {} })).toBeNull();
        expect(toCompanyTemplate({ id: 'c1', name: 'X', baseRole: 'agent', overrides: {} })).toBeNull();
    });
});
