// Default automation rules created when a tenant first uses automations.
// Template variables: {{client_name}}, {{property_address}}, {{scheduled_date}},
//                     {{inspector_name}}, {{report_url}}, {{agreement_sign_url}},
//                     {{invoice_url}}, {{payment_url}}, {{company_name}}
//
// {{agreement_sign_url}} is special: when present, AutomationService.flush()
// lazily creates an agreement_request row + token before substitution.
// Rules using this var are auto-skipped if inspection.agreementRequired === false.
//
// ─── ENGLISH ONLY, ON PURPOSE ────────────────────────────────────────────────
// These seeds ship in English and no other language, and that is a DECISION,
// not an oversight — do not "finish the job" by adding Spanish rows here.
//
// message_templates now carries a `locale` and the send path picks a variant by
// the RECIPIENT's language, so seeding Spanish would be technically trivial. It
// is the content that stops us: this is copy a tenant sends under their own
// company name, and inspection terminology varies enough between markets that
// our translation would be wrong for someone and disputed by someone else. A
// tenant who edits the English seed owns the wording; a tenant who inherits our
// Spanish inherits our vocabulary choices without ever agreeing to them.
//
// So: ship the mechanism, let each tenant author their own market's Spanish.
// The authoring surface (Settings → Communication → Templates) shows which
// variants are missing so this reads as an invitation rather than a gap.
// ─────────────────────────────────────────────────────────────────────────────

