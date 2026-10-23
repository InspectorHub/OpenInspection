import { useMemo } from "react";
import { useLoaderData } from "react-router";
import { FieldEditor } from "@core/field-ui/editor/FieldEditor";
import { EditorHumanCheck } from "~/components/editor/EditorHumanCheck";
import { InspectionFieldHost } from "~/components/field/WebFieldHost";
import { m as appMessages } from "~/paraglide/messages";
import { editorDataFromLoader } from "~/lib/field/web-editor-data";
import type { loader } from "./inspection-edit/loader.server";

export function meta() {
 return [{ title: appMessages.editor_route_meta_title() }];
}

export { loader } from "./inspection-edit/loader.server";

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
