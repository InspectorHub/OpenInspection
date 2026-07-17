import type { useFetcher } from "react-router";
import type { AgentResult } from "../NewInspectionWizard";
import { m } from "~/paraglide/messages";

export function PeopleStep({
  clientName,
  setClientName,
  clientEmail,
  setClientEmail,
  clientPhone,
  setClientPhone,
  clientNameMissing,
  selectedAgent,
  newAgentMode,
  setNewAgentMode,
  newAgentName,
  setNewAgentName,
  newAgentEmail,
  setNewAgentEmail,
  agentSearch,
  agentDropdownOpen,
  setAgentDropdownOpen,
  agentFetcher,
  handleAgentSearchChange,
  selectAgent,
  clearAgent,
  enableNewAgentMode,
}: {
  clientName: string;
  setClientName: (v: string) => void;
  clientEmail: string;
  setClientEmail: (v: string) => void;
  clientPhone: string;
  setClientPhone: (v: string) => void;
  clientNameMissing: boolean;
  selectedAgent: AgentResult | null;
  newAgentMode: boolean;
  setNewAgentMode: (v: boolean) => void;
  newAgentName: string;
  setNewAgentName: (v: string) => void;
  newAgentEmail: string;
  setNewAgentEmail: (v: string) => void;
  agentSearch: string;
  agentDropdownOpen: boolean;
  setAgentDropdownOpen: (v: boolean) => void;
  agentFetcher: ReturnType<typeof useFetcher<{ intent: "search-agents"; agents: AgentResult[] }>>;
  handleAgentSearchChange: (value: string) => void;
  selectAgent: (agent: AgentResult) => void;
  clearAgent: () => void;
  enableNewAgentMode: () => void;
}) {
  return (
    <div className="space-y-5">
      {/* CLIENT section */}
      <div className="space-y-3">
        <p className="text-[12px] font-bold text-ih-fg-3 uppercase tracking-wide">{m.newinsp_people_client_section()}</p>
        <div>
          <label className="block text-[12px] font-bold text-ih-fg-3 mb-1.5">{m.newinsp_people_name_label()}</label>
          <input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder={m.newinsp_people_client_name_ph()}
            className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
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
              onChange={(e) => handleAgentSearchChange(e.target.value)}
              onBlur={() => {
                // Small delay so click on dropdown item fires first.
                setTimeout(() => setAgentDropdownOpen(false), 150);
              }}
              placeholder={m.newinsp_people_search_ph()}
              className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none placeholder:text-ih-fg-4"
            />
            {agentDropdownOpen && (
              <div className="absolute z-10 w-full mt-1 rounded-md border border-ih-border bg-ih-bg-card shadow-ih-popover overflow-hidden">
                {agentFetcher.state === "submitting" || agentFetcher.state === "loading" ? (
                  <p className="px-3 py-2 text-[12px] text-ih-fg-4">{m.newinsp_people_searching()}</p>
                ) : agentFetcher.data?.agents && agentFetcher.data.agents.length > 0 ? (
                  agentFetcher.data.agents.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onMouseDown={() => selectAgent(a)}
                      className="w-full text-left px-3 py-2 text-[13px] hover:bg-ih-bg-muted border-b border-ih-border last:border-b-0"
                    >
                      <span className="font-medium">{a.name}</span>
                      {a.email ? <span className="ml-2 text-ih-fg-4 text-[12px]">{a.email}</span> : null}
                    </button>
                  ))
                ) : agentFetcher.data ? (
                  <p className="px-3 py-2 text-[12px] text-ih-fg-4">{m.newinsp_people_no_agents()}</p>
                ) : null}
              </div>
            )}
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
