import { m } from "~/paraglide/messages";

/**
 * What the command palette can navigate to, as data.
 *
 * Split from the component when the file passed the 400-line ceiling, and the
 * seam is the honest one: these are lists, not behaviour. The component owns
 * the input, the filtering and the keyboard; this owns what there is to find.
 */

export interface PaletteItem {
  id: string;
  label: string;
  group: string;
  hint?: string;
  icon: string;
  to?: string;
  onSelect?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Static sources                                                     */
/* ------------------------------------------------------------------ */

// Recents is the one unbounded group (a busy workspace has hundreds of
// inspections), so it is capped at its source. The static navigation groups
// (Pages, Settings) are bounded lists and must render in full — see the
// `groups` memo, which deliberately does NOT re-truncate per group (#IA-50:
// the old blanket `< 8` cap silently hid 6 of the 14 Settings destinations
// whenever the palette was browsed without a filter word).
export const RECENTS_CAP = 8;

// Built as thunks (not module-level consts) so the Paraglide `m.*()` labels
// resolve inside the per-request locale scope instead of freezing at import.
export function getPages(hasMarketplace: boolean): PaletteItem[] {
  return [
    { id: "p-inspections", label: m.command_palette_page_inspections(), group: m.command_palette_group_pages(), icon: "page", to: "/inspections", hint: m.command_palette_hint_g_then_i() },
    { id: "p-reports", label: m.command_palette_page_reports(), group: m.command_palette_group_pages(), icon: "page", to: "/inspections?workflow=published", hint: m.command_palette_hint_g_then_r() },
    { id: "p-templates", label: m.command_palette_page_templates(), group: m.command_palette_group_pages(), icon: "page", to: "/library/templates", hint: m.command_palette_hint_g_then_t() },
    // SaaS-only: `/library/marketplace` 404s in standalone, and the palette is
    // the second door to it besides the Library hub tile.
    ...(hasMarketplace ? [{ id: "p-marketplace", label: m.command_palette_page_marketplace(), group: m.command_palette_group_pages(), icon: "page", to: "/library/marketplace" }] : []),
    { id: "p-agreements", label: m.command_palette_page_agreements(), group: m.command_palette_group_pages(), icon: "page", to: "/library/agreements" },
    { id: "p-comments", label: m.command_palette_page_comments(), group: m.command_palette_group_pages(), icon: "page", to: "/library/comments" },
    { id: "p-repair", label: m.command_palette_page_repair(), group: m.command_palette_group_pages(), icon: "page", to: "/library/repair-items" },
    { id: "p-contacts", label: m.command_palette_page_contacts(), group: m.command_palette_group_pages(), icon: "page", to: "/contacts", hint: m.command_palette_hint_g_then_c() },
    { id: "p-calendar", label: m.command_palette_page_calendar(), group: m.command_palette_group_pages(), icon: "page", to: "/calendar" },
    { id: "p-invoices", label: m.command_palette_page_invoices(), group: m.command_palette_group_pages(), icon: "page", to: "/invoices" },
    { id: "p-ratings", label: m.command_palette_page_ratings(), group: m.command_palette_group_pages(), icon: "page", to: "/library/rating-systems" },
    { id: "p-metrics", label: m.command_palette_page_metrics(), group: m.command_palette_group_pages(), icon: "page", to: "/metrics" },
    { id: "p-team", label: m.command_palette_page_team(), group: m.command_palette_group_pages(), icon: "page", to: "/team" },
    { id: "p-notifications", label: m.command_palette_page_notifications(), group: m.command_palette_group_pages(), icon: "page", to: "/notifications" },
  ];
}

export function getSettings(): PaletteItem[] {
  return [
    { id: "s-main", label: m.command_palette_settings_main(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings" },
    { id: "s-profile", label: m.command_palette_settings_profile(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings/profile" },
    { id: "s-company", label: m.command_palette_settings_company(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings/workspace" },
    { id: "s-theme", label: m.command_palette_settings_theme(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings/workspace" },
    { id: "s-services", label: m.command_palette_settings_services(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings/services" },
    { id: "s-email", label: m.command_palette_settings_email(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings/communication" },
    { id: "s-email-templates", label: m.command_palette_settings_email_templates(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings/communication/templates" },
    { id: "s-automations", label: m.command_palette_settings_automations(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings/automations" },
    { id: "s-integrations", label: m.command_palette_settings_integrations(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings/integrations" },
    { id: "s-qbo", label: m.command_palette_settings_qbo(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings/integrations/qbo" },
    { id: "s-password", label: m.command_palette_settings_password(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings/security" },
    { id: "s-2fa", label: m.command_palette_settings_2fa(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings/security" },
    { id: "s-account", label: m.command_palette_settings_account(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings/security" },
    { id: "s-payments", label: m.command_palette_settings_payments(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings/advanced" },
    { id: "s-ai", label: m.command_palette_settings_ai(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings/advanced" },
    { id: "s-data", label: m.command_palette_settings_data(), group: m.command_palette_group_settings(), icon: "gear", to: "/settings/data" },
  ];
}
