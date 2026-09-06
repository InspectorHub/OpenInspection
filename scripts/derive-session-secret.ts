/**
 * Compute the value to provision as `SESSION_SECRET`.
 *
 * WHY THIS EXISTS. When `SESSION_SECRET` is unset, `app/lib/session.server.ts`
 * derives the `__session` cookie signing secret from `JWT_SECRET` using PBKDF2
 * at 100k iterations. The result is memoised, but the memo lives in the
 * isolate, so EVERY new isolate pays the full derivation on its first request —
 * and `getToken` sits on nearly every route, including the root route, which
 * does nothing but redirect. Measured 2026-09-06: that one derivation exceeds
 * the Workers Free plan's entire 10ms per-request CPU budget on its own.
 *
 * Setting `SESSION_SECRET` short-circuits the derivation entirely
 * (`getSessionSecret` returns the explicit value before touching Web Crypto).
 *
 * WHY IT PRINTS THE DERIVED VALUE RATHER THAN A FRESH RANDOM ONE. Any *other*
 * value is also a valid secret, but it invalidates every session cookie in the
 * wild and logs every user out. Provisioning exactly what the derivation would
 * have produced makes the change byte-identical from the cookie's point of
 * view: zero user impact, and the PBKDF2 never runs again.
 *
 * It imports the SAME `deriveSessionSecret` the Worker uses. There is no second
 * implementation to drift out of sync — that is the entire safety argument, so
 * do not inline a copy of the derivation here.
 *
 * USAGE — the secret is read from stdin, never from argv (argv is visible in
 * process listings and lands in shell history):
 *
 *   npx tsx scripts/derive-session-secret.ts            # then paste, then Ctrl-D
 *   cat jwt-secret.txt | npx tsx scripts/derive-session-secret.ts
 *
 * Then provision it (this prompts for the value; paste the printed hex):
 *
 *   npx wrangler secret put SESSION_SECRET --config wrangler.saas.jsonc
 *
 * Re-run this whenever JWT_SECRET is rotated: the derived value changes with
 * it, and a stale SESSION_SECRET keeps working but no longer matches what the
 * fallback would produce, so removing SESSION_SECRET later would log everyone
 * out. Prefer keeping SESSION_SECRET set from here on.
 *
 * The printed value IS a secret. Do not paste it into a ticket, a commit, or a
 * chat window.
 */
import { deriveSessionSecret } from "../app/lib/session-secret";

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
    if (process.argv.length > 2) {
        console.error(
            "This script takes no arguments. Pipe JWT_SECRET on stdin so it does not\n" +
            "appear in process listings or shell history.",
        );
        process.exit(2);
    }

    if (process.stdin.isTTY) {
        console.error("Paste JWT_SECRET, then press Enter and Ctrl-D (Ctrl-Z then Enter on Windows):");
    }

    // Trailing newline only — a secret may legitimately contain inner whitespace,
    // so trimming both ends would silently derive from a different string than
    // the Worker sees in its binding.
    const jwtSecret = (await readStdin()).replace(/\r?\n$/, "");

    if (!jwtSecret) {
        console.error("No input received on stdin. Nothing derived.");
        process.exit(2);
    }

    const derived = await deriveSessionSecret(jwtSecret);

    console.error("\nSESSION_SECRET (provision this value; it is itself a secret):\n");
    console.log(derived);
    console.error(
        "\nNext:  npx wrangler secret put SESSION_SECRET --config wrangler.saas.jsonc" +
        "\nThis value equals what the running Worker derives today, so existing" +
        "\nsession cookies keep verifying and nobody is logged out.\n",
    );
}

void main();
