/**
 * Did a request fail because the browser could not reach the server at all?
 *
 * A failed `fetch` rejects with a bare `TypeError` whose text differs by browser
 * ("Failed to fetch" in Chromium, "Load failed" in Safari, "NetworkError when
 * attempting to fetch resource." in Firefox). React Router hands that error to the
 * nearest error boundary, which used to read it as "something went wrong" and offer
 * a link that needs the network too.
 *
 * An HTTP error response is never a network failure: the server answered. And when
 * the browser itself reports it is offline, any thrown error that is not a router
 * response is treated as one, because that is what the person is looking at.
 */
const NETWORK_TYPE_ERROR = /failed to fetch|networkerror|load failed|network request failed|the internet connection appears to be offline/i;

export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof Response) return false;
  if (typeof error === "object" && error !== null && "status" in error && "statusText" in error) return false;
  if (error instanceof TypeError && NETWORK_TYPE_ERROR.test(error.message)) return true;
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
