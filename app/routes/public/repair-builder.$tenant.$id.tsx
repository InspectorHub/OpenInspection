/**
 * Interactive Repair Request Builder — standalone full-page route.
 *
 * Route: /repair-builder/:tenant/:id
 * Loader: resolves defects + existing repair requests via BFF.
 * Action: all mutations via BFF (no client fetch).
 *
 * The UI lives in the shared <RepairBuilderSection> component so it can render
 * both here AND inline inside the unified client-portal Hub. This route is now a
 * thin wrapper: loader + action (the BFF) + a default component that hands the
 * loader result and this route's action path to the section.
 */
import { useLoaderData, useParams } from "react-router";
import type { Route } from "./+types/repair-builder.$tenant.$id";
import { createApi } from "~/lib/api-client.server";
import { getToken } from "~/lib/session.server";
import { PublicNotice } from "~/components/PublicNotice";
import {
  RepairBuilderSection,
  builderCreditTotal,
  sortDefects,
  toggleSelected,
  type Defect,
  type RepairRequest,
  type RepairRequestItem,
  type LoaderResult,
} from "~/components/portal/sections/RepairBuilderSection";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.repair_builder_meta_title() }];
}

// Re-export pure helpers + types so existing tests/importers keep working after
// the UI move into the shared section component.
export { builderCreditTotal, sortDefects, toggleSelected };
export type { Defect, RepairRequest, RepairRequestItem, LoaderResult };

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({
  params,
  request,
  context,
}: Route.LoaderArgs): Promise<LoaderResult> {
  const tenant = params.tenant ?? "";
  const id = params.id ?? "";
  const sessionToken = (await getToken(context, request)) ?? undefined;
  const api = createApi(context, { token: sessionToken });
  const parsedUrl = new URL(request.url);
  const token = parsedUrl.searchParams.get("token") ?? undefined;

  try {
    const res = await api.repairBuilder["repair-builder"][":tenant"][":id"].source.$get({
      param: { tenant, id },
      query: { token },
    });

    if (res.status === 401) {
      return { kind: "no_access" };
    }

    if (res.status === 403) {
      const body = (await res.json()) as { error?: { code?: string } };
      const code = body?.error?.code;
      if (code === "NOT_PUBLISHED") return { kind: "not_published" };
      return { kind: "forbidden" };
    }

    if (!res.ok) {
      return { kind: "error" };
    }

    const body = (await res.json()) as { data?: { defects: Defect[]; mine: RepairRequest[] } };
    const data = body.data;
    if (!data) return { kind: "error" };

    return {
      kind: "ok",
      defects: data.defects,
      mine: data.mine,
      tenant,
      id,
      token: parsedUrl.searchParams.get("token"),
    };
  } catch {
    return { kind: "error" };
  }
}

// ---------------------------------------------------------------------------
// Action (BFF only)
// ---------------------------------------------------------------------------

