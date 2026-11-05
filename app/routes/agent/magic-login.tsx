/**
 * Agent emailed sign-in link: the page behind `/agent/magic-login?code=`.
 *
 * A GET only SHOWS a "Continue" button; the single-use code is spent by the POST that button sends. Mail scanners and link previews
 * fetch the emailed URL with a GET before the person does, and a link that signs in on GET would be used up by then, leaving the agent on
 * "this link has expired". The emailed URL does not change.
 *
 * The POST calls the API's redeem handler in-process (the handler mints the agent session cookie and answers with a redirect); this
 * action forwards that cookie and the destination. A wrong, used or expired code goes to the sign-in page's existing expired-link
 * message; a rate-limited caller is told to wait, which is not the same thing as an expired link.
 */
import { Form, redirect, useActionData, useLocation, useNavigation } from "react-router";
import type { Route } from "./+types/magic-login";
import { Button } from "@core/shared-ui";
import { getApiUrl } from "~/lib/api.server";
import { getCloudflareEnv } from "~/lib/load-context";
import { isCrossSitePost } from "~/lib/same-origin-post.server";
import { useSubmitLatch } from "~/hooks/useSubmitLatch";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.auth_agent_magic_meta_title() }];
}

const EXPIRED = "/agent-login?error=expired_link";

export async function loader({ request }: Route.LoaderArgs) {
  // Nothing is redeemed here: this only decides whether there is a code to continue with.
  if (!new URL(request.url).searchParams.get("code")) throw redirect("/agent-login");
  return {};
}

export async function action({ request, context }: Route.ActionArgs) {
  // A form posted from another site is answered like an expired link, and the code is not spent (login CSRF).
  if (isCrossSitePost(request)) return redirect(EXPIRED);
  const code = new URL(request.url).searchParams.get("code");
  if (!code) throw redirect("/agent-login");
  const env = getCloudflareEnv(context);
  const target = new Request(`${getApiUrl(context)}/agent/magic-login?code=${encodeURIComponent(code)}`, { redirect: "manual" });
  let res: Response;
  try {
    res = env.API_WORKER ? await env.API_WORKER.fetch(target) : await fetch(target);
  } catch {
    return redirect(EXPIRED);
  }
  if (res.status === 429) return { rateLimited: true as const };
  const location = res.headers.get("location");
  if (res.status !== 302 || !location) return redirect(EXPIRED);
  // The API answers a refused code with a redirect to the expired-link message; a redeemed one carries the session cookie.
  const cookie = res.headers.get("set-cookie");
  return redirect(location, { headers: cookie ? { "Set-Cookie": cookie } : undefined });
}

export default function AgentMagicLogin() {
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const { search } = useLocation();
  const latch = useSubmitLatch();

  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-ih-fg-1 mb-2">{m.auth_agent_magic_heading()}</h1>
      <p className="text-[14px] text-ih-fg-3 mb-6">{m.auth_agent_magic_body()}</p>
      {result?.rateLimited ? (
        <p role="alert" className="text-[14px] text-ih-bad-fg mb-4">{m.auth_agent_magic_rate_limited()}</p>
      ) : null}
      {/* The action keeps the emailed query string so the POST carries the code the GET showed. */}
      <Form method="post" action={`/agent/magic-login${search}`} onSubmit={latch()}>
        <Button type="submit" pending={navigation.state === "submitting"}>{m.auth_agent_magic_cta()}</Button>
      </Form>
    </div>
  );
}
