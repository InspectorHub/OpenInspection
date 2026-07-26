import type { AppLoadContext } from "react-router";
import { getCloudflareEnv } from "~/lib/load-context";

export function getApiUrl(context?: AppLoadContext): string {
  const apiUrl = getCloudflareEnv(context as AppLoadContext).API_URL;
  if (apiUrl) return apiUrl;
  // Dev / CI: process.env is available
  try {
    if (typeof process !== "undefined" && process?.env?.API_URL) {
      return process.env.API_URL;
    }
  } catch { /* env not available in this runtime */ }
  return "http://localhost:8788";
}
