# Security Policy

## Supported Versions

Currently, only the `main` branch is supported for security updates.

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0.0 | :x:                |

## Reporting a Vulnerability

We take the security of OpenInspection seriously. If you believe you have found a security vulnerability, please report it to us by following these steps:

1.  **Do not open a public GitHub issue.** This allows us to fix the issue before it's exploited.
2.  Report the vulnerability directly via **[GitHub Security Advisories](https://github.com/InspectorHub/OpenInspection/security/advisories/new)**. This is the most secure way to transmit details privately to our team.
3.  Include as much detail as possible:
    *   Type of issue (e.g., SQL injection, XSS, RCE)
    *   Steps to reproduce
    *   Potential impact
    *   (Optional) Proposed fix or mitigation

### Response Time

We will acknowledge receipt of your report within 48 hours and provide a preliminary assessment of the issue. We aim to resolve critical issues within 7 days.

## Disclosure Policy

Once a fix is implemented and verified, we will:
1.  Release a new version.
2.  Publish a security advisory if appropriate.
3.  Credit the researcher (if desired).

## Security Best Practices for Deployers

- **JWT_SECRET**: Ensure your `JWT_SECRET` is at least 32 characters long and cryptographically secure. The `setup:cloudflare` script handles tokens automatically.
- **WAF**: Enable Cloudflare WAF (Web Application Firewall) on your Worker's route for additional protection against common attacks.
- **Access Logs**: Review your Cloudflare Logs regularly to detect suspicious activity.
