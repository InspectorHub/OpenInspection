import { Outlet } from "react-router";
import { PageHeader } from "@core/shared-ui";

export default function LibraryLayout() {
  return (
    <div>
      <PageHeader title="Library" />
      <div className="mt-ih-list">
        <Outlet />
      </div>
    </div>
  );
}
