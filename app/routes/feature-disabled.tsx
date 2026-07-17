import { Link } from "react-router";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.misc_feature_disabled_meta_title() }];
}

export default function FeatureDisabledPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ih-bg-card">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-ih-watch-bg flex items-center justify-center">
          <svg
            className="w-8 h-8 text-ih-watch"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01M10.29 3.86l-8.6 14.86A1 1 0 002.56 20h18.88a1 1 0 00.87-1.28l-8.6-14.86a1 1 0 00-1.72 0z"
            />
          </svg>
        </div>
        <p className="text-lg font-semibold text-ih-fg-2">
          {m.misc_feature_disabled_heading()}
        </p>
        <p className="text-[13px] text-ih-fg-3 mt-2 max-w-sm mx-auto">
          {m.misc_feature_disabled_desc()}
        </p>
        <Link
          to="/inspections"
          className="inline-flex items-center gap-1.5 mt-6 h-9 px-4 rounded-md bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600 transition-colors"
        >
          {m.misc_feature_disabled_back()}
        </Link>
      </div>
    </div>
  );
}
