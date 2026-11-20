# Moving a company to your own deployment

This page describes how to move a company's records from one OpenInspection
deployment to another that you run yourself. It uses the **data package**: a
complete, verifiable copy of a company's records and photos that one deployment
writes and another reads.

Moving is a planned operation with a short period in which the old deployment is
read-only. Plan it, rehearse it, and keep the old deployment for at least 30
days.

## Before you start

- You must be the **owner** of the company on the deployment you are leaving.
  Managers cannot create a data package.
- You need a Cloudflare account able to run the deployment reliably. A free
  account is enough to try the software; see the [deployment guide](deploy.md)
  for what running it needs.
- Decide the web address you will use **before** you import. Links and QR codes
  in documents the new deployment produces are built from `APP_BASE_URL`;
  documents produced earlier keep the address they were produced with.
- Know what does not move. See [What a data package contains](../reference/data-package-format.md).
- Keep your package for as long as your own record-keeping needs require. The
  package is a complete copy of reports, photos and signed agreements.

## What moves and what does not

| Moves | Does not move |
|---|---|
| Inspections, results, reports and report versions | Passwords, two-factor secrets and sessions |
| Templates, agreements, comments, services, contacts | Connection secrets (email, SMS, accounting, calendar, AI keys) |
| Invoices and payment history | Sign-in links for clients and signing links for pending agreements |
| Photos and other stored files | The company slug and domain |
| Settings that exist in the destination | Settings that belong to the hosting arrangement |
| Signed agreements and their evidence, as a read-only archive | Videos stored on Cloudflare Stream (re-upload them) |

Signed agreements are **not** recreated. The destination keeps a byte-identical
archive and can verify it; it never creates, changes or re-signs a signing
record.

## 1. Stand up the destination

1. Deploy a new instance. See [Quickstart](../quickstart.md) and
   [Deploying OpenInspection](deploy.md). Create the two queues and the OAuth KV
   namespace if you use the command-line route.
2. Set `APP_BASE_URL` to your final address.
3. Open `/setup` and choose **Start empty**. Otherwise the starter library will
   already be present.
4. If the package was made on a deployment that used a fixed company id and you
   want your photo and link addresses to stay the same, set `SINGLE_TENANT_ID`
   to the id the package's manifest names, **before** `/setup`.
5. Sign in, create and delete one inspection with a photo, and open `/status`.
6. Run the preflight check against the new instance:

   ```bash
   node scripts/preflight-self-host.mjs --url https://your-instance.example.com
   ```

## 2. Make a data package

The desktop app creates the package on your computer; the browser only shows
job status. On the deployment you are leaving, as the owner, open the desktop
app and use **Settings → Move to another deployment → Leave this workspace**,
then **Make the package**. You are asked for your password (and your
authenticator code if two-factor sign-in is on). The package is built in the
background. Download every file listed.

The package contains your clients' personal information: store it on an
encrypted drive and delete it when you no longer need it.

Check it before you rely on it:

```bash
node scripts/verify-data-package.mjs <folder-with-the-package>
```

The script reads the package offline and prints how many files and signed
records it checked and how many failed, side by side. It exits non-zero on any
failure.

## 3. Rehearse

On the destination, in the desktop app use **Settings → Move to another
deployment → Arrive at this workspace**.

1. Choose the package file. It is verified on your computer before anything is
   sent to the server.
2. Read the preview. It lists what will be added, what is skipped and why.
3. Restore, then check the destination: compare the counts against the source.
4. Press **Undo import** and watch it disappear. Undoing an import permanently
   deletes every row and photo it created — including any edits made since —
   and leaves everything the destination had before untouched.

## 4. Cut over

1. On the deployment you are leaving, make it read-only while you move so the
   package matches the state you reviewed. Anyone editing should finish first.
   How you do this depends on your deployment.
2. Make a **new** package and verify it. Do not reuse the rehearsal package:
   edits made after it are not in it.
3. Restore it on the destination and verify it: compare the counts, spot-check
   several inspections, check the signed records, and check that photos render.
4. Reconnect what did not move (email, payments, accounting, calendars, SMS,
   AI) and invite your team. People set their own passwords.
5. Update your own website links and booking-widget embeds to the new address.
6. Keep the old deployment read-only for at least 30 days. Rolling back after
   work has started on the destination loses that work.

## If it goes wrong

| Message | Meaning | What to do |
|---|---|---|
| "made by a newer version" | The package needs a newer release | Update the destination, then retry |
| "stopped for today" | The destination's daily write allowance was reached | Continue tomorrow, or use a paid plan |
| "file looks damaged" | A file did not match its checksum | Download that file again |
| A report is not visible to a client | It was gated before the move (agreement or payment outstanding) | The gate is carried over; resolve it as you would have before |

The import is resumable: close the page and come back. Applying the same
package twice creates nothing new.

## Large packages

The desktop upload is resumable but slow on a home connection. You can place
the package files in the inbound location of the destination's storage bucket
with any S3-compatible tool and start the import from there. See
[Data package format](../reference/data-package-format.md).

## What the import never does

It does not send email, text messages or webhooks. It does not contact your
clients. It does not change or recreate any signing record.

## Imported reports are read-only

A report that came in with an import cannot be edited, re-signed or re-sent.
You can open it, download it, and **copy it as a new report**: the copy is an
ordinary new inspection with the findings you choose (ratings, notes,
optionally photos), and it carries none of the original's signed, published or
payment state.
