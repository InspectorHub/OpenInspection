import { Link, isRouteErrorResponse } from "react-router";
import { Button, buttonClasses } from "@core/shared-ui";
import { isNetworkFailure } from "~/lib/network-error";
import { m } from "~/paraglide/messages";

/**
 * The error screen of a detail route: not found, forbidden, "no connection", or
 * generic, with one way back. A route's `ErrorBoundary` passes its own wording.
 *
 * When the browser could not reach the server the screen says so and offers a retry
 * instead of the way back: the page the link leads to needs the network too.
 */
export function RouteErrorNotice({ error, messages, back, fullScreen = false }: {
  error: unknown;
  messages: { notFound: string; forbidden: string; generic: string };
  back: { to: string; label: string };
  fullScreen?: boolean;
}) {
  const status = isRouteErrorResponse(error) ? error.status : null;
  const offline = isNetworkFailure(error);
  const message = offline
    ? m.helper_network_unreachable()
    : status === 404 ? messages.notFound : status === 403 ? messages.forbidden : messages.generic;
  const wrap = fullScreen
    ? "flex flex-col items-center justify-center h-screen bg-ih-bg-app gap-3 px-6 text-center"
    : "max-w-[1080px] mx-auto pt-16 px-9 flex flex-col items-center gap-3 text-center";
  return (
    <div className={wrap}>
      <p className="text-[15px] font-bold text-ih-fg-1">{message}</p>
      {offline ? (
        <Button variant="primary" onClick={() => window.location.reload()}>
          {m.helper_network_retry()}
        </Button>
      ) : (
        <Link to={back.to} className={buttonClasses({ variant: "primary", size: "md" })}>{back.label}</Link>
      )}
    </div>
  );
}