export async function action({
  params,
  request,
  context,
}: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("_intent") ?? "");
  const tenant = params.tenant ?? "";
  const id = params.id ?? "";
  const token = (form.get("_token") as string | null) ?? undefined;

  const sessionToken = (await getToken(context, request)) ?? undefined;
  const api = createApi(context, { token: sessionToken });

  try {
    if (intent === "create-list") {
      const res = await api.repairBuilder["repair-builder"][":tenant"][":id"].$post({
        param: { tenant, id },
        query: { token },
      });
      if (!res.ok) return { ok: false as const, error: m.repair_builder_error_create_list() };
      const body = (await res.json()) as { data?: RepairRequest };
      return { ok: true as const, data: body.data };
    }

    const rrId = String(form.get("rrId") ?? "");

    if (intent === "add-item") {
      const findingKey = String(form.get("findingKey") ?? "");
      const sectionTitle = String(form.get("sectionTitle") ?? "");
      const itemLabel = String(form.get("itemLabel") ?? "");
      const commentSnapshot = (form.get("commentSnapshot") as string | null) ?? null;
      const creditRaw = form.get("requestedCreditCents");
      const requestedCreditCents = creditRaw !== null && creditRaw !== "" ? Number(creditRaw) : null;
      const note = (form.get("note") as string | null) ?? null;

      const res = await api.repairBuilder["repair-builder"][":tenant"][":id"].lists[":rrId"].items.$post({
        param: { tenant, id, rrId },
        query: { token },
        json: {
          findingKey,
          sectionTitle,
          itemLabel,
          commentSnapshot,
          requestedCreditCents,
          note,
        },
      });
      if (!res.ok) return { ok: false as const, error: m.repair_builder_error_add_item() };
      const body = (await res.json()) as { data?: RepairRequestItem };
      return { ok: true as const, data: body.data };
    }

    if (intent === "update-item") {
      const itemId = String(form.get("itemId") ?? "");
      const creditRaw = form.get("requestedCreditCents");
      const noteRaw = form.get("note");
      const patch: { requestedCreditCents?: number; note?: string } = {};
      if (creditRaw !== null && creditRaw !== "") patch.requestedCreditCents = Number(creditRaw);
      if (noteRaw !== null) patch.note = String(noteRaw);

      const res = await api.repairBuilder["repair-builder"][":tenant"][":id"].lists[":rrId"].items[":itemId"].$patch({
        param: { tenant, id, rrId, itemId },
        query: { token },
        json: patch,
      });
      if (!res.ok) return { ok: false as const, error: m.repair_builder_error_update_item() };
      return { ok: true as const };
    }

    if (intent === "remove-item") {
      const itemId = String(form.get("itemId") ?? "");
      const res = await api.repairBuilder["repair-builder"][":tenant"][":id"].lists[":rrId"].items[":itemId"].$delete({
        param: { tenant, id, rrId, itemId },
        query: { token },
      });
      if (!res.ok) return { ok: false as const, error: m.repair_builder_error_remove_item() };
      return { ok: true as const };
    }

    if (intent === "set-intro") {
      const customIntro = (form.get("customIntro") as string | null) ?? null;
      const res = await api.repairBuilder["repair-builder"][":tenant"][":id"].lists[":rrId"].$patch({
        param: { tenant, id, rrId },
        query: { token },
        json: { customIntro },
      });
      if (!res.ok) return { ok: false as const, error: m.repair_builder_error_save_intro() };
      return { ok: true as const };
    }

    if (intent === "send-email") {
      const shareToken = String(form.get("shareToken") ?? "");
      const to = String(form.get("to") ?? "");
      const message = (form.get("message") as string | null) ?? undefined;
      if (!shareToken || !to) return { ok: false as const, error: m.repair_builder_error_missing_recipient() };
      const res = await api.repairBuilder["repair-request"].share[":shareToken"].email.$post({
        param: { shareToken },
        json: { to, message },
      });
      if (!res.ok) return { ok: false as const, error: m.repair_builder_error_send_email() };
      return { ok: true as const };
    }

    return { ok: false as const, error: m.repair_builder_error_unknown_intent({ intent }) };
  } catch {
    return { ok: false as const, error: m.repair_builder_error_server() };
  }
}

// ---------------------------------------------------------------------------
// Component — thin wrapper around the shared RepairBuilderSection
// ---------------------------------------------------------------------------

export default function RepairBuilderPage() {
  const result = useLoaderData<typeof loader>() as LoaderResult;
  const params = useParams();
  const tenant = params.tenant ?? "";
  const id = params.id ?? "";

  // Standalone full-page route: render gated/error states with the shared
  // full-page chrome (PublicNotice) so they read consistently with the rest of
  // the public surface. (The inline Hub mount keeps RepairBuilderSection's bare
  // mini-cards, which is correct inside the Hub's own chrome.)
  if (result.kind === "no_access") {
    return (
      <PublicNotice title={m.repair_builder_noaccess_title()}>
        {m.repair_builder_noaccess_body()}
      </PublicNotice>
    );
  }
  if (result.kind === "not_published") {
    return (
      <PublicNotice title={m.repair_request_notpublished_title()}>
        {m.repair_builder_notpublished_body()}
      </PublicNotice>
    );
  }
  if (result.kind === "forbidden") {
    return (
      <PublicNotice title={m.repair_builder_forbidden_title()}>
        {m.repair_builder_forbidden_body()}
      </PublicNotice>
    );
  }
  if (result.kind === "error") {
    return (
      <PublicNotice title={m.repair_builder_error_title()} tone="error">
        {m.repair_builder_error_body()}
      </PublicNotice>
    );
  }

  // The internal fetchers must always post to THIS route's action regardless of
  // mount point; the standalone route's path is /repair-builder/:tenant/:id.
  const actionPath = `/repair-builder/${tenant}/${id}`;
  return <RepairBuilderSection result={result} actionPath={actionPath} />;
}
