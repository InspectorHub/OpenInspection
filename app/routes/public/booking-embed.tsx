import { useEffect, useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/booking-embed";
import { createApi } from "~/lib/api-client.server";

export function meta() {
  return [{ title: "Book inspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface EmbedData {
  slug: string;
  inspectorId: string;
  inspectorName: string;
  tenantSubdomain: string;
  siteKey: string;
  theme: "light" | "dark" | "branded";
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  // Branded mode currently renders as light — backlog C-6 will wire tenant.primaryColor through the public booking API.
  const raw = url.searchParams.get("style");
  const theme: EmbedData["theme"] =
    raw === "dark" ? "dark" : raw === "branded" ? "branded" : "light";
  try {
    const api = createApi(context);
    const res = await api.bookings.book[":tenant"][":slug"].$get({
      param: { tenant: params.tenant ?? "", slug: params.slug ?? "" },
    });
    const body = res.ok ? await res.json() : {};
    // Shape returned by GET /api/public/book/:tenant/:slug — see server/api/bookings.ts:
    //   { inspectorId, name, company, avatar, turnstileSiteKey, services }
    // NOTE: the field names here (`name`, `turnstileSiteKey`) differ from this
    // route's EmbedData; map them explicitly rather than relying on matching keys.
    const d = res.ok
      ? (((body as Record<string, unknown>).data ?? null) as
          | {
              inspectorId?: string;
              name?: string;
              turnstileSiteKey?: string | null;
            }
          | null)
      : null;
    return {
      data: d
        ? ({
            slug: params.slug ?? "",
            inspectorId: d.inspectorId ?? "",
            inspectorName: d.name ?? "Inspector",
            tenantSubdomain: params.tenant ?? "",
            siteKey: d.turnstileSiteKey ?? "",
            theme,
          } satisfies EmbedData)
        : null,
      error: res.ok ? null : "Not found",
    };
  } catch {
    return { data: null, error: "Service unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/*  Page (no layout -- standalone iframe)                              */
/* ------------------------------------------------------------------ */

export default function BookingEmbedPage() {
  const { data, error } = useLoaderData<typeof loader>();

  useEffect(() => {
    if (typeof document === "undefined") return;
    const isDark = data && (data as EmbedData).theme === "dark";
    document.documentElement.setAttribute("data-color-scheme", isDark ? "dark" : "light");
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [data]);

  if (error || !data) {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ color: "#64748b", fontSize: 13 }}>Booking unavailable.</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="bg-ih-bg-card border border-ih-border rounded-xl p-5">
        <h2 className="text-base font-bold text-ih-fg-1 mb-1">
          Book with {data.inspectorName}
        </h2>
        <p className="text-[13px] text-ih-fg-3 mb-4">
          Pick a date and we'll confirm by email.
        </p>
        <BookingForm data={data} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Booking form fragment                                              */
/* ------------------------------------------------------------------ */

function BookingForm({ data }: { data: EmbedData }) {
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);

    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/public/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: fd.get("slug"),
          inspectorId: fd.get("inspectorId"),
          address: fd.get("address"),
          clientName: fd.get("clientName"),
          clientEmail: fd.get("clientEmail"),
          clientPhone: fd.get("clientPhone") || undefined,
          date: fd.get("date"),
          turnstileToken: fd.get("cf-turnstile-response") || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && (json as Record<string, unknown>).success) {
        setStatus({ text: "Booking request sent! Check your email.", ok: true });
        // Notify parent iframe
        window.parent?.postMessage(
          { type: "oi-embed", kind: "success", slug: data.slug },
          "*",
        );
      } else {
        const err = (json as Record<string, Record<string, string>>)?.error;
        setStatus({ text: err?.message || "Could not submit", ok: false });
      }
    } catch {
      setStatus({ text: "Network error", ok: false });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="hidden" name="slug" value={data.slug} />
      <input type="hidden" name="inspectorId" value={data.inspectorId} />

      <div className="mb-3">
        <label className="block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1">
          Property address
        </label>
        <input
          type="text"
          name="address"
          required
          placeholder="123 Main St, Austin, TX"
          className="w-full px-2.5 py-2 border border-ih-border rounded-md text-sm bg-ih-bg-card text-ih-fg-1 outline-none focus:border-indigo-500 focus:shadow-ih-focus"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1">
            Your name
          </label>
          <input
            type="text"
            name="clientName"
            required
            placeholder="Jane Doe"
            className="w-full px-2.5 py-2 border border-ih-border rounded-md text-sm bg-ih-bg-card text-ih-fg-1 outline-none focus:border-indigo-500 focus:shadow-ih-focus"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1">
            Email
          </label>
          <input
            type="email"
            name="clientEmail"
            required
            placeholder="jane@example.com"
            className="w-full px-2.5 py-2 border border-ih-border rounded-md text-sm bg-ih-bg-card text-ih-fg-1 outline-none focus:border-indigo-500 focus:shadow-ih-focus"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1">
            Phone
          </label>
          <input
            type="tel"
            name="clientPhone"
            placeholder="(555) 555-5555"
            className="w-full px-2.5 py-2 border border-ih-border rounded-md text-sm bg-ih-bg-card text-ih-fg-1 outline-none focus:border-indigo-500 focus:shadow-ih-focus"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1">
            Preferred date
          </label>
          <input
            type="date"
            name="date"
            required
            className="w-full px-2.5 py-2 border border-ih-border rounded-md text-sm bg-ih-bg-card text-ih-fg-1 outline-none focus:border-indigo-500 focus:shadow-ih-focus"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full px-4 py-3 bg-ih-primary text-white rounded-lg font-bold text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        {submitting ? "Submitting..." : "Request booking"}
      </button>

      {status && (
        <div
          className={`mt-3 text-[13px] ${
            status.ok ? "text-green-700 dark:text-green-400" : "text-ih-bad-fg"
          }`}
        >
          {status.text}
        </div>
      )}
    </form>
  );
}
