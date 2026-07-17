import { Outlet } from "react-router";
import { PageHeader } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export default function SettingsLayout() {
  return (
    <div>
      <PageHeader title={m.settings_crumb_settings()} />
      <div className="mt-ih-list max-w-3xl">
        <Outlet />
      </div>
    </div>
  );
}
