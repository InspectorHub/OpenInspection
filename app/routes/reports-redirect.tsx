import { redirect } from "react-router";

export function loader() {
  return redirect("/dashboard?workflow=published", 301);
}

export default function ReportsRedirect() {
  return null;
}
