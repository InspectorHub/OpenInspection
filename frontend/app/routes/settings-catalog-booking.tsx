import { redirect } from "react-router";

export function loader() {
  return redirect("/settings/booking");
}

export default function SettingsCatalogBooking() {
  return null;
}
