import { Outlet } from "react-router";
import { PageHeader } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export default function LibraryLayout() {
  return (
    <div>
      <PageHeader title={m.library_layout_title()} />
      <div className="mt-ih-list">
        <Outlet />
      </div>
    </div>
  );
}
