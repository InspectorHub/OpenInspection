/**
 * <PublicNotice> — the canonical full-page status/error screen for PUBLIC routes
 * (no app shell, no auth). Matches the house style of `public/inspector-not-found`
 * so every public gated/error page reads consistently: a vertically + horizontally
 * centered card on the app card background, serif heading, muted body copy.
 *
 * Use this from a STANDALONE public route's component when the loader resolves a
 * non-OK state. Do NOT use it for content rendered INLINE inside another page's
 * chrome (e.g. a Hub section) — those keep bare mini-cards.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import type { ReactNode } from "react";

export function PublicNotice({
  title,
  children,
  tone = "default",
}: {
  title: string;
  /** Body copy — string or rich nodes. */
  children: ReactNode;
  /** `error` tints the heading with the danger token; `default` is neutral. */
  tone?: "default" | "error";
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-ih-bg-card">
      <div className="max-w-[420px] text-center">
        <h1
          className={`font-serif text-[32px] font-semibold mb-4 ${
            tone === "error" ? "text-ih-bad-fg" : "text-ih-fg-1"
          }`}
        >
          {title}
        </h1>
        <div className="text-ih-fg-3 text-[15px] leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
