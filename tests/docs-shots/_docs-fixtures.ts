/**
 * Fixtures the CAPTURE run needs and the shared seed deliberately does not have.
 *
 * `tests/seed-fixtures.ts` creates inspections with `template_id` NULL — its
 * comment says so in as many words, because the specs that use it exercise the
 * editor's no-template fallback. The user guide documents the opposite path:
 * the wizard refuses to leave its first step without a template, so a capture
 * run against that seed alone photographs a form nobody can advance. (The first
 * committed version of `create-an-inspection.shots.ts` did exactly that, and
 * could never have produced its pictures.)
 *
 * So the captures create what they need, THROUGH THE API, and only what the
 * pictures require. Not through the seed: adding a template there would change
 * the fixture every E2E spec shares, to serve a documentation build.
 *
 * Everything created here is plainly fictional and lives on the fixture tenant.
 * The screenshots are of the product, not of the data — but the data is what a
 * reader sees, so it has to look like a real inspection rather than like
 * "test test test".
 */
import type { Page } from '@playwright/test';
import { apiGet, apiPost, authedWriteHeaders } from '../e2e/helpers/seed-login';

/** A small, plausible residential template — one section, two rated items. */
export const DOCS_TEMPLATE = {
    name: 'Residential Inspection',
    schema: {
        schemaVersion: 2 as const,
        sections: [
            {
                id: 'exterior',
                title: 'Exterior',
                items: [
                    {
                        id: 'roof',
                        label: 'Roof covering',
                        type: 'rich' as const,
                        ratingOptions: ['Satisfactory', 'Monitor', 'Defect'],
                        tabs: {
                            information: [
                                { id: 'roof-info-1', title: 'Asphalt shingle', comment: 'Asphalt shingle roof covering, viewed from ground level.', default: true },
                            ],
                            limitations: [
                                { id: 'roof-lim-1', title: 'Not walked', comment: 'The roof was not walked; it was inspected from the ground with binoculars.', default: false },
                            ],
                            defects: [
                                {
                                    id: 'roof-def-1',
                                    title: 'Damaged shingles',
                                    category: 'recommendation' as const,
                                    location: 'South slope',
                                    comment: 'Damaged shingles were observed on the {{location}}. Recommend evaluation by a {{trade}}.',
                                    photos: [],
                                    // INCLUDED BY DEFAULT, so the publish check
                                    // has something real to refuse on: the
                                    // comment still carries an unfilled
                                    // {{trade}}, which is the one condition that
                                    // blocks in every workspace. Without it the
                                    // readiness picture shows a clean dialog
                                    // while its caption promises a list of
                                    // blockers.
                                    default: true,
                                },
                            ],
                        },
                    },
                    {
                        id: 'gutters',
                        label: 'Gutters and downspouts',
                        type: 'rich' as const,
                        ratingOptions: ['Satisfactory', 'Monitor', 'Defect'],
                        tabs: { information: [], limitations: [], defects: [] },
                    },
                ],
            },
        ],
    },
};

/**
 * Ensure the fixture tenant has a template, and return its id.
 *
 * Idempotent by NAME rather than by id: the capture run re-runs against a
 * database the seed has just emptied, but it also has to survive a re-run
 * against one it has not — and creating a second "Residential Inspection" every
 * time would put a growing list in the picture of the template picker.
 */
export async function ensureDocsTemplate(page: Page): Promise<string> {
    const listed = await apiGet(page, '/api/inspections/templates?page=1&pageSize=100');
    if (listed.ok()) {
        const body = (await listed.json()) as { data?: Array<{ id: string; name: string }> };
        const found = (body.data ?? []).find((t) => t.name === DOCS_TEMPLATE.name);
        if (found) return found.id;
    }
    // The shared `apiPost` pins the response to 200 and this endpoint answers
    // 201 Created, so a successful create fails its assertion. Swallowing that
    // is safe here ONLY because the list below is the real check: if the
    // template is absent afterwards, this throws with a message that says so
    // rather than walking into a wizard that cannot advance.
    await apiPost(page, '/api/inspections/templates', DOCS_TEMPLATE).catch(() => undefined);
    const after = await apiGet(page, '/api/inspections/templates?page=1&pageSize=100');
    const body = (await after.json()) as { data?: Array<{ id: string; name: string }> };
    const created = (body.data ?? []).find((t) => t.name === DOCS_TEMPLATE.name);
    if (!created) throw new Error('docs fixture: template was created but does not list');
    return created.id;
}

