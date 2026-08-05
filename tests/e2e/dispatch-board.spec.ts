/**
 * Dispatch board — drag to assign, and the block-policy refusal (Phase C, Task 7).
 *
 * These are the two gestures the board exists for, and neither is reachable from
 * a component test: a drop is only a TIME because of where the pointer was
 * relative to a real laid-out axis, and the block policy is a server 409 that
 * has to travel back through the route action into the modal.
 *
 * Two things about how this is driven are deliberate:
 *
 *   - The drag goes through `helpers/html5-drag`, not `dragTo()`. The board is
 *     HTML5 DnD and reads the card id off `dataTransfer`; Playwright's
 *     mouse-based drag emits pointer events only, so `dragstart`/`drop` never
 *     fire and the card sits still.
 *   - Both drops in the conflict test use the SAME `offsetY`. The instant is
 *     whatever the board's own geometry makes of that pixel, so the two land on
 *     the same minute by construction rather than by arithmetic repeated here.
 *
 * Outcomes are asserted against the API, not only the DOM: the board re-renders
 * from a revalidated loader, so "the card moved" and "the schedule was written"
 * are different claims and only the second one matters.
 *
 * Auth mirrors collab-editing / inspector-portal: a self-issued CSRF
 * double-submit pair on login, then the captured `__Host-inspector_token`
 * replayed as a Bearer for API calls and as a cookie header for navigation.
 * Depends on the `api` project for the seeded admin@autotest.com workspace.
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { makeCsrfToken } from './helpers/csrf';
import { dragEnd, dragOver, dragStart, html5DragTo } from './helpers/html5-drag';

const BASE_URL = 'http://127.0.0.1:8789';
const NAV_TIMEOUT = 30000;

const ADMIN_EMAIL = 'admin@autotest.com';
const ADMIN_PASSWORD = 'Password123!';

/**
 * 112px below the axis top. The axis starts at 07:00 and an hour is 56px, so
 * this is exactly 09:00 — on the 30-minute booking lattice, hence not moved by
 * the snap. A round number here keeps the failure message readable when the
 * axis geometry changes.
 */
const DROP_OFFSET_Y = 112;

interface DispatchItem {
    id: string;
    kind: string;
    inspectionId?: string;
    userId?: string;
    startTime?: string;
}
interface DispatchBoard {
    date: string;
    conflictPolicy: 'advisory' | 'block';
    slotIntervalMin: number;
    dayStartMs: number;
    inspectors: { id: string; email: string; role: string }[];
    items: DispatchItem[];
    unassigned: DispatchItem[];
}

