---
domain: "Multi Cloud & Engine Agnostic"
related_code_paths: ["src/ports/", "src/adapters/"]
core_rule: "Never use cloud-specific SDKs natively in core domains. Adhere to WinterCG web standards (Request/Response) and abstract database queries via Drizzle ORM."
---
# 05. Multi-Cloud & Cloud-Agnostic Strategy

To ensure the open-source system is truly free from vendor lock-in and can be deployed on Cloudflare, AWS, or Google Cloud, the core architecture must adopt a highly decoupled, cloud-neutral design.

## Key Architecture Pattern: Hexagonal Architecture (Ports and Adapters)

The system strictly prohibits leaking cloud-vendor SDKs (such as `aws-sdk-s3` or `Cloudflare D1 binding`) directly into core business logic files. The entire system enforces strong dependency inversion:

1. **Domain Layer**: Pure TypeScript inspection and customer management logic, completely cloud-agnostic.
2. **Ports**: Clearly defined operation interfaces, such as `IStorageProvider`, `IDatabaseProvider`, `IEmailProvider`.
3. **Adapters**: Concrete vendor-specific implementations at the outermost gateway layer (e.g., `AWSS3Adapter`, `CloudflareR2Adapter`, `GoogleCloudStorageAdapter`). Injected into the business layer at runtime based on environment variables.

## Serverless Edge Computing Standard: WinterCG

To avoid tightly coupling business code to vendor-specific context formats (e.g., AWS Lambda's proprietary `event` JSON payload format):

* **Use Web-standard frameworks (Hono)**: Instead of vendor-specific HTTP parsing. Hono is built entirely on the standard Web Request/Response API (WinterCG proposal).
* **Result**: The same routing and request-handling code runs **without any modification** on:
  - Cloudflare Workers
  - AWS Lambda
  - Google Cloud Functions / Cloud Run
  - Even a self-hosted Node.js / Bun server

## Database Dialect Independence: Full ORM Engine

Minimize SQL dialect coupling. This is critical for smooth data migration between cloud providers.

* **Use modern query builders like Drizzle ORM**: All business-level queries are written in strongly-typed ORM syntax.
* **Transparent switching**: The underlying connection pool can be hot-swapped via a single configuration parameter:
  - Environment A (free deployment): Cloudflare D1 Serverless driver.
  - Environment B (high concurrency): AWS RDS Aurora Serverless v2 PostgreSQL.
  - Environment C (Google Cloud): GCP Cloud SQL.

## Unified Infrastructure as Code (IaC)

Do not rely solely on a specific cloud's UI console or proprietary build scripts (e.g., `wrangler.toml` only targets Cloudflare).

* Production deployment strategies should use multi-cloud infrastructure tools such as **Terraform** or **Pulumi**.
* Provide community users with multiple deployment templates: `aws-deployment-stack` (CDK) and `cloudflare-deployment-stack` (Wrangler/TF).

Through these comprehensive decoupling measures across compute, storage, database, and build layers, the product maintains a platform-neutral open-source core that can seamlessly migrate to any cloud provider at any time.
