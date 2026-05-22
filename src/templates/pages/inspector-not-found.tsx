import { raw } from 'hono/html';

interface Props {
    slug: string;
    companyName?: string | undefined;
}

const NOT_FOUND_STYLES = `
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: #fafaf7; color: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
.card { max-width: 420px; text-align: center; }
.title { font-family: 'Fraunces', Georgia, serif; font-size: 32px; margin: 0 0 16px; font-weight: 600; }
.body { color: #475569; line-height: 1.6; font-size: 15px; }
code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; }
html[data-color-scheme="dark"] body { background: #0b1120; color: #f1f5f9; }
html[data-color-scheme="dark"] .body { color: #cbd5e1; }
html[data-color-scheme="dark"] code { background: rgba(255,255,255,0.06); color: #cbd5e1; }
`;

/**
 * Booking #7 Sprint C-1 — friendly 404 served when /inspector/<slug> doesn't
 * resolve to a real user. The slug echo helps customers spot typos at a glance.
 */
export const InspectorNotFoundPage = ({ slug, companyName }: Props): JSX.Element => (
    <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Inspector not found</title>
            <script dangerouslySetInnerHTML={{ __html: `(function(){try{var L=localStorage.getItem('ih-color-scheme');if(L&&!localStorage.getItem('oi-color-scheme'))localStorage.setItem('oi-color-scheme',L);if(L)localStorage.removeItem('ih-color-scheme');}catch(e){}var s=localStorage.getItem('oi-color-scheme');var p=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-color-scheme',s==='dark'||(s===null&&p)?'dark':'light');})()`}} />
            <link rel="stylesheet" href="/fonts.css" />
            {raw(`<style>${NOT_FOUND_STYLES}</style>`)}
        </head>
        <body>
            <div class="card">
                <h1 class="title">Inspector not found</h1>
                <p class="body">
                    We couldn't find an inspector with the link <code>/inspector/{slug}</code>
                    {companyName ? ` at ${companyName}` : ''}. Double-check with whoever shared the link.
                </p>
            </div>
        </body>
    </html>
);
