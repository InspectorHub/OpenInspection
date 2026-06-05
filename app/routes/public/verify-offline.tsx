import { useState } from "react";
import { unzipSync, strFromU8 } from "fflate";

interface AuditEvent {
  id: string;
  event: string;
  createdAt: number;
  payloadJson: string;
  prevHash: string;
  hash: string;
  signature: string;
  keyFingerprint: string;
}

interface VerificationResult {
  valid: boolean;
  errors: string[];
  eventCount: number;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s/g, "");
  const bin = atob(body);
  const buf = new ArrayBuffer(bin.length);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return buf;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function verifyChain(events: AuditEvent[], publicKeyPem: string): Promise<string[]> {
  const errors: string[] = [];

  // 1. Recompute SHA-256 chain
  let expectedPrev = "";
  for (const ev of events) {
    const canonical = JSON.stringify({
      event: ev.event,
      payloadJson: ev.payloadJson,
      prevHash: ev.prevHash,
      createdAt: ev.createdAt,
    });
    const buf = new TextEncoder().encode(canonical);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const hashHex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (ev.prevHash !== expectedPrev) errors.push(`Event ${ev.id}: prevHash mismatch`);
    if (ev.hash !== hashHex) errors.push(`Event ${ev.id}: SHA-256 hash mismatch`);
    expectedPrev = ev.hash;
  }

  // 2. Verify Ed25519 signatures
  try {
    const keyDer = pemToArrayBuffer(publicKeyPem);
    const key = await crypto.subtle.importKey("spki", keyDer, { name: "Ed25519" }, false, ["verify"]);
    for (const ev of events) {
      const sig = hexToBytes(ev.signature);
      const data = new TextEncoder().encode(ev.hash);
      const ok = await crypto.subtle.verify(
        { name: "Ed25519" },
        key,
        sig as unknown as ArrayBuffer,
        data as unknown as ArrayBuffer,
      );
      if (!ok) errors.push(`Event ${ev.id}: Ed25519 signature invalid`);
    }
  } catch (e) {
    errors.push(`Ed25519 import or verify failed: ${(e as Error).message}`);
  }

  return errors;
}

export function meta() {
  return [{ title: "Offline Verify - OpenInspection" }];
}

export default function VerifyOffline() {
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    setResult(null);
    try {
      if (!file.name.endsWith(".zip")) {
        setResult({ valid: false, errors: ["Please drop an evidence.zip file."], eventCount: 0 });
        return;
      }
      const buf = await file.arrayBuffer();
      const unzipped = unzipSync(new Uint8Array(buf));
      const trailFile = unzipped["audit-trail.json"];
      const pemFile = unzipped["public-key.pem"];
      if (!trailFile || !pemFile) {
        setResult({ valid: false, errors: ["Missing audit-trail.json or public-key.pem in zip."], eventCount: 0 });
        return;
      }
      const trail = JSON.parse(strFromU8(trailFile));
      const pem = strFromU8(pemFile);
      const errors = await verifyChain(trail.events, pem);
      setResult({ valid: errors.length === 0, errors, eventCount: trail.events.length });
    } catch (e) {
      setResult({ valid: false, errors: [(e as Error).message], eventCount: 0 });
    } finally {
      setBusy(false);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) await handleFile(file);
  };

  const onSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await handleFile(file);
  };

  return (
    <main className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold">Offline Verification</h1>
      <p className="mt-2 text-sm text-ih-fg-3">
        Drop your <code className="bg-ih-bg-muted px-1 rounded">evidence.zip</code> below. All
        cryptographic verification runs in your browser using the Web Crypto API — this page does
        not transmit the zip back to our server.
      </p>
      <label
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="mt-6 block border-2 border-dashed border-ih-border rounded-lg p-12 text-center cursor-pointer hover:bg-ih-bg-muted/50"
      >
        <span className="block text-sm">Drop evidence.zip here, or click to select</span>
        <input type="file" accept=".zip,application/zip" onChange={onSelect} className="hidden" />
      </label>
      {busy && <p className="mt-4 text-sm text-ih-fg-3">Verifying...</p>}
      {result && (
        <div
          className={
            "mt-6 p-4 rounded " +
            (result.valid ? "bg-ih-ok-bg border border-ih-ok" : "bg-ih-bad-bg border border-ih-bad")
          }
        >
          <p className="font-semibold">
            {result.valid
              ? `✓ All ${result.eventCount} chain events verified.`
              : `✗ ${result.errors.length} error(s) found`}
          </p>
          {result.errors.map((err, i) => (
            <p key={i} className="text-sm mt-1">
              {err}
            </p>
          ))}
        </div>
      )}
      <p className="mt-12 text-xs text-ih-fg-3">
        To verify offline without trusting this server, View Source on this page, save it locally
        along with evidence.zip, and open the local HTML file in a fresh browser session. All
        cryptography uses the browser's built-in Web Crypto API; no external network requests
        happen during verification.
      </p>
    </main>
  );
}
