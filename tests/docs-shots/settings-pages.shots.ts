import { test } from './_harness';
import { captureSettings, type SettingsShot } from './_settings-shots';
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
 * Captures for the configuration guides, one picture each.
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
];

test('the configuration pages', async ({ page }) => {
    await loginAsSeedUser(page, SEED_EMAILS.admin);
    for (const entry of PAGES) {
        await captureSettings(page, entry);
    }
});
