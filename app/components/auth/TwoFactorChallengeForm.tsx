import { Form, useNavigation } from "react-router";
import { Input, Button } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * The second step of a two-factor sign-in.
 *
 * The challenge token travels in a hidden field, deliberately. `server/api/auth.ts`
 * mints it with no Set-Cookie so that a stolen session cookie alone can never
 * satisfy the second factor, and a URL parameter would put a live credential
 * into browser history and referrer headers. A hidden field is neither: it
 * lives in one response, for the five minutes the token is valid.
 *
 * `returnTo` is carried through so a 2FA account lands where a non-2FA account
 * would — the OAuth consent bounce resumes on the far side of this form rather
 * than dropping the destination the moment a second factor is involved.
 */
export function TwoFactorChallengeForm({
  challengeToken,
  returnTo,
  error,
}: {
  challengeToken: string;
  returnTo: string;
  error?: string;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <Form method="post" className="space-y-4" noValidate>
      <input type="hidden" name="challengeToken" value={challengeToken} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}

      <p className="text-[13px] text-ih-fg-2">{m.auth_login_2fa_help()}</p>

      <Input
        name="code"
        autoFocus
        // `one-time-code` is what lets a phone offer the code from its own
        // notification. `inputMode` keeps a numeric keypad for the six-digit
        // case without rejecting a recovery code, which is not numeric.
        autoComplete="one-time-code"
        inputMode="numeric"
        label={m.auth_login_2fa_code_label()}
        aria-invalid={error ? true : undefined}
        error={error}
        reserveErrorSpace
      />

      <Button type="submit" variant="primary" size="lg" disabled={submitting} className="w-full">
        {submitting ? m.auth_login_2fa_submit_pending() : m.auth_login_2fa_submit()}
      </Button>

      {/* Not a "cancel". The challenge expires in five minutes and a person who
          cannot reach their authenticator needs a way back to the start rather
          than a dead form. */}
      <a href="/login" className="block text-center text-xs font-bold text-ih-primary-text hover:underline">
        {m.auth_login_2fa_start_over()}
      </a>
    </Form>
  );
}
