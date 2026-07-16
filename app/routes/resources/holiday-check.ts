/**
 * BFF resource for internal holiday advisory/block in NewInspectionWizard.
 */
import type { AppLoadContext } from "react-router";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";

export async function loader({
  request,
  context,
}: {
  request: Request;
  context: AppLoadContext;
}) {
  const token = await requireToken(context, request);
  const api = createApi(context, { token });
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { effect: "none" as const, name: null };
  }

  const checkGet = (api.admin as unknown as {
    holidays: { check: { $get: (args: { query: { date: string } }) => Promise<Response> } };
  }).holidays.check.$get;

  const res = await checkGet({ query: { date } }).catch(() => null);
  if (!res?.ok) return { effect: "none" as const, name: null };

  const body = (await res.json()) as {
    data?: { effect?: "none" | "block" | "advisory"; name?: string | null };
  };
  return {
    effect: body.data?.effect ?? ("none" as const),
    name: body.data?.name ?? null,
  };
}
