import { Form } from "react-router";
import { QualificationWidget } from "./QualificationWidget";

interface Service {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  active: boolean;
}

interface Member {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

interface ServicesCatalogPanelProps {
  services: Service[];
  restrictionMap: Record<string, string[]>;
  members: Member[];
}

export function ServicesCatalogPanel({ services, restrictionMap, members }: ServicesCatalogPanelProps) {
  return (
    <div className="bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-ih-border">
            <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Name</th>
            <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Duration</th>
            <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Price</th>
            <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4">Status</th>
            <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {services.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-10 text-center text-[13px] text-ih-fg-3">
                No services yet. Click "Add service" to create your first.
              </td>
            </tr>
          ) : (
            services.map((svc) => (
              <tr key={svc.id} className="border-b border-ih-border last:border-b-0 hover:bg-ih-bg-muted transition-colors">
                <td className="py-3 px-4">
                  <p className="text-[13px] font-medium text-ih-fg-1">{svc.name}</p>
                  {svc.description && (
                    <p className="text-[11px] text-ih-fg-3 mt-0.5 line-clamp-1">{svc.description}</p>
                  )}
                  <QualificationWidget
                    service={svc}
                    initialUserIds={restrictionMap[svc.id] ?? []}
                    members={members}
                  />
                </td>
                <td className="py-3 px-4 text-[13px] text-ih-fg-3">&mdash;</td>
                <td className="py-3 px-4 text-[13px] font-bold text-ih-ok-fg">
                  ${((svc.price || 0) / 100).toFixed(2)}
                </td>
                <td className="py-3 px-4">
                  <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
 svc.active
 ? "bg-ih-ok-bg text-ih-ok-fg"
 : "bg-ih-bg-muted text-ih-fg-3"
 }`}>
                    {svc.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="py-3 px-4 text-right">
                  <Form method="post" className="inline">
                    <input type="hidden" name="intent" value="toggle-service" />
                    <input type="hidden" name="id" value={svc.id} />
                    <input type="hidden" name="active" value={String(svc.active)} />
                    <button type="submit" className="text-[12px] font-semibold text-ih-primary hover:underline">
                      {svc.active ? "Deactivate" : "Activate"}
                    </button>
                  </Form>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
