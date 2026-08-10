import { test, expect, type Page } from '@playwright/test';

/**
 * What a public-page visitor pays for the timezone table (#99).
 *
 * ── Why this is a harness and not a gate ──
 * It asserts only that its own instrument works. There are no ms thresholds: a
 * wall-clock budget on a shared box is a coin flip, and a flaky perf gate gets
 * disabled, which is worse than not having one. What it produces is a table of
 * numbers, printed, for a human to decide against.
 *
 * ── What is actually being paid, and by whom ──
 * `app/lib/timezones.ts` builds `TIMEZONE_SELECT_OPTIONS` at MODULE SCOPE.
 * `verify.tsx` imports `ViewerTimeZoneNotice` statically, so the module sits in
 * that route's client chunk graph and is evaluated during hydration by EVERY
 * visitor — including one whose envelope id is bogus, where the notice never
 * renders at all (verify.tsx returns early on `!result`, and the notice is
 * additionally behind `signers.some(s => s.signedAt)`).
 *
 * Two separate costs, with different populations:
 *
 *   A. module evaluation       — paid by everyone who loads the page
 *   B. 419 <option> DOM nodes  — paid only when the notice really renders
 *
 * A is the one worth measuring first, and it needs no seeded data.
 *
 * ── The confound this harness exists to resolve ──
 * The shipping implementation computes each zone's offset TWICE: once in the
 * `.map` feeding the sort, then again inside `timeZoneLabel` (the sorted offset
 * is destructured away). That is 2×419 `Intl.DateTimeFormat` + `formatToParts`
 * constructions where 419 would do.
 *
 * It does NOT follow that de-duplicating halves the cost. ICU timezone data is
 * initialised lazily and cached per process, so a second call for a zone can be
 * far cheaper than the first — the same effect measured on the server, where
 * ~15ms of a ~48ms module init was one-time ICU setup no code change removes.
 * The `two` vs `one` pair measures the real saving instead of assuming it, and
 * the ICU columns say whether the numbers are cold or warm.
 *
 * ── Throttling ──
 * `Emulation.setCPUThrottlingRate` is what Lighthouse's mobile preset uses. It
 * scales main-thread execution and models nothing else — no memory pressure, no
 * weaker GPU, no thermal behaviour. For this question that is acceptable,
 * because the work IS main-thread JS plus DOM construction. It is still not a
 * real device: read 6× as "a slow phone's main thread", not as a Galaxy A15.
 *
 * Run: TZ_PERF=1 npx playwright test --project=timezone-perf
 */

/** 1 = unthrottled. 4 = Lighthouse's mobile preset. 6 = a slow Android main thread. */
const RATES = [1, 4, 6] as const;

/** Repeats per measurement; the median is reported. */
const REPS = 5;

const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const round = (n: number) => Math.round(n * 100) / 100;

async function throttle(page: Page, rate: number) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

/**
 * Builds the option table in-page, mirroring app/lib/timezones.ts.
 *
 * Passed to `page.evaluate`, which serialises the function itself — so it must
 * close over nothing. `variant: 'two'` reproduces what ships today; `'one'`
 * threads the already-known offset into the label. Everything else is
 * identical, so the difference between them is the duplicate work and nothing
 * else.
 */
function buildTable({ variant, reps }: { variant: 'one' | 'two'; reps: number }) {
    const offsetMinutes = (tz: string): number => {
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: tz,
                timeZoneName: 'longOffset',
            }).formatToParts(new Date());
            const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
            const m = /GMT([+-])(\d{2}):(\d{2})/.exec(raw);
            if (!m) return 0;
            return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
        } catch {
            return 0;
        }
    };
    const fmt = (min: number): string => {
        const sign = min < 0 ? '-' : '+';
        const abs = Math.abs(min);
        const hh = String(Math.floor(abs / 60)).padStart(2, '0');
        const mm = String(abs % 60).padStart(2, '0');
        return `UTC${sign}${hh}:${mm}`;
    };

    const supported =
        (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
            .supportedValuesOf?.('timeZone') ?? [];
    const ids = supported.includes('UTC') ? supported : ['UTC', ...supported];

    const samples: number[] = [];
    let built = 0;
    for (let i = 0; i < reps; i++) {
        const t0 = performance.now();
        const sorted = ids
            .map((tz) => ({ tz, offset: offsetMinutes(tz) }))
            .sort((a, b) => a.offset - b.offset || a.tz.localeCompare(b.tz));
        const table =
            variant === 'two'
                ? sorted.map(({ tz }) => ({
                      value: tz,
                      // the shipping shape: offset recomputed here
                      label: `(${fmt(offsetMinutes(tz))}) ${tz.replace(/_/g, ' ')}`,
                  }))
                : sorted.map(({ tz, offset }) => ({
                      value: tz,
                      label: `(${fmt(offset)}) ${tz.replace(/_/g, ' ')}`,
                  }));
        samples.push(performance.now() - t0);
        built = table.length;
    }
    return { samples, built };
}

