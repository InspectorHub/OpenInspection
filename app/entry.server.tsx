import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import { logRouteError } from "../server/lib/route-error-logging";
import { bindFieldUiLocale } from "~/lib/field/web-locale";

// The field editor package has its own paraglide runtime; make it read the app's request-scoped
// locale (the render runs inside paraglideMiddleware). A thunk, so no value is shared across requests.
bindFieldUiLocale();

export const streamTimeout = 5_000;

/** Replaces React Router's default, which logs every 4xx a scanner provokes as an error. */
export function handleError(error: unknown, { request }: { request: Request }) {
  logRouteError(error, request);
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  const userAgent = request.headers.get("user-agent");
  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      signal: AbortSignal.timeout(streamTimeout),
      onError(error: unknown) {
        console.error(error);
        responseStatusCode = 500;
      },
    },
  );

  if (userAgent && isbot(userAgent)) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");

  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