export const AUTOMATION_SEEDS = [
    {
        name:            'Booking Confirmation',
        trigger:         'inspection.created' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Your inspection is scheduled — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Your inspection at <strong>{{property_address}}</strong> has been scheduled for <strong>{{scheduled_date}}</strong>.</p><p>Your inspector: {{inspector_name}}</p><p>— {{company_name}}</p>',
        smsBody:         '{{company_name}}: your inspection at {{property_address}} is set for {{scheduled_date}}. Reply STOP to opt out; questions? call {{company_phone}}',
        isDefault: true,
    },
    {
        name:            "Booking Confirmation (Buyer's Agent)",
        trigger:         'inspection.created' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'buyer_agent' as const,
        delayMinutes:    0,
        subjectTemplate: 'Inspection scheduled — {{property_address}}',
        bodyTemplate:    '<p>An inspection has been scheduled at <strong>{{property_address}}</strong> on <strong>{{scheduled_date}}</strong>.</p><p>Client: {{client_name}} · Inspector: {{inspector_name}}</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            '24-Hour Reminder',
        trigger:         'inspection.confirmed' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Reminder: Inspection tomorrow — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Just a reminder that your inspection at <strong>{{property_address}}</strong> is scheduled for <strong>{{scheduled_date}}</strong>.</p><p>— {{company_name}}</p>',
        smsBody:         '{{company_name}}: reminder — your inspection at {{property_address}} is {{scheduled_date}}. Reply STOP to opt out; questions? call {{company_phone}}',
        isDefault: true,
    },
    {
        name:            'Cancellation Notice',
        trigger:         'inspection.cancelled' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Inspection cancelled — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Your inspection at <strong>{{property_address}}</strong> has been cancelled. Please contact us to reschedule.</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    // The referring agent is told the visit is off for the same reason they are
    // told it was booked: they are coordinating a transaction around the date.
    // Promoted from the standalone /setup seeder's private list, which shipped
    // this rule to self-hosters while the SaaS path had no equivalent — the
    // second half of the same defect as the six renamed duplicates.
    {
        name:            "Cancellation Notice (Buyer's Agent)",
        trigger:         'inspection.cancelled' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'buyer_agent' as const,
        delayMinutes:    0,
        subjectTemplate: 'Inspection cancelled — {{property_address}}',
        bodyTemplate:    '<p>The inspection at <strong>{{property_address}}</strong> has been cancelled. The client may need to reschedule.</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            'Report Ready',
        trigger:         'report.published' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Your inspection report is ready — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Your inspection report for <strong>{{property_address}}</strong> is ready to view.</p><p><a href="{{report_url}}">View Report</a></p><p>— {{company_name}}</p>',
        smsBody:         '{{company_name}}: your inspection report for {{property_address}} is ready: {{report_url}} Reply STOP to opt out; questions? call {{company_phone}}',
        isDefault: true,
    },
    {
        name:            "Report Ready (Buyer's Agent)",
        trigger:         'report.published' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'buyer_agent' as const,
        delayMinutes:    0,
        subjectTemplate: 'Inspection report ready — {{property_address}}',
        bodyTemplate:    '<p>Hello,</p><p>The inspection report for <strong>{{property_address}}</strong> is ready to view.</p><p><a href="{{report_url}}">View Report</a></p><p>— {{company_name}}</p>',
        smsBody:         '{{company_name}}: the inspection report for {{property_address}} is ready: {{report_url}} Reply STOP to opt out; questions? call {{company_phone}}',
        isDefault: true,
    },
    {
        name:            'Report Ready (Listing Agent)',
        trigger:         'report.published' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'listing_agent' as const,
        delayMinutes:    0,
        subjectTemplate: 'Inspection report ready — {{property_address}}',
        bodyTemplate:    '<p>Hello,</p><p>The inspection report for <strong>{{property_address}}</strong> is ready to view.</p><p><a href="{{report_url}}">View Report</a></p><p>— {{company_name}}</p>',
        smsBody:         '{{company_name}}: the inspection report for {{property_address}} is ready: {{report_url}} Reply STOP to opt out; questions? call {{company_phone}}',
        isDefault: true,
        defaultActive: false,
    },
    {
        name:            'Report Updated',
        trigger:         'report.amended' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Your inspection report was updated — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Your inspection report for <strong>{{property_address}}</strong> has been updated.</p><p>{{summary}}</p><p><a href="{{report_url}}">View the updated report</a></p><p>— {{company_name}}</p>',
        smsBody:         '{{company_name}}: your inspection report for {{property_address}} was updated: {{report_url}} Reply STOP to opt out; questions? call {{company_phone}}',
        isDefault: true,
    },
    {
        name:            "Report Updated (Buyer's Agent)",
        trigger:         'report.amended' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'buyer_agent' as const,
        delayMinutes:    0,
        subjectTemplate: 'Inspection report updated — {{property_address}}',
        bodyTemplate:    '<p>Hello,</p><p>The inspection report for <strong>{{property_address}}</strong> has been updated.</p><p>{{summary}}</p><p><a href="{{report_url}}">View the updated report</a></p><p>— {{company_name}}</p>',
        smsBody:         '{{company_name}}: the inspection report for {{property_address}} was updated: {{report_url}} Reply STOP to opt out; questions? call {{company_phone}}',
        isDefault: true,
    },
    {
        name:            'Invoice / Payment Request',
        trigger:         'invoice.created' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Invoice for your inspection — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>An invoice has been created for your inspection at <strong>{{property_address}}</strong>.</p><p><a href="{{invoice_url}}">View & Pay Invoice</a></p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            'Payment Received',
        trigger:         'payment.received' as const,
        recipientKind:   'inspector' as const,
        recipientRoleKey: null,
        delayMinutes:    0,
        subjectTemplate: 'Payment received — {{property_address}}',
        bodyTemplate:    '<p>Payment has been received for the inspection at <strong>{{property_address}}</strong> (client: {{client_name}}).</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    // The payer's own copy. The seed above tells the OFFICE money arrived; this
    // tells the person who sent it, which is a record of a payment they made
    // and the only one we ever produce. Promoted from the standalone /setup
    // seeder's private list — same provenance as the buyer's-agent
    // cancellation above.
    {
        name:            'Payment Received (Client Receipt)',
        trigger:         'payment.received' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Receipt: payment received — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Thank you — your payment for the inspection at <strong>{{property_address}}</strong> has been received.</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            'Send agreement to client on inspection scheduled',
        trigger:         'inspection.created' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Please sign your inspection agreement — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Please review and sign the inspection agreement for <strong>{{property_address}}</strong> scheduled for {{scheduled_date}}.</p><p><a href="{{agreement_sign_url}}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Review & Sign Agreement</a></p><p>The link will expire in 14 days.</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            'Notify inspector when client signs agreement',
        trigger:         'agreement.signed' as const,
        recipientKind:   'inspector' as const,
        recipientRoleKey: null,
        delayMinutes:    0,
        subjectTemplate: 'Agreement signed — {{property_address}}',
        bodyTemplate:    '<p>{{client_name}} signed the inspection agreement for <strong>{{property_address}}</strong>.</p><p>The report is now available to publish.</p>',
        isDefault: true,
    },
    {
        name:            'Send signed agreement copy to client',
        trigger:         'agreement.signed' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Confirmation: agreement signed — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Thank you for signing the inspection agreement for <strong>{{property_address}}</strong>.</p><p>Your report will be available at <a href="{{report_url}}">{{report_url}}</a> once the inspection is complete.</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            'Notify inspector when client declines agreement',
        trigger:         'agreement.declined' as const,
        recipientKind:   'inspector' as const,
        recipientRoleKey: null,
        delayMinutes:    0,
        subjectTemplate: 'Agreement declined — {{property_address}}',
        bodyTemplate:    '<p>{{client_name}} declined the inspection agreement for <strong>{{property_address}}</strong>.</p><p>You may want to reach out to discuss next steps.</p>',
        isDefault: true,
    },
    {
        name:            'Notify inspector when client views agreement',
        trigger:         'agreement.viewed' as const,
        recipientKind:   'inspector' as const,
        recipientRoleKey: null,
        delayMinutes:    0,
        subjectTemplate: 'Agreement viewed — {{property_address}}',
        bodyTemplate:    '<p>{{client_name}} just viewed the inspection agreement for <strong>{{property_address}}</strong>. They have not yet signed.</p>',
        isDefault: true,
        // NOTE: ensureSeeds() honors an optional `defaultActive: false` field
        // (maps to `active`) — see the Report Ready (Listing Agent) seed above
        // and the Review request seed below for examples. This rule
        // intentionally leaves `defaultActive` unset (active=true); reconsider
        // in Spec 3 if email noise becomes a complaint.
    },
    // Spec 4D — Inspection Events automations.
    // EventService pre-INSERTs automation_logs with computed sendAt
    // (scheduled_at - 24h for reminder, completed_at + 72h for follow-up).
    // delayMinutes is unused for these rules; cron flush picks up by sendAt.
    {
        name:            'Event Reminder (24h before)',
        trigger:         'event.created' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Reminder: {{event_type_name}} tomorrow — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Just a reminder that your {{event_type_name}} is scheduled for {{event_scheduled_at}} at {{property_address}}.</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            'Event Follow-up (results ready)',
        trigger:         'event.completed' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'client' as const,
        delayMinutes:    0,
        subjectTemplate: '{{event_type_name}} results — {{property_address}}',
        // Names the report the results belong to. "your inspection report",
        // singular, is the wrong document once an order carries more than one
        // deliverable — the radon numbers are in the radon report, and pointing
        // the client at the standard report sends them looking for something
        // that is not there.
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>The results for your {{event_type_name}} at {{property_address}} are now available in your {{event_type_name}} report.</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    // The lab result ARRIVING. Fires off `event.results_received`, which the
    // office marks days after the pickup was completed — a different moment,
    // a different actor, and the one the client is actually waiting on.
    {
        name:            'Event Results Received',
        trigger:         'event.results_received' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Your {{event_type_name}} results are in — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>The results for your {{event_type_name}} at <strong>{{property_address}}</strong> have arrived and are now in your {{event_type_name}} report.</p><p><a href="{{report_url}}">View the report</a></p><p>— {{company_name}}</p>',
        smsBody:         '{{company_name}}: your {{event_type_name}} results for {{property_address}} are in: {{report_url}} Reply STOP to opt out; questions? call {{company_phone}}',
        isDefault: true,
    },
    {
        name:            "Event Results Received (Buyer's Agent)",
        trigger:         'event.results_received' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'buyer_agent' as const,
        delayMinutes:    0,
        subjectTemplate: '{{event_type_name}} results are in — {{property_address}}',
        bodyTemplate:    '<p>Hello,</p><p>The results for the {{event_type_name}} at <strong>{{property_address}}</strong> have arrived and are now in the {{event_type_name}} report.</p><p><a href="{{report_url}}">View the report</a></p><p>— {{company_name}}</p>',
        smsBody:         '{{company_name}}: the {{event_type_name}} results for {{property_address}} are in: {{report_url}} Reply STOP to opt out; questions? call {{company_phone}}',
        isDefault: true,
    },
    // Track J (#122) — post-delivery follow-up. One day after the report is
    // published, thank the client and invite questions.
    {
        name:            'Post-inspection follow-up',
        trigger:         'report.published' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'client' as const,
        delayMinutes:    1440, // 1 day
        subjectTemplate: 'Following up on your inspection — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>We hope your inspection report for <strong>{{property_address}}</strong> was helpful. If anything in it raised a question, just reply to this email — we are happy to walk you through it.</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    // Track J (#122) — review request. Three days after publish. Seeded INACTIVE
    // and engine-skips until tenant_configs.review_url is set (fail-closed).
    {
        name:            'Review request',
        trigger:         'report.published' as const,
        recipientKind:   'role' as const,
        recipientRoleKey: 'client' as const,
        delayMinutes:    4320, // 3 days
        subjectTemplate: 'How did we do? — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Thanks again for choosing us for your inspection at <strong>{{property_address}}</strong>. If you have a moment, a short review really helps other homebuyers find us:</p><p><a href="{{review_url}}">Leave a review</a></p><p>— {{company_name}}</p>',
        isDefault: true,
        defaultActive: false,
    },

    // ── Internal staff alerts (B3) ─────────────────────────────────────────
    // These replace the four hard-coded `createForAllAdmins` call sites. They
    // are `in_app` only — an internal alert is not an email — and addressed to
    // `staff`, which is the same owners+managers audience the direct calls
    // had. Seeded ACTIVE so the migration preserves coverage exactly: an
    // office that gets an alert today still gets one, now from a rule they can
    // rename, reword or switch off.
    //
    // `inAppTitle` / `inAppBody` are the twelve literals (IA-115), now
    // template text: `backfillAutomationTemplates` turns each into a
    // message_templates(channel='in_app') row the operator owns.
    {
        name:            'Office alert — new booking',
        trigger:         'booking.received' as const,
        recipientKind:   'staff' as const,
        delayMinutes:    0,
        subjectTemplate: '',
        bodyTemplate:    '',
        channels:        ['in_app'],
        inAppTitle:      'New booking — {{property_address}}',
        inAppBody:       'A new booking came in for {{scheduled_date}}.',
        isDefault: true,
    },
    {
        name:            'Office alert — inspection scheduled',
        trigger:         'inspection.created' as const,
        recipientKind:   'staff' as const,
        delayMinutes:    0,
        subjectTemplate: '',
        bodyTemplate:    '',
        channels:        ['in_app'],
        inAppTitle:      'New inspection scheduled — {{property_address}}',
        isDefault: true,
    },
    {
        name:            'Office alert — inspection confirmed',
        trigger:         'inspection.confirmed' as const,
        recipientKind:   'staff' as const,
        delayMinutes:    0,
        subjectTemplate: '',
        bodyTemplate:    '',
        channels:        ['in_app'],
        inAppTitle:      'Inspection confirmed — {{property_address}}',
        isDefault: true,
    },
    {
        name:            'Office alert — inspection cancelled',
        trigger:         'inspection.cancelled' as const,
        recipientKind:   'staff' as const,
        delayMinutes:    0,
        subjectTemplate: '',
        bodyTemplate:    '',
        channels:        ['in_app'],
        inAppTitle:      'Inspection cancelled — {{property_address}}',
        isDefault: true,
    },
    {
        name:            'Office alert — inspection completed',
        trigger:         'inspection.completed' as const,
        recipientKind:   'staff' as const,
        delayMinutes:    0,
        subjectTemplate: '',
        bodyTemplate:    '',
        channels:        ['in_app'],
        inAppTitle:      'Inspection completed — {{property_address}}',
        isDefault: true,
    },
    {
        name:            'Office alert — report published',
        trigger:         'report.published' as const,
        recipientKind:   'staff' as const,
        delayMinutes:    0,
        subjectTemplate: '',
        bodyTemplate:    '',
        channels:        ['in_app'],
        inAppTitle:      'Report published — {{property_address}}',
        isDefault: true,
    },
    {
        name:            'Office alert — invoice created',
        trigger:         'invoice.created' as const,
        recipientKind:   'staff' as const,
        delayMinutes:    0,
        subjectTemplate: '',
        bodyTemplate:    '',
        channels:        ['in_app'],
        inAppTitle:      'Invoice created — {{property_address}}',
        isDefault: true,
    },
    {
        name:            'Office alert — payment received',
        trigger:         'payment.received' as const,
        recipientKind:   'staff' as const,
        delayMinutes:    0,
        subjectTemplate: '',
        bodyTemplate:    '',
        channels:        ['in_app'],
        inAppTitle:      'Payment received — {{property_address}}',
        isDefault: true,
    },
    {
        name:            'Office alert — agreement signed',
        trigger:         'agreement.signed' as const,
        recipientKind:   'staff' as const,
        delayMinutes:    0,
        subjectTemplate: '',
        bodyTemplate:    '',
        channels:        ['in_app'],
        inAppTitle:      'Agreement signed — {{property_address}}',
        isDefault: true,
    },
] as const;
