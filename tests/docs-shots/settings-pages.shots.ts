import { test } from './_harness';
import { captureSettings, type SettingsShot } from './_settings-shots';
import { ensureDocsCatalogue } from './_docs-fixtures';
import { loginAsSeedUser } from '../e2e/helpers/seed-login';
import { SEED_EMAILS } from '../seed-fixtures';

// Desktop only. The mobile project exists for the guides that document a phone
// flow; running these there would overwrite every capture with a narrow one
// under the same id — the prose that describes a three-pane editor would be
// illustrated by a single column.
test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'desktop captures');
});


/**
 * Captures for the configuration guides, one picture each — plus the two
 * library surfaces, which are not under `/settings` but want exactly the same
 * walk: one admin login, go to a path, wait for that page's own content, shoot.
 * Splitting them into a file of their own would buy a second login and nothing
 * else.
 *
 * NO COPY LIVES HERE. Every id below has a matching `<!-- shot: <id> | … -->`
 * in the guide named beside it, and those live with the hosted docs.
 *
 * Photographed as the ADMIN, deliberately: these pages are owner/manager
 * surfaces, and an inspector's view of Settings is a different — much shorter —
 * picture that would document a page most readers of these guides do not have.
 *
 * `billing-and-usage/settings-billing` is absent ON PURPOSE — the billing tile
 * does not render on a standalone deployment, which is what this stack is, so
 * there is no screen to photograph. It is recorded with its reason in
 * `apps/portal/docs/shot-exemptions.json` and ships as text.
 *
 * Connected apps NEEDS `MCP_ENABLED=true` on the capture server. Without it the
 * page renders "Contact your administrator to enable remote MCP access", which
 * is a real screen but not the one this guide is about — see the run flags in
 * the docs-shots README note.
 */
const PAGES: SettingsShot[] = [
    { guide: 'workspace-and-branding', id: 'settings-workspace', path: '/settings/workspace', ready: /Branding/i },
    { guide: 'your-team',              id: 'team-page',          path: '/team',               ready: /Team/i },
    { guide: 'services-and-pricing',   id: 'settings-services',  path: '/settings/services',  ready: /Services/i },
    { guide: 'scheduling-and-booking', id: 'settings-schedule',  path: '/settings/schedule',  ready: /Weekly/i },
    { guide: 'messages-and-templates', id: 'settings-communication', path: '/settings/communication', ready: /Email delivery/i },
    { guide: 'automations',            id: 'settings-automations',   path: '/settings/automations',   ready: /Automation/i },
    { guide: 'connected-apps',         id: 'settings-integrations',  path: '/settings/integrations',  ready: /Integrations|QuickBooks/i },
    { guide: 'connected-apps',         id: 'settings-connected-apps', path: '/settings/connected-apps', ready: /Connected applications|MCP clients/i },
    { guide: 'security',               id: 'settings-security',   path: '/settings/security',   ready: /Change password/i },
    { guide: 'privacy-and-data',       id: 'settings-compliance', path: '/settings/compliance', ready: /Agreement retention window/i },
    { guide: 'advanced',               id: 'settings-advanced-ai', path: '/settings/advanced',  ready: /AI features/i },
    // Owner-only, and the seed admin IS the owner. On this stack no authority
    // PDF has been supplied, so the picture is the page as an operator first
    // meets it: every revision this build publishes, each marked "Not stored".
    // That is the state the guide describes, not a degraded one.
    { guide: 'statutory-forms',        id: 'settings-statutory-forms', path: '/settings/statutory-forms', ready: /Statutory form PDFs|publishes no statutory forms/i },
    // The two library surfaces. `ready` is a tile title rather than the page
    // heading: the hub's shell renders before its tiles do.
    { guide: 'content-library-and-marketplace', id: 'library-hub',        path: '/library',             ready: /Canned Comments/i },
    // `ready` refuses a count of ZERO on purpose. The first version of this
    // entry accepted "Marketplace is empty" as a loaded page, and shipped a
    // picture of a bare shelf to illustrate a guide about installing things —
    // green run, useless capture. Requiring a non-zero count makes an unseeded
    // catalogue a FAILURE, which is what it is.
    { guide: 'content-library-and-marketplace', id: 'marketplace-browse', path: '/library/marketplace', ready: /\b[1-9]\d* available/ },
];

test('the configuration pages', async ({ page }) => {
    await loginAsSeedUser(page, SEED_EMAILS.admin);
    // The catalogue has to exist before the marketplace is photographed — see
    // ensureDocsCatalogue for what shipped the first time it did not.
    await ensureDocsCatalogue(page);
    for (const entry of PAGES) {
        await captureSettings(page, entry);
    }
});
