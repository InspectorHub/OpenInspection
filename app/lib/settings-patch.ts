// Sanitize the settings-sheet form payload before it hits the BFF relay
// (PATCH /api/inspections/:id → UpdateInspectionSchema). The sheet renders
// HTML inputs that emit '' for "unchanged/unset", and an <input type=date>
// emits a bare YYYY-MM-DD — but the schema wants `date` as a full ISO
// datetime, `price` as a number, and treats omitted optional keys as "leave
// untouched". This pure helper bridges the two so a partial save validates.

type SettingsPatchInput = Record<string, unknown>;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function sanitizeSettingsPatch(form: SettingsPatchInput): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(form)) {
        // 1. Empty string = "unchanged/unset" — omit so the schema leaves it alone.
        if (value === '') continue;

        // 2. date-only → ISO datetime (local 9 AM convention used in the wizard).
        if (key === 'date' && typeof value === 'string' && DATE_ONLY.test(value)) {
            out[key] = new Date(value + 'T09:00:00').toISOString();
            continue;
        }

        // 3. price → number; drop if it doesn't parse.
        if (key === 'price') {
            const n = Number(value);
            if (Number.isNaN(n)) continue;
            out[key] = n;
            continue;
        }

        // 4 & 5. Booleans and everything else pass through unchanged.
        out[key] = value;
    }

    return out;
}
