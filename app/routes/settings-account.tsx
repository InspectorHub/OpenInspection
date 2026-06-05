import { redirect } from "react-router";

export function loader() {
  return redirect("/settings/security");
}

export default function SettingsAccount() {
  return null;
}
