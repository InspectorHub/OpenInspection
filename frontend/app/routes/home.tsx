import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [{ title: "OpenInspection" }];
}

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-ih-fg-1">
          OpenInspection
        </h1>
        <p className="text-ih-fg-3 mt-2">Frontend is running</p>
        <a href="/login" className="mt-4 inline-block text-indigo-600 hover:underline text-sm font-medium">
          Sign in &rarr;
        </a>
      </div>
    </div>
  );
}
