import { Outlet } from "react-router";

export default function PublicLayout() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
      <Outlet />
    </div>
  );
}
