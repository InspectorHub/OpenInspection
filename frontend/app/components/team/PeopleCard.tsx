interface Person {
  name: string;
  email?: string;
  phone?: string;
}

interface PeopleCardProps {
  inspector?: Person | null;
  client?: Person | null;
  buyerAgents?: Person[];
  listingAgents?: Person[];
}

const CHIP = {
  inspector:     { label: "Inspector",      bg: "#eef2ff", fg: "#4338ca" },
  client:        { label: "Buyer",          bg: "#f0fdf4", fg: "#166534" },
  agent_buyer:   { label: "Buyer's Agent",  bg: "#ecfeff", fg: "#0e7490" },
  agent_listing: { label: "Listing Agent",  bg: "#fef3c7", fg: "#92400e" },
} as const;

type ChipKind = keyof typeof CHIP;

function initials(name: string): string {
  return (name || "").trim().split(/\s+/).slice(0, 2).map((s) => s.charAt(0).toUpperCase()).join("");
}

function PersonRow({ person, kind, suffix }: { person: Person; kind: ChipKind; suffix?: string }) {
  const chip = CHIP[kind];
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold ring-1 ring-inset" style={{ background: chip.bg, color: chip.fg, "--tw-ring-color": `${chip.fg}33` } as React.CSSProperties}>
        {initials(person.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-semibold text-slate-900 truncate">{person.name}</span>
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full whitespace-nowrap" style={{ background: chip.bg, color: chip.fg }}>{chip.label}</span>
          {suffix && <span className="px-2 py-0.5 text-[10px] font-bold rounded-full whitespace-nowrap bg-slate-100 text-slate-600">{suffix}</span>}
        </div>
        <div className="text-[12px] mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {person.email && <a href={`mailto:${person.email}`} className="text-indigo-600 hover:underline">{person.email}</a>}
          {person.phone && <a href={`tel:${person.phone}`} className="text-indigo-600 hover:underline">{person.phone}</a>}
          {!person.email && !person.phone && <span className="text-slate-400 italic">No contact info</span>}
        </div>
      </div>
    </div>
  );
}

export function PeopleCard({ inspector, client, buyerAgents = [], listingAgents = [] }: PeopleCardProps) {
  const total = (inspector ? 1 : 0) + (client ? 1 : 0) + buyerAgents.length + listingAgents.length;
  if (total === 0) return null;

  return (
    <section className="bg-white border border-slate-200 rounded-md p-5">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-[14px] font-bold tracking-tight text-slate-900">People</h2>
        <span className="text-[10px] font-mono text-slate-400">{total} total</span>
      </header>
      <div className="divide-y divide-slate-100">
        {inspector && <PersonRow person={inspector} kind="inspector" />}
        {client && <PersonRow person={client} kind="client" />}
        {buyerAgents.map((a, idx) => (
          <PersonRow key={`buyer-${idx}`} person={a} kind="agent_buyer" suffix={buyerAgents.length > 1 ? `· ${idx + 1}/${buyerAgents.length}` : undefined} />
        ))}
        {listingAgents.map((a, idx) => (
          <PersonRow key={`listing-${idx}`} person={a} kind="agent_listing" suffix={listingAgents.length > 1 ? `· ${idx + 1}/${listingAgents.length}` : undefined} />
        ))}
      </div>
    </section>
  );
}
