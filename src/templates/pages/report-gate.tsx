import type { FC } from 'hono/jsx';

interface ReportGateProps {
    reason: 'payment' | 'agreement';
    companyName: string;
    primaryColor: string;
    actionUrl: string;
    actionLabel: string;
}

export const ReportGatePage: FC<ReportGateProps> = ({
    reason, companyName, primaryColor, actionUrl, actionLabel,
}) => {
    const icon = reason === 'payment' ? '💳' : '📝';
    const title = reason === 'payment'
        ? 'Payment Required to View Report'
        : 'Agreement Signature Required';
    const message = reason === 'payment'
        ? 'Please complete payment to access the full inspection report.'
        : 'Please sign the inspection agreement before viewing the report.';

    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{title} — {companyName}</title>
                <style>{`
                    body { font-family: system-ui, sans-serif; background: #f8fafc;
                           display: flex; align-items: center; justify-content: center;
                           min-height: 100vh; margin: 0; }
                    .card { background: white; border-radius: 16px; padding: 48px 40px;
                            max-width: 440px; width: 100%; text-align: center;
                            box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
                    .icon { font-size: 48px; margin-bottom: 16px; }
                    h1 { font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 12px; }
                    p  { font-size: 14px; color: #64748b; margin: 0 0 28px; line-height: 1.6; }
                    a  { display: inline-block; padding: 12px 28px; border-radius: 99px;
                         background: var(--brand); color: white; font-weight: 700;
                         font-size: 14px; text-decoration: none; }
                    .brand { margin-top: 32px; font-size: 12px; color: #94a3b8; }
                `}</style>
                <style>{`:root { --brand: ${primaryColor}; }`}</style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">{icon}</div>
                    <h1>{title}</h1>
                    <p>{message}</p>
                    <a href={actionUrl}>{actionLabel}</a>
                    <div class="brand">{companyName}</div>
                </div>
            </body>
        </html>
    );
};
