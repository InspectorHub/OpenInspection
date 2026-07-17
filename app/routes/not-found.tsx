import { Link } from "react-router";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.misc_not_found_meta_title() }];
}

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ih-bg-card">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-ih-fg-4">
          404
        </h1>
        <p className="text-lg font-semibold text-ih-fg-2 mt-4">
          {m.misc_not_found_heading()}
        </p>
        <p className="text-[13px] text-ih-fg-3 mt-2 max-w-sm">
          {m.misc_not_found_desc()}
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 mt-6 h-9 px-4 rounded-md bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600 transition-colors"
        >
          {m.misc_not_found_home()}
        </Link>
      </div>
    </div>
  );
}
