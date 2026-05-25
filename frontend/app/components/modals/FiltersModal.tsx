import { useState } from "react";

interface Agent {
  id: string;
  name: string;
  email: string;
}

interface Tag {
  id: string;
  name: string;
}

interface FilterValues {
  dateFrom: string;
  dateTo: string;
  agentId: string;
  tagIds: string[];
}

interface FiltersModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (filters: FilterValues) => void;
  agents?: Agent[];
  tags?: Tag[];
}

export function FiltersModal({ open, onClose, onApply, agents = [], tags = [] }: FiltersModalProps) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [agentId, setAgentId] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);

  if (!open) return null;

  function handleReset() {
    setDateFrom("");
    setDateTo("");
    setAgentId("");
    setTagIds([]);
    onApply({ dateFrom: "", dateTo: "", agentId: "", tagIds: [] });
    onClose();
  }

  function handleApply() {
    onApply({ dateFrom, dateTo, agentId, tagIds });
    onClose();
  }

  function toggleTag(id: string) {
    setTagIds((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label="Filters">
      <div className="max-w-md w-full p-6 bg-white dark:bg-slate-800 rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4 text-slate-900 dark:text-slate-100">Filters</h2>

        <label className="block mb-3">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Date range</span>
          <div className="flex gap-2">
            <input className="flex-1 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <input className="flex-1 px-2 py-1 border border-slate-200 dark:border-slate-600 rounded text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </label>

        <label className="block mb-3">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Agent</span>
          <select className="w-full px-2 py-1 border border-slate-200 dark:border-slate-600 rounded text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">Any</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
          </select>
        </label>

        <label className="block mb-3">
          <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Tags</span>
          <div className="flex flex-wrap gap-1">
            {tags.length === 0 ? (
              <p className="text-xs text-slate-400">No tags yet.</p>
            ) : tags.map((t) => (
              <label key={t.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-xs font-medium cursor-pointer">
                <input type="checkbox" checked={tagIds.includes(t.id)} onChange={() => toggleTag(t.id)} className="w-3 h-3" />
                <span>{t.name}</span>
              </label>
            ))}
          </div>
        </label>

        <footer className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
          <button className="px-3 h-9 rounded-md text-sm text-slate-500 hover:text-rose-600" onClick={handleReset}>Reset</button>
          <button className="px-3 h-9 rounded-md border border-slate-200 dark:border-slate-600 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300" onClick={onClose}>Cancel</button>
          <button className="px-3 h-9 rounded-md bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700" onClick={handleApply}>Apply</button>
        </footer>
      </div>
    </div>
  );
}
