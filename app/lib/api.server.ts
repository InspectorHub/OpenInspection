import type { AppLoadContext } from "react-router";

export function getApiUrl(context?: AppLoadContext): string {
  if (context?.cloudflare?.env?.API_URL) return context.cloudflare.env.API_URL as string;
  // Dev / CI: process.env is available
  try {
    if (typeof process !== "undefined" && process?.env?.API_URL) {
      return process.env.API_URL;
    }
  } catch { /* env not available in this runtime */ }
  return "http://localhost:8788";
}
