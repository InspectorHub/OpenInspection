import { useLoaderData } from "react-router";
import type { Route } from "./+types/inspector-profile";
import { apiFetch } from "~/lib/api.server";

export function meta({ data }: Route.MetaArgs) {
  const d = data as LoaderResult | undefined;
  const name = d?.profile?.name ?? "Inspector";
  return [
    { title: `${name} - Home Inspector` },
    { name: "description", content: d?.profile?.bio?.slice(0, 160) || `Book a home inspection with ${name}.` },
  ];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ServiceItem {
  name: string;
  durationMinutes: number | null;
  price: number; // cents
}

interface InspectorData {
  name: string | null;
  bio: string | null;
  photoUrl: string | null;
  licenseNumber: string | null;
  email: string | null;
  phone: string | null;
  slug: string | null;
  serviceAreas: Array<{ city: string; state: string }>;
}

interface LoaderResult {
  profile: InspectorData | null;
  services: ServiceItem[];
  tenantSlug: string;
  error: string | null;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ params }: Route.LoaderArgs) {
  try {
    const res = await apiFetch(
      `/api/public/inspector/${params.tenant}/${params.slug}`,
    );
    const json = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    const data = json.data as { profile: InspectorData; services: ServiceItem[] } | undefined;
    return {
      profile: data?.profile ?? null,
      services: data?.services ?? [],
      tenantSlug: params.tenant ?? "",
      error: res.ok ? null : "Inspector not found",
    } satisfies LoaderResult;
  } catch {
    return { profile: null, services: [], tenantSlug: "", error: "Service unavailable" } satisfies LoaderResult;
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtPrice(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString();
}

function fmtDuration(min: number | null): string {
  if (min == null || min <= 0) return "";
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${min}m`;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function InspectorProfilePage() {
  const { profile, services, tenantSlug, error } =
    useLoaderData<typeof loader>() as LoaderResult;

  if (error || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <h1 className="font-serif text-[32px] font-semibold mb-4 text-slate-900 dark:text-slate-100">
            Inspector not found
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-[15px]">
            Double-check the link or contact whoever shared it.
          </p>
        </div>
      </div>
    );
  }

  const displayName = profile.name ?? "Inspector";
  const initials = displayName
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <header className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-end max-w-[1200px] mx-auto px-6 lg:px-16 pt-24 pb-12">
        <div>
          <h1 className="font-serif text-[96px] lg:text-[96px] text-[56px] font-semibold tracking-tight leading-[0.95] -translate-x-3 text-slate-900 dark:text-slate-100">
            {displayName}
          </h1>
          {profile.licenseNumber && (
            <div className="mt-4 font-mono text-xs tracking-wide uppercase text-slate-400 dark:text-slate-500">
              License {profile.licenseNumber}
            </div>
          )}
          {profile.serviceAreas.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {profile.serviceAreas.slice(0, 5).map((a) => (
                <span
                  key={`${a.city}-${a.state}`}
                  className="inline-block px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs"
                >
                  {a.city}, {a.state}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end lg:justify-end">
          {profile.photoUrl ? (
            <img
              src={profile.photoUrl}
              alt={`${displayName}, home inspector`}
              className="w-full max-w-[360px] aspect-square rounded-full object-cover translate-y-12"
            />
          ) : (
            <div className="w-full max-w-[360px] aspect-square rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center font-serif text-[96px] font-semibold">
              {initials || "I"}
            </div>
          )}
        </div>
      </header>

      {/* Bio */}
      {profile.bio && (
        <section className="max-w-[640px] mx-auto px-6 lg:px-16 py-6 text-lg leading-relaxed text-slate-600 dark:text-slate-400">
          {profile.bio}
        </section>
      )}

      {/* Services */}
      {services.length > 0 && (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-[1200px] mx-auto px-6 lg:px-16 py-12">
          {services.slice(0, 6).map((s) => (
            <article
              key={s.name}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6"
            >
              <div className="font-mono text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                {fmtDuration(s.durationMinutes)}
              </div>
              <div className="font-serif text-[32px] font-semibold mt-2 mb-2 text-slate-900 dark:text-slate-100">
                {fmtPrice(s.price)}
              </div>
              <div className="text-sm text-slate-500 dark:text-slate-400">
                {s.name}
              </div>
            </article>
          ))}
        </section>
      )}

      {/* Trust strip */}
      <div className="bg-slate-900 dark:bg-slate-800 text-white dark:text-slate-300 py-6 px-6 lg:px-16 mt-12 flex flex-wrap justify-center gap-12 text-[13px] tracking-wide">
        <span>Insured</span>
        <span>
          Licensed{profile.licenseNumber ? ` · ${profile.licenseNumber}` : ""}
        </span>
        <span>
          {profile.serviceAreas.length} service area
          {profile.serviceAreas.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* CTA */}
      <section className="text-center py-16 px-6">
        {profile.slug && (
          <a
            href={`/book/${tenantSlug}/${profile.slug}`}
            className="inline-block bg-indigo-600 text-white px-8 py-4 rounded-lg font-bold text-base hover:opacity-90 transition-opacity"
          >
            Book an inspection
          </a>
        )}
      </section>

      {/* Contact footer */}
      <footer className="text-center py-8 px-6 border-t border-slate-200 dark:border-slate-700 text-[13px] text-slate-400 dark:text-slate-500">
        {profile.email && (
          <a href={`mailto:${profile.email}`} className="hover:underline">
            Contact via email
          </a>
        )}
        {profile.phone && (
          <span className="ml-4">{profile.phone}</span>
        )}
      </footer>
    </div>
  );
}
