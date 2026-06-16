import { useLoaderData } from "react-router";
import type { Route } from "./+types/messages";
import { MessagesSection } from "~/components/portal/sections/MessagesSection";

export function meta() {
  return [{ title: "Messages - OpenInspection" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  return { token: params.token ?? "" };
}

export default function MessagesPublicPage() {
  const { token } = useLoaderData<typeof loader>();
  return (
    <div className="min-h-screen bg-ih-bg-app">
      <div className="max-w-2xl mx-auto py-8 px-4">
        <MessagesSection token={token} />
      </div>
    </div>
  );
}
