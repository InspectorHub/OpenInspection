import { getCloudflareEnv, type LoadContext } from "~/lib/load-context";

export function getApiUrl(context?: LoadContext): string {
  const apiUrl = getCloudflareEnv(context as LoadContext).API_URL;
  if (apiUrl) return apiUrl;
  // Dev / CI: process.env is available
  try {
    if (typeof process !== "undefined" && process?.env?.API_URL) {
      return process.env.API_URL;
    }
  } catch { /* env not available in this runtime */ }
  return "http://localhost:8788";
}
