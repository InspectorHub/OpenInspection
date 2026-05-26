# Getting Started

A quick walkthrough of the OpenInspection workflow — from setup to published report.

## Setup

After deploying (see [`developers/02_deploy.md`](developers/02_deploy.md)), visit `/setup` to create your admin account. A 6-digit verification code is logged on first boot.

## Core Workflow

### 1. Create an Inspection

**Dashboard** (`/dashboard`) → **+ New Inspection**

Enter the property address, client name/email, select a template, assign an inspector, and pick a date. The inspection starts in `draft` status.

### 2. Field Collection

Open the inspection → **Field Form** (`/inspections/:id/form`).

- Template sections appear as a scrollable checklist
- Rate items 1-5 via keyboard, or use the rating picker
- Type `/` to open the canned comment snippet picker (250+ pre-written comments)
- Take photos directly — they upload to R2 and attach to the item
- **Works offline** — data saves to IndexedDB and syncs when connectivity returns

### 3. Publish the Report

When field work is complete, click **Publish**. This:
- Creates a versioned report snapshot
- Emails the client a link to the report viewer
- Report is accessible at `/report/:id` (branded, print-friendly)

Clients can sign agreements and pay via Stripe if configured.

### 4. Booking (Optional)

Enable public booking so clients can self-schedule:
- **Settings → Services** — define inspection types with pricing
- **Settings → Availability** — set weekly schedule + date overrides
- Share your booking link: `/book/:tenant/:inspector-slug`
- Turnstile bot protection included

An embeddable iframe widget is also available at `/embed/:tenant/:slug`.

## Templates

Templates define the inspection checklist structure. Manage them at **Templates** (`/templates`).

- 9 item types: rich (rated), boolean, text, number, select, date, photo-only, and more
- Configurable rating systems (e.g., 3-level, 5-level, TREC)
- **Import from Spectora**: paste your Spectora export JSON → one-click import

Community templates are available in the **Marketplace** (`/marketplace`).

## Team

**Settings → Team** to invite inspectors. Roles:

| Role | Access |
|---|---|
| Owner | Full access + billing + team management |
| Admin | Full access except billing |
| Inspector | Own inspections + field form + reports |
| Agent | Referral tracking + assigned inspection reports |

## Key Pages

| Page | URL | Purpose |
|---|---|---|
| Dashboard | `/dashboard` | Inspection list, stats, filters |
| Inspection Editor | `/inspections/:id` | 3-pane editor with sections, items, photos |
| Field Form | `/inspections/:id/form` | Mobile-first field collection |
| Templates | `/templates` | Manage inspection checklists |
| Contacts | `/contacts` | Client and agent CRM |
| Calendar | `/calendar` | Schedule view |
| Settings | `/settings/*` | Workspace config, integrations, billing |
| Public Booking | `/book/:tenant/:slug` | Client self-scheduling |
| Report Viewer | `/report/:id` | Client-facing inspection report |