/**
 * Ensure the fixture tenant sells something, and return nothing.
 *
 * The wizard is four steps with a service catalogue and THREE without it
 * (`buildWizardSteps` drops Services when the catalogue is empty) — and the
 * guide documents the four-step form, with a picture of the Services step. The
 * shared seed creates no services, so a capture run against it alone walked
 * property → people → confirm and photographed the confirm step under the name
 * `wizard-services`. A picture of the wrong screen is worse than a missing one:
 * it is wrong in a way a reader cannot detect.
 */
export async function ensureDocsService(page: Page, templateId: string): Promise<void> {
    const listed = await apiGet(page, '/api/services');
    if (listed.ok()) {
        const body = (await listed.json()) as { data?: Array<{ name: string }> };
        if ((body.data ?? []).some((s) => s.name === 'Full Home Inspection')) return;
    }
    // 201 Created, which the shared helper's `toBe(200)` rejects — the list
    // below is the real check. See ensureDocsTemplate.
    // templateId is REQUIRED for the public booking page, not decoration: the
    // profile endpoint lists `svcRows.filter(s => s.active && s.templateId)`,
    // so a service with no template is invisible to clients while looking
    // perfectly normal in Settings. The first version of this fixture omitted
    // it and the booking walk stalled on a Services step with nothing to tick.
    await apiPost(page, '/api/services', {
        name: 'Full Home Inspection',
        price: 45000,
        durationMinutes: 180,
        templateId,
    }).catch(() => undefined);
    const after = await apiGet(page, '/api/services');
    const body = (await after.json()) as { data?: Array<{ name: string }> };
    if (!(body.data ?? []).some((s) => s.name === 'Full Home Inspection')) {
        throw new Error('docs fixture: service was created but does not list');
    }
}

/**
 * Give the fixture tenant a working week, so its public booking page opens.
 *
 * `bookingOpen` is not a setting anybody toggles — the profile endpoint derives
 * it as "does ANY qualified inspector have availability hours" (`bookingOpen =
 * hourIds.length > 0`). The shared seed configures none, so `/book/<tenant>`
 * renders "Online booking isn't open yet".
 *
 * That state is a real screen, and it is NOT the one the client guide is about:
 * a capture run against the bare seed silently produced a picture of the closed
 * page under the name `public-booking`, which would have shipped as the
 * illustration of "your inspector's booking page". A wrong picture is worse
 * than a missing one — a reader cannot tell it is wrong.
 *
 * PUT, not POST: the endpoint replaces the caller's whole week, so this is
 * idempotent by construction and re-running cannot accumulate slots.
 */
export async function ensureDocsAvailability(page: Page): Promise<void> {
    const res = await page.request.put('/api/availability', {
        headers: await authedWriteHeaders(page),
        data: {
            slots: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
                dayOfWeek,
                startTime: '09:00',
                endTime: '17:00',
            })),
        },
    });
    if (!res.ok()) {
        throw new Error(`docs fixture: availability PUT -> ${res.status()} ${await res.text()}`);
    }
}

/**
 * An inspection the staff guides can be photographed against.
 *
 * The seed's own inspections carry `template_id` NULL by design, so the hub
 * shows no report content and the editor renders its fallback — neither is
 * what guides 2, 4 and 5 describe. This one is created WITH the docs template,
 * so the pictures show a report that has a structure to fill in.
 *
 * Idempotent by ADDRESS: re-running must not add a second row to the list the
 * first picture is of.
 */