function jsonHeaders(token?: string) {
    const csrf = makeCsrfToken();
    return {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrf,
        Cookie: `__Host-csrf_token=${csrf}`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

async function login(request: APIRequestContext): Promise<string> {
    const res = await request.post(`${BASE_URL}/api/auth/login`, {
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
        headers: jsonHeaders(),
    });
    expect(res.status(), 'admin login').toBe(200);
    const token = (res.headers()['set-cookie'] ?? '').match(/__Host-inspector_token=([^;]+)/)?.[1];
    expect(token, 'no session cookie returned').toBeTruthy();
    return token!;
}

async function getBoard(request: APIRequestContext, token: string): Promise<DispatchBoard> {
    const res = await request.get(`${BASE_URL}/api/calendar/dispatch`, {
        headers: jsonHeaders(token),
    });
    expect(res.status(), 'GET /api/calendar/dispatch').toBe(200);
    return (await res.json()).data as DispatchBoard;
}

async function createTemplate(request: APIRequestContext, token: string): Promise<string> {
    const res = await request.post(`${BASE_URL}/api/inspections/templates`, {
        data: {
            name: `Dispatch E2E Template ${Date.now()}`,
            schema: {
                schemaVersion: 2,
                sections: [
                    {
                        id: 's_general',
                        title: 'General',
                        items: [
                            {
                                id: 'roof',
                                label: 'Roof',
                                type: 'rich',
                                ratingOptions: ['Inspected'],
                                tabs: { information: [], limitations: [], defects: [] },
                            },
                        ],
                    },
                ],
            },
        },
        headers: jsonHeaders(token),
    });
    expect(res.status(), 'create template').toBe(201);
    return (await res.json()).data.template.id as string;
}

/**
 * An inspection parked on the board's day with nobody on it.
 *
 * The instant is set through the schedule endpoint rather than the create call
 * so the civil date is derived from the epoch in the TENANT timezone — the same
 * derivation the board itself uses. Passing a date string here instead would put
 * the row on the board's neighbour whenever the runner's zone disagrees.
 */
async function seedUnassigned(
    request: APIRequestContext,
    token: string,
    board: DispatchBoard,
    templateId: string,
    address: string,
): Promise<string> {
    const created = await request.post(`${BASE_URL}/api/inspections`, {
        data: { propertyAddress: address, clientName: 'Dispatch Client', templateId },
        headers: jsonHeaders(token),
    });
    expect(created.status(), `create inspection (${address})`).toBe(201);
    const id = (await created.json()).data.inspection.id as string;

    const scheduled = await request.patch(`${BASE_URL}/api/inspections/${id}/schedule`, {
        data: { scheduledStartMs: board.dayStartMs + 8 * 60 * 60 * 1000, leadInspectorId: null },
        headers: jsonHeaders(token),
    });
    expect(scheduled.status(), `park inspection (${address}) unassigned`).toBe(200);
    return id;
}

async function setConflictPolicy(
    request: APIRequestContext,
    token: string,
    policy: 'advisory' | 'block',
): Promise<void> {
    const res = await request.patch(`${BASE_URL}/api/admin/tenant-config`, {
        data: { bookingConflictPolicy: policy },
        headers: jsonHeaders(token),
    });
    expect(res.status(), `set conflict policy ${policy}`).toBe(200);
}

async function openBoard(page: Page, token: string): Promise<void> {
    await page.setExtraHTTPHeaders({ Cookie: `__Host-inspector_token=${token}` });
    await page.goto(`${BASE_URL}/calendar/dispatch`, {
        timeout: NAV_TIMEOUT,
        waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('dispatch-unassigned-lane')).toBeVisible();
}

const laneCard = (page: Page, inspectionId: string) =>
    page.locator(`[data-testid="dispatch-unassigned-lane"] [data-inspection-id="${inspectionId}"]`);

const columnAxis = (page: Page, inspectorId: string) =>
    page.locator(`[data-dispatch-dropzone="${inspectorId}"]`);

/**
 * Wait until the board's drag handlers are actually attached, and return the
 * minute the board maps `DROP_OFFSET_Y` to.
 *
 * The lane and the columns are SERVER-RENDERED, so they are visible — and inert
 * — before React hydrates. A drop dispatched into that window lands on nothing,
 * silently, and the spec reads as "the board ignored the gesture". Waiting on
 * visibility does not help because visibility is exactly what is already true.
 *
 * The probe is the board's own hover indicator: it renders only from state that
 * `dragstart` sets and `dragover` reads, so its appearance is proof that both
 * handlers are live. It is also worth asserting in its own right — a dispatcher
 * has to see where the card will land before letting go.
 */
async function awaitDropIndicator(
    page: Page,
    inspectionId: string,
    inspectorId: string,
): Promise<number> {
    const card = laneCard(page, inspectionId);
    const axis = columnAxis(page, inspectorId);
    await expect(card, 'the inspection should be in the unassigned lane').toBeVisible();

    const box = await axis.boundingBox();
    if (!box) throw new Error('dispatch column has no bounding box');
    const point = { clientX: box.x + box.width / 2, clientY: box.y + DROP_OFFSET_Y };
    const indicator = page.getByTestId('dispatch-drop-indicator');

    for (let attempt = 0; attempt < 40; attempt++) {
        await dragStart(card);
        await dragOver(axis, point);
        if ((await indicator.count()) > 0) {
            const minute = Number(await indicator.first().getAttribute('data-drop-minute'));
            await dragEnd(card);
            return minute;
        }
        await dragEnd(card);
        await page.waitForTimeout(250);
    }
    throw new Error('dispatch board never became interactive — no drop indicator after dragover');
}

/** The item the board reports for an inspection, wherever it currently sits. */
function itemFor(board: DispatchBoard, inspectionId: string): DispatchItem | undefined {
    return board.items.find((i) => i.inspectionId === inspectionId);
}

let token = '';
let templateId = '';

test.describe.serial('Dispatch board — drag to assign (Phase C)', () => {
    test.beforeAll(async ({ request }) => {
        token = await login(request);
        templateId = await createTemplate(request, token);
    });

    test('owner drags an unassigned inspection onto an inspector column and it is assigned', async ({
        page,
        request,
    }) => {
        await setConflictPolicy(request, token, 'advisory');
        const board = await getBoard(request, token);
        const inspector = board.inspectors[0];
        expect(inspector, 'dispatch roster is empty — the api project seeds owner + inspector').toBeTruthy();

        const inspectionId = await seedUnassigned(
            request,
            token,
            board,
            templateId,
            '10 Dispatch Drop Way',
        );

        await openBoard(page, token);
        const minute = await awaitDropIndicator(page, inspectionId, inspector.id);
        expect(minute, 'the board should preview 09:00 for this pixel').toBe(9 * 60);

        await html5DragTo(
            page,
            laneCard(page, inspectionId),
            columnAxis(page, inspector.id),
            DROP_OFFSET_Y,
        );

        // The card leaves the lane once the loader revalidates…
        await expect(laneCard(page, inspectionId)).toHaveCount(0, { timeout: 15000 });

        // …but the claim that matters is the written schedule, not the render.
        const after = await getBoard(request, token);
        expect(after.unassigned.map((i) => i.inspectionId)).not.toContain(inspectionId);
        const moved = itemFor(after, inspectionId);
        expect(moved?.userId, 'the drop should assign the column owner').toBe(inspector.id);
        expect(moved?.startTime, 'the drop pixel should become 09:00 on the axis').toBe('09:00');
    });

    test('a blocked conflict shows the modal and leaves the inspection where it was', async ({
        page,
        request,
    }) => {
        await setConflictPolicy(request, token, 'advisory');
        const board = await getBoard(request, token);
        const inspector = board.inspectors[0];

        // Occupant first, placed with the SAME gesture at the SAME pixel, so the
        // two starts are equal by construction rather than by arithmetic here.
        const occupantId = await seedUnassigned(request, token, board, templateId, '20 Occupied Ct');
        await openBoard(page, token);
        await awaitDropIndicator(page, occupantId, inspector.id);
        await html5DragTo(
            page,
            laneCard(page, occupantId),
            columnAxis(page, inspector.id),
            DROP_OFFSET_Y,
        );
        await expect(laneCard(page, occupantId)).toHaveCount(0, { timeout: 15000 });

        // Now the tenant refuses double-booking, and a second job wants the slot.
        await setConflictPolicy(request, token, 'block');
        const intruderId = await seedUnassigned(request, token, board, templateId, '21 Refused Ln');

        await openBoard(page, token);
        await expect(page.getByText(/block/i).first()).toBeVisible();
        await awaitDropIndicator(page, intruderId, inspector.id);
        await html5DragTo(
            page,
            laneCard(page, intruderId),
            columnAxis(page, inspector.id),
            DROP_OFFSET_Y,
        );

        const modal = page.getByRole('dialog');
        await expect(modal, 'a refused drop must say so, not fail silently').toBeVisible({
            timeout: 15000,
        });

        // And the refusal has to be real: the intruder is still unassigned.
        const after = await getBoard(request, token);
        expect(after.unassigned.map((i) => i.inspectionId)).toContain(intruderId);
        expect(itemFor(after, intruderId)?.userId ?? null).toBeNull();
    });

    test.afterAll(async ({ request }) => {
        if (token) await setConflictPolicy(request, token, 'advisory');
    });
});
