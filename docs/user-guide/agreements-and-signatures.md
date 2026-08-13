# Agreements and signatures

Getting the agreement signed, and why the signature stays verifiable without us.

> Part 3 of 7 in the inspection workflow. Illustrated version with a
> screenshot per step: <https://inspectorhub.io/docs/agreements-and-signatures>

Agreement templates live in the library (`/library/agreements`). An inspection
can carry more than one agreement and more than one signer per agreement —
signer roles are `client`, `co_client`, `agent`, `other`.

The client signs at `/agreements/sign/<tenant>/<token>` from a link you send.
Each signature is recorded in a hash-chained Ed25519 audit log (ESIGN Act +
UETA), and produces a server-rendered signed PDF plus a Certificate of
Completion. Anyone can check a signature at `/v/<token>` (the QR code printed on
the PDF), or offline at `/verify` — the offline verifier deliberately does not
call your server, so a signature stays checkable independently of you.

Inspectors can optionally pre-sign.

---

← [The inspection hub](the-inspection-hub.md) · [All guides](README.md) · [The inspection editor](the-inspection-editor.md) →
