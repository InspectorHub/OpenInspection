/**
 * `<input type="datetime-local">` ⇄ ISO conversions.
 *
 * The control speaks `YYYY-MM-DDTHH:mm` with no zone and means "wall clock time
 * in the browser's zone"; the API stores a full ISO instant. `new Date(iso)
 * .toISOString().slice(0,16)` is the tempting one-liner and it is wrong — that
 * renders the UTC wall clock, so an inspector west of Greenwich opens the field
 * and sees a time nobody scheduled.
 *
 * NOTE: these deliberately use the BROWSER's zone, not the tenant display zone.
 * A native datetime-local picker has no zone control and always submits browser
 * wall-clock, so reading it back in any other zone is what creates an
 * off-by-hours. The card's read-only line still renders in the tenant zone,
 * which is the surface the tz gate covers.
 */

/** ISO instant → the `YYYY-MM-DDTHH:mm` the control wants. `''` for no date. */
export function toLocalInputValue(iso: string | null | undefined): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `YYYY-MM-DDTHH:mm` (browser wall clock) → ISO instant. `''` for unparseable input. */
export function fromLocalInputValue(local: string): string {
    if (!local) return "";
    const d = new Date(local);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