/** Cost of putting the option nodes in the document (cost B). */
function mountOptions({ count, reps }: { count: number; reps: number }) {
    const samples: number[] = [];
    for (let i = 0; i < reps; i++) {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const sel = document.createElement('select');
        const t0 = performance.now();
        for (let j = 0; j < count; j++) {
            const o = document.createElement('option');
            o.value = `z${j}`;
            o.textContent = `(UTC+00:00) Zone ${j}`;
            sel.appendChild(o);
        }
        host.appendChild(sel);
        // Force layout so the measurement includes work the browser would defer.
        void sel.offsetHeight;
        samples.push(performance.now() - t0);
        host.remove();
    }
    return samples;
}

/** Is ICU timezone data cold or warm in this renderer? */
function icuFirstVsSecond() {
    const one = (tz: string) => {
        const t0 = performance.now();
        new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
            .formatToParts(new Date());
        return performance.now() - t0;
    };
    // A zone nothing else on this page is likely to have touched.
    const first = one('Indian/Kerguelen');
    const second = one('Indian/Kerguelen');
    return { first, second };
}

type Row = {
    rate: number;
    coldTwo: number;
    two: number;
    one: number;
    savedPctA: number;
    savedPctB: number;
    mountMs: number;
    icu1: number;
    icu2: number;
    built: number;
};

const rows: Row[] = [];

