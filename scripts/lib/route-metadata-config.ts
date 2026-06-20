/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

// ──────────────────────────────────────────────────────────────────
// Configuration: file → tag, naming overrides, tier rules
// ──────────────────────────────────────────────────────────────────

// Primary tag (from VALID_TAGS in route-metadata-standards.ts) by source file.
export const FILE_TAG: Record<string, string> = {
    'admin.ts':                 'admin',
    'agent.ts':                 'agents',
    'agents.ts':                'agents',
    'agent-signup.ts':          'agents',
    'ai.ts':                    'ai',
    'analytics.ts':             'metrics',
    'auth.ts':                  'auth',
    'automations.ts':           'automations',
    'availability.ts':          'bookings',
    'billing.ts':               'invoices',
    'bookings.ts':              'bookings',
    'calendar.ts':              'calendar',
    'calendar-events.ts':       'calendar',
    'concierge.ts':             'bookings',
    'contacts.ts':              'contacts',
    'data.ts':                  'admin',
    'events.ts':                'automations',
    'guest.ts':                 'guest',
    'identity.ts':              'identity',
    'inspection-requests.ts':   'inspections',
    'inspection-sync.ts':       'inspections',
    'inspections.ts':           'inspections',
    'integration.ts':           'integrations',
    'integrations.ts':          'integrations',
    'invoices.ts':              'invoices',
    'marketplace.ts':           'marketplace',
    'messages.ts':              'messages',
    'metrics.ts':               'metrics',
    'notifications.ts':         'notifications',
    'places.ts':                'bookings',
    'profile.ts':               'profile',
    'public-share.ts':          'inspections',
    'public-slug.ts':           'profile',
    'qbo.ts':                   'qbo',
    'qbo-webhook.ts':           'webhooks',
    'rating-systems.ts':        'ratings',
    'recommendations.ts':       'recommendations',
    'repair-requests.ts':       'inspections',
    'services.ts':              'services',
    'tags.ts':                  'tags',
    'team.ts':                  'team',
    'template-migrations.ts':   'templates',
    'tenant-presence.ts':       'inspections',
    'users.ts':                 'identity',
    'widget.ts':                'webhooks',
};

// Singular entity name (PascalCase) for operationId construction, by file.
// Always SINGULAR; the script appends 's' (or '-y → -ies') for plural verbs.
// Defaults to PascalCase(filename without extension and trailing 's').
export const FILE_ENTITY_OVERRIDE: Record<string, string> = {
    'admin.ts':                 'Tenant',
    'agent-signup.ts':          'Agent',
    'analytics.ts':             'Analytic',         // listAnalytics, getAnalytic
    'auth.ts':                  'Session',
    'availability.ts':          'Availability',
    'calendar-events.ts':       'CalendarEvent',
    'data.ts':                  'TenantData',
    'identity.ts':              'Identity',
    'inspection-requests.ts':   'InspectionRequest',
    'inspection-sync.ts':       'Inspection',
    'metrics.ts':               'Metric',           // listMetrics, getMetric
    'places.ts':                'Place',
    'profile.ts':               'Profile',
    'public-share.ts':          'PublicShare',
    'public-slug.ts':           'Slug',
    'qbo.ts':                   'QboIntegration',
    'qbo-webhook.ts':           'QboWebhook',
    'rating-systems.ts':        'RatingSystem',
    'repair-requests.ts':       'RepairRequest',
    'template-migrations.ts':   'TemplateMigration',
    'tenant-presence.ts':       'Presence',
    'widget.ts':                'Widget',
};

// Verb-like last-path-segments that should drive operationId naming.
export const KNOWN_VERBS = new Set([
    'clone', 'send', 'sync', 'mark', 'confirm', 'approve', 'reject', 'complete',
    'publish', 'unpublish', 'archive', 'restore', 'refresh', 'merge', 'split',
    'upgrade', 'migrate', 'import', 'export', 'cancel', 'redeem', 'verify',
    'invite', 'accept', 'decline', 'revoke', 'rotate', 'enable', 'disable',
    'reset', 'forgot', 'change', 'set', 'unset', 'add', 'remove', 'attach',
    'detach', 'pin', 'unpin', 'autofill', 'autosummarize', 'preview', 'render',
    'upload', 'download', 'geocode', 'autocomplete', 'check', 'validate',
    'leaderboard', 'whoami', 'me', 'dashboard', 'counts', 'overrides',
    'bulk', 'seed-defaults', 'unread-count', 'mark-read', 'mark-all-read',
    'mark-sent', 'mark-paid', 'replace', 'connect', 'disconnect', 'subscribe',
    'unsubscribe', 'callback', 'authorize', 'authorise', 'logout', 'login',
    'join', 'leave', 'kick', 'ban', 'unban', 'mute', 'unmute',
]);

// Tier overrides — anything matching the regex gets the given tier.
export const TIER_PATTERNS: Array<{ rx: RegExp; tier: 'primary' | 'extended' | 'excluded' }> = [
    { rx: /webhook/i,             tier: 'excluded' },
    { rx: /\/sysadmin\//,          tier: 'excluded' },
    { rx: /^\/api\/integration\//, tier: 'excluded' },  // M2M
    { rx: /\/ics(\/|$)/i,          tier: 'excluded' },
    { rx: /presence/i,             tier: 'excluded' },
    { rx: /\/bulk(\/|$)/i,         tier: 'extended' },
];

// Files whose top-level CRUD routes are eligible for 'primary' tier.
// Cap-aware: we want total primary ≤ 45.
export const PRIMARY_ELIGIBLE_FILES = new Set([
    'inspections.ts', 'bookings.ts', 'templates.ts', 'recommendations.ts',
    'team.ts', 'messages.ts', 'notifications.ts', 'contacts.ts', 'invoices.ts',
    'services.ts', 'marketplace.ts', 'ai.ts', 'agent.ts',
]);

// Public/excluded file overrides for scopes.
export const PUBLIC_AUTH_FILES = new Set(['auth.ts']);
export const AGENT_FILES = new Set(['agent.ts']);
export const ADMIN_FILES = new Set(['admin.ts']);

export const VALID_TAGS = new Set([
    'auth', 'inspections', 'bookings', 'templates', 'team',
    'agents', 'ai', 'invoices', 'services', 'messages',
    'notifications', 'contacts', 'metrics', 'admin', 'sysadmin',
    'audit', 'marketplace', 'recommendations', 'agreements', 'webhooks',
    'public', 'calendar', 'tags', 'ratings', 'guest',
    'profile', 'identity', 'automations', 'integrations', 'qbo',
]);

// Files whose routes are always 'excluded' (M2M, webhook receivers, presence).
export const EXCLUDED_FILES = new Set([
    'integration.ts',           // M2M endpoint group (machine-to-machine)
    'qbo-webhook.ts',           // QBO webhook receiver
    'widget.ts',                // public widget tracker, webhook-like
    'tenant-presence.ts',       // WebSocket presence
]);
