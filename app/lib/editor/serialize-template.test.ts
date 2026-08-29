/**
 * The editor's save serializer builds each item key-by-key. A key it does not
 * name is not sent -- which is how `number` was quietly lost on every save.
 * This spec pins parentId to the wire before it can join it.
 */
import { describe, it, expect } from 'vitest';
import { serializeItemForSave } from './serialize-template';

describe('serializeItemForSave', () => {
    it('sends parentId when the item is nested', () => {
        const out = serializeItemForSave({
            id: 'a1', label: 'Fully adhered', type: 'boolean', parentId: 'a',
        });
        expect(out.parentId).toBe('a');
    });

    it('sends an explicit null when the item was un-nested', () => {
        // Omitting the key on un-nest would leave the stored document's old
        // parentId in place: the author drags an item out, saves, reloads, and
        // it is nested again with nothing to explain why.
        expect(serializeItemForSave({ id: 'a', label: 'A', type: 'boolean', parentId: null }).parentId)
            .toBe(null);
    });

    it('omits the key entirely on a template that never nested anything', () => {
        // Positive control, and it protects every stored flat template from
        // growing a key on its next save.
        expect('parentId' in serializeItemForSave({ id: 'a', label: 'A', type: 'boolean' }))
            .toBe(false);
    });

    it('sends the author-written number, which used to be dropped', () => {
        // Not new work -- it is the bug the parity gate found. Fixing it here
        // is what turns lint:item-key-parity green for this mirror.
        expect(serializeItemForSave({ id: 'a', label: 'A', type: 'boolean', number: '3.2' }).number)
            .toBe('3.2');
    });

    it('still omits a key the item does not carry', () => {
        // Positive control for the two "sends it" tests: a serializer that
        // emitted every key unconditionally would pass them and would send
        // `number: undefined` on every item in every template.
        const out = serializeItemForSave({ id: 'a', label: 'A', type: 'boolean' });
        expect('number' in out).toBe(false);
        expect('icon' in out).toBe(false);
    });
});
