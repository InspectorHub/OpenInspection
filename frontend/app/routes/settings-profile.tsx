import { Link } from "react-router";

export default function SettingsProfile() {
  return (
    <div className="space-y-[18px]">
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <Link to="/settings" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-slate-900 dark:text-slate-100">Profile</span>
      </div>
      <h2 className="text-[19px] font-bold text-slate-900 dark:text-slate-100">Profile</h2>
      <p className="text-[13px] text-slate-500">Coming in Phase 3</p>
    </div>
  );
}
