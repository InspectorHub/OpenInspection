import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/booking-embed";
import { apiFetch } from "~/lib/api.server";

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
  style: "full" | "compact";
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ params, request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const style = url.searchParams.get("style") === "compact" ? "compact" : "full";
  try {
    const res = await apiFetch(
      `/api/public/embed/${params.tenant}/${params.slug}`,
    );
    const json = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    const d = json.data as Partial<EmbedData> | undefined;
    return {
      data: d
        ? ({
            slug: d.slug ?? params.slug ?? "",
            inspectorId: d.inspectorId ?? "",
            inspectorName: d.inspectorName ?? "Inspector",
            tenantSubdomain: d.tenantSubdomain ?? params.tenant ?? "",
            siteKey: d.siteKey ?? "",
            style,
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
  const [showForm, setShowForm] = useState(false);

  if (error || !data) {
    return (
      <div style={{ padding: 16 }}>
        <p style={{ color: "#64748b", fontSize: 13 }}>Booking unavailable.</p>
      </div>
    );
  }

  if (data.style === "compact" && !showForm) {
    return (
      <div className="p-6 text-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
        <p className="text-[13px] text-slate-500 mb-3">
          Book with {data.inspectorName}
        </p>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full px-4 py-3 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:opacity-90 transition-opacity"
        >
          Schedule an inspection
        </button>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">
          Book with {data.inspectorName}
        </h2>
        <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-4">
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
        <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
          Property address
        </label>
        <input
          type="text"
          name="address"
          required
          placeholder="123 Main St, Austin, TX"
          className="w-full px-2.5 py-2 border border-slate-200 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
            Your name
          </label>
          <input
            type="text"
            name="clientName"
            required
            placeholder="Jane Doe"
            className="w-full px-2.5 py-2 border border-slate-200 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
            Email
          </label>
          <input
            type="email"
            name="clientEmail"
            required
            placeholder="jane@example.com"
            className="w-full px-2.5 py-2 border border-slate-200 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
            Phone
          </label>
          <input
            type="tel"
            name="clientPhone"
            placeholder="(555) 555-5555"
            className="w-full px-2.5 py-2 border border-slate-200 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">
            Preferred date
          </label>
          <input
            type="date"
            name="date"
            required
            className="w-full px-2.5 py-2 border border-slate-200 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full px-4 py-3 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        {submitting ? "Submitting..." : "Request booking"}
      </button>

      {status && (
        <div
          className={`mt-3 text-[13px] ${
            status.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {status.text}
        </div>
      )}
    </form>
  );
}
