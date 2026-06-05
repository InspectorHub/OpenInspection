import { Outlet } from "react-router";

export default function PublicLayout() {
  return (
    <div className="min-h-screen bg-ih-bg-card text-ih-fg-1">
      <Outlet />
    </div>
  );
}
