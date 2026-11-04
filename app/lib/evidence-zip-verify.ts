import { unzipSync, strFromU8 } from "fflate";
import { verifyEvidenceChainDetailed, type ChainProblem, type PackEvent, type PackKey } from "../../server/lib/esign/chain-verify";

/** The most an `audit-trail.json` may inflate to, and the most events it may hold: far above any real agreement's trail. */
const MAX_TRAIL_BYTES = 8 * 1024 * 1024;
const MAX_PEM_BYTES = 64 * 1024;
export const MAX_EVENTS = 20_000;

/**
 * valid — every event checked. invalid — a real chain, hash, signature or key problem. partial — nothing that was checked failed, but some
 * events are signed with a key the pack does not carry, so they could not be checked.
 */
type EvidenceOutcome = "valid" | "invalid" | "partial";

export interface EvidenceVerdict {
  outcome: EvidenceOutcome;
  valid: boolean;
  /** Problems in the order they were found; the page shows them as plain lines. */
  problems: ChainProblem[];
  eventCount: number;
  /** Fingerprints (recomputed from the key bytes) of the keys that checked events: to compare with the online verification page. */
  fingerprints: string[];
  /** Why the zip could not be read at all, when it could not. */
  unreadable?: "not_zip" | "missing_files" | "bad_trail" | "too_large";
}

interface Trail { events?: unknown; keys?: unknown; keyFingerprint?: unknown }

const UNREADABLE = (unreadable: NonNullable<EvidenceVerdict["unreadable"]>): EvidenceVerdict =>
  ({ outcome: "invalid", valid: false, problems: [], eventCount: 0, fingerprints: [], unreadable });

function isEvent(value: unknown): value is PackEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return ["id", "event", "payloadJson", "hash", "signature", "keyFingerprint"].every((k) => typeof v[k] === "string")
    && (v.prevHash === null || typeof v.prevHash === "string");
}

/** The keys the pack carries: the `keys` list when there is one (every key the chain used), else the single public-key.pem. */
function keysOf(trail: Trail, pem: string): PackKey[] {
  if (Array.isArray(trail.keys)) {
    const listed = trail.keys.filter((k): k is PackKey => typeof k === "object" && k !== null && typeof (k as PackKey).fingerprint === "string" && typeof (k as PackKey).pem === "string");
    if (listed.length > 0) return listed;
  }
  return typeof trail.keyFingerprint === "string" ? [{ fingerprint: trail.keyFingerprint, pem }] : [];
}

/**
 * Verify an evidence pack (the zip the sign-off workflow stores and emails) with nothing but the browser: `audit-trail.json` and
 * `public-key.pem` are read from the zip and the chain is checked by the same rules the server applies (server/lib/esign/chain-verify.ts).
 * Only those two entries are inflated, and only if they declare a sane size; nothing else in the zip is read.
 */
export async function verifyEvidenceZip(zip: Uint8Array): Promise<EvidenceVerdict> {
  let oversize = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, {
      filter: (f) => {
        const limit = f.name === "audit-trail.json" ? MAX_TRAIL_BYTES : f.name === "public-key.pem" ? MAX_PEM_BYTES : -1;
        if (limit < 0) return false;
        if (f.originalSize > limit) { oversize = true; return false; }
        return true;
      },
    });
  } catch {
    return UNREADABLE("not_zip");
  }
  if (oversize) return UNREADABLE("too_large");
  const trailFile = files["audit-trail.json"];
  const pemFile = files["public-key.pem"];
  if (!trailFile || !pemFile) return UNREADABLE("missing_files");
  // The declared size can be wrong: check what came out as well.
  if (trailFile.length > MAX_TRAIL_BYTES || pemFile.length > MAX_PEM_BYTES) return UNREADABLE("too_large");
  let trail: Trail;
  try {
    trail = JSON.parse(strFromU8(trailFile)) as Trail;
  } catch {
    return UNREADABLE("bad_trail");
  }
  if (!Array.isArray(trail.events) || !trail.events.every(isEvent)) return UNREADABLE("bad_trail");
  if (trail.events.length > MAX_EVENTS) return UNREADABLE("too_large");
  const { problems, fingerprintsUsed } = await verifyEvidenceChainDetailed(trail.events, keysOf(trail, strFromU8(pemFile)));
  const outcome: EvidenceOutcome = problems.length === 0 ? "valid"
    : problems.every((p) => p.reason === "no_key" || p.reason === "bad_key") ? "partial" : "invalid";
  return { outcome, valid: problems.length === 0, problems, eventCount: trail.events.length, fingerprints: fingerprintsUsed };
}
