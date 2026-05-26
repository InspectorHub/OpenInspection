import { redirect } from "react-router";
import type { Route } from "./+types/home";
import { getToken } from "~/lib/session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const token = await getToken(request);
  if (token) throw redirect("/dashboard");
  throw redirect("/login");
}

export default function Home() {
  return null;
}
