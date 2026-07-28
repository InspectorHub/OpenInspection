/**
 * Inspection roles — the tenant-configurable roles a contact can hold on an
 * inspection (buyer's agent, listing agent, contractor, …).
 *
 * IA-96 — this lived as a third tab on /contacts, which put a configuration
 * table beside two lists of people and made "Contacts" mean two different
 * things depending on the tab. Roles are not contacts: there are a handful of
 * them, they change once a quarter, and only an admin may touch them. That is
 * the definition of a setting, so it lives here.
 *
 * The route is admin-gated in the loader (`requireAdminLoader`), not merely
 * hidden from the nav — the old tab was hidden but its `role-*` actions sat on
 * a route any authenticated user could POST to.
 */
import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/settings-inspection-roles";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import { RolesTable } from "~/components/contacts/RolesTable";
import { RoleProfileModal } from "~/components/contacts/RoleProfileModal";
import type { RoleProfile, MessageTemplateOption } from "~/components/contacts/contacts-helpers";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.settings_inspection_roles_meta_title() }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const, roleProfiles: [], messageTemplates: [] };
  try {
    const api = createApi(context, { token });
    const [rolesRes, emailRes, smsRes] = await Promise.all([
      api.roleProfiles.index.$get(),
      api.messageTemplates.index.$get({ query: { channel: "email" } }).catch(() => null),
      api.messageTemplates.index.$get({ query: { channel: "sms" } }).catch(() => null),
    ]);
    const rolesBody = rolesRes.ok ? ((await rolesRes.json()) as { data?: RoleProfile[] }) : { data: [] };
    const emailBody = emailRes?.ok ? ((await emailRes.json()) as { data?: MessageTemplateOption[] }) : { data: [] };
    const smsBody = smsRes?.ok ? ((await smsRes.json()) as { data?: MessageTemplateOption[] }) : { data: [] };
    return {
      forbidden: false as const,
      roleProfiles: rolesBody.data ?? [],
      messageTemplates: [...(emailBody.data ?? []), ...(smsBody.data ?? [])],
    };
  } catch {
    return { forbidden: false as const, roleProfiles: [], messageTemplates: [] };
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const form = await request.formData();
  const intent = form.get("intent") as string;
  const api = createApi(context, { token });

  if (intent === "role-create") {
    const label = String(form.get("label") ?? "").trim();
    const kind = String(form.get("kind") ?? "") as "client" | "agent" | "other";
    if (!label || !kind) return { ok: false };
    const emailTemplateId = String(form.get("emailTemplateId") ?? "").trim();
    const smsTemplateId = String(form.get("smsTemplateId") ?? "").trim();
    const body: { label: string; kind: "client" | "agent" | "other"; emailTemplateId?: string; smsTemplateId?: string } = { label, kind };
    if (emailTemplateId) body.emailTemplateId = emailTemplateId;
    if (smsTemplateId) body.smsTemplateId = smsTemplateId;
    const res = await api.roleProfiles.index.$post({ json: body });
    return { ok: res.ok };
  }

  if (intent === "role-update") {
    const id = form.get("id") as string;
    const label = String(form.get("label") ?? "").trim();
    const emailTemplateId = String(form.get("emailTemplateId") ?? "").trim();
    const smsTemplateId = String(form.get("smsTemplateId") ?? "").trim();
    const res = await api.roleProfiles[":id"].$put({
      param: { id },
      json: {
        label,
        emailTemplateId: emailTemplateId || null,
        smsTemplateId: smsTemplateId || null,
      },
    });
    return { ok: res.ok };
  }

  if (intent === "role-delete") {
    const id = form.get("id") as string;
    const res = await api.roleProfiles[":id"].$delete({ param: { id } });
    return { ok: res.ok };
  }

  return { ok: false };
}

export default function SettingsInspectionRolesPage() {
  const { forbidden, roleProfiles, messageTemplates } = useLoaderData<typeof loader>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editRole, setEditRole] = useState<RoleProfile | null>(null);

  if (forbidden) return <AccessDenied />;

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: m.settings_crumb_settings(), href: "/settings" }, { label: m.settings_inspection_roles_heading() }]} />

      <RolesTable
        roleProfiles={roleProfiles as RoleProfile[]}
        onEdit={(p) => { setEditRole(p); setModalOpen(true); }}
        onCreate={() => { setEditRole(null); setModalOpen(true); }}
      />

      <RoleProfileModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        profile={editRole}
        templates={messageTemplates as MessageTemplateOption[]}
      />
    </div>
  );
}
