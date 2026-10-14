/**
 * What pressing "Check credentials" came back with, in the shape the page draws.
 *
 * Only these words cross from the route action to the browser: never the
 * credentials, never Intuit's own response, never the server's error text.
 */
export type QboCheckedSetting = "QBO_CLIENT_ID" | "QBO_CLIENT_SECRET";

export type QboCheckOutcome =
  /** Intuit answered. `checkedAt` is epoch SECONDS, as the API reports it. */
  | { kind: "paired" | "rejected" | "unreachable"; checkedAt: number }
  /** The server was asked and declined: nothing was sent to Intuit. */
  | { kind: "credentials_missing"; missing: QboCheckedSetting[] }
  | { kind: "app_base_url_missing" | "rate_limited" | "failed" };
