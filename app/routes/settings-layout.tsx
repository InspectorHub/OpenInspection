import { Outlet } from "react-router";
import { PageHeader } from "@core/shared-ui";

export default function SettingsLayout() {
  return (
    <div>
      <PageHeader eyebrow="SETTINGS" eyebrowColor="slate" title="Settings" />
      <div className="mt-[18px]">
        <Outlet />
      </div>
    </div>
  );
}
