import { m } from "~/paraglide/messages";

/** The viewer as the sidebar and the mobile drawer show them. */
export interface UserIdentity {
  primary: string;
  /** The email, only when it adds something the primary line does not already say. */
  secondary: string | null;
}

/**
 * One line for "who is signed in", never the same text twice. A name that is
 * missing, blank or just the email collapses to the email alone; with nothing at
 * all it is the neutral word, never a role name (see Sidebar.tsx).
 */
export function userIdentity(
  user: { name?: string | null; email?: string | null } | null | undefined,
  unnamed: string,
): UserIdentity {
  const name = user?.name?.trim() ?? "";
  const email = user?.email?.trim() ?? "";
  if (name && name.toLowerCase() !== email.toLowerCase()) {
    return { primary: name, secondary: email || null };
  }
  return { primary: email || unnamed, secondary: null };
}

const ROLE_LABEL: Record<string, () => string> = {
  owner: m.settings_team_role_owner_name,
  manager: m.settings_team_role_manager_name,
  inspector: m.settings_team_role_inspector_name,
  staff: m.settings_team_role_staff_name,
};

/** The translated team role name; an unknown role is shown as stored rather than hidden. */
export function roleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  return ROLE_LABEL[role]?.() ?? role;
}
