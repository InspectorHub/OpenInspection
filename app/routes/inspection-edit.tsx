import { useMemo } from "react";
import { useLoaderData, useRouteError } from "react-router";
import { FieldEditor } from "@core/field-ui/editor/FieldEditor";
import { EditorHumanCheck } from "~/components/editor/EditorHumanCheck";
import { InspectionFieldHost } from "~/components/field/WebFieldHost";
import { RouteErrorNotice } from "~/components/RouteErrorNotice";
import { m as appMessages } from "~/paraglide/messages";
import { editorDataFromLoader } from "~/lib/field/web-editor-data";
import type { loader } from "./inspection-edit/loader.server";

export function meta() {
 return [{ title: appMessages.editor_route_meta_title() }];
}

export { loader } from "./inspection-edit/loader.server";

/**
 * The document depends on the viewer (their session) AND on a cookie (the remembered layout band the loader reads),
 * so no shared cache may keep it and hand it to anyone else. `private` forbids shared caches and still lets the
 * browser restore the page on back and forward (`no-store` would defeat that); `Vary: Cookie` states the dependency
 * for any cache that ignores it. This is the only HTML document that sets its own cache directive. Only `Set-Cookie`
 * is taken from the loader, as in `auth-layout`: forwarding every loader header could let a caching directive leak
 * onto the page.
 */
export function headers({ loaderHeaders }: { loaderHeaders: Headers }) {
 const out = new Headers({ "Cache-Control": "private", Vary: "Cookie" });
 const setCookie = loaderHeaders.get("Set-Cookie");
 if (setCookie) out.append("Set-Cookie", setCookie);
 return out;
}

/**
 * The editor holds its own optimistic state (useInspection) and persists every
 * change through fetchers. Re-running this heavy loader after each mutation
 * (rate / notes / save-settings / set-cover / upload-cover …) just reloads and
 * flickers the whole editor. Skip revalidation for POST submissions; navigation
 * and explicit `revalidator.revalidate()` (offline sync) still refresh because
 * they carry no POST formMethod.
 */
export function shouldRevalidate({
  formMethod,
  defaultShouldRevalidate,
}: {
  formMethod?: string;
  defaultShouldRevalidate: boolean;
}) {
  if (formMethod && formMethod.toUpperCase() === "POST") return false;
  return defaultShouldRevalidate;
}

/** Action (BFF relay for client mutations). */
export { action } from "./inspection-edit/action.server";

/** The editor sits outside the workspace layout, so it mounts the human check itself. */
export default function InspectionEditRoute() {
 const loaderData = useLoaderData<typeof loader>();
 // The page takes its data as a prop and follows every revalidation: units, publish state and the rest are
 // read from it, so a fresh payload re-renders the page.
 const data = useMemo(() => editorDataFromLoader(loaderData), [loaderData]);
 return (
 <EditorHumanCheck coolingWindow={data.outboundCoolingWindow}>
 <InspectionFieldHost><FieldEditor data={data} /></InspectionFieldHost>
 </EditorHumanCheck>
 );
}

/**
 * A deleted or missing inspection answers 404 from the loader. The editor sits outside the workspace layout, so the
 * notice fills the screen and offers the way back to the list.
 */
export function ErrorBoundary() {
 return (
  <RouteErrorNotice
   error={useRouteError()}
   fullScreen
   messages={{ notFound: appMessages.inspections_hub_eb_not_found(), forbidden: appMessages.inspections_hub_eb_forbidden(), generic: appMessages.inspections_hub_eb_generic() }}
   back={{ to: "/inspections", label: appMessages.inspections_hub_eb_back() }}
  />
 );
}
