// Default automation rules created when a tenant first uses automations.
// Template variables: {{client_name}}, {{property_address}}, {{scheduled_date}},
//                     {{inspector_name}}, {{report_url}}, {{agreement_sign_url}},
//                     {{invoice_url}}, {{payment_url}}, {{company_name}}
//
// {{agreement_sign_url}} is special: when present, AutomationService.flush()
// lazily creates an agreement_request row + token before substitution.
// Rules using this var are auto-skipped if inspection.agreementRequired === false.

export const AUTOMATION_SEEDS = [
    {
        name:            'Booking Confirmation',
        trigger:         'inspection.created' as const,
        recipient:       'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Your inspection is scheduled — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Your inspection at <strong>{{property_address}}</strong> has been scheduled for <strong>{{scheduled_date}}</strong>.</p><p>Your inspector: {{inspector_name}}</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            "Booking Confirmation (Buyer's Agent)",
        trigger:         'inspection.created' as const,
        recipient:       'buying_agent' as const,
        delayMinutes:    0,
        subjectTemplate: 'Inspection scheduled — {{property_address}}',
        bodyTemplate:    '<p>An inspection has been scheduled at <strong>{{property_address}}</strong> on <strong>{{scheduled_date}}</strong>.</p><p>Client: {{client_name}} · Inspector: {{inspector_name}}</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            '24-Hour Reminder',
        trigger:         'inspection.confirmed' as const,
        recipient:       'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Reminder: Inspection tomorrow — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Just a reminder that your inspection at <strong>{{property_address}}</strong> is scheduled for <strong>{{scheduled_date}}</strong>.</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            'Cancellation Notice',
        trigger:         'inspection.cancelled' as const,
        recipient:       'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Inspection cancelled — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Your inspection at <strong>{{property_address}}</strong> has been cancelled. Please contact us to reschedule.</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            'Report Ready',
        trigger:         'report.published' as const,
        recipient:       'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Your inspection report is ready — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Your inspection report for <strong>{{property_address}}</strong> is ready to view.</p><p><a href="{{report_url}}">View Report</a></p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            'Invoice / Payment Request',
        trigger:         'invoice.created' as const,
        recipient:       'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Invoice for your inspection — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>An invoice has been created for your inspection at <strong>{{property_address}}</strong>.</p><p><a href="{{invoice_url}}">View & Pay Invoice</a></p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            'Payment Received',
        trigger:         'payment.received' as const,
        recipient:       'inspector' as const,
        delayMinutes:    0,
        subjectTemplate: 'Payment received — {{property_address}}',
        bodyTemplate:    '<p>Payment has been received for the inspection at <strong>{{property_address}}</strong> (client: {{client_name}}).</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            'Send agreement to client on inspection scheduled',
        trigger:         'inspection.created' as const,
        recipient:       'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Please sign your inspection agreement — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Please review and sign the inspection agreement for <strong>{{property_address}}</strong> scheduled for {{scheduled_date}}.</p><p><a href="{{agreement_sign_url}}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Review & Sign Agreement</a></p><p>The link will expire in 14 days.</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            'Notify inspector when client signs agreement',
        trigger:         'agreement.signed' as const,
        recipient:       'inspector' as const,
        delayMinutes:    0,
        subjectTemplate: 'Agreement signed — {{property_address}}',
        bodyTemplate:    '<p>{{client_name}} signed the inspection agreement for <strong>{{property_address}}</strong>.</p><p>The report is now available to publish.</p>',
        isDefault: true,
    },
    {
        name:            'Send signed agreement copy to client',
        trigger:         'agreement.signed' as const,
        recipient:       'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Confirmation: agreement signed — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Thank you for signing the inspection agreement for <strong>{{property_address}}</strong>.</p><p>Your report will be available at <a href="{{report_url}}">{{report_url}}</a> once the inspection is complete.</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            'Notify inspector when client declines agreement',
        trigger:         'agreement.declined' as const,
        recipient:       'inspector' as const,
        delayMinutes:    0,
        subjectTemplate: 'Agreement declined — {{property_address}}',
        bodyTemplate:    '<p>{{client_name}} declined the inspection agreement for <strong>{{property_address}}</strong>.</p><p>You may want to reach out to discuss next steps.</p>',
        isDefault: true,
    },
    {
        name:            'Notify inspector when client views agreement',
        trigger:         'agreement.viewed' as const,
        recipient:       'inspector' as const,
        delayMinutes:    0,
        subjectTemplate: 'Agreement viewed — {{property_address}}',
        bodyTemplate:    '<p>{{client_name}} just viewed the inspection agreement for <strong>{{property_address}}</strong>. They have not yet signed.</p>',
        isDefault: true,
        // NOTE: AUTOMATION_SEEDS doesn't currently track an `active` flag at seed
        // time (active defaults to true in ensureSeeds). Inspector can disable in
        // Settings → Automations. If we want this rule disabled by default, we
        // need to extend ensureSeeds() to honor a `defaultActive: false` field.
        // For Spec 2A: leave active=true; reconsider in Spec 3 if email noise
        // becomes a complaint.
    },
    // Spec 4D — Inspection Events automations.
    // EventService pre-INSERTs automation_logs with computed sendAt
    // (scheduled_at - 24h for reminder, completed_at + 72h for follow-up).
    // delayMinutes is unused for these rules; cron flush picks up by sendAt.
    {
        name:            'Event Reminder (24h before)',
        trigger:         'event.created' as const,
        recipient:       'client' as const,
        delayMinutes:    0,
        subjectTemplate: 'Reminder: {{event_type_name}} tomorrow — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Just a reminder that your {{event_type_name}} is scheduled for {{event_scheduled_at}} at {{property_address}}.</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    {
        name:            'Event Follow-up (results ready)',
        trigger:         'event.completed' as const,
        recipient:       'client' as const,
        delayMinutes:    0,
        subjectTemplate: '{{event_type_name}} results — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>The results for your {{event_type_name}} at {{property_address}} are now available in your inspection report.</p><p>— {{company_name}}</p>',
        isDefault: true,
    },
    // Track J (#122) — post-delivery follow-up. One day after the report is
    // published, thank the client and invite questions.
    {
        name:            'Post-inspection follow-up',
        trigger:         'report.published' as const,
        recipient:       'client' as const,
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
        recipient:       'client' as const,
        delayMinutes:    4320, // 3 days
        subjectTemplate: 'How did we do? — {{property_address}}',
        bodyTemplate:    '<p>Hi {{client_name}},</p><p>Thanks again for choosing us for your inspection at <strong>{{property_address}}</strong>. If you have a moment, a short review really helps other homebuyers find us:</p><p><a href="{{review_url}}">Leave a review</a></p><p>— {{company_name}}</p>',
        isDefault: true,
        defaultActive: false,
    },
] as const;
