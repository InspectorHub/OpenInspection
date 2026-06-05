import { redirect } from "react-router";

export function loader() {
  return redirect("/repair-items", 301);
}

export default function RecommendationsRedirect() {
  return null;
}
