# OpenInspection (Open Source Edition)

OpenInspection is a standalone, single-tenant inspection engine built for the edge. It allows you to run your entire home inspection business on your own Cloudflare account with zero monthly software fees.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/InspectorHub/OpenInspection)


## A Simplified Architecture

The Open Source version is designed as a **Single-Workspace System**. This means one deployment serves one business. This architecture prioritizes simplicity, ease of deployment, and total data ownerhsip.

---

## Core Capabilities

- **Inspector Dashboard**: Manage your jobs, clients, and reports in one place.
- **Online Booking**: A built-in public scheduler with Turnstile bot protection.
- **Mobile Field Form**: Collect data on-site with a mobile-first, offline-capable form.
- **Professional Reports**: Branded HTML reports with e-signatures and payment integration.
- **AI-Powered Assistance**: Use Gemini AI to refine your comments and generate defect summaries.

### 1. Zero-Setup (Web-First)
The fastest way to get started. No local Node.js required:
1. Click the **Deploy to Cloudflare** button above.
2. Follow the Cloudflare dashboard prompts to create your D1 database and KV namespace.
3. Once deployed, visit your Worker URL (e.g., `https://openinspection.workers.dev/setup`).
4. A 6-digit setup code will be automatically generated and logged by the system. Enter this code to initialize your admin account.

> **Note**: If you don't see the setup code in your deployment logs, run `npm run setup:cloudflare -- --refresh-setup-code` after deployment to generate a new one.


### 2. Automated Install (CLI-First)
Recommended for developers who want to manage the system via terminal:
```bash
git clone https://github.com/InspectorHub/OpenInspection
cd OpenInspection
npm install
npm run setup:cloudflare
```

The script will create your database (D1), object storage (R2), and configuration cache (KV) automatically.

### 2. Manual Configuration
1. Set `SINGLE_TENANT_ID = "00000000-0000-0000-0000-000000000000"` in your `wrangler.toml`.
2. Apply database migrations: `npm run db:migrate:remote`.
3. Deploy your worker: `npm run deploy`.

## Support & Scalability

- **Scaling for Private Use**: If you need to manage multiple separate businesses, simply deploy multiple instances of OpenInspection. Each instance is completely isolated, ensuring maximum security and data privacy.
- **Community Support**: Check the GitHub Discussions or browse the [Architecture Guide](./docs/architecture.md).

## Tech Stack
- **Cloudflare Workers**: High-performance edge computing.
- **Hono**: Ultrafast web framework.
- **Drizzle ORM**: Type-safe database management.
- **Tailwind CSS**: Modern UI styling.

## License
[GNU Affero General Public License v3.0](./LICENSE).
