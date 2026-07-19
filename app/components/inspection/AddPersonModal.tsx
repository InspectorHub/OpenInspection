import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Modal, Button, Input, Select } from "@core/shared-ui";
import type { action } from "~/routes/inspection-hub";
import type { RoleProfile } from "~/components/contacts/contacts-helpers";
import { m } from "~/paraglide/messages";

/** A contact returned by the "search-contacts" hub action intent. */
export interface ContactSearchResult {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  agency: string | null;
}

/**
 * "Add person" modal (Plan 1B Task 5). Either search/select an existing
 * contact (typeahead, mirroring NewInspectionWizard's agent search) OR
 * create one inline, then pick the role profile the contact will occupy on
 * the inspection, and submit — the caller's `fetcher` posts the "person-add"
 * intent to the hub route action.
 */
export function AddPersonModal({
  open,
  onClose,
  roleProfiles,
  isAdmin,
  fetcher,
}: {
  open: boolean;
  onClose: () => void;
  roleProfiles: RoleProfile[];
  isAdmin: boolean;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
}) {
  // Dedicated fetcher for the contact typeahead — independent of `fetcher`
  // (the add mutation). A debounced search must never cancel an in-flight
  // add, and vice versa (RR shared-fetcher-abort).
  const searchFetcher = useFetcher<{ intent: "search-contacts"; contacts: ContactSearchResult[] }>();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [search, setSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactSearchResult | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newAgency, setNewAgency] = useState("");
  const [roleProfileId, setRoleProfileId] = useState("");

  const activeRoles = roleProfiles.filter((r) => r.active);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setDropdownOpen(false);
      setSelectedContact(null);
      setCreateMode(false);
      setNewName("");
      setNewEmail("");
      setNewPhone("");
      setNewAgency("");
      setRoleProfileId("");
    }
  }, [open]);

  function handleSearchChange(value: string) {
    setSearch(value);
    setDropdownOpen(value.trim().length >= 2);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length >= 2) {
      debounceRef.current = setTimeout(() => {
        searchFetcher.submit({ intent: "search-contacts", search: value.trim() }, { method: "post" });
      }, 300);
    }
  }

  function selectContact(contact: ContactSearchResult) {
    setSelectedContact(contact);
    setSearch("");
    setDropdownOpen(false);
    setCreateMode(false);
  }

  function clearContact() {
    setSelectedContact(null);
  }

  const submitting = fetcher.state !== "idle";
  const error =
    fetcher.data?.intent === "person-add" && !fetcher.data.ok ? fetcher.data.error : undefined;

  const roleKind = activeRoles.find((r) => r.id === roleProfileId)?.kind;
  const newContactType = roleKind === "agent" ? "agent" : "client";

  const canSubmit =
    roleProfileId.length > 0 && (createMode ? newName.trim().length > 0 : selectedContact !== null);

  function handleSubmit() {
    if (!canSubmit) return;
    if (createMode) {
      fetcher.submit(
        {
          intent: "person-add",
          roleProfileId,
          newContactName: newName.trim(),
          newContactEmail: newEmail.trim(),
          newContactPhone: newPhone.trim(),
          newContactAgency: newAgency.trim(),
          newContactType,
        },
        { method: "post" },
      );
      return;
    }
    if (selectedContact) {
      fetcher.submit(
        { intent: "person-add", roleProfileId, contactId: selectedContact.id },
        { method: "post" },
      );
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={m.inspections_hub_people_modal_title()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {m.common_cancel()}
          </Button>
          <Button variant="primary" disabled={!canSubmit || submitting} onClick={handleSubmit}>
            {submitting ? m.inspections_hub_people_adding() : m.inspections_hub_people_submit()}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Contact picker: search/select existing, or create inline. */}
        <div>
          <label className="block text-xs font-bold text-ih-fg-2 mb-1">
            {m.inspections_hub_people_contact_label()}
          </label>
          {selectedContact ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-ih-primary bg-ih-primary-tint">
              <span className="flex-1 text-[13px] font-medium text-ih-primary">
                {selectedContact.name}
                {selectedContact.email && (
                  <span className="ml-1 text-ih-fg-4 font-normal text-[12px]">({selectedContact.email})</span>
                )}
              </span>
              <button
                type="button"
                onClick={clearContact}
                className="text-ih-fg-4 hover:text-ih-fg-2 text-base leading-none"
                aria-label={m.inspections_hub_people_clear_contact_aria()}
              >
                &times;
              </button>
            </div>
          ) : createMode ? (
            <div className="space-y-3 p-3 rounded-md border border-ih-border bg-ih-bg-muted">
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-bold text-ih-fg-3">{m.inspections_hub_people_new_contact_title()}</p>
                <button
                  type="button"
                  onClick={() => setCreateMode(false)}
                  className="text-[12px] text-ih-fg-4 hover:text-ih-fg-2"
                >
                  {m.common_cancel()}
                </button>
              </div>
              <Input
                label={m.inspections_hub_people_name_label()}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={m.inspections_hub_people_name_ph()}
              />
              <Input
                label={m.inspections_hub_people_email_label()}
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder={m.inspections_hub_people_email_ph()}
              />
              <Input
                label={m.inspections_hub_people_phone_label()}
                type="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder={m.inspections_hub_people_phone_ph()}
              />
              <Input
                label={m.inspections_hub_people_agency_label()}
                value={newAgency}
                onChange={(e) => setNewAgency(e.target.value)}
                placeholder={m.inspections_hub_people_agency_ph()}
              />
            </div>
          ) : (
            <div className="relative">
              <Input
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                onBlur={() => {
                  // Small delay so a click on a dropdown item fires first.
                  setTimeout(() => setDropdownOpen(false), 150);
                }}
                placeholder={m.inspections_hub_people_search_ph()}
              />
              {dropdownOpen && (
                <div className="absolute z-10 w-full mt-1 rounded-md border border-ih-border bg-ih-bg-card shadow-ih-popover overflow-hidden">
                  {searchFetcher.state === "submitting" || searchFetcher.state === "loading" ? (
                    <p className="px-3 py-2 text-[12px] text-ih-fg-4">{m.inspections_hub_people_searching()}</p>
                  ) : searchFetcher.data?.contacts && searchFetcher.data.contacts.length > 0 ? (
                    searchFetcher.data.contacts.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={() => selectContact(c)}
                        className="w-full text-left px-3 py-2 text-[13px] hover:bg-ih-bg-muted border-b border-ih-border last:border-b-0"
                      >
                        <span className="font-medium">{c.name}</span>
                        {c.email && <span className="ml-2 text-ih-fg-4 text-[12px]">{c.email}</span>}
                      </button>
                    ))
                  ) : searchFetcher.data ? (
                    <p className="px-3 py-2 text-[12px] text-ih-fg-4">{m.inspections_hub_people_no_contacts()}</p>
                  ) : null}
                </div>
              )}
            </div>
          )}
          {!selectedContact && !createMode && (
            <button
              type="button"
              onClick={() => setCreateMode(true)}
              className="mt-2 text-[12px] font-medium text-ih-primary hover:underline"
            >
              {m.inspections_hub_people_create_new()}
            </button>
          )}
        </div>

        {/* Role picker. */}
        <Select
          label={m.inspections_hub_people_role_label()}
          value={roleProfileId}
          onChange={(e) => setRoleProfileId(e.target.value)}
          options={[
            { value: "", label: m.inspections_hub_people_role_placeholder(), disabled: true },
            ...activeRoles.map((r) => ({ value: r.id, label: r.label })),
          ]}
          hint={
            activeRoles.length === 0
              ? isAdmin
                ? m.inspections_hub_people_no_roles_admin()
                : m.inspections_hub_people_no_roles_non_admin()
              : undefined
          }
        />

        {error && <p className="text-[12px] font-medium text-ih-bad-fg">{error}</p>}
      </div>
    </Modal>
  );
}
