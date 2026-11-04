/**
 * Mutating routes under an inspection that are NOT report content, each with the reason.
 *
 * One list for two guards. `editReports` (who may write report content) and the publish lock (409
 * `REPORT_PUBLISHED`) both cover exactly the routes in `isReportAuthoringPath`; everything else that writes is
 * listed here, so a new write route that nobody classified turns BOTH specs red.
 *
 * Being listed means the route stays available on a PUBLISHED report. The actions the owner allows after publish
 * are the non-content ones: resend or forward the report, take payment, collect agreement signatures, retract it,
 * and everything about the order that is not the report (people, schedule, services, messages, documents).
 */
export const NOT_REPORT_CONTENT: Record<string, string> = {
    'DELETE /api/inspections/:id/documents/:docId': 'client document',
    'DELETE /api/inspections/:id/people/:personId': 'people on the job',
    'DELETE /api/inspections/:id/reports/:reportId': 'report lifecycle',
    'DELETE /api/inspections/:id/services/:lineId': 'booked service line',
    'PATCH /api/inspections/:id/pay-splits/:splitId': 'money',
    'PATCH /api/inspections/:id/schedule': 'scheduling',
    'PATCH /api/inspections/:id/services/:lineId': 'booked service line',
    'POST /api/inspections/:id/agent-token': 'sharing',
    'POST /api/inspections/:id/agreement-requests': 'agreements',
    'POST /api/inspections/:id/cancel': 'cancellation',
    'POST /api/inspections/:id/clone': 'creates another inspection',
    'POST /api/inspections/:id/complete': 'status',
    'POST /api/inspections/:id/confirm': 'status',
    'POST /api/inspections/:id/export/word': 'export of existing content',
    'POST /api/inspections/:id/pay-splits/:splitId/corrections': 'money',
    'POST /api/inspections/:id/pay-splits/refresh': 'money',
    'POST /api/inspections/:id/pdf/refresh': 'rendering of existing content',
    'POST /api/inspections/:id/people': 'people on the job',
    'POST /api/inspections/:id/people/:personId/make-primary': 'people on the job',
    'POST /api/inspections/:id/people/:personId/reset-access': 'people on the job',
    'POST /api/inspections/:id/publish': 'publishing is its own capability',
    'POST /api/inspections/:id/reinspect': 'creates another inspection',
    'POST /api/inspections/:id/relock-report': 'report lifecycle',
    'POST /api/inspections/:id/return': 'review workflow',
    'POST /api/inspections/:id/send-report-pdf': 'delivery',
    'POST /api/inspections/:id/send-sms': 'delivery',
    'POST /api/inspections/:id/services': 'booked service line',
    'POST /api/inspections/:id/share-agent': 'sharing',
    'POST /api/inspections/:id/sign': 'signing',
    'POST /api/inspections/:id/uncancel': 'cancellation',
    'POST /api/inspections/:id/unlock-report': 'report lifecycle',
    'POST /api/inspections/:id/unpublish': 'publishing is its own capability',
    'POST /api/inspections/:id/edit-again': 'publishing is its own capability: it is the step that lifts the publish lock',
    'POST /api/inspections/:inspectionId/events': 'activity log',
    'POST /api/inspections/:inspectionId/messages': 'messaging',
    'POST /api/inspections/:inspectionId/messages/upload': 'messaging',
    'PUT /api/inspections/:id/documents': 'client document',
    'PUT /api/inspections/:id/report-link-expiry': 'delivery setting',
};

