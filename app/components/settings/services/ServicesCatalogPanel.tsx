import { Form } from "react-router";
import { Table } from "@core/shared-ui";
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
      <Table<Service>
        rows={services}
        getRowKey={(svc) => svc.id}
        empty={
          <p className="py-10 text-center text-[13px] text-ih-fg-3">
            No services yet. Click "Add service" to create your first.
          </p>
        }
        columns={[
          {
            label: "Name",
            cell: (svc) => (
              <>
                <p className="text-[13px] font-medium text-ih-fg-1">{svc.name}</p>
                {svc.description && (
                  <p className="text-[11px] text-ih-fg-3 mt-0.5 line-clamp-1">{svc.description}</p>
                )}
                <QualificationWidget
                  service={svc}
                  initialUserIds={restrictionMap[svc.id] ?? []}
                  members={members}
                />
              </>
            ),
          },
          { label: "Duration", cell: () => <span className="text-ih-fg-3">&mdash;</span> },
          {
            label: "Price",
            cell: (svc) => <span className="font-bold text-ih-ok-fg">${((svc.price || 0) / 100).toFixed(2)}</span>,
          },
          {
            label: "Status",
            cell: (svc) => (
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                svc.active
                  ? "bg-ih-ok-bg text-ih-ok-fg"
                  : "bg-ih-bg-muted text-ih-fg-3"
              }`}>
                {svc.active ? "Active" : "Inactive"}
              </span>
            ),
          },
          {
            label: "Actions",
            align: "right",
            cell: (svc) => (
              <Form method="post" className="inline">
                <input type="hidden" name="intent" value="toggle-service" />
                <input type="hidden" name="id" value={svc.id} />
                <input type="hidden" name="active" value={String(svc.active)} />
                <button type="submit" className="text-[12px] font-semibold text-ih-primary hover:underline">
                  {svc.active ? "Deactivate" : "Activate"}
                </button>
              </Form>
            ),
          },
        ]}
      />
    </div>
  );
}
