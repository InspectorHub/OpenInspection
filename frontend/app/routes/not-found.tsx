import { Link } from "react-router";

export function meta() {
  return [{ title: "Page Not Found - OpenInspection" }];
}

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-900">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-slate-300 dark:text-slate-600">
          404
        </h1>
        <p className="text-lg font-semibold text-slate-700 dark:text-slate-200 mt-4">
          Page not found
        </p>
        <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-2 max-w-sm">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 mt-6 h-9 px-4 rounded-md bg-indigo-600 text-white text-[13px] font-bold hover:bg-indigo-700 transition-colors"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
