import { redirect } from "react-router";
import type { Route } from "./+types/booking-inspector-redirect";

export function loader({ params, request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  url.searchParams.set("inspector", params.slug ?? "");
  return redirect(`/book/${params.tenant}?${url.searchParams.toString()}`);
}

export default function BookingInspectorRedirect() {
  return null;
}
