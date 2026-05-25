// Spec 3A — Cancel inspection modal. Mounted ONCE per page (e.g. on dashboard).
// Listens for 'open-cancel-modal' event with { id }. POSTs to /api/inspections/:id/cancel.

import { Modal, ModalFooter } from './modal';

export const CancelModal = () => (
    <div x-data="cancelModalFactory()" x-cloak>
        <Modal
            name="open"
            title="Cancel inspection"
            size="md"
            footer={
                <ModalFooter
                    cancelText="Back"
                    onCancel="open = false"
                    onConfirm="submit()"
                    confirmDisabled="busy"
                    confirmTextExpr="busy ? 'Cancelling...' : 'Cancel inspection'"
                    danger={true}
                />
            }
        >
            <div class="space-y-3">
                <div>
                    <label class="block text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">Reason</label>
                    <select x-model="reason" class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm">
                        <option value="client_cancelled">Client cancelled</option>
                        <option value="weather">Weather</option>
                        <option value="inspector_unavailable">Inspector unavailable</option>
                        <option value="property_unavailable">Property unavailable</option>
                        <option value="rescheduled">Rescheduled</option>
                        <option value="other">Other</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">Notes (optional)</label>
                    <textarea x-model="notes" rows={3} maxlength={500} placeholder="Optional details..."
                              class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"></textarea>
                </div>
            </div>
        </Modal>
        <script dangerouslySetInnerHTML={{ __html: `
            function cancelModalFactory() {
                return {
                    open: false, busy: false, currentId: null,
                    reason: 'client_cancelled', notes: '',
                    init() {
                        window.addEventListener('open-cancel-modal', (e) => {
                            this.currentId = e.detail.id;
                            this.reason = 'client_cancelled';
                            this.notes = '';
                            this.open = true;
                        });
                    },
                    async submit() {
                        if (!this.currentId) return;
                        this.busy = true;
                        try {
                            const res = await fetch('/api/inspections/' + this.currentId + '/cancel', {
                                method: 'POST', credentials: 'include',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ reason: this.reason, notes: this.notes || undefined }),
                            });
                            if (!res.ok) {
                                const err = await res.json().catch(() => ({}));
                                throw new Error(err?.error?.message || ('HTTP ' + res.status));
                            }
                            this.open = false;
                            if (typeof window.showToast === 'function') window.showToast('Inspection cancelled');
                            window.dispatchEvent(new CustomEvent('inspection-updated', { detail: { id: this.currentId } }));
                        } catch (e) {
                            if (typeof window.showToast === 'function') window.showToast('Cancel failed: ' + e.message, true);
                        } finally {
                            this.busy = false;
                        }
                    },
                };
            }
        `}} />
    </div>
);
