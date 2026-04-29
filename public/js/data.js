document.addEventListener('alpine:init', () => {
    Alpine.data('dataExport', () => ({
        importing: false,
        importResult: null,
        importError: '',

        downloadExport(type) {
            const a = document.createElement('a');
            a.href = `/api/data/export/${type}`;
            a.download = '';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        },

        async importContacts(event) {
            const file = event.target.files?.[0];
            if (!file) return;
            this.importing = true;
            this.importResult = null;
            this.importError = '';
            try {
                const form = new FormData();
                form.append('file', file);
                const res = await authFetch('/api/data/import/contacts', { method: 'POST', body: form });
                const json = await res.json();
                if (res.ok && json.success) {
                    this.importResult = json.data;
                } else {
                    this.importError = json.error?.message || 'Import failed';
                }
            } catch (e) {
                this.importError = 'Network error during import';
            } finally {
                this.importing = false;
                event.target.value = '';
            }
        },
    }));
});