test.describe('timezone table — what a public visitor pays', () => {
    test.describe.configure({ mode: 'serial' });

    for (const rate of RATES) {
        test(`isolated build + option mount @ CPU ${rate}x`, async ({ page }) => {
            // The whole point is to run slowly: four build sequences x REPS at 6x
            // is ~20 throttled passes, which blew the 30s default and took the
            // /verify measurement down with it (the run reported a FAILURE, not a
            // slow success — but a shorter REPS would have reported a fast, quiet,
            // wrong one). Scale the budget with the throttle instead of trimming
            // the samples.
            test.setTimeout(60_000 + rate * 40_000);
            await throttle(page, rate);
            // about:blank on purpose: no app code, so nothing has warmed ICU or
            // built a formatter before the first sample.
            await page.goto('about:blank');

            const icu = await page.evaluate(icuFirstVsSecond);

            // ── Sequence A: two first, then one ──
            // Whichever variant runs SECOND inherits a warm ICU cache and a
            // warmed JIT, so a single fixed order silently credits it with a
            // saving it did not earn. The first run of this harness reported
            // "saved 35ms" against a one-pass total of 25.4ms — arithmetically
            // impossible for 419 extra calls, and the tell that order was doing
            // the work. So the order is run BOTH ways and both answers printed.
            // They bracket the truth; if they disagree wildly, neither is usable.
            const twoA = await page.evaluate(buildTable, { variant: 'two' as const, reps: REPS });
            const oneA = await page.evaluate(buildTable, { variant: 'one' as const, reps: REPS });
            // ── Sequence B: one first, then two (everything already warm) ──
            const oneB = await page.evaluate(buildTable, { variant: 'one' as const, reps: REPS });
            const twoB = await page.evaluate(buildTable, { variant: 'two' as const, reps: REPS });

            const mount = await page.evaluate(mountOptions, { count: twoA.built, reps: REPS });

            const twoMsA = median(twoA.samples);
            const oneMsA = median(oneA.samples);
            const twoMsB = median(twoB.samples);
            const oneMsB = median(oneB.samples);
            rows.push({
                rate,
                // The very first pass of the very first variant: nothing is warm
                // yet, which is the state hydration actually arrives in.
                coldTwo: round(twoA.samples[0]),
                two: round((twoMsA + twoMsB) / 2),
                one: round((oneMsA + oneMsB) / 2),
                savedPctA: round(((twoMsA - oneMsA) / twoMsA) * 100),
                savedPctB: round(((twoMsB - oneMsB) / twoMsB) * 100),
                mountMs: round(median(mount)),
                icu1: round(icu.first),
                icu2: round(icu.second),
                built: twoA.built,
            });

            const two = twoA;
            const one = oneA;
            const twoMs = twoMsA;

            // Instrument sanity, NOT a performance budget:
            expect(two.built, 'built no options — Intl.supportedValuesOf returned nothing')
                .toBeGreaterThan(300);
            expect(one.built, 'the two variants built different lists — not comparable')
                .toBe(two.built);
            expect(twoMs, 'measured 0ms — the clock or the loop is doing nothing')
                .toBeGreaterThan(0);
        });
    }

    test('long tasks during a real /verify hydration @ CPU 6x', async ({ page }) => {
        await throttle(page, 6);
        await page.addInitScript(() => {
            (window as unknown as { __lt: number[] }).__lt = [];
            new PerformanceObserver((l) => {
                for (const e of l.getEntries()) {
                    (window as unknown as { __lt: number[] }).__lt.push(e.duration);
                }
            }).observe({ type: 'longtask', buffered: true });
        });

        // A bogus envelope id on purpose: this is the population the module cost
        // is unconditional for. The page renders "verification failed", the
        // notice never mounts, and the table is built during hydration anyway.
        await page.goto('/verify/no-such-envelope-99', { waitUntil: 'load' });
        await page.waitForLoadState('networkidle');

        const lt = await page.evaluate(() => (window as unknown as { __lt: number[] }).__lt);
        const total = lt.reduce((a, b) => a + b, 0);
        console.log(
            `\n/verify (bogus id — notice NOT rendered) @ 6x: ${lt.length} long task(s), ` +
                `total ${round(total)}ms, longest ${round(Math.max(0, ...lt))}ms`,
        );

        // Sanity only: the observer must have been installed before load.
        expect(Array.isArray(lt), 'the long-task observer never ran').toBe(true);
    });

    test.afterAll(() => {
        if (!rows.length) return;
        const head =
            'rate | COLD 1st pass | warm 2/zone | warm 1/zone | saved% A | saved% B | mount opts | ICU 1st | ICU 2nd';
        const body = rows
            .map(
                (r) =>
                    `${r.rate}x`.padEnd(4) +
                    ` | ${String(r.coldTwo).padStart(13)}` +
                    ` | ${String(r.two).padStart(11)}` +
                    ` | ${String(r.one).padStart(11)}` +
                    ` | ${String(r.savedPctA).padStart(8)}` +
                    ` | ${String(r.savedPctB).padStart(8)}` +
                    ` | ${String(r.mountMs).padStart(10)}` +
                    ` | ${String(r.icu1).padStart(7)}` +
                    ` | ${String(r.icu2).padStart(7)}`,
            )
            .join('\n');
        console.log(
            `\ntimezone table cost — ${rows[0].built} zones, all ms\n${head}\n${body}\n\n` +
                `COLD 1st pass is the number hydration pays: nothing is warm when the page\n` +
                `boots. The warm columns are medians of ${REPS} and are what a second visit\n` +
                `in the same renderer would see — they UNDERSTATE the real cost.\n\n` +
                `saved% A ran two-first, saved% B ran one-first. Whichever variant goes\n` +
                `second inherits a warm ICU cache and a warmed JIT, so a single order\n` +
                `credits it with a saving it did not earn. Trust the pair only if the two\n` +
                `columns are close; if they diverge, the ordering is the measurement.\n\n` +
                `ICU 1st vs 2nd shows how steep that warm-up is for one zone.\n` +
                `CPU throttling models the main thread only — this is not a real device.\n`,
        );
    });
});
