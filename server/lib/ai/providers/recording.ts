import type { AiProvider, AiRequest, AiResponse } from '../provider';

/**
 * TEST-ONLY AI transport. Records every request and replays canned text
 * instead of calling a backend, so a test can assert what a caller ASKED for
 * without stubbing global `fetch` and without a network dependency.
 *
 * It also serves as the proof that `AiProvider` is genuinely backend-neutral:
 * this class satisfies the whole interface in a dozen lines and mentions no
 * vendor concept anywhere. If a future change to `AiProvider` cannot be
 * implemented here, that change has leaked a backend detail into the contract.
 *
 * Mirrors `server/lib/email/providers/recording.ts` in intent. Unlike that one
 * it is never wired into the worker — there is no AI equivalent of the E2E
 * email sink, so this stays out of every production code path by construction.
 */
export class RecordingAiProvider implements AiProvider {
    readonly id = 'recording';

    /** Every request handed to `complete`, in order. */
    readonly requests: AiRequest[] = [];

    /** Canned replies, consumed in order; the last one repeats once exhausted. */
    constructor(private replies: string[] = ['']) {}

    async complete(input: AiRequest): Promise<AiResponse> {
        this.requests.push(input);
        const text = this.replies.length > 1 ? this.replies.shift()! : (this.replies[0] ?? '');
        return { text };
    }
}
