import { Outlet, useLocation } from "react-router";
import { PageHeader } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export default function SettingsLayout() {
  // Every settings SUBPAGE renders its own header — a breadcrumb trail
  // ("Settings › Services") plus the page title. A section header here as well
  // put the page's name on screen twice and the word "Settings" twice, above
  // three lines of chrome before any content. The hub at /settings has no
  // breadcrumb of its own, so it is the one page that still needs this.
  const { pathname } = useLocation();
  const isHub = pathname.replace(/\/+$/, "") === "/settings";

  return (
    <div>
      {isHub && <PageHeader title={m.settings_crumb_settings()} />}
      <div className={`max-w-3xl ${isHub ? "mt-ih-list" : ""}`}>
        <Outlet />
      </div>
    </div>
  );
}
