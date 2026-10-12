import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, Modal } from "@core/shared-ui";
import { setHumanToken } from "~/lib/human-token";
import { useTurnstileWidget } from "~/lib/turnstile";
import { m } from "~/paraglide/messages";

/**
 * Inside a new company's first 24 hours, a message to a client goes out only
 * after the sender proves they are a person. Every surface that sends one calls
 * `await ensureHuman()` before submitting; it resolves true at once outside the
 * window, and otherwise after a fresh Turnstile challenge is solved (the token
 * is left for the next request, see `~/lib/human-token`). False means the
 * person closed the dialog and the send should not go ahead.
 *
 * A new challenge every time is deliberate: a token redeems once.
 */
type EnsureHuman = () => Promise<boolean>;

const EnsureHumanContext = createContext<EnsureHuman>(async () => true);

export function useEnsureHuman(): EnsureHuman {
  return useContext(EnsureHumanContext);
}

/**
 * `onSubmit` for a native form whose submit has no handler of its own: holds
 * the browser submit, runs the challenge, and re-fires it once the person is
 * verified. A second press during the challenge is ignored. Cancelling submits
 * nothing.
 */
export function useHumanGatedSubmit() {
  const ensureHuman = useEnsureHuman();
  const busy = useRef(false);
  const pass = useRef(false);
  return useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      if (pass.current) {
        pass.current = false;
        return;
      }
      e.preventDefault();
      const form = e.currentTarget;
      if (busy.current) return;
      busy.current = true;
      try {
        if (!(await ensureHuman())) return;
        // Let the submit event that started this finish dispatching first. When no
        // challenge is needed the promise above is already resolved, so the code
        // below would otherwise run INSIDE that dispatch, where the browser
        // ignores a nested requestSubmit() and the form silently never posts.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        pass.current = true;
        form.requestSubmit();
        // The flag only bridges the re-fired event, which dispatches synchronously.
        // If no event fired (validation now fails, form gone) it must not outlive this call.
        pass.current = false;
      } finally {
        busy.current = false;
      }
    },
    [ensureHuman],
  );
}

/**
 * For a page with no session context (a public share page, the agent portal): the
 * action reports `verifySiteKey` when the server refused the send because the
 * company is inside its first 24 hours. This shows the challenge for that
 * response and calls `resubmit` once the person has passed it. Render the
 * returned element anywhere in the component.
 */
export function useChallengeOnRefusal(
  data: { verifySiteKey?: string } | undefined,
  state: string,
  resubmit: () => void,
): { dialog: ReactNode; blocked: boolean } {
  const [open, setOpen] = useState<{ id: number; siteKey: string } | null>(null);
  // True once the check was passed and the re-send was refused anyway: the page should
  // show its own error then (and only then, not behind the dialog on the first refusal).
  const [blocked, setBlocked] = useState(false);
  const handled = useRef<unknown>(null);
  const counter = useRef(0);
  // When the page last sent again after a passed check. A refusal right after that is
  // the same refusal; one long after it is a new attempt (the re-send may never have run).
  const retriedAt = useRef(0);
  useEffect(() => {
    if (state !== "idle" || !data || data === handled.current) return;
    handled.current = data;
    if (!data.verifySiteKey) {
      retriedAt.current = 0;
      setBlocked(false);
      return;
    }
    // Refused again straight after a passed check: asking again would loop forever
    // (the server cannot accept this token). Stop and let the page show its error.
    if (Date.now() - retriedAt.current < RETRY_WINDOW_MS) {
      retriedAt.current = 0;
      setBlocked(true);
      return;
    }
    setBlocked(false);
    counter.current += 1;
    setOpen({ id: counter.current, siteKey: data.verifySiteKey });
  }, [data, state]);
  const dialog = !open ? null : (
    <VerifyDialog
      key={open.id}
      step={open.id}
      siteKey={open.siteKey}
      onDone={(ok) => {
        // A late callback from a dialog that has since been replaced is ignored.
        if (counter.current !== open.id) return;
        setOpen(null);
        if (ok) {
          retriedAt.current = Date.now();
          resubmit();
        }
      }}
    />
  );
  return { dialog, blocked };
}

/** How long a refusal after a re-send counts as the answer to that re-send. */
const RETRY_WINDOW_MS = 90_000;

interface Pending {
  id: number;
  resolve: (ok: boolean) => void;
}

export function OutboundVerificationProvider({
  windowOpen,
  siteKey,
  children,
}: {
  /** True only while the cooling window is open (the server says so). */
  windowOpen: boolean;
  siteKey: string | null | undefined;
  children: ReactNode;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  // The request on screen, held outside React state so settling it is never a side
  // effect of a state updater (which React may run more than once).
  const pendingRef = useRef<Pending | null>(null);
  const counter = useRef(0);

  const ensureHuman = useCallback<EnsureHuman>(() => {
    // Without a site key the widget cannot render; let the server decide, it
    // refuses with the same code if it needed the token.
    if (!windowOpen || !siteKey) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      counter.current += 1;
      const id = counter.current;
      // A second request while a dialog is open replaces it; the first caller is
      // told "not verified" instead of waiting forever.
      pendingRef.current?.resolve(false);
      const next = { id, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, [windowOpen, siteKey]);

  const finish = useCallback((ok: boolean, id: number) => {
    const current = pendingRef.current;
    // A late callback from a dialog that has since been replaced must not settle its successor.
    if (!current || current.id !== id) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(ok);
  }, []);

  return (
    <EnsureHumanContext.Provider value={ensureHuman}>
      {children}
      {pending && (
        <VerifyDialog key={pending.id} step={pending.id} siteKey={siteKey} onDone={(ok) => finish(ok, pending.id)} />
      )}
    </EnsureHumanContext.Provider>
  );
}

function VerifyDialog({
  step,
  siteKey,
  onDone,
}: {
  step: number;
  siteKey: string | null | undefined;
  onDone: (ok: boolean) => void;
}) {
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useTurnstileWidget(
    siteKey,
    widgetRef,
    step,
    (token) => {
      setHumanToken(token);
      onDone(true);
    },
    { onLoadFailed: () => setLoadFailed(true) },
  );

  return (
    <Modal
      open
      onClose={() => onDone(false)}
      title={m.outbound_verify_title()}
      size="sm"
      footer={
        <Button variant="secondary" onClick={() => onDone(false)}>
          {m.outbound_verify_cancel()}
        </Button>
      }
    >
      <p className="text-sm text-ih-fg-2 mb-4">{m.outbound_verify_body()}</p>
      <div ref={widgetRef} className="min-h-[65px] flex justify-center" />
      {loadFailed && (
        <p role="alert" className="mt-3 text-sm text-ih-bad-fg">
          {m.outbound_verify_load_failed()}
        </p>
      )}
    </Modal>
  );
}
