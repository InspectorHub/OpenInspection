import { type SignatureUser } from '../../lib/inspector-signature';
import { escapeHtml, type Constructor } from './base';

/**
 * Agreement e-sign email methods: signing request, signed-confirmation, and
 * the post-completion evidence-pack delivery. Mixed into EmailService —
 * see `email.service.ts`.
 */
export function AgreementEmailMixin<TBase extends Constructor>(Base: TBase) {
    return class AgreementEmail extends Base {
        /**
         * Sends an agreement signing request email to a client.
         *
         * Sprint B-4a — appends the inspector's signature when caller passes
         * `inspector` + `host`.
         */
        async sendAgreementRequest(to: string, clientName: string | null, agreementName: string, signUrl: string, inspector?: SignatureUser, host?: string) {
            const name = escapeHtml(clientName || 'Client');
            const fallbackBody = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
                <h2 style="color: #4f46e5;">Document Ready to Sign</h2>
                <p>Hi ${name},</p>
                <p>You have been asked to review and sign the following agreement:</p>
                <p style="font-weight: bold; color: #1e293b;">${escapeHtml(agreementName)}</p>
                <div style="margin: 32px 0;">
                    <a href="${signUrl}" style="background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Review &amp; Sign Agreement</a>
                </div>
                <p style="font-size: 14px; color: #64748b;">If the button doesn't work, copy and paste this link: ${signUrl}</p>
                <p style="color: #64748b; font-size: 14px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px;">
                    Thank you,<br>${this.appName} Team
                </p>
            </div>`;
            const rendered = this.renderWithSignature(
                'agreement-request',
                { clientName: clientName ?? 'Client', agreementName, signUrl },
                `Please sign: ${agreementName}`,
                fallbackBody,
                inspector,
                host,
            );
            if (!rendered.enabled) return;
            await this.sendEmail(
                [to],
                rendered.subject,
                rendered.html,
                undefined,
                { inspector },
            );
        }

        /**
         * Sprint 1 C-8 — sends a calm, branded confirmation email after a
         * client signs an inspection agreement. CC's the inspector so both
         * parties have a record. All styles inlined per email-client rules
         * (many clients strip <style> blocks).
         *
         * @param to              Client email address (signer)
         * @param ccs             Optional CC list (typically the inspector)
         * @param clientName      Signer name as shown in the agreement
         * @param propertyAddress Property the agreement covers
         * @param verifyUrl       Public verify URL (Spec 5H envelope verifier)
         * @param confirmationId  Short uppercase confirmation code
         * @param signedAtUtc     ISO timestamp of the signature event
         * @param ipAddress       IP recorded with the signature (audit-trail)
         */
        async sendAgreementSignedConfirmation(
            to:               string,
            ccs:              string[],
            clientName:       string,
            propertyAddress:  string,
            verifyUrl:        string,
            confirmationId:   string,
            signedAtUtc:      string,
            ipAddress:        string | null,
            inspector?:       SignatureUser,
            host?:            string,
        ) {
            const escape = escapeHtml;
            const fallbackHtml = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <h1 style="margin:0 0 8px 0;font-size:18px;font-weight:600;line-height:1.4;color:#0f172a;">Agreement signed</h1>
              <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#64748b;">
                Thank you, ${escape(clientName)}. Your inspection agreement for
                <strong style="color:#0f172a;">${escape(propertyAddress)}</strong>
                is signed and on file.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 16px 32px;">
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">
                  Signed: ${escape(signedAtUtc)}<br>
                  IP: ${escape(ipAddress || 'recorded')}<br>
                  Confirmation: ${escape(confirmationId)}
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 32px 32px;">
              <a href="${verifyUrl}" style="display:inline-block;background:#6366f1;color:#ffffff;padding:10px 18px;border-radius:6px;font-size:13px;font-weight:700;text-decoration:none;">View signed agreement</a>
              <p style="margin:16px 0 0 0;font-size:11px;line-height:1.5;color:#94a3b8;">
                If the button does not work, paste this URL into your browser:<br>
                <span style="color:#64748b;word-break:break-all;">${verifyUrl}</span>
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0 0;font-size:11px;color:#94a3b8;">Sent by ${escape(this.appName)}</p>
      </td>
    </tr>
  </table>
</body>
</html>`;

            const rendered = this.renderWithSignature(
                'agreement-signed',
                { clientName, propertyAddress, verifyUrl, confirmationId, signedAtUtc, ipAddress: ipAddress ?? 'recorded' },
                `Agreement signed — ${propertyAddress}`,
                fallbackHtml,
                inspector,
                host,
            );
            if (!rendered.enabled) return;
            const recipients = [to, ...ccs.filter(Boolean).filter(e => e && e !== to)];
            await this.sendEmail(
                recipients,
                rendered.subject,
                rendered.html,
                undefined,
                { inspector },
            );
        }

        /**
         * Spec 5H P4 — delivers the signed agreement PDF and evidence pack ZIP
         * to the client after the sign-completion workflow finishes.
         *
         * Called by Step 5 (email-parties) of SignCompletionWorkflow. Best-effort:
         * silently no-ops when RESEND_API_KEY is absent (mirrors the existing
         * `sendEmail` guard). The two binary attachments are converted to base64
         * using the same `arrayBufferToBase64` helper used throughout this class.
         *
         * @param to               Client email address
         * @param clientName       Signer name shown in the greeting
         * @param envelopeId       Agreement request ID (used as display reference)
         * @param verifyUrl        Public verification URL for the signed document
         * @param signedPdfBytes   Raw bytes of the signed agreement PDF
         * @param evidenceZipBytes Raw bytes of the evidence pack ZIP
         */
        async sendEvidencePack(params: {
            to: string;
            clientName: string;
            envelopeId: string;
            verifyUrl: string;
            signedPdfBytes: Uint8Array;
            evidenceZipBytes: Uint8Array;
        }): Promise<void> {
            const { to, clientName, envelopeId, verifyUrl, signedPdfBytes, evidenceZipBytes } = params;
            const escape = escapeHtml;
            const name = escape(clientName);
            const fallbackHtml = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <h1 style="margin:0 0 8px 0;font-size:18px;font-weight:600;line-height:1.4;color:#0f172a;">Your signed agreement</h1>
              <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#64748b;">
                Hi ${name}, your signed agreement and full evidence pack are attached to this email for your records.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 16px 32px;">
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">
                  Envelope: ${escape(envelopeId)}<br>
                  Attachments: signed-agreement.pdf · evidence-pack.zip
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 32px 32px;">
              <a href="${verifyUrl}" style="display:inline-block;background:#6366f1;color:#ffffff;padding:10px 18px;border-radius:6px;font-size:13px;font-weight:700;text-decoration:none;">Verify signed agreement</a>
              <p style="margin:16px 0 0 0;font-size:11px;line-height:1.5;color:#94a3b8;">
                If the button does not work, paste this URL into your browser:<br>
                <span style="color:#64748b;word-break:break-all;">${verifyUrl}</span>
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0 0;font-size:11px;color:#94a3b8;">Sent by ${escape(this.appName)}</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
            const rendered = this.renderOr('evidence-pack', { clientName, envelopeId, verifyUrl }, {
                subject: 'Your signed agreement',
                html: fallbackHtml,
            });
            if (!rendered.enabled) return;
            await this.sendEmail(
                [to],
                rendered.subject,
                rendered.html,
                [
                    { filename: 'signed-agreement.pdf', content: signedPdfBytes.buffer as ArrayBuffer, contentType: 'application/pdf' },
                    { filename: 'evidence-pack.zip',    content: evidenceZipBytes.buffer as ArrayBuffer, contentType: 'application/zip' },
                ],
            );
        }
    };
}
