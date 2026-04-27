import { BrandingConfig } from '../../types/auth';

export const BareLayout = (props: { title: string, children: unknown, branding?: BrandingConfig | undefined, extraHead?: JSX.Element }): JSX.Element => {
    const { title, children, branding, extraHead } = props;
    const rawPrimaryColor = branding?.primaryColor || '#6366f1';
    const safePrimaryColor = /^#[0-9a-fA-F]{3,8}$/.test(rawPrimaryColor) ? rawPrimaryColor : '#c85a2a';
    const rawGaId = branding?.gaMeasurementId;
    const safeGaId = /^G-[A-Z0-9]+$/.test(rawGaId || '') ? rawGaId : '';

    return (
        <html lang="en" class="scroll-smooth">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{title}</title>
                <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
                <script defer src="https://unpkg.com/@alpinejs/collapse@3.14.9/dist/cdn.min.js"></script>
                <script defer src="https://unpkg.com/alpinejs@3.14.9/dist/cdn.min.js"></script>
                <link rel="stylesheet" href="/styles.css" />
                <style dangerouslySetInnerHTML={{ __html: `
                    :root {
                        --primary-color: ${safePrimaryColor};
                        --primary-glow: ${safePrimaryColor}40;
                    }
                    body { font-family: 'Inter', sans-serif; }
                    .glass { background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.3); }
                ` }} />

                {extraHead}

                {safeGaId && (
                    <>
                        <script async src={`https://www.googletagmanager.com/gtag/js?id=${safeGaId}`}></script>
                        <script dangerouslySetInnerHTML={{ __html: `
                            window.dataLayer = window.dataLayer || [];
                            function gtag(){dataLayer.push(arguments);}
                            gtag('js', new Date());
                            gtag('config', '${safeGaId}');
                        ` }} />
                    </>
                )}
            </head>
            <body class="bg-[#fdfdfd] text-slate-900 antialiased min-h-screen selection:bg-indigo-100 selection:text-indigo-900">
                {children}
            </body>
        </html>
    );
};

export const MainLayout = (props: { title: string, children: unknown, branding?: BrandingConfig | undefined, extraHead?: JSX.Element }): JSX.Element => {
    const { title, children, branding, extraHead } = props;
    const siteName = branding?.siteName || 'OpenInspection';
    const rawPrimaryColor = branding?.primaryColor || '#6366f1';
    const safePrimaryColor = /^#[0-9a-fA-F]{3,8}$/.test(rawPrimaryColor) ? rawPrimaryColor : '#c85a2a';
    const logoUrl = branding?.logoUrl;
    const rawGaId = branding?.gaMeasurementId;
    const safeGaId = /^G-[A-Z0-9]+$/.test(rawGaId || '') ? rawGaId : '';

    return (
        <html lang="en" class="scroll-smooth">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{title}</title>
                <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
                <script defer src="https://unpkg.com/@alpinejs/collapse@3.14.9/dist/cdn.min.js"></script>
                <script defer src="https://unpkg.com/alpinejs@3.14.9/dist/cdn.min.js"></script>
                <link rel="stylesheet" href="/styles.css" />
                <style dangerouslySetInnerHTML={{ __html: `
                    :root {
                        --primary-color: ${safePrimaryColor};
                        --primary-glow: ${safePrimaryColor}40;
                    }
                    body { font-family: 'Inter', sans-serif; }
                    .glass { background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.3); }
                ` }} />

                {extraHead}

                {safeGaId && (
                    <>
                        <script async src={`https://www.googletagmanager.com/gtag/js?id=${safeGaId}`}></script>
                        <script dangerouslySetInnerHTML={{ __html: `
                            window.dataLayer = window.dataLayer || [];
                            function gtag(){dataLayer.push(arguments);}
                            gtag('js', new Date());
                            gtag('config', '${safeGaId}');
                        ` }} />
                    </>
                )}
            </head>
            <body class="bg-[#f8fafc] text-slate-900 antialiased min-h-screen">
                <div class="flex min-h-screen">
                    {/* Sidebar / Navigation */}
                    <aside class="w-72 bg-white border-r border-slate-200 hidden lg:flex flex-col sticky top-0 h-screen">
                        <div class="p-8 flex items-center gap-4 border-b border-slate-100">
                            <div class="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-100 overflow-hidden ring-4 ring-white">
                                <img src={logoUrl || '/logo.svg'} alt={siteName} class="w-full h-full object-contain" />
                            </div>
                            <span class="text-2xl font-extrabold text-slate-900 tracking-tightest leading-tight">{siteName}</span>
                        </div>
                        
                        <nav class="flex-1 p-6 space-y-2 overflow-y-auto">
                            <a href="/dashboard" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group relative">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z"></path></svg>
                                <span>Inspections</span>
                            </a>
                            <a href="/templates" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                                <span>Templates</span>
                            </a>
                            <a href="/agreements" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                <span>Agreements</span>
                            </a>
                             <a href="/team" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                                <span>Team</span>
                            </a>
                        </nav>
                        
                        <div class="p-6 border-t border-slate-100 bg-slate-50/50">
                             <a href="/settings" class="flex items-center gap-3 px-5 py-4 rounded-2xl text-slate-600 hover:bg-white hover:text-indigo-600 hover:shadow-sm transition-all font-semibold group">
                                <svg class="w-5 h-5 group-hover:rotate-45 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                <span>Settings</span>
                            </a>
                            <button id="logoutBtn" class="w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-red-600 hover:bg-red-50 transition-all font-semibold group mt-2">
                                <svg class="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                                <span>Sign Out</span>
                            </button>
                        </div>
                    </aside>
                    
                    <main class="md:flex-1 w-full bg-[#f8fafc] overflow-y-auto">
                        <div class="max-w-7xl mx-auto py-10 px-6 sm:px-8 lg:px-12">
                            {children}
                        </div>
                    </main>
                </div>
            </body>
        </html>
    );
};
