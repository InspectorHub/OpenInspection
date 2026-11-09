import { m } from "~/paraglide/messages";

/**
 * The screen's name for a notification class, in the UI language.
 *
 * `server/lib/notifications/classes.ts` is the authority for WHICH classes exist
 * and carries an English `label` for each; that label is what the API returns, so
 * showing it directly rendered English under an es-419 UI. This maps a class id to
 * its catalog message instead (resolved at call time, inside the locale scope),
 * and falls back to the server's label for an id with no key here, so a class
 * added on the server still renders before it is translated. A test pins that
 * every class in `NOTIFICATION_CLASSES` has a key.
 */
const LABELS: Record<string, () => string> = {
  "password-reset": () => m.notif_class_password_reset(),
  "agent-invite": () => m.notif_class_agent_invite(),
  "agent-login-link": () => m.notif_class_agent_login_link(),
  "subject-export-ready": () => m.notif_class_subject_export_ready(),
  "subject-erasure-confirmed": () => m.notif_class_subject_erasure_confirmed(),
  "agent-share-link": () => m.notif_class_agent_share_link(),
  "agent-new-referral": () => m.notif_class_agent_new_referral(),
  "agent-report-ready": () => m.notif_class_agent_report_ready(),
  "agent-invoice-paid": () => m.notif_class_agent_invoice_paid(),
  "inspection-cancelled-buyers-agent": () => m.notif_class_inspection_cancelled_buyers_agent(),
  "report-ready-listing-agent": () => m.notif_class_report_ready_listing_agent(),
  "booking-confirmation-buyers-agent": () => m.notif_class_booking_confirmation_buyers_agent(),
  "report-amended-buyers-agent": () => m.notif_class_report_amended_buyers_agent(),
  "event-results-received-buyers-agent": () => m.notif_class_event_results_received_buyers_agent(),
  "concierge-confirmed-agent": () => m.notif_class_concierge_confirmed_agent(),
  "concierge-cancelled-agent": () => m.notif_class_concierge_cancelled_agent(),
  "workspace-invitation": () => m.notif_class_workspace_invitation(),
  "client-portal-login": () => m.notif_class_client_portal_login(),
  "agreement-request": () => m.notif_class_agreement_request(),
  "agreement-signed": () => m.notif_class_agreement_signed(),
  "evidence-pack": () => m.notif_class_evidence_pack(),
  "payment-request": () => m.notif_class_payment_request(),
  "payment-receipt": () => m.notif_class_payment_receipt(),
  "report-ready": () => m.notif_class_report_ready(),
  "report-ready-pdf": () => m.notif_class_report_ready_pdf(),
  "repair-request-share": () => m.notif_class_repair_request_share(),
  "usage-quota-warning": () => m.notif_class_usage_quota_warning(),
  "usage-quota-reached": () => m.notif_class_usage_quota_reached(),
  "destruction-incomplete": () => m.notif_class_destruction_incomplete(),
  "migration-import-received": () => m.notif_class_migration_import_received(),
  "migration-import-ready": () => m.notif_class_migration_import_ready(),
  "migration-import-declined": () => m.notif_class_migration_import_declined(),
  "migration-import-expiring": () => m.notif_class_migration_import_expiring(),
  "admin-test-send": () => m.notif_class_admin_test_send(),
  "booking-confirmation": () => m.notif_class_booking_confirmation(),
  "message-notification": () => m.notif_class_message_notification(),
  "inspection-reminder": () => m.notif_class_inspection_reminder(),
  "inspection-cancelled": () => m.notif_class_inspection_cancelled(),
  "report-amended": () => m.notif_class_report_amended(),
  "event-reminder": () => m.notif_class_event_reminder(),
  "event-followup": () => m.notif_class_event_followup(),
  "event-results-received": () => m.notif_class_event_results_received(),
  "post-inspection-followup": () => m.notif_class_post_inspection_followup(),
  "review-request": () => m.notif_class_review_request(),
  "inspector-payment-received": () => m.notif_class_inspector_payment_received(),
  "inspector-agreement-signed": () => m.notif_class_inspector_agreement_signed(),
  "inspector-agreement-declined": () => m.notif_class_inspector_agreement_declined(),
  "inspector-agreement-viewed": () => m.notif_class_inspector_agreement_viewed(),
  "office-alert-new-booking": () => m.notif_class_office_alert_new_booking(),
  "office-alert-inspection-scheduled": () => m.notif_class_office_alert_inspection_scheduled(),
  "office-alert-inspection-confirmed": () => m.notif_class_office_alert_inspection_confirmed(),
  "office-alert-inspection-cancelled": () => m.notif_class_office_alert_inspection_cancelled(),
  "office-alert-inspection-completed": () => m.notif_class_office_alert_inspection_completed(),
  "office-alert-report-published": () => m.notif_class_office_alert_report_published(),
  "office-alert-invoice-created": () => m.notif_class_office_alert_invoice_created(),
  "office-alert-payment-received": () => m.notif_class_office_alert_payment_received(),
  "office-alert-agreement-signed": () => m.notif_class_office_alert_agreement_signed(),
  "concierge-client-confirm": () => m.notif_class_concierge_client_confirm(),
  "concierge-inspector-review": () => m.notif_class_concierge_inspector_review(),
};

export const TRANSLATED_NOTIFICATION_CLASS_IDS: string[] = Object.keys(LABELS);

export function notificationClassLabel(id: string, serverLabel: string): string {
  return LABELS[id]?.() ?? serverLabel;
}