export async function ensureDocsInspection(page: Page, templateId: string): Promise<string> {
    const address = '1240 Alder Street, Springfield';
    const listed = await apiGet(page, '/api/inspections?page=1&pageSize=100');
    if (listed.ok()) {
        const body = (await listed.json()) as { data?: Array<{ id: string; propertyAddress?: string }> };
        const found = (body.data ?? []).find((i) => i.propertyAddress === address);
        if (found) return found.id;
    }
    await apiPost(page, '/api/inspections', {
        propertyAddress: address,
        clientName: 'Dana Buyer',
        clientEmail: 'dana.buyer@example.com',
        templateId,
    }).catch(() => undefined);
    const after = await apiGet(page, '/api/inspections?page=1&pageSize=100');
    const body = (await after.json()) as { data?: Array<{ id: string; propertyAddress?: string }> };
    const created = (body.data ?? []).find((i) => i.propertyAddress === address);
    if (!created) throw new Error('docs fixture: inspection was created but does not list');
    return created.id;
}

/**
 * Send an agreement on the docs inspection and hand back the SIGNER's own link.
 *
 * The two client-facing signing captures cannot be faked with a URL: each
 * signer holds a distinct token, and the page refuses anything else. So the
 * fixture does what an inspector does — create an agreement, send it, then read
 * back the per-signer link the admin UI's "Copy link" resolves.
 *
 * Returns a root-relative path, because a capture navigates with Playwright's
 * baseURL and an absolute link would pin the picture to whatever host the
 * server happened to stamp.
 */
export async function ensureDocsSignerLink(page: Page, inspectionId: string): Promise<string> {
    const name = 'Standard Inspection Agreement';
    const list = await apiGet(page, '/api/admin/agreements');
    let agreementId: string | undefined;
    if (list.ok()) {
        const body = (await list.json()) as { data?: Array<{ id: string; name: string }> };
        agreementId = (body.data ?? []).find((a) => a.name === name)?.id;
    }
    if (!agreementId) {
        await apiPost(page, '/api/admin/agreements', {
            name,
            content: '<p>This agreement governs the inspection of the property named above.</p>',
        }).catch(() => undefined);
        const after = await apiGet(page, '/api/admin/agreements');
        const body = (await after.json()) as { data?: Array<{ id: string; name: string }> };
        agreementId = (body.data ?? []).find((a) => a.name === name)?.id;
    }
    if (!agreementId) throw new Error('docs fixture: agreement template was not created');

    const sent = await page.request.post('/api/admin/agreements/send', {
        headers: await authedWriteHeaders(page),
        data: {
            agreementId,
            inspectionId,
            clientEmail: 'dana.buyer@example.com',
            clientName: 'Dana Buyer',
        },
    });
    if (!sent.ok()) throw new Error(`docs fixture: agreement send -> ${sent.status()} ${await sent.text()}`);

    // The envelope id comes from the hub aggregate — the same payload the
    // inspection page reads. There is no GET on the inspection's
    // `agreement-requests` path (it is POST-only), which is the kind of thing
    // only a run finds out.
    const hub = await apiGet(page, `/api/inspections/${inspectionId}/hub`);
    const hubBody = (await hub.json()) as { data?: { agreementRequests?: Array<{ id: string }> } };
    const requestId = (hubBody.data?.agreementRequests ?? [])[0]?.id;
    if (!requestId) throw new Error('docs fixture: no agreement request after send');

    const signers = await apiGet(page, `/api/admin/agreements/requests/${requestId}/signers`);
    const sBody = (await signers.json()) as { data?: Array<{ id: string }> };
    const signerId = (sBody.data ?? [])[0]?.id;
    if (!signerId) throw new Error('docs fixture: envelope has no signer');

    const link = await apiGet(page, `/api/admin/agreements/requests/${requestId}/signers/${signerId}/link`);
    const lBody = (await link.json()) as { data?: { url?: string } };
    const url = lBody.data?.url;
    if (!url) throw new Error('docs fixture: signer link endpoint returned no url');
    return new URL(url, 'http://127.0.0.1').pathname + new URL(url, 'http://127.0.0.1').search;
}
