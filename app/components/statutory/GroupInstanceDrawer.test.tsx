// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GroupInstanceDrawer } from '~/components/statutory/GroupInstanceDrawer';
import type { EditorGroup } from '~/lib/editor/statutory-groups';

const GROUP: EditorGroup = {
    id: 'electrical_panel',
    label: 'Electrical Panel',
    capacity: 2,
    overflowTo: 'additional_comments',
    slots: [
        { index: 0, label: 'Main Panel', fields: { type: 'a', total_amps: 'b' } },
        { index: 1, label: 'Second Panel', fields: { type: 'c', total_amps: 'd' } },
    ],
};

describe('GroupInstanceDrawer', () => {
    it('offers one field per field the group declares', () => {
        render(<GroupInstanceDrawer open group={GROUP} index={2} onClose={vi.fn()} onSave={vi.fn()} />);
        expect(screen.getByLabelText(/type/i)).toBeTruthy();
        expect(screen.getByLabelText(/total amps/i)).toBeTruthy();
    });

    it('says where this instance will end up, before anything is typed', () => {
        // The inspector must learn at the moment he adds it that the form has
        // no box for it -- not when he presses send, three houses later.
        render(<GroupInstanceDrawer open group={GROUP} index={2} onClose={vi.fn()} onSave={vi.fn()} />);
        const body = document.body.textContent ?? '';
        expect(body).toMatch(/2/);                       // how many the form prints
        expect(body).toMatch(/additional comments/i);    // where this one goes
    });

    it('hands back what was typed, keyed by the group field names', () => {
        const onSave = vi.fn();
        render(<GroupInstanceDrawer open group={GROUP} index={2} onClose={vi.fn()} onSave={onSave} />);
        fireEvent.change(screen.getByLabelText(/total amps/i), { target: { value: '60' } });
        fireEvent.click(screen.getByRole('button', { name: /save|record/i }));
        expect(onSave).toHaveBeenCalledWith({ total_amps: '60' });
    });

    it('does not send fields left empty', () => {
        // An empty box is not an answer of "", it is an answer nobody gave.
        const onSave = vi.fn();
        render(<GroupInstanceDrawer open group={GROUP} index={2} onClose={vi.fn()} onSave={onSave} />);
        fireEvent.click(screen.getByRole('button', { name: /save|record/i }));
        expect(onSave).toHaveBeenCalledWith({});
    });

    it('titles itself with the position, counting the way a person would', () => {
        // Index 2 is the third panel. "Panel 2" would be a different panel.
        render(<GroupInstanceDrawer open group={GROUP} index={2} onClose={vi.fn()} onSave={vi.fn()} />);
        expect(document.body.textContent).toMatch(/Electrical Panel 3/);
    });
});
