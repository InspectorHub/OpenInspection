/**
 * The merge variables a message template may use, and one clearly fictional
 * sample value for each.
 *
 * Delivery (`deliver-email.ts`, `sms.ts`, `template-vars.ts`) builds the real
 * values per send. The template editor's Preview and Test send have no
 * inspection to read from, so they render against `AUTOMATION_VARIABLE_SAMPLES`
 * instead; without it every placeholder rendered as an empty string and the
 * author could not tell a working template from a broken one.
 *
 * The samples are typed as a full `Record` over the name list: adding a name
 * without a sample is a compile error, and `tests/unit/automations/variable-catalogue.spec.ts`
 * checks the list against the variables delivery and the seeded templates use.
 * None of the values is real data; they are never sent to a client, only shown
 * to (or test-sent to) the person editing the template.
 */
export const AUTOMATION_VARIABLES = [
    'client_name',
    'property_address',
    'scheduled_date',
    'report_url',
    'company_name',
    'company_phone',
    'summary',
    'inspector_name',
    'invoice_url',
    'payment_url',
    'agreement_sign_url',
    'review_url',
    'event_type_name',
    'event_scheduled_at',
    'event_inspector_name',
] as const;

export type AutomationVariable = typeof AUTOMATION_VARIABLES[number];

export const AUTOMATION_VARIABLE_SAMPLES: Readonly<Record<AutomationVariable, string>> = {
    client_name:          'Jordan Sample',
    property_address:     '123 Example Street, Springfield',
    scheduled_date:       'Jun 12, 2027',
    report_url:           'https://app.example.test/report/sample',
    company_name:         'Example Inspections',
    company_phone:        '(555) 010-0199',
    summary:              'Added photos to the roof section.',
    inspector_name:       'Alex Inspector',
    invoice_url:          'https://app.example.test/invoices',
    payment_url:          'https://app.example.test/invoices',
    agreement_sign_url:   'https://app.example.test/sign-agreement/sample',
    review_url:           'https://reviews.example.test/sample',
    event_type_name:      'Radon test',
    event_scheduled_at:   'Jun 13, 2027, 10:00 AM',
    event_inspector_name: 'Sam Technician',
};

/**
 * Sample values for a preview or test send. Anything the caller supplies wins,
 * so an API client that wants its own values still gets them; a placeholder
 * outside the catalogue renders empty, exactly as it does in a real send.
 */
export function previewVariables(overrides?: Record<string, string>): Record<string, string> {
    return { ...AUTOMATION_VARIABLE_SAMPLES, ...(overrides ?? {}) };
}
