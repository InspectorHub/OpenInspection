import type { useContactSearch } from "~/hooks/useContactSearch";
import type { AgentResult, ClientResult } from "../NewInspectionWizard";
import { ContactSuggestions } from "./ContactSuggestions";
import { m } from "~/paraglide/messages";

type ClientSearch = ReturnType<
  typeof useContactSearch<{ intent: "search-clients"; clients: ClientResult[] }>
>;
type AgentSearch = ReturnType<
  typeof useContactSearch<{ intent: "search-agents"; agents: AgentResult[] }>
>;

export function PeopleStep({
  clientName,
  clientEmail,
  setClientEmail,
  clientPhone,
  setClientPhone,
  clientNameMissing,
  clientSearch,
  selectClient,
  selectedAgent,
  newAgentMode,
  setNewAgentMode,
  newAgentName,
  setNewAgentName,
  newAgentEmail,
  setNewAgentEmail,
  agentSearch,
  agentSearchCtl,
  selectAgent,
  clearAgent,
  enableNewAgentMode,
}: {
  clientName: string;
  clientEmail: string;
  setClientEmail: (v: string) => void;
  clientPhone: string;
  setClientPhone: (v: string) => void;
  clientNameMissing: boolean;
  clientSearch: ClientSearch;
  selectClient: (client: ClientResult) => void;
  selectedAgent: AgentResult | null;
  newAgentMode: boolean;
  setNewAgentMode: (v: boolean) => void;
  newAgentName: string;
  setNewAgentName: (v: string) => void;
  newAgentEmail: string;
  setNewAgentEmail: (v: string) => void;
  agentSearch: string;
  agentSearchCtl: AgentSearch;
  selectAgent: (agent: AgentResult) => void;
  clearAgent: () => void;
  enableNewAgentMode: () => void;
}) {
  return (
    <div className="space-y-5">
      {/* CLIENT section */}
      <div className="space-y-3">
        <p className="text-[12px] font-bold text-ih-fg-3 uppercase tracking-wide">{m.newinsp_people_client_section()}</p>
        {/* The client is searched from Contacts as it is typed — the agent field
            always was, and a repeat client had to be re-typed by hand (email and
            phone included) beside a field that could have found them. Picking a
            contact fills all three fields; typing a new name is still fine. */}
        <div className="relative">
          <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_people_name_label()}</label>
          <input
            value={clientName}
            onChange={(e) => clientSearch.onQueryChange(e.target.value)}
            onBlur={() => {
              // Delay so a click on a suggestion lands before the list closes.
              setTimeout(() => clientSearch.setDropdownOpen(false), 150);
            }}
            placeholder={m.newinsp_people_client_search_ph()}
            className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
          />
          <ContactSuggestions
            open={clientSearch.dropdownOpen}
            loading={clientSearch.fetcher.state === "submitting" || clientSearch.fetcher.state === "loading"}
            contacts={clientSearch.fetcher.data?.clients}
            emptyLabel={m.newinsp_people_no_clients()}
            onPick={selectClient}
          />
          {clientNameMissing && (
            <p className="text-[12px] text-ih-danger mt-1">{m.newinsp_people_name_required()}</p>
          )}
          {!clientNameMissing && clientName.trim().length > 0 && clientEmail.trim().length === 0 && (
            <p className="text-[12px] text-ih-fg-4 mt-1">{m.newinsp_people_email_hint()}</p>
          )}
        </div>
        <div>
          <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_people_email_label()}</label>
          <input
            type="email"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            placeholder={m.newinsp_people_client_email_ph()}
            className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
          />
        </div>
        <div>
          <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_people_phone_label()}</label>
          <input
            type="tel"
            value={clientPhone}
            onChange={(e) => setClientPhone(e.target.value)}
            placeholder={m.newinsp_people_phone_ph()}
            className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
          />
        </div>
      </div>

      {/* AGENT section */}
      <div className="space-y-3">
        <p className="text-[12px] font-bold text-ih-fg-3 uppercase tracking-wide">{m.newinsp_people_agent_section()}</p>

        {selectedAgent ? (
          /* Chip for the selected agent */
          <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-ih-primary bg-ih-primary-tint">
            <span className="flex-1 text-[13px] font-medium text-ih-primary">
              {selectedAgent.name}
              {selectedAgent.email ? <span className="ml-1 text-ih-fg-4 font-normal text-[12px]">({selectedAgent.email})</span> : null}
            </span>
            <button
              type="button"
              onClick={clearAgent}
              className="text-ih-fg-4 hover:text-ih-fg-2 text-base leading-none"
              aria-label={m.newinsp_people_remove_agent_aria()}
            >&times;</button>
          </div>
        ) : newAgentMode ? (
          /* Inline new-agent form */
          <div className="space-y-3 p-3 rounded-md border border-ih-border bg-ih-bg-muted">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[12px] font-bold text-ih-fg-3">{m.newinsp_people_new_agent_title()}</p>
              <button
                type="button"
                onClick={() => setNewAgentMode(false)}
                className="text-[12px] text-ih-fg-4 hover:text-ih-fg-2"
              >{m.common_cancel()}</button>
            </div>
            <div>
              <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_people_name_label()}</label>
              <input
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                placeholder={m.newinsp_people_agent_name_ph()}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
              />
            </div>
            <div>
              <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_people_email_label()}</label>
              <input
                type="email"
                value={newAgentEmail}
                onChange={(e) => setNewAgentEmail(e.target.value)}
                placeholder={m.newinsp_people_agent_email_ph()}
                className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
              />
            </div>
          </div>
        ) : (
          /* Typeahead search */
          <div className="relative">
            <input
              value={agentSearch}
              onChange={(e) => agentSearchCtl.onQueryChange(e.target.value)}
              onBlur={() => {
                // Small delay so click on dropdown item fires first.
                setTimeout(() => agentSearchCtl.setDropdownOpen(false), 150);
              }}
              placeholder={m.newinsp_people_search_ph()}
              className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
            />
            <ContactSuggestions
              open={agentSearchCtl.dropdownOpen}
              loading={agentSearchCtl.fetcher.state === "submitting" || agentSearchCtl.fetcher.state === "loading"}
              contacts={agentSearchCtl.fetcher.data?.agents}
              emptyLabel={m.newinsp_people_no_agents()}
              onPick={selectAgent}
            />
          </div>
        )}

        {!selectedAgent && !newAgentMode && (
          <button
            type="button"
            onClick={enableNewAgentMode}
            className="text-[12px] font-medium text-ih-primary hover:underline"
          >{m.newinsp_people_add_agent()}</button>
        )}
      </div>
    </div>
  );
}
