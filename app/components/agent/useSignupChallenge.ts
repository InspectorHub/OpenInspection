import { useCallback, useRef, useState } from "react";
import { useTurnstileWidget } from "~/lib/turnstile";
import { m } from "~/paraglide/messages";

/**
 * The bot challenge on the agent signup form.
 *
 * The server demands a token wherever the deployment mandates one (SaaS always, on
 * Cloudflare's published test key when none is configured), so the page renders the
 * widget with the key the server resolved and never offers a way around it. A null
 * key means nothing is demanded. A token is good for ONE request, so `spend()`
 * clears it and asks the widget again after every answered submit.
 */
export function useSignupChallenge(siteKey: string | null, enabled: boolean) {
  const needsChallenge = !!siteKey && enabled;
  const host = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState("");
  const [round, setRound] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useTurnstileWidget(
    needsChallenge ? siteKey : null,
    host,
    round,
    (solved) => {
      setToken(solved);
      setError(null);
      setUnavailable(false);
    },
    {
      onLoadFailed: () => setUnavailable(true),
      onExpired: () => { setToken(""); setError(m.auth_agent_signup_verify_required()); },
      onError: () => { setToken(""); setUnavailable(true); },
    },
  );
  const spend = useCallback(() => {
    setToken("");
    setRound((n) => n + 1);
  }, []);
  return { needsChallenge, host, token, error, unavailable, setError, spend };
}
