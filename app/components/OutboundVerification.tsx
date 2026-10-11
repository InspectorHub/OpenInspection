import { createContext, useCallback, useContext, useRef, useState, type FormEvent, type ReactNode } from "react";
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
        pass.current = true;
        form.requestSubmit();
      } finally {
        busy.current = false;
      }
    },
    [ensureHuman],
  );
}

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
  const counter = useRef(0);

  const ensureHuman = useCallback<EnsureHuman>(() => {
    // Without a site key the widget cannot render; let the server decide, it
    // refuses with the same code if it needed the token.
    if (!windowOpen || !siteKey) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      counter.current += 1;
      setPending({ id: counter.current, resolve });
    });
  }, [windowOpen, siteKey]);

  const finish = useCallback((ok: boolean) => {
    setPending((p) => {
      p?.resolve(ok);
      return null;
    });
  }, []);

  return (
    <EnsureHumanContext.Provider value={ensureHuman}>
      {children}
      {pending && (
        <VerifyDialog key={pending.id} step={pending.id} siteKey={siteKey} onDone={finish} />
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
